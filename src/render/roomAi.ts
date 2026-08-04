/**
 * Hi-res AI room compositor (Phase C of the `ai` graphics tier).
 *
 * Mirrors the enhanced (FFNG truecolor) room look at S× resolution from the
 * AI-upscaled masters staged under public/enhanced-ai/<JMENO>/ (built by
 * tools/studio/build-ai.mjs, which supersedes tools/build-room-ai.mjs for this tier).
 * Like worldMapAi it renders the IDENTICAL GAME STATE — item positions, fish body/head
 * frames, the water-wave parameters and the slide interpolation are all delegated from
 * the same engine that drives the faithful compositor; this file paints them bigger,
 * from bigger art. It renders with canvas-2D drawImage into a ready-made S×-sized 2D
 * context (the #screen canvas), so the browser does the alpha compositing and the caller
 * CSS-scales the result down to the room's display box.
 *
 * Where it is NOT merely "the same pixels, larger", in two distinct senses that are
 * worth keeping apart:
 *
 * 1. RESAMPLING. Having real hi-res art lets an effect the 1998 engine could only
 *    evaluate on the native pixel grid be evaluated on THIS one. Nothing about the
 *    effect's rule changes — only the resolution it is sampled at. Two do this, both on
 *    the GPU backend: the spec=1 mirror reflects with sub-pixel accuracy (drawMirror,
 *    below), and the water wobble is evaluated per fragment, at a fractional shift, at
 *    the sub-tick time (glRoomAi.ts's BG_FS). The canvas-2D fallback keeps the faithful
 *    1998 sampling of the wobble — the tier's one backend-dependent difference,
 *    documented on `AiTarget.background`.
 *
 * 2. AN ADDITION, i.e. a LIBERTY. The ripple trains (`activeRipples`, aiTarget.ts) are
 *    motion the original never had at all: a fine wave that rises through the water
 *    every few seconds. No amount of resolution derives that from the 1998 engine, and
 *    calling it a resampling would be dishonest. It is here because it was asked for and
 *    it looks right, it is confined to this tier and this backend, and it is switchable
 *    (`RIPPLE.amp = 0` restores the pure resampled wobble exactly).
 *
 * Game state, timing and logic are untouched by all of it: nothing above moves an item,
 * changes a tick, or is read by anything the simulation can see.
 *
 * Scope: the wall-over-wobbled background and the object + fish sprites in item
 * z-order, PLUS the effects the faithful path draws from index read-back — the
 * spec=1 mirror (drawMirror), the spec=3/4 elevator double rope (drawRope), the
 * gspec=2 darkness fill and the gspec=5 bonus fish swap — and LODE's destructive
 * falling wreck, replayed into a mutable ×S copy of the background (syncWreck).
 * Anything with no staged FFNG art (un-mapped items, the skeleton and the darkness
 * silhouette) falls back to the room's own palette bitmaps via classicSprite(),
 * mirroring what the enhanced source does. Used whenever `graphics === 'ai'` and the
 * room's AI assets loaded; the caller (aiRoomRenderActive) withholds it for gspec=42
 * (the ZX band render), frames with an active fishing hook, and frames with a CPU-only
 * frame effect running (megabomb flash / silent film / interlaced / the Tetris
 * overlay), all of which the faithful compositor must draw instead. classic/enhanced
 * never touch it.
 */
import { Canvas2dAiTarget, aiImageRevision, markAiImageChanged } from './aiTarget.js';
import type { AiImage, AiTarget, AiWobble } from './aiTarget.js';
import { darkestIndex } from './renderRoom.js';
import { walkRoom, FSIZE, type RoomWalkSink, type FishFrame } from './roomWalk.js';
import { FISH_BODY_FILE, FISH_HEAD_FILE, frameIndex } from './enhancedArtSource.js';
import { withLoadSlot } from './loadSlot.js';
import { wreckDamage, type WreckDamage } from './artSource.js';
import { forEachWreckPixel, wreckFrame } from '../core/room.js';
import type { Room, Item, WreckSwap } from '../core/room.js';
import { FFR_EXTRA, type FfrBitmap } from '../data/ffr.js';

/** Upscale factor of the committed AI room art (must match tools/build-room-ai.mjs AI_SCALE). */
export const AI_ROOM_SCALE = 4;

/**
 * Does this room's background actually have moving water on screen?
 *
 * Two ways it does not, and BOTH matter to the caller that asks: rooms 46 and 66 carry
 * `wamp === 0` in their FFR data, and a gspec=2 darkness room paints a flat fill with no
 * background at all (see `paintBackground`) — CHODBA is the case that bites, because it
 * has `wamp = 5` and only becomes dark when the player switches the light off, so a
 * `wamp`-only test says "animating" for a frame that cannot change by a single pixel.
 *
 * Exported because the render loop needs the same answer to decide whether an idle room
 * is worth waking for (main.ts `aiWaterAnimating`), and that decision costs a ×S
 * composite per wake. One definition, so the loop and the compositor cannot disagree
 * about whether there is any water.
 */
export function aiWaterVisible(room: Room): boolean {
  return room.gspec !== 2 && room.wamp !== 0;
}

/**
 * The purely-data half of the "may the AI compositor draw this frame?" rule, split out
 * of main.ts's aiRoomRenderActive so it has ONE definition that tests can import. The
 * caller supplies the module state it cannot see (tier, loaded art, current room).
 *
 * Named fields rather than positional flags on purpose: this gate takes five inputs,
 * three of them boolean, and this codebase has already shipped a bug where an
 * argument slid into the wrong positional slot and failed silently.
 *
 * A frame is withheld when:
 *  - gspec 42, the ZX-Spectrum band render — its per-scanline bands are an index effect
 *    and the low-fi look is the point;
 *  - any fishing hook is active — the faithful path draws hooks on top from the palette;
 *  - a CPU-only frame effect is running (megabomb flash / silent film / interlaced /
 *    the Tetris overlay) — those are applied by the faithful compositor as it builds the
 *    frame, so this path would silently render without them;
 *  - a sprite cheat (xundead / xmorph) is reshaping the fish — those transform the
 *    classic sprite sheet that the enhanced tier re-derives from, while this path blits
 *    pre-baked AI fish frames that no cheat can reach;
 *  - a subtitle is on screen that has to be BAKED into the frame (the vector overlay is
 *    unavailable because no subtitle font loaded). The faithful compositor bakes it in
 *    applyFrameEffects; this path has no equivalent, so it would drop the line entirely.
 *    Falling back costs resolution for those frames, which is far better than losing
 *    dialogue — and it only happens when every bundled font failed to load.
 *
 * LODE's falling wreck USED to be a sixth condition: the ship destroys the room
 * background per pixel, which static ×S bitmaps cannot represent, so the tier handed the
 * frame back and the room visibly dropped from ×4 to native mid-fall. `AiRoom.syncWreck`
 * now replays those swaps into a mutable ×S copy, so the condition is gone rather than
 * merely satisfied. Of the remaining five, only gspec=42 is reachable in normal play.
 */
export interface AiRoomGateInput {
  gspec: number;
  hookStates: readonly number[];
  frameEffects: boolean;
  /** xundead / xmorph active — the AI fish cache cannot reflect them. */
  spriteCheatsActive: boolean;
  /** A subtitle is showing and must be baked into the frame rather than overlaid. */
  bakedSubsNeeded: boolean;
}

export function aiRoomGateAllows(g: AiRoomGateInput): boolean {
  if (g.gspec === 42) return false;
  if (g.hookStates.some((s) => s !== 0)) return false;
  if (g.frameEffects) return false;
  if (g.spriteCheatsActive) return false;
  if (g.bakedSubsNeeded) return false;
  return true;
}

/** Staged skeleton body (FFR frame TL_KOSTRA=19, absent from FISH_BODY_FILE). */
const SKELETON_FILE = 'body_skeleton_00.png';

/**
 * A mutable straight-RGBA buffer the ×S wreck replay exchanges pixels through.
 *
 * `ox`/`oy` are the buffer's top-left corner in the FULL ×S art, so the caller can hand
 * over a WINDOW of the background instead of the whole thing: at ×4 LODE's background is
 * 2760×2280 (25 MB) and each swap touches at most one ship footprint (≤780×508), so
 * reading and writing back only that rect is what keeps this affordable — and keeps the
 * canvas, not a second full-size array, as the single source of truth.
 */
export interface AiWreckSurface {
  readonly data: Uint8ClampedArray;
  readonly w: number;
  readonly h: number;
  readonly ox: number;
  readonly oy: number;
}

/**
 * Replay ONE recorded KresliLod swap (Room.applyWreckSwap, core/room.ts:277) into ×S art.
 *
 * The native exchange is `ship[sp] <-> bg[bp]` on the palette plane; at ×S every native
 * pixel is an S×S block, so this exchanges the block. How a recorded swap is DECODED into
 * positions — the row-major offset, the `- FFR_EXTRA` padded-column offset, the sprite
 * bounds — is not restated here: `forEachWreckPixel` (core/room.ts) owns it, and the
 * enhanced tier's `syncWreck` reads the same history through the same function. Only the
 * ×S art bounds and the block exchange below belong to this tier.
 *
 * **Alpha is deliberately NOT exchanged; both sides are forced opaque.** The faithful
 * path swaps palette INDICES, which carry no alpha at all, so opaque is the honest ×S
 * analogue. It also has to be: the GPU background pass writes `outColor.a = 1.0`
 * (glRoomAi.ts BG_FS) while canvas-2D keeps whatever alpha the background carries, so a
 * sub-255 pixel here — which a ×4 block around an opaque native pixel can easily pick up
 * from an anti-aliased sprite edge — would make the two backends disagree. Keeping every
 * written pixel opaque additionally makes the getImageData/putImageData round-trip that
 * feeds `bg` lossless, since premultiplying by 1 is the identity.
 *
 * `artW`/`artH` are the FULL ×S art size and clip to it; `bg` may be a WINDOW of that art
 * (see AiWreckSurface), which is what production passes.
 */
export function applyWreckSwapScaled(
  bg: AiWreckSurface,
  sprite: AiWreckSurface,
  swap: WreckSwap,
  scale: number,
  artW: number,
  artH: number,
): void {
  const S = scale;
  forEachWreckPixel(swap, Math.round(sprite.w / S), Math.round(sprite.h / S), (i, j, dx, dy) => {
    if (dy < 0 || dy * S >= artH) return;
    if (dx < 0 || dx * S >= artW) return;
    for (let by = 0; by < S; by++) {
      const sy = i * S + by - sprite.oy;
      const ty = dy * S + by - bg.oy;
      if (sy < 0 || sy >= sprite.h || ty < 0 || ty >= bg.h) continue;
      for (let bx = 0; bx < S; bx++) {
        const sx = j * S + bx - sprite.ox;
        const tx = dx * S + bx - bg.ox;
        if (sx < 0 || sx >= sprite.w || tx < 0 || tx >= bg.w) continue;
        const sp = (sy * sprite.w + sx) * 4;
        const bp = (ty * bg.w + tx) * 4;
        for (let channel = 0; channel < 3; channel++) {
          const oldBg = bg.data[bp + channel]!;
          bg.data[bp + channel] = sprite.data[sp + channel]!;
          sprite.data[sp + channel] = oldBg;
        }
        bg.data[bp + 3] = 255;
        sprite.data[sp + 3] = 255;
      }
    }
  });
}

/** The ×S art rect one swap can touch, in ×S pixels, clipped to the art. */
export function wreckSwapRect(
  swap: WreckSwap,
  spriteW: number,
  spriteH: number,
  scale: number,
  artW: number,
  artH: number,
): { x: number; y: number; w: number; h: number } | null {
  if (swap.pixels.length === 0) return null;
  const x0 = Math.max(0, (swap.x - FFR_EXTRA) * scale);
  const y0 = Math.max(0, swap.y * scale);
  const x1 = Math.min(artW, (swap.x - FFR_EXTRA) * scale + spriteW);
  const y1 = Math.min(artH, swap.y * scale + spriteH);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** What a `syncWreck` pass should read back, apply and consume. */
export interface WreckBatch {
  /**
   * The swaps to apply, IN RECORDED ORDER. The exchange is destructive and each swap
   * reads what the previous one left, so this order is the rule, not a detail.
   */
  readonly pending: readonly { swap: WreckSwap; sprite: AiWreckSurface }[];
  /** The ×S rect covering every pending swap — one readback for the whole batch. */
  readonly rect: { x: number; y: number; w: number; h: number } | null;
  /** Where the cursor lands ONCE `pending` has actually been applied. */
  readonly cursor: number;
}

/**
 * Decide what the next wreck pass does — the whole of `syncWreck`'s decision-making, kept
 * pure so it can be tested without a DOM (vitest runs in node here, with no canvas).
 *
 * Two rules live here and neither is obvious:
 *
 *  - **A swap whose sprite cannot be resolved STOPS the batch; it is not skipped.** The
 *    exchange is destructive and order-dependent, so replaying a later swap over an
 *    unapplied earlier one yields a background that is wrong rather than merely
 *    incomplete. Leaving the cursor on the failure means a transient fault (a canvas
 *    context the browser declined to give us) is retried next frame instead of silently
 *    eating the rest of the fall.
 *  - **A swap that changed nothing is consumed.** Every fall ends with one of those
 *    (`applyWreckSwap` records the final off-screen pass with an empty pixel list), and
 *    retrying it forever would mean never advancing again.
 *
 * `cursor` is what the caller should store AFTER applying `pending` — never before.
 */
export function planWreckBatch(
  swaps: readonly WreckSwap[],
  from: number,
  spriteFor: (phase: number) => AiWreckSurface | null,
  scale: number,
  artW: number,
  artH: number,
): WreckBatch {
  const pending: { swap: WreckSwap; sprite: AiWreckSurface }[] = [];
  let cursor = from;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (; cursor < swaps.length; cursor++) {
    const swap = swaps[cursor]!;
    const sprite = spriteFor(swap.phase);
    if (!sprite) break;
    const r = wreckSwapRect(swap, sprite.w, sprite.h, scale, artW, artH);
    if (!r) continue;
    pending.push({ swap, sprite });
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  }
  return {
    pending,
    rect: pending.length === 0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 },
    cursor,
  };
}

/**
 * Apply a planned batch into the window `planWreckBatch` sized for it.
 *
 * The iteration ORDER is the whole content of this function, which is why it is a function
 * at all rather than a loop inside `syncWreck`: the exchange is destructive, each swap
 * reads what the previous one left, and a tick's erase and draw footprints overlap almost
 * completely — so applying a batch backwards produces a plausible-looking wreck made of
 * the wrong pixels. That is invisible to any check based on WHERE the damage is, and
 * `syncWreck` itself cannot be unit-tested (it needs a canvas).
 */
export function applyWreckBatch(
  window: AiWreckSurface,
  pending: readonly { swap: WreckSwap; sprite: AiWreckSurface }[],
  scale: number,
  artW: number,
  artH: number,
): void {
  for (const { swap, sprite } of pending) {
    applyWreckSwapScaled(window, sprite, swap, scale, artW, artH);
  }
}

/** An enhanced object bound to an FFR item index, its animation frames as bitmaps. */
interface AiObject {
  readonly item: number;
  readonly frames: readonly ImageBitmap[];
}
type AiFishSide = Map<string, ImageBitmap>;
interface AiFish {
  small: { left: AiFishSide; right: AiFishSide };
  big: { left: AiFishSide; right: AiFishSide };
}

/** Per-frame inputs the caller already computes for the faithful render. */
export interface AiRoomFrame {
  count: number;
  /**
   * Sub-tick interpolation fraction (0..1) — the SAME `alpha` the loop already uses to
   * interpolate fish motion between logic ticks (main.ts, set from `acc`/`LOGIC_MS` at
   * the end of the fixed-timestep loop). Read-only here: it moves
   * no game state, it only lets the GPU sample the water wave at display resolution
   * instead of at 12.5 Hz. Optional so a probe that does not care can omit it.
   */
  alpha?: number;
  slide: number;
  fishAnim: { little: FishFrame; big: FishFrame };
}

/**
 * Fetch + decode the AI room art from `${base}enhanced-ai/<jmeno>/` (background,
 * wall, object sprites) plus the shared `${base}enhanced-ai/_fish/` set. Resolves to
 * an AiRoom when every asset decoded, or null when any is missing/undecodable
 * (⇒ the caller falls back to the enhanced/classic render). Never throws.
 */
interface AiManifest {
  scale: number;
  bg: string[];
  wall: string[];
  objects: { item: number; frames: string[] }[];
}

export async function loadAiRoom(base: string, jmeno: string): Promise<AiRoom | null> {
  try {
    // Decoded bitmaps are memoised BY URL for the duration of this load. Manifests bind
    // the same sprite file to several item indices (7019 frame references across the
    // shipped tier resolve to only 2397 distinct files), and without this each reference
    // produced its own ImageBitmap that the room then retained for the session.
    const decoded = new Map<string, Promise<ImageBitmap>>();
    const bmp = (url: string): Promise<ImageBitmap> => {
      let p = decoded.get(url);
      if (!p) { p = bmpShared(url); decoded.set(url, p); }
      return p;
    };
    const dir = `${base}enhanced-ai/${jmeno}/`;
    // ai.json carries the room's scale and the shipped filenames. The shipped tier is
    // uniform ×4 today (ADAPTIVE_SCALE is off in tools/studio/lib/upscale.mjs), but the
    // scale is read rather than assumed so re-enabling it needs no runtime change — and
    // the filenames must be read regardless, since the tier ships WebP, not PNG.
    const res = await fetch(`${dir}ai.json`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
    const man = (await res.json()) as AiManifest;
    const scale = Number(man.scale) || AI_ROOM_SCALE;
    if (!man.bg?.length || !man.wall?.length) return null;
    const bgLoad = Promise.all(man.bg.map((f) => bmp(dir + f)));
    const wallLoad = Promise.all(man.wall.map((f) => bmp(dir + f)));
    const objectLoads = (man.objects ?? []).map(async (e): Promise<AiObject | null> => {
      if (typeof e.item !== 'number' || !Array.isArray(e.frames) || e.frames.length === 0) return null;
      return { item: e.item, frames: await Promise.all(e.frames.map((f) => bmp(dir + f))) };
    });
    // The fish set exists per scale, since the fish are drawn into this room's ×S
    // composite — but it is the SAME art for every room at that scale, so it is shared
    // rather than decoded per room (see fishCache).
    const [bg, wall, loaded, fish] = await Promise.all([
      bgLoad,
      wallLoad,
      Promise.all(objectLoads),
      sharedAiFish(base, scale, bmpShared),
    ]);
    const objects = loaded.filter((o): o is AiObject => o !== null);
    // Only the room's OWN bitmaps are disposable; the shared fish set outlives any one
    // room and must never be closed from here.
    const owned = await Promise.all([...decoded.values()]);
    return new AiRoom(bg, wall, objects, fish, scale, owned);
  } catch (e) {
    // Returning null falls back to the enhanced tier, which is the right behaviour for
    // a user with a partial download — but it also hides a genuinely broken build, so
    // say why rather than silently rendering the wrong tier.
    console.warn(`AI tier unavailable for ${jmeno}:`, e);
    return null;
  }
}

/** Fetch + decode one asset. Used directly for assets SHARED between rooms (the fish
 *  set), which therefore must not be owned — or disposed — by any single AiRoom. */
async function bmpShared(url: string): Promise<ImageBitmap> {
  return withLoadSlot(async () => {
    const res = await fetch(url);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`${url}: ${res.status}`);
    // `premultiplyAlpha: 'none'` is load-bearing, not a default spelled out. With the
    // browser's own choice ('default') Chrome hands back PREMULTIPLIED pixels, and
    // texImage2D from an ImageBitmap takes the bitmap's own alpha mode — the GPU
    // compositor then multiplied by alpha a second time and every anti-aliased sprite
    // edge came out darkened toward the background (measured: a 160,95,44 edge pixel
    // rendering as 105,61,32). canvas-2D is unaffected either way, so nothing else in
    // the tier could have caught it.
    return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none' });
  });
}

/**
 * The fish set is shared by every room at a given scale, so it is decoded ONCE and
 * cached by scale. Loading it per room meant ~133 extra asset fetches and another 132
 * retained ImageBitmaps for every room entered — the same art over and over, since
 * AiRoom instances are cached for the session and never release their bitmaps.
 *
 * Keyed on the PROMISE so two rooms loading concurrently share one decode.
 */
/**
 * Map a SHIPPED fish filename to the key the renderer looks it up by.
 *
 * Frames are resolved through FISH_BODY_FILE / FISH_HEAD_FILE, which are shared with the
 * enhanced tier and therefore name PNGs, while this tier ships WebP. Keying the map by
 * the shipped name made every lookup miss and silently drew NO fish in any room — no
 * error, no 404, correct canvas size. Exported so tests assert this exact rule instead
 * of re-implementing it (a re-implementation cannot catch the bug it guards).
 */
export const aiFishKey = (shipped: string): string => shipped.replace(/\.webp$/i, '.png');

/** Where a shipped fish frame lives, given the per-scale set directory. */
export const aiFishUrl = (dir: string, size: 'small' | 'big', facing: 'left' | 'right', file: string): string =>
  `${dir}${size}/${facing}/${file}`;

const fishCache = new Map<string, Promise<AiFish>>();

function sharedAiFish(base: string, scale: number, bmp: (u: string) => Promise<ImageBitmap>): Promise<AiFish> {
  const dir = `${base}enhanced-ai/_fish/x${scale}/`;
  let p = fishCache.get(dir);
  if (!p) {
    p = loadAiFish(dir, bmp);
    // Don't cache a rejection: a transient failure would otherwise poison every later
    // room at this scale for the rest of the session.
    p.catch(() => fishCache.delete(dir));
    fishCache.set(dir, p);
  }
  return p;
}

async function loadAiFish(dir: string, bmp: (u: string) => Promise<ImageBitmap>): Promise<AiFish> {
  const res = await fetch(`${dir}manifest.json`);
  const m = (await res.json()) as Record<'small' | 'big', Record<'left' | 'right', string[]>>;
  const side = async (size: 'small' | 'big', facing: 'left' | 'right'): Promise<AiFishSide> => {
    const map: AiFishSide = new Map();
    await Promise.all((m[size]?.[facing] ?? []).map(async (f) =>
      map.set(aiFishKey(f), await bmp(aiFishUrl(dir, size, facing, f)))));
    return map;
  };
  const [smallLeft, smallRight, bigLeft, bigRight] = await Promise.all([
    side('small', 'left'),
    side('small', 'right'),
    side('big', 'left'),
    side('big', 'right'),
  ]);
  return {
    small: { left: smallLeft, right: smallRight },
    big: { left: bigLeft, right: bigRight },
  };
}

export class AiRoom {
  /** This room's upscale factor, from ai.json — ×4 unless ADAPTIVE_SCALE is re-enabled. */
  readonly scale: number;
  /** Per-sprite glass masks for the spec=1 mirror (see glassMask). */
  private readonly glassCache = new WeakMap<ImageBitmap, Float32Array>();
  /** ×S palette sprites for items with no staged art (see drawClassicItem). */
  private readonly classicCache = new Map<string, HTMLCanvasElement>();
  /** The canvas-2D target, kept across frames so its composite caches survive. */
  private cpuTarget: Canvas2dAiTarget | null = null;
  /** Fired by dispose() so a GPU mirror of these bitmaps can be released with them. */
  private readonly disposeHooks: (() => void)[] = [];

  /**
   * LODE's mutable ×S background — a copy of `bg[0]` the falling wreck destroys.
   *
   * Allocated on the first swap (25 MB at ×4, so no other room pays for it) and then
   * REUSED for the life of this AiRoom, never replaced: both backends cache by source
   * identity, and the GPU frees its texture through `ownedImages()`, so swapping in a
   * fresh canvas would strand a 25 MB texture per reset.
   */
  private wreckBg: HTMLCanvasElement | null = null;
  /**
   * The eroding ×S ship sprites, by phase. They are the swap's other half — never drawn
   * (item spec=11 is skipped by the walk), so they need pixels but no canvas.
   */
  private readonly wreckSprites = new Map<number, AiWreckSurface>();
  /** How much of `room.wreckSwaps` has already been replayed (see syncWreck). */
  private wreckCursor = 0;
  /**
   * The swap history these mutations belong to.
   *
   * `EnhancedArtSource` is rebuilt whenever the Room identity changes, so its copies die
   * with the room; an AiRoom does NOT — it is cached by room name across entries with an
   * LRU of 3. Without this, leaving LODE and coming back (or restarting the room) gave a
   * fresh Room with an empty history but the same AiRoom, still showing a fully wrecked
   * background. `room.wreckSwaps` is a readonly field, so its identity IS the room's.
   */
  private wreckOwner: readonly WreckSwap[] | null = null;

  constructor(
    private readonly bg: readonly ImageBitmap[],
    private readonly wall: readonly ImageBitmap[],
    private readonly objects: readonly AiObject[],
    private readonly fish: AiFish,
    scale: number = AI_ROOM_SCALE,
    /** Bitmaps this room OWNS (bg/wall/objects, deduped by URL) — not the shared fish. */
    private readonly owned: readonly ImageBitmap[] = [],
  ) { this.scale = scale; }

  /**
   * Release this room's decoded pixels. At ×4 a single room retains ~50 MB, so keeping
   * every visited room alive grew without bound (~430 MB after 7 rooms, ~4 GB over a
   * full playthrough). Closes only `owned`: the fish set is shared by every room at this
   * scale and is owned by fishCache. Idempotent — safe to call on an already-evicted room.
   */
  dispose(): void {
    for (const b of this.owned) b.close();
    this.classicCache.clear();
    this.cpuTarget?.release();
    for (const fn of this.disposeHooks) fn();
    this.disposeHooks.length = 0;
    // AFTER the hooks: they read ownedImages(), which includes the wreck canvas, to free
    // its texture. Dropping it first would strand 25 MB of VRAM on exactly the eviction
    // that exists to bound this tier's memory.
    this.wreckBg = null;
    this.wreckSprites.clear();
    this.wreckCursor = 0;
    this.wreckOwner = null;
  }

  /**
   * Register a callback for `dispose()`. The GPU target holds a texture per bitmap of
   * this room (~50 MB at ×4), and `dispose()` closes the bitmaps themselves — without
   * this the GL textures would be orphaned by exactly the eviction that exists to bound
   * the memory.
   */
  onDispose(fn: () => void): void {
    this.disposeHooks.push(fn);
  }

  /**
   * Test/debug: the state of the ×S wreck replay — how many recorded swaps have been
   * applied, the background's cache revision, an FNV-1a hash of the mutable ×S
   * background, and what differs from the pristine art. `null` for every room that has
   * never wrecked anything.
   *
   * Exists because "CPU and GPU agree" is not enough here: they would also agree if the
   * replay did nothing and both rendered the pristine background. The hash proves the art
   * moved at all; `damage` is reported in NATIVE cells so it can be compared directly
   * against the enhanced tier's replay of the same history (see wreckDamage). Reads the
   * whole ×S canvas, so it is a probe hook, not something to call per frame.
   */
  wreckDigest(): { replayed: number; revision: number; hash: number; damage: WreckDamage | null } | null {
    const cv = this.wreckBg;
    const base = this.bg[0];
    if (!cv || !base || typeof document === 'undefined') return null;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const now = g.getImageData(0, 0, cv.width, cv.height).data;
    let hash = 2166136261;
    for (let i = 0; i < now.length; i++) hash = Math.imul(hash ^ now[i]!, 16777619);

    const ref = document.createElement('canvas');
    ref.width = cv.width;
    ref.height = cv.height;
    const rg = ref.getContext('2d', { willReadFrequently: true });
    const digest = { replayed: this.wreckCursor, revision: aiImageRevision(cv), hash: hash >>> 0 };
    if (!rg) return { ...digest, damage: null };
    rg.imageSmoothingEnabled = false;
    rg.drawImage(base, 0, 0);
    const was = rg.getImageData(0, 0, cv.width, cv.height).data;
    return { ...digest, damage: wreckDamage(now, was, cv.width, cv.height, this.scale) };
  }

  /**
   * The bitmaps this room ALONE holds — its background, wall and object sprites, deduped
   * by URL, plus LODE's mutable ×S background copy once the wreck has allocated it.
   * Deliberately excludes the fish set, which is shared by every room at this scale (see
   * sharedAiFish) and must outlive any single room: a backend that treated it as
   * room-owned would re-acquire it on every room entry.
   */
  ownedImages(): readonly AiImage[] {
    return this.wreckBg ? [...this.owned, this.wreckBg] : this.owned;
  }

  /** Native room pixel size the caller must scale the framebuffer from (×scale). */
  get nativeWidth(): number { return Math.round(this.bg[0]!.width / this.scale); }
  get nativeHeight(): number { return Math.round(this.bg[0]!.height / this.scale); }

  /**
   * The background + wall art the next background pass would use, or null for a
   * gspec=2 darkness room (which paints no art at all).
   *
   * Exposed for the wobble oracle: a probe that reproduces BG_FS in JS needs the SOURCE
   * images, not the composite, or it is comparing the implementation with itself.
   */
  backgroundArt(room: Room): { bg: AiImage; wall: AiImage } | null {
    if (room.gspec === 2) return null;
    const faze = room.wallItem.afaze;
    this.syncWreck(room);
    const bgIdx = Math.min(faze, this.bg.length - 1);
    const bg: AiImage = (bgIdx === 0 && this.wreckBg) ? this.wreckBg : this.bg[bgIdx]!;
    return { bg, wall: this.wall[Math.min(faze, this.wall.length - 1)]! };
  }

  /**
   * The room's water-wave data for this frame, or null when it does not wobble.
   *
   * Deliberately DATA, not a computed shift table: the two backends now sample this
   * wave differently — canvas-2D at 1998's quantization, the GPU per fragment at ×S —
   * and that split is documented once, on `AiTarget.background`, rather than being
   * pre-decided here for both. `time` carries the sub-tick fraction; `count` carries the
   * logic tick the composite cache keys on.
   */
  private wobbleFor(room: Room, count: number, alpha: number): AiWobble | null {
    if (!aiWaterVisible(room)) return null;
    return { wamp: room.wamp, wper: room.wper, wspd: room.wspd, count, time: count + alpha };
  }

  /**
   * Composite the wall-over-wobbled background + all sprites for `room`+`f` into a
   * scale×-sized 2D context, already cleared by the caller, at (0,0). The canvas-2D
   * entry point: wraps `ctx` in the persistent Canvas2dAiTarget (whose background
   * composite cache must outlive the frame) and runs the shared walk.
   */
  draw(ctx: CanvasRenderingContext2D, room: Room, f: AiRoomFrame): void {
    if (this.cpuTarget) this.cpuTarget.bind(ctx);
    else this.cpuTarget = new Canvas2dAiTarget(ctx);
    this.drawInto(this.cpuTarget, room, f);
  }

  /**
   * Composite `room`+`f` into `t` at S×. The structure — background first, then items
   * in z-order with the gspec=2 visibility flip, the gspec=5 fish swap, the slide
   * interpolation and the spec=1/3/4 effect anchors — comes from the shared `walkRoom`
   * (src/render/roomWalk.ts), which the faithful compositor replays too. This tier
   * differs only in `AiSink` below: bigger art, RGBA instead of a palette plane, and
   * every coordinate multiplied by `scale` on the way out.
   */
  drawInto(t: AiTarget, room: Room, f: AiRoomFrame): void {
    walkRoom(this.sink(t, f.alpha ?? 0), room, f.count, f.slide, f.fishAnim);
  }

  /**
   * Just the wall-over-wobbled-background layer, no items and no fish — the ×S twin of
   * the faithful path's `renderRoomBackgroundRgba`.
   *
   * Exists so a probe can hold the water rule to a hand-computed expectation without the
   * sprites on top of it. Comparing the FULL frame cannot do that: the wobble is the only
   * thing being pinned, and every other primitive would have to be reproduced by the
   * oracle too, which is how an oracle becomes a copy of the implementation.
   */
  drawBackgroundInto(t: AiTarget, room: Room, count: number, alpha = 0): void {
    this.paintBackground(t, room, count, alpha);
  }

  /**
   * This tier's `RoomWalkSink` — a pure forwarder onto `t`, and the ONLY place the S×
   * scale enters. The walk emits native coordinates (an item's cell origin plus its
   * slide offset); everything below multiplies them out to backing-store pixels.
   */
  private sink(t: AiTarget, alpha: number): RoomWalkSink {
    const S = this.scale;
    const px = (cell: number, shift: number): number => (cell * FSIZE + shift) * S;
    return {
      background: (room, count) => this.paintBackground(t, room, count, alpha),
      item: (room, it, index, sx, sy) => this.drawItem(t, it, index, px(it.x, sx), px(it.y, sy), room),
      fish: (room, which, it, sx, sy, frame) =>
        this.drawFish(t, room, which, px(it.x, sx), px(it.y, sy), frame, it),
      // No index plane to read back here, so the reflection is masked by the mirror's
      // own ×S sprite instead — see drawMirror.
      mirror: (_room, at) => this.drawMirror(t, at.x, at.y, at.bmp, this.spriteFor(at.item, at.index)),
      rope: (room, x1, y1, x2, y2, col) => this.drawRope(t, room, x1, y1, x2, y2, col),
    };
  }

  /**
   * The wall-over-wobbled-background composite, or the gspec=2 darkness fill.
   *
   * VyplnMistnost (URoom.pas:26210): a darkness room is filled with the palette's
   * near-black — no wall, no background. Only the lit items (spec=2, e.g. CHODBA's
   * glowing dog eyes) and the fish silhouettes are drawn on top, so those are the
   * parts worth having at S×.
   */
  private paintBackground(t: AiTarget, room: Room, count: number, alpha: number): void {
    if (room.gspec === 2) {
      const d = room.palette[darkestIndex(room.palette)] ?? { r: 0, g: 0, b: 0 };
      t.fill(d.r, d.g, d.b);
      return;
    }
    const faze = room.wallItem.afaze;
    this.syncWreck(room);
    const bgIdx = Math.min(faze, this.bg.length - 1);
    // Only frame 0 is ever wrecked, exactly as EnhancedArtSource.syncWreck mutates only
    // wreckBackgrounds[0] (LODE ships a single background frame).
    const bg: AiImage = (bgIdx === 0 && this.wreckBg) ? this.wreckBg : this.bg[bgIdx]!;
    const wall = this.wall[Math.min(faze, this.wall.length - 1)]!;
    const wobble = this.wobbleFor(room, count, alpha);
    // The composite depends only on the wall's animation phase and — when the room
    // wobbles — the logic tick; the fish interpolate BETWEEN ticks, so a target that
    // can cache the composite skips it on most frames. Note the key carries `count`, NOT
    // `wobble.time`: the sub-tick term exists for the GPU, which composites every frame
    // anyway, and putting it in here would miss the canvas-2D cache on every display
    // frame — which is exactly why that backend keeps the faithful tick-rate wobble.
    // The background's REVISION is in the key because LODE's is mutable: the wreck
    // changes its pixels without changing the image object, and a target caching on
    // `sig` alone would keep re-blitting the undamaged composite. (LODE happens to
    // wobble, so `count` would mask this most of the time — which is luck, not
    // correctness.)
    t.background(`${faze}|${wobble === null ? 0 : count}|${aiImageRevision(bg)}`, bg, wall, wobble, this.scale);
  }

  /**
   * Replay KresliLod's destructive swaps into a private ×S copy of the background and of
   * the ship sprites — the ×S counterpart of `EnhancedArtSource.syncWreck`, and the
   * reason this tier no longer hands LODE's falling ship back to the faithful compositor.
   *
   * `wreckCursor` makes the history idempotent: each recorded swap is applied exactly
   * once, however many display frames pass between logic ticks. What to apply, in what
   * order, and how far the cursor may advance is decided by `planWreckBatch`, which is
   * pure and therefore testable; everything here is the canvas work it cannot do. A whole
   * batch shares ONE readback of its union rect (a fall in flight records an erase and a
   * draw per tick, with overlapping footprints), and that rect is then handed on as the
   * patch the GPU updates its texture from. Reading the whole 25 MB canvas back per swap,
   * or re-uploading it whole, would each cost more than a frame.
   *
   * Requires a DOM; the unit tests drive `planWreckBatch` and `applyWreckSwapScaled`
   * directly instead.
   */
  private syncWreck(room: Room): void {
    const swaps = room.wreckSwaps;
    if (this.wreckOwner !== swaps) {
      // A rebuilt Room (re-entry, restart, undo past the wreck) starts from pristine art.
      this.wreckOwner = swaps;
      this.wreckCursor = 0;
      this.wreckSprites.clear();
      if (this.wreckBg) this.resetWreckBg();
    }
    if (this.wreckCursor >= swaps.length) return;
    if (typeof document === 'undefined') return;
    const base = this.bg[0];
    if (!base) return;
    const canvas = this.wreckBg ?? this.makeWreckBg(base);
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const batch = planWreckBatch(
      swaps,
      this.wreckCursor,
      (phase) => this.wreckSprite(room, phase),
      this.scale,
      canvas.width,
      canvas.height,
    );
    if (!batch.rect) {
      this.wreckCursor = batch.cursor; // only no-op swaps, if any: nothing to draw
      return;
    }

    const { x, y, w, h } = batch.rect;
    const img = ctx.getImageData(x, y, w, h);
    const window: AiWreckSurface = { data: img.data, w: img.width, h: img.height, ox: x, oy: y };
    applyWreckBatch(window, batch.pending, this.scale, canvas.width, canvas.height);
    // Committed here, not after the write: applying a swap ERODES the sprite, and that is
    // the half that cannot be undone. Replaying it would erode twice.
    this.wreckCursor = batch.cursor;
    ctx.putImageData(img, x, y);
    // Both backends cache the background by identity; this is how they learn it moved —
    // and the patch is what lets the GPU update the changed rect instead of the whole
    // 25 MB texture (12.3 ms vs 0.68 ms, see the measurement note in aiTarget.ts).
    markAiImageChanged(canvas, { x, y, w: img.width, h: img.height, data: img.data });
  }

  /** The mutable ×S background copy, created on the first swap. */
  private makeWreckBg(base: ImageBitmap): HTMLCanvasElement | null {
    const cv = document.createElement('canvas');
    cv.width = base.width;
    cv.height = base.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    g.drawImage(base, 0, 0);
    this.wreckBg = cv;
    markAiImageChanged(cv);      // ⇒ revision >= 1, so its sig can never collide with bg[0]'s
    return cv;
  }

  /** Restore the wreck canvas to the pristine background, keeping its identity. */
  private resetWreckBg(): void {
    const cv = this.wreckBg;
    const base = this.bg[0];
    if (!cv || !base) return;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(base, 0, 0);
    markAiImageChanged(cv);
  }

  /**
   * The eroding ×S pixels of ship phase `phase`, lazily copied out of the staged sprite.
   *
   * The wreck object is bound to item `itemCount - 1` — the same lookup syncWreck uses,
   * and the index the shipped LODE manifest stages its five `potop_*` frames under.
   */
  private wreckSprite(room: Room, phase: number): AiWreckSurface | null {
    const hit = this.wreckSprites.get(phase);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;
    const src = wreckFrame(this.objects, room.itemCount, phase);
    if (!src) return null;
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    const g = cv.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0);
    const img = g.getImageData(0, 0, src.width, src.height);
    const surface: AiWreckSurface = { data: img.data, w: img.width, h: img.height, ox: 0, oy: 0 };
    this.wreckSprites.set(phase, surface);
    return surface;
  }

  /**
   * KresliDvojlano (URoom.pas:25863) at S×: two "ropes" 4 ORIGINAL px apart running
   * from (x1,y1) down to (x2,y2), the x stepped by the accumulated slope so the pair
   * leans with the endpoints. The walk stays in original coordinates (identical
   * stepping to cpuDrawRope, so the lean matches the faithful render exactly) and each
   * step paints an S×S block, giving a rope that is S px thick instead of a hairline.
   * `col` is a palette index — resolved through the room palette since we draw RGBA.
   */
  private drawRope(t: AiTarget, room: Room, x1: number, y1: number, x2: number, y2: number, col: number): void {
    if (y2 <= y1) return; // guards div-by-zero and the empty loop
    const S = this.scale;
    const c = room.palette[col];
    if (!c) return;
    const d = (x2 - x1) / (y2 - y1);
    let r = 0.5;
    let x = x1;
    for (let y = y1; y <= y2; y++) {
      while (r > 1) { x++; r -= 1; }
      while (r < 0) { x--; r += 1; }
      r += d;
      t.fillRect(x * S, y * S, S, S, c.r, c.g, c.b);
      t.fillRect((x + 4) * S, y * S, S, S, c.r, c.g, c.b);
    }
  }

  /** The AI sprite an item is currently drawn with (same lookup as drawItem). */
  private spriteFor(item: Item, index: number): ImageBitmap | null {
    for (const obj of this.objects) {
      if (obj.item !== index || obj.frames.length === 0) continue;
      return obj.frames[frameIndex(item.afaze, obj.frames.length)] ?? null;
    }
    return null;
  }

  /**
   * KresliZrcadlo (URoom.pas:25822) at S× — the spec=1 mirror reflection, the one
   * index read-back effect this compositor implements.
   *
   * The faithful path identifies the reflective "glass" by PALETTE INDEX: the index
   * sampled at the mirror rect's centre is the glass colour, and every pixel in the
   * rect carrying it is replaced by the pixel mirrored about the rect's axis
   * (dest col X+k ← src col X+3-k). There is no index buffer here (we composite
   * RGBA), so the mask is read from the mirror's own AI SPRITE, whose glass is a
   * flat chroma key (pure cyan). Taking it from the sprite rather than the classic
   * FFR bitmap keeps the mask at FULL S× resolution, so the oval's edge follows the
   * hi-res art instead of a blocky native-pixel staircase, and the highlight streaks
   * drawn inside the glass (white, far from the key) are excluded for free.
   *
   * Scaled geometry: original col d reflects to 2X+3-d, so with sub-pixel accuracy
   * scaled col D reflects to S*(2X+4)-1-D (a true mirror, flipping inside each
   * source pixel too — a free win from having real hi-res art). Rows are untouched.
   * Reads from a snapshot of the pre-mirror pixels, which is what the original's
   * in-place left-to-right loop effectively produces (its near-axis self-reference
   * reads glass→glass, a no-op).
   */
  private drawMirror(t: AiTarget, X: number, Y: number, bmp: FfrBitmap, spr: ImageBitmap | null): void {
    const w = bmp.w, h = bmp.h;
    if (w <= 0 || h <= 0 || !spr) return;
    const glass = this.glassMask(spr);
    if (!glass) return;
    t.mirrorGlass(X, Y, w, h, this.scale, glass, spr.width, spr.height);
  }
  /**
   * Per-pixel "glassness" of a mirror sprite at S×, cached per bitmap. The staged
   * art paints the reflective area with a pure-cyan chroma key that the reflection
   * REPLACES ENTIRELY, so anything left unwritten shows through as raw key colour —
   * including the anti-aliased fringe, where the key blends toward the black inner
   * outline and would otherwise leave teal speckles ringing the oval.
   *
   * So score each pixel by how much CYAN KEY it contains rather than by distance to
   * the key: for a blend of (0,255,255) over anything darker, `min(G,B) - R` tracks
   * the key's own coverage. Full replacement once a pixel is at least half key,
   * fading to 0 below that. The white highlight streaks (R = G = B ⇒ 0), the orange
   * frame (R ≫ G,B ⇒ 0) and the black outline (0) all score zero and survive.
   */
  private glassMask(spr: ImageBitmap): Float32Array | null {
    const cached = this.glassCache.get(spr);
    if (cached) return cached;
    const cv = document.createElement('canvas');
    cv.width = spr.width; cv.height = spr.height;
    const g2 = cv.getContext('2d', { willReadFrequently: true });
    if (!g2) return null;
    g2.drawImage(spr, 0, 0);
    const d = g2.getImageData(0, 0, spr.width, spr.height).data;
    const HALF_KEY = 128; // key coverage at which the pixel is fully reflected
    const out = new Float32Array(spr.width * spr.height);
    for (let i = 0; i < out.length; i++) {
      const o = i * 4;
      if (d[o + 3]! < 128) continue; // outside the sprite
      const key = Math.min(d[o + 1]!, d[o + 2]!) - d[o]!;
      out[i] = key <= 0 ? 0 : key >= HALF_KEY ? 1 : key / HALF_KEY;
    }
    this.glassCache.set(spr, out);
    return out;
  }

  /**
   * An item's AI sprite(s) at its slid hi-res position. Matches the enhanced
   * spec=10 flip (statically-spec=10 art is pre-mirrored ⇒ drawn as-is; a runtime
   * spec=10 toggle mirrors the base art), and draws every sprite bound to this item
   * index in manifest order (stacked cabins etc.). Missing AI art falls back to
   * drawClassicItem(): the room's own FFR bitmap nearest-scaled ×S, mirroring
   * EnhancedArtSource's per-element fallback.
   */
  private drawItem(t: AiTarget, item: Item, index: number, x0: number, y0: number, room: Room): void {
    const preMirrored = (item.initSpec ?? item.spec) === 10;
    const mirror = (item.spec === 10) !== preMirrored;
    let drew = false;
    for (const obj of this.objects) {
      if (obj.item !== index || obj.frames.length === 0) continue;
      const spr = obj.frames[frameIndex(item.afaze, obj.frames.length)]!;
      t.blit(spr, x0, y0, mirror);
      drew = true;
    }
    // Not every item has staged FFNG art (e.g. WIN's bonus-window fish, items 10/11,
    // are absent from objects.json). The enhanced source silently falls through to
    // classicItem() in that case; without the same fallback the AI tier would simply
    // DROP those items. Draw the room's own FFR bitmap, nearest-scaled ×S.
    if (!drew) this.drawClassicItem(t, room, item, x0, y0);
  }

  /**
   * classicItem() at S×: the palette FFR bitmap with `item.mask` as the transparent
   * index, magnified nearest-neighbour so it lines up with the rest of the ×S
   * composite. Cached per bitmap+mask — the art is static, only the position moves.
   */
  private drawClassicItem(t: AiTarget, room: Room, item: Item, x0: number, y0: number): void {
    const bmp = room.bitmaps[item.bmp + item.afaze];
    if (!bmp) return;
    const cv = this.classicSprite(room, bmp, item.mask, `i${item.bmp + item.afaze}`);
    if (!cv) return;
    t.blit(cv, x0, y0, item.spec === 10);              // KresliRev
  }

  /**
   * A palette FFR bitmap rendered to an S× canvas with `mask` transparent, cached
   * under `tag:mask`. Shared by the un-mapped-item and un-mapped-fish-frame paths
   * (e.g. the gspec=2 dark silhouette body, which has no FFNG file).
   */
  private classicSprite(room: Room, bmp: FfrBitmap, mask: number, tag: string): HTMLCanvasElement | null {
    const key = `${tag}:${mask}`;
    const hit = this.classicCache.get(key);
    if (hit) return hit;
    const S = this.scale;
    const nat = document.createElement('canvas');
    nat.width = bmp.w; nat.height = bmp.h;
    const ng = nat.getContext('2d');
    if (!ng) return null;
    const img = ng.createImageData(bmp.w, bmp.h);
    for (let i = 0; i < bmp.w * bmp.h; i++) {
      const idx = bmp.pixels[i]!;
      if (idx === mask) continue;                      // transparent
      const c = room.palette[idx];
      if (!c) continue;
      img.data[i * 4] = c.r; img.data[i * 4 + 1] = c.g; img.data[i * 4 + 2] = c.b; img.data[i * 4 + 3] = 255;
    }
    ng.putImageData(img, 0, 0);
    const cv = document.createElement('canvas');
    cv.width = bmp.w * S; cv.height = bmp.h * S;
    const cg = cv.getContext('2d');
    if (!cg) return null;
    cg.imageSmoothingEnabled = false;
    cg.drawImage(nat, 0, 0, cv.width, cv.height);
    this.classicCache.set(key, cv);
    return cv;
  }

  /** A fish's AI body (+ optional head overlay) at its slid hi-res position. */
  private drawFish(t: AiTarget, room: Room, which: 'little' | 'big', x0: number, y0: number, frame: FishFrame, item: Item): void {
    const venku = which === 'little' ? room.venku.little : room.venku.big;
    if (venku) return;                    // exited: gone
    const alive = which === 'little' ? room.alive.little : room.alive.big;
    const dead = which === 'little' ? room.kostra.little : room.kostra.big;
    if (!alive && !dead) return;          // fully gone
    const size = which === 'little' ? 'small' : 'big';
    const facingRight = which === 'little' ? room.facingRight.little : room.facingRight.big;
    const set = this.fish[size][facingRight ? 'right' : 'left'];
    if (dead) {
      // Crushed: the eroding skeleton (KresliK). The enhanced source has no
      // FISH_BODY_FILE entry for TL_KOSTRA and simply falls back to the classic
      // renderer for this, but the staged fish set DOES ship body_skeleton_00, so
      // the AI tier can dissolve it at full resolution instead of drawing nothing.
      const skel = set.get(SKELETON_FILE);
      if (!skel) return;
      const rozpad = Math.min(which === 'big' ? room.rozpad.big : room.rozpad.little, 255);
      t.disintegrate(skel, x0, y0, this.scale, rozpad);
      return;
    }
    const bodyFile = FISH_BODY_FILE[frame.bodyFrame];
    if (!bodyFile) {
      // No FFNG file for this body frame — the gspec=2 dark silhouette (TL_TMA=23)
      // is the real case; frame 0 is the deliberate wink-out (nil bitmap ⇒ nothing).
      // The enhanced source falls through to classicFish here, so do the same.
      if (frame.bodyFrame === 0) return;
      const bodies = which === 'big' ? room.bodies.big : room.bodies.small;
      const bmp = bodies[frame.bodyFrame];
      if (!bmp) return;
      const cv = this.classicSprite(room, bmp, item.mask, `f${which}${frame.bodyFrame}`);
      if (cv) t.blit(cv, x0, y0, facingRight);
      return;
    }
    const body = set.get(bodyFile);
    if (!body) return;
    t.blit(body, x0, y0, false);
    if (frame.headFrame > 0) {
      const headFile = FISH_HEAD_FILE[frame.headFrame];
      const head = headFile ? set.get(headFile) : undefined;
      if (head) t.blit(head, x0, y0, false);
    }
  }
}
