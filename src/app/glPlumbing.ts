/**
 * The rendering plumbing: the per-tier art sources, the two WebGL compositors, and
 * the GPU↔CPU parity probes.
 *
 * This is the layer between "what the room looks like" (src/render/*) and "paint a
 * frame" (draw() in main.ts). It builds a ClassicArtSource or EnhancedArtSource for
 * the current room and caches it until the room changes, lazily creates the GL
 * compositors, presents their output onto #screen-gl, and owns the
 * disabled-for-this-session GL failure flags.
 *
 * ── The seam ──────────────────────────────────────────────────────────────────
 * The cleanest boundary left in main.ts: eight names in, nothing written back. The
 * two GL failure flags moved down here with the code that owns them, so the only
 * write that used to cross the seam — drawCutscene giving up on its own present —
 * is now a call to markGlFailed(). Everything else this module exports is read
 * through ES live bindings, so main.ts sees current values with no accessors.
 *
 * initGlPlumbing() is called from main.ts at the point this code used to sit, and module
 * scope here is entirely side-effect-free — including the context-loss listeners, which
 * initGlPlumbing() attaches rather than module scope. See its comment for why.
 */
import { Room } from '../core/room.js';
import type { ArtSource } from '../render/artSource.js';
import { ClassicArtSource } from '../render/classicArtSource.js';
import { EnhancedArtSource } from '../render/enhancedArtSource.js';
import type { EnhancedArt, EnhancedObject, FishSprites } from '../render/enhancedArtSource.js';
import { GlAiScreen } from '../render/glRoomAi.js';
import { GlScreen, webgl2Available } from '../render/glScreen.js';
import { renderRoomInto, renderRoomRgba } from '../render/renderRoom.js';
import type { RenderOptions } from '../render/renderRoom.js';
import { AiRoom } from '../render/roomAi.js';
import type { AiRoomFrame } from '../render/roomAi.js';
import { SubtitleSystem } from '../render/subtitles.js';
import { cheatFishSprites } from './cheats.js';
import { glCanvas } from './dom.js';
import { count, room, subs } from './gameState.js';
import type { RoomGeometry } from './layout.js';

/** What this module needs to see of the running game. All read-only. */
/**
 * Five members, down from eight. `count`, `room` and `subs` are imported from
 * `gameState.ts` now — live bindings, so this module sees them change with no accessor
 * and no wiring in main.ts to maintain.
 */
export interface GlPlumbingHost {
  readonly aiRoom: AiRoom | null;
  readonly enhancedArt: EnhancedArt | null;
  readonly enhancedObjects: EnhancedObject[];
  readonly fishSprites: FishSprites | null;
  readonly setInfo: () => void;
}

let host!: GlPlumbingHost;

/**
 * Hand this module its view of the game, and arm the context-loss handlers.
 *
 * The listeners are attached HERE rather than at module scope. An imported module is
 * evaluated before any statement of its importer, so registering them at module scope
 * put them ahead of everything main.ts sequences, which module scope must never do.
 * They were harmless there (glCanvas is detached until buildStage() runs, and a
 * detached canvas cannot lose a context it never had), but "harmless because of a
 * second fact" is a worse invariant than "does not happen". Called once, during boot.
 */
export function initGlPlumbing(h: GlPlumbingHost): void {
  host = h;

  // WebGL context loss (GPU reset, driver reclaim, tab backgrounding) does NOT
  // throw — it fires an event and makes subsequent GL calls silently no-op, which
  // would otherwise leave a blank canvas. Handle it as the real per-frame fallback
  // net: disable the GPU backend for now (→ the dispatch takes the CPU path and
  // hides #screen-gl automatically) and drop the dead compositor so it is rebuilt
  // on the next explicit enable. preventDefault() lets the browser restore the
  // context; on restore we allow a fresh GlScreen to be created.
  glCanvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    glFailed = true;
    glAiFailed = true;
    roomGl.reset();
    aiGl.reset();
    console.warn('[ff] WebGL context lost; falling back to the CPU compositor. Press R to retry WebGL.');
    host.setInfo();
  });
  glCanvas.addEventListener('webglcontextrestored', () => {
    // Allow a rebuild, but stay on CPU until the user re-enables WebGL (R), so a
    // flapping context can never thrash the render path.
    roomGl.reset();
    aiGl.reset();
  });
}


// Set once if a GPU backend throws, disabling it for the session (the CPU compositor
// takes over) so a driver/context failure can never wedge rendering.
//
// One flag PER backend, because they fail independently and share nothing but the
// context. Collapsing them was wrong in both directions: the `ai` tier's ×S buffers are
// an order of magnitude larger than the faithful compositor's, so an AI-only allocation
// failure would have disabled the GPU for `classic`/`enhanced` where it was working
// fine — and conversely, an AI compositor that never built at all left this flag false,
// so the HUD reported a per-frame CPU fallback forever instead of a disabled backend.
//
// They live in this module because this is the GL layer: it sets them on a failed draw
// or a lost context and clears them in enableWebgl(). Readers elsewhere import the live
// bindings.
export let glFailed = false;
export let glAiFailed = false;

/**
 * Give up on the GPU for the rest of the session (the caller falls back to the CPU
 * blit). The one write from outside this layer: drawCutscene's own present can throw
 * independently of the room compositors.
 */
export function markGlFailed(): void {
  glFailed = true;
}

/**
 * The classic art source (room palette → RGBA LUT) for the current room, rebuilt
 * only when the room changes so the compositor's hot path doesn't reallocate the
 * 256-entry table every frame.
 */
let classicArt: ClassicArtSource | null = null;
let classicArtRoom: Room | null = null;
export function classicArtFor(r: Room): ClassicArtSource {
  if (classicArtRoom !== r || classicArt === null) {
    classicArt = new ClassicArtSource(r.palette);
    classicArtRoom = r;
  }
  return classicArt;
}

/**
 * A WebGL compositor built on demand from the stacked #screen-gl canvas, at most once
 * per context: `reset()` (context loss / re-enable) lets the next call rebuild it.
 * Yields null — meaning "use the CPU path" — when WebGL2 is unavailable or construction
 * fails, which is a normal outcome, not an error.
 *
 * There are two of these (the faithful compositor and the `ai` tier's) and they share
 * one canvas and one context: `getContext('webgl2')` returns the context the other one
 * already created. Only the class differs, so only the class is passed in.
 */
function lazyCompositor<T>(what: string, build: (gl: WebGL2RenderingContext) => T) {
  let comp: T | null = null;
  let tried = false;
  return {
    get(): T | null {
      if (tried) return comp;
      tried = true;
      if (!webgl2Available()) return null;
      const gl = glCanvas.getContext('webgl2');
      if (!gl) return null;
      try {
        comp = build(gl);
      } catch (e) {
        console.warn(`[ff] the ${what} WebGL compositor failed to build; staying on the CPU path`, e);
        comp = null;
      }
      return comp;
    },
    /** Drop the built compositor so the next `get()` rebuilds it. */
    reset(): void {
      comp = null;
      tried = false;
    },
    /** Allow a rebuild only if nothing is live — a cpu→webgl toggle must not leak one. */
    allowRebuild(): void {
      if (!comp) tried = false;
    },
  };
}

const roomGl = lazyCompositor('room', (gl) => new GlScreen(gl));
const aiGl = lazyCompositor('ai tier', (gl) => new GlAiScreen(gl));
export const glCompositor = (): GlScreen | null => roomGl.get();
export const glAiCompositor = (): GlAiScreen | null => aiGl.get();

// WebGL context loss (GPU reset, driver reclaim, tab backgrounding) does NOT
// throw — it fires an event and makes subsequent GL calls silently no-op, which
// would otherwise leave a blank canvas. Handle it as the real per-frame fallback
// net: disable the GPU backend for now (→ the dispatch takes the CPU path and
// hides #screen-gl automatically) and drop the dead compositor so it is rebuilt
// on the next explicit enable. preventDefault() lets the browser restore the
// context; on restore we allow a fresh GlScreen to be created.

/**
 * Clear the WebGL disabled-for-session state so both GPU backends can run again.
 * Rebuilds a compositor only if none is live (i.e. after a context loss); a normal
 * cpu→webgl toggle keeps the existing ones rather than leaking them.
 */
export function enableWebgl(): void {
  glFailed = false;
  glAiFailed = false;
  roomGl.allowRebuild();
  aiGl.allowRebuild();
}

/**
 * The enhanced art source for the current room + currently-loaded FFNG art,
 * rebuilt only when the room or its decoded art/objects/fish change (so the
 * per-frame hot path doesn't reallocate the palette LUT). Used for every room in
 * enhanced mode — the source itself falls back to classic per element where no
 * truecolor art exists.
 */
let enhArt: EnhancedArtSource | null = null;
let enhKey: [Room | null, EnhancedArt | null, EnhancedObject[], FishSprites | null] = [null, null, [], null];
export function enhancedArtFor(r: Room): EnhancedArtSource {
  const fish = cheatFishSprites ?? host.fishSprites; // xundead/xmorph reshape these
  if (
    enhArt === null ||
    enhKey[0] !== r ||
    enhKey[1] !== host.enhancedArt ||
    enhKey[2] !== host.enhancedObjects ||
    enhKey[3] !== fish
  ) {
    enhArt = new EnhancedArtSource(r.palette, host.enhancedArt, host.enhancedObjects, fish);
    enhKey = [r, host.enhancedArt, host.enhancedObjects, fish];
  }
  return enhArt;
}


/**
 * WebGL draw path: composite the room on the GPU via the shared renderInto
 * (GlScreen) — either art source (classic palette or enhanced FFNG truecolor) —
 * and present to #screen-gl. Returns false to request the CPU fallback if a GL
 * call throws (the backend is then disabled for the session) or, defensively, if
 * the compositor ever flags a frame `unsupported`. Never throws.
 */
export function drawGpu(
  geom: RoomGeometry,
  art: ArtSource,
  opts: RenderOptions,
  useVecSubs: boolean,
): boolean {
  const gl = glCompositor();
  if (!gl || !room) return false;
  try {
    gl.begin(geom.nativeW, geom.nativeH, room.palette);
    renderRoomInto(gl, room, art, opts);
    if (gl.unsupported) return false; // defensive: an un-ported primitive → CPU this frame
    if (!useVecSubs) subs?.draw(gl, opts.count ?? 0); // baked subtitles via GPU setIndex
    presentToGlCanvas(gl, geom);
    return true;
  } catch (e) {
    glFailed = true;
    console.warn('[ff] WebGL renderer failed; falling back to the CPU compositor for this session', e);
    return false;
  }
}

/**
 * WebGL draw path for the `ai` tier: composite the room's ×S frame on the GPU via the
 * shared room walk (AiRoom.drawInto → GlAiScreen) and present it to #screen-gl.
 * Returns false to request the canvas-2D fallback — when the compositor could not be
 * built, when the GPU cannot hold this room's ×S buffer, when a primitive could not run,
 * or when a GL call throws (which disables this backend for the session). Never throws.
 */
export function drawAiGpu(geom: RoomGeometry, r: Room, f: AiRoomFrame): boolean {
  const comp = glAiCompositor();
  if (!comp || !host.aiRoom) return false;
  try {
    comp.track(host.aiRoom); // so evicting the room frees its ~50 MB of textures with it
    // Not a formality: a ×4 room needs up to 3120px, WebGL2 only guarantees 2048, and an
    // oversized allocation is reported as a GL error rather than thrown — so without
    // this the frame would be "successfully" presented blank.
    if (!comp.begin(geom.backingW, geom.backingH)) return false;
    host.aiRoom.drawInto(comp, r, f);
    if (comp.unsupported) return false;
    presentToGlCanvas(comp, geom);
    return true;
  } catch (e) {
    glAiFailed = true;
    console.warn('[ff] the AI tier WebGL compositor failed; falling back to canvas-2D for this session', e);
    return false;
  }
}

/**
 * Size #screen-gl to the room's CSS box at device resolution and present into it.
 *
 * The room's box comes from roomGeometry — the GL canvas is an overlay stacked on
 * #screen, so it must match that box exactly rather than recompute it. Shared by both
 * GPU paths: the compositors differ entirely, the presentation does not.
 */
function presentToGlCanvas(comp: { present(w: number, h: number): void }, geom: RoomGeometry): void {
  const dpr = window.devicePixelRatio || 1;
  const { cssW, cssH } = geom;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (glCanvas.width !== bw || glCanvas.height !== bh) {
    glCanvas.width = bw;
    glCanvas.height = bh;
  }
  glCanvas.style.width = `${cssW}px`;
  glCanvas.style.height = `${cssH}px`;
  comp.present(bw, bh);
}

/**
 * Per-channel diff (ignoring alpha) between two same-size RGBA frames, plus WHERE they
 * disagree worst and what each side holds there.
 *
 * The aggregate alone says a parity probe failed but not where to look, and in a
 * 2400x2100 buffer "0.004% of the pixels are wrong" is a needle in a haystack — so a
 * failing room names its own suspect pixel. `w` (the frame width) turns the index into
 * coordinates; pass 0 when the caller has no use for them.
 *
 * Both are computed in ONE pass. A second sweep is another ~20 MB of pixel traffic per
 * room at this tier's frame sizes, times 72 rooms, on a machine already running the
 * whole probe suite in parallel — and the UI gate's value is that it stays fast enough
 * to run on every change.
 */
export function glChannelDiff(
  cpu: Uint8Array,
  gpu: Uint8Array,
  w = 0,
): {
  max: number;
  rmse: number;
  overPct: number;
  worstAt: [number, number];
  worstCpu: number[];
  worstGpu: number[];
} {
  let max = 0;
  let sumsq = 0;
  let over = 0;
  let px = 0;
  let at = 0;
  const n = gpu.length;
  for (let i = 0; i < n; i += 4) {
    let pixMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(gpu[i + c]! - cpu[i + c]!);
      if (d > pixMax) pixMax = d;
      sumsq += d * d;
      if (d > 2) over++;
      px++;
    }
    if (pixMax > max) { max = pixMax; at = i; }
  }
  const idx = at / 4;
  return {
    max,
    rmse: Math.sqrt(sumsq / px),
    overPct: (over / px) * 100,
    worstAt: w > 0 ? [idx % w, Math.floor(idx / w)] : [idx, 0],
    worstCpu: [cpu[at]!, cpu[at + 1]!, cpu[at + 2]!, cpu[at + 3]!],
    worstGpu: [gpu[at]!, gpu[at + 1]!, gpu[at + 2]!, gpu[at + 3]!],
  };
}

/**
 * Test-only GPU-vs-CPU parity probe: render the current room through both the
 * CPU (`renderRoomRgba`) and the GPU (`renderRoomInto` → GlScreen) with the given
 * art source and compare (max/rmse channel diff, % of channels differing > 2).
 * For the ZX room (gspec=42) the band width + colour cycle are `Math.random`-
 * driven per frame, so the comparison seeds `Math.random` to a constant and
 * snapshots/restores the room's zx state around the two renders — both passes see
 * identical inputs, giving a byte-exact check while the LIVE render stays random.
 */
export function glParityCompare(art: ArtSource): Record<string, unknown> | null {
  if (!room) return null;
  const comp = glCompositor();
  if (!comp) return { webgl: false };
  const opts = { count: count };
  const isZx = room.gspec === 42;
  const realRandom = Math.random;
  // For the ZX room the band width + colour cycle are Math.random-driven and
  // blitZX advances room.zx, so (a) seed Math.random to a constant and (b)
  // snapshot room.zx — rewound between the CPU and GPU passes so both see
  // identical input, and fully restored in `finally` so this probe leaves the
  // live loading-band animation exactly where it found it (no side effects).
  let zxSnap: { pruh: number; count: number; cur: number; colors: number[] | null } | null = null;
  if (isZx) {
    Math.random = () => 0.5;
    const zx = room.zx;
    zxSnap = { pruh: zx.pruh, count: zx.count, cur: zx.cur, colors: zx.colors };
  }
  try {
    const cpu = renderRoomRgba(room, art, opts);
    if (zxSnap) Object.assign(room.zx, zxSnap); // rewind zx so the GPU pass sees identical state
    comp.begin(cpu.width, cpu.height, room.palette);
    renderRoomInto(comp, room, art, opts);
    if (comp.unsupported) return { webgl: true, unsupported: true };
    const gpu = comp.readback();
    if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
    return { webgl: true, w: gpu.w, h: gpu.h, ...glChannelDiff(cpu.rgba, gpu.rgba) };
  } finally {
    if (isZx) {
      Math.random = realRandom;
      if (zxSnap) Object.assign(room.zx, zxSnap); // restore live animation state
    }
  }
}

