/**
 * Hi-res AI room compositor (Phase C of the `ai` graphics tier).
 *
 * Mirrors the enhanced (FFNG truecolor) room look at S× resolution from the
 * AI-upscaled masters staged under public/enhanced-ai/<JMENO>/ (built by
 * tools/studio/build-ai.mjs, which supersedes tools/build-room-ai.mjs for this tier).
 * Like worldMapAi it is PURELY a higher-resolution rendering of the identical game
 * state: item positions, the water-wobble, fish body/head frames and the slide
 * interpolation are all delegated from the same engine that drives the faithful
 * compositor — this file only paints them bigger, from bigger art. It renders with
 * canvas-2D drawImage into a ready-made S×-sized 2D context (the #screen canvas),
 * so the browser does the alpha compositing and the caller CSS-scales the result
 * down to the room's display box.
 *
 * Scope: the wall-over-wobbled background and the object + fish sprites in item
 * z-order, PLUS the effects the faithful path draws from index read-back — the
 * spec=1 mirror (drawMirror), the spec=3/4 elevator double rope (drawRope), the
 * gspec=2 darkness fill and the gspec=5 bonus fish swap. Anything with no staged
 * FFNG art (un-mapped items, the skeleton and the darkness silhouette) falls back
 * to the room's own palette bitmaps via classicSprite(), mirroring what the
 * enhanced source does. Used whenever `graphics === 'ai'` and the room's AI assets
 * loaded; the caller (aiRoomRenderActive) withholds it for gspec=42 (the ZX band
 * render), frames with an active fishing hook, and frames with a CPU-only frame
 * effect running (megabomb flash / silent film / interlaced / the Tetris overlay),
 * all of which the faithful compositor must draw instead. classic/enhanced never
 * touch it.
 */
import { Dir, DX_DIR, DY_DIR } from '../core/dir.js';
import { delphiRound, RANDPOLE } from './framebuffer.js';
import { FSIZE, TL_ZAKLAD, darkestIndex } from './renderRoom.js';
import { FISH_BODY_FILE, FISH_HEAD_FILE, frameIndex } from './enhancedArtSource.js';
import type { FishFrame } from './renderRoom.js';
import type { Room, Item } from '../core/room.js';
import type { FfrBitmap } from '../data/ffr.js';

/** Upscale factor of the committed AI room art (must match tools/build-room-ai.mjs AI_SCALE). */
export const AI_ROOM_SCALE = 4;

/**
 * The purely-data half of the "may the AI compositor draw this frame?" rule, split out
 * of main.ts's aiRoomRenderActive so it has ONE definition that tests can import. The
 * caller supplies the module state it cannot see (tier, loaded art, current room).
 *
 * Named fields rather than positional flags on purpose: this gate has grown to six
 * inputs, five of them boolean, and this codebase has already shipped a bug where an
 * argument slid into the wrong positional slot and failed silently.
 *
 * A frame is withheld when:
 *  - gspec 42, the ZX-Spectrum band render — its per-scanline bands are an index effect
 *    and the low-fi look is the point;
 *  - any fishing hook is active — the faithful path draws hooks on top from the palette;
 *  - a CPU-only frame effect is running (megabomb flash / silent film / interlaced /
 *    the Tetris overlay) — those are applied by the faithful compositor as it builds the
 *    frame, so this path would silently render without them;
 *  - the LODE shipwreck is falling — the faithful and enhanced paths replay destructive
 *    per-pixel wreck swaps into the background, which this path's static ×4 bitmaps
 *    cannot represent, so it would show a stale, undamaged room;
 *  - a sprite cheat (xundead / xmorph) is reshaping the fish — those transform the
 *    classic sprite sheet that the enhanced tier re-derives from, while this path blits
 *    pre-baked AI fish frames that no cheat can reach;
 *  - a subtitle is on screen that has to be BAKED into the frame (the vector overlay is
 *    unavailable because no subtitle font loaded). The faithful compositor bakes it in
 *    applyFrameEffects; this path has no equivalent, so it would drop the line entirely.
 *    Falling back costs resolution for those frames, which is far better than losing
 *    dialogue — and it only happens when every bundled font failed to load.
 */
export interface AiRoomGateInput {
  gspec: number;
  hookStates: readonly number[];
  frameEffects: boolean;
  /** LODE: room.wreckSwaps is non-empty, i.e. the ship has damaged the background. */
  wreckActive: boolean;
  /** xundead / xmorph active — the AI fish cache cannot reflect them. */
  spriteCheatsActive: boolean;
  /** A subtitle is showing and must be baked into the frame rather than overlaid. */
  bakedSubsNeeded: boolean;
}

export function aiRoomGateAllows(g: AiRoomGateInput): boolean {
  if (g.gspec === 42) return false;
  if (g.hookStates.some((s) => s !== 0)) return false;
  if (g.frameEffects) return false;
  if (g.wreckActive) return false;
  if (g.spriteCheatsActive) return false;
  if (g.bakedSubsNeeded) return false;
  return true;
}

const BASE_FRAME: FishFrame = { bodyFrame: TL_ZAKLAD[0], headFrame: 0 };
/** Staged skeleton body (FFR frame TL_KOSTRA=19, absent from FISH_BODY_FILE). */
const SKELETON_FILE = 'body_skeleton_00.png';

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
    const bg = await Promise.all(man.bg.map((f) => bmp(dir + f)));
    const wall = await Promise.all(man.wall.map((f) => bmp(dir + f)));
    const objects: AiObject[] = [];
    for (const e of man.objects ?? []) {
      if (typeof e.item !== 'number' || !Array.isArray(e.frames) || e.frames.length === 0) continue;
      objects.push({ item: e.item, frames: await Promise.all(e.frames.map((f) => bmp(dir + f))) });
    }
    // The fish set exists per scale, since the fish are drawn into this room's ×S
    // composite — but it is the SAME art for every room at that scale, so it is shared
    // rather than decoded per room (see fishCache).
    const fish = await sharedAiFish(base, scale, bmpShared);
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
  const res = await fetch(url);
  if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) throw new Error(`${url}: ${res.status}`);
  return createImageBitmap(await res.blob());
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
  return {
    small: { left: await side('small', 'left'), right: await side('small', 'right') },
    big: { left: await side('big', 'left'), right: await side('big', 'right') },
  };
}

export class AiRoom {
  /** This room's upscale factor, from ai.json — ×4 unless ADAPTIVE_SCALE is re-enabled. */
  readonly scale: number;
  /** Per-sprite glass masks for the spec=1 mirror (see glassMask). */
  private readonly glassCache = new WeakMap<ImageBitmap, Float32Array>();
  /** Scratch canvas reused by the skeleton dissolve (see drawDisintegrating). */
  private dissolveCanvas: HTMLCanvasElement | null = null;
  /** Cached background+wall composite, and the state it was built for. */
  private bgCanvas: HTMLCanvasElement | null = null;
  private bgSig = '';
  /** ×S palette sprites for items with no staged art (see drawClassicItem). */
  private readonly classicCache = new Map<string, HTMLCanvasElement>();

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
    this.dissolveCanvas = null;
    this.bgCanvas = null;
    this.bgSig = '';
  }

  /** Native room pixel size the caller must scale the framebuffer from (×scale). */
  get nativeWidth(): number { return Math.round(this.bg[0]!.width / this.scale); }
  get nativeHeight(): number { return Math.round(this.bg[0]!.height / this.scale); }

  /**
   * Draw the background+wall composite, reusing a cached copy when it has not changed.
   *
   * The composite depends only on the wall's animation phase and — when the room has
   * water wobble — the logic tick, both of which advance at 12.5Hz. The fish, however,
   * interpolate between ticks, so the room repaints at the display rate; without this
   * cache every one of those frames re-ran the whole banded wobble.
   *
   * Measured on a 435×405 room at ×4: 85 drawImage calls and 5.98 Mpx blitted per
   * frame, against a canvas of only 2.82 Mpx. The AI tier could not hold 60fps and its
   * subtitles visibly juddered while the enhanced tier (which composites on the GPU)
   * stayed smooth. Cached, a repeat frame is a single full-canvas blit.
   *
   * With wamp === 0 the composite does not depend on `count` at all, so a still room
   * builds it exactly once.
   */
  private paintBackgroundCached(ctx: CanvasRenderingContext2D, room: Room, bg: ImageBitmap, wall: ImageBitmap, count: number, faze: number): void {
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    // No DOM (unit tests drive this with a recording context) ⇒ paint straight through.
    // The cache is a rendering optimisation, not behaviour: the composite it produces is
    // identical either way, so the uncached path is the correct fallback.
    if (typeof document === 'undefined') { this.paintBackground(ctx, room, bg, wall, count); return; }
    const sig = `${faze}|${room.wamp === 0 ? 0 : count}|${W}x${H}`;
    if (!this.bgCanvas || this.bgSig !== sig) {
      if (!this.bgCanvas) this.bgCanvas = document.createElement('canvas');
      if (this.bgCanvas.width !== W || this.bgCanvas.height !== H) {
        this.bgCanvas.width = W;
        this.bgCanvas.height = H;
      }
      const bctx = this.bgCanvas.getContext('2d');
      if (!bctx) { this.bgCanvas = null; this.paintBackground(ctx, room, bg, wall, count); return; }
      bctx.setTransform(1, 0, 0, 1, 0, 0);
      bctx.imageSmoothingEnabled = false;
      bctx.clearRect(0, 0, W, H);
      this.paintBackground(bctx, room, bg, wall, count);
      this.bgSig = sig;
    }
    ctx.drawImage(this.bgCanvas, 0, 0);
  }

  /**
   * Composite the wall-over-wobbled background + all sprites for `room`+`f` into
   * `ctx` (a scale×-sized 2D context, already cleared by the caller), at (0,0).
   * Replays renderInto's background + item pass, only bigger — including the
   * gspec=2 darkness fill and the spec=1/3/4 effect anchors.
   */
  draw(ctx: CanvasRenderingContext2D, room: Room, f: AiRoomFrame): void {
    const S = this.scale;
    ctx.imageSmoothingEnabled = false;
    const faze = room.wallItem.afaze;
    const bg = this.bg[Math.min(faze, this.bg.length - 1)]!;
    const wall = this.wall[Math.min(faze, this.wall.length - 1)]!;
    if (room.gspec === 2) {
      // VyplnMistnost (URoom.pas:26210): a darkness room is filled with the palette's
      // near-black — no wall, no background. Only the lit items (spec=2, e.g. CHODBA's
      // glowing dog eyes) and the fish silhouettes are drawn on top, so those are the
      // parts worth having at S×.
      const d = room.palette[darkestIndex(room.palette)];
      ctx.fillStyle = d ? `rgb(${d.r},${d.g},${d.b})` : '#000';
      ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    } else {
      this.paintBackgroundCached(ctx, room, bg, wall, f.count, faze);
    }

    // gspec=5 (WIN bonus level): the fish BODY is drawn for the YOUNG fish
    // (StartLittle/StartBig) — who sit still, hence BASE_FRAME below — while the
    // controlled "old" pair render as plain item sprites. Same swap renderInto does.
    const bigFishIdx = room.gspec === 5 ? room.startBig : room.bigIdx;
    const littleFishIdx = room.gspec === 5 ? room.startLittle : room.littleIdx;
    // spec=1 mirror anchor, captured during the item pass and applied after every
    // item is drawn — exactly like renderInto's KresliSpec ordering. spec=3 (gear)
    // and spec=4 (lift) likewise anchor the ZDVIZ elevator's double rope.
    let mirror: { x: number; y: number; bmp: FfrBitmap; spr: ImageBitmap | null } | null = null;
    let gear: { x: number; y: number; bmp: FfrBitmap } | null = null;
    let lift: { x: number; y: number } | null = null;
    for (let j = 1; j <= room.itemCount; j++) {
      const it = room.items[j]!;
      // In a gspec=2 darkness room the visibility rule flips: only the two fish and
      // items with spec=2 (the lit ones) show — everything else is swallowed by the
      // dark, regardless of spec/visible. Mirrors renderInto.
      if (room.gspec === 2) {
        if (it.spec !== 2 && j !== room.littleIdx && j !== room.bigIdx) continue;
      } else if (it.spec === 11 || !it.visible) {
        continue;
      }
      const shift = it.dir !== Dir.no ? Math.round(f.slide * FSIZE) : 0;
      const sx = shift * DX_DIR[it.dir]!;
      const sy = shift * DY_DIR[it.dir]!;
      const x0 = (it.x * FSIZE + sx) * S;
      const y0 = (it.y * FSIZE + sy) * S;
      if (it.spec === 1) {
        const bm = room.bitmaps[it.bmp + it.afaze];
        if (bm) mirror = { x: it.x * FSIZE + sx, y: it.y * FSIZE + sy, bmp: bm, spr: this.spriteFor(it, j) };
      } else if (it.spec === 3) {
        const bm = room.bitmaps[it.bmp];                       // gear pulley (no afaze)
        if (bm) gear = { x: it.x * FSIZE + sx, y: it.y * FSIZE + sy, bmp: bm };
      } else if (it.spec === 4) {
        lift = { x: it.x * FSIZE + sx, y: it.y * FSIZE + sy }; // the cabin below
      }
      // In the bonus the YOUNG fish are the ones drawn as fish, and they sit still —
      // renderInto forces BASE_FRAME there, so the live animation of the (elsewhere
      // controlled) old pair must not leak onto them.
      const bonus = room.gspec === 5;
      if (j === bigFishIdx) this.drawFish(ctx, room, 'big', x0, y0, bonus ? BASE_FRAME : f.fishAnim.big, it);
      else if (j === littleFishIdx) this.drawFish(ctx, room, 'little', x0, y0, bonus ? BASE_FRAME : f.fishAnim.little, it);
      else this.drawItem(ctx, it, j, x0, y0, room);
    }
    if (mirror) this.drawMirror(ctx, mirror.x, mirror.y, mirror.bmp, mirror.spr);
    // The elevator cable, after the mirror — KresliSpec's spec=3 case: a double rope
    // from the gear pulley (x+58, y+27) to the lift top (x+43, y), coloured by the
    // pixel sampled from the gear bitmap at (col 1, row 58).
    if (gear && lift) {
      const g = gear, l = lift;
      const ci = 58 * g.bmp.w + 1;
      const col = ci < g.bmp.pixels.length ? g.bmp.pixels[ci]! : 0;
      this.drawRope(ctx, room, g.x + 58, g.y + 27, l.x + 43, l.y, col);
    }
  }

  /**
   * KresliDvojlano (URoom.pas:25863) at S×: two "ropes" 4 ORIGINAL px apart running
   * from (x1,y1) down to (x2,y2), the x stepped by the accumulated slope so the pair
   * leans with the endpoints. The walk stays in original coordinates (identical
   * stepping to cpuDrawRope, so the lean matches the faithful render exactly) and each
   * step paints an S×S block, giving a rope that is S px thick instead of a hairline.
   * `col` is a palette index — resolved through the room palette since we draw RGBA.
   */
  private drawRope(ctx: CanvasRenderingContext2D, room: Room, x1: number, y1: number, x2: number, y2: number, col: number): void {
    if (y2 <= y1) return; // guards div-by-zero and the empty loop
    const S = this.scale;
    const c = room.palette[col];
    if (!c) return;
    ctx.save();
    ctx.fillStyle = `rgb(${c.r},${c.g},${c.b})`;
    const d = (x2 - x1) / (y2 - y1);
    let r = 0.5;
    let x = x1;
    for (let y = y1; y <= y2; y++) {
      while (r > 1) { x++; r -= 1; }
      while (r < 0) { x--; r += 1; }
      r += d;
      ctx.fillRect(x * S, y * S, S, S);
      ctx.fillRect((x + 4) * S, y * S, S, S);
    }
    ctx.restore();
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
  private drawMirror(ctx: CanvasRenderingContext2D, X: number, Y: number, bmp: FfrBitmap, spr: ImageBitmap | null): void {
    const S = this.scale;
    const w = bmp.w, h = bmp.h;
    if (w <= 0 || h <= 0 || !spr) return;
    const glass = this.glassMask(spr);
    if (!glass) return;
    const MW = spr.width, MH = spr.height;
    const CW = ctx.canvas.width, CH = ctx.canvas.height;
    // dest span [X, X+w) and its reflection [X+4-w, X+4), both in native columns.
    const rx0 = Math.max(0, Math.min(X, X + 4 - w) * S);
    const rx1 = Math.min(CW, Math.max(X + w, X + 4) * S);
    const ry0 = Math.max(0, Y * S), ry1 = Math.min(CH, (Y + h) * S);
    if (rx1 <= rx0 || ry1 <= ry0) return;
    const img = ctx.getImageData(rx0, ry0, rx1 - rx0, ry1 - ry0);
    const px = img.data;
    const snap = new Uint8ClampedArray(px); // pre-mirror snapshot to read from
    const RW = img.width;
    const K = S * (2 * X + 4) - 1; // srcCol = K - destCol
    const dx0 = Math.max(rx0, X * S), dx1 = Math.min(rx1, (X + w) * S);
    for (let sy = ry0; sy < ry1; sy++) {
      const my = sy - Y * S;
      if (my < 0 || my >= MH) continue;
      const rowBase = (sy - ry0) * RW;
      const mRow = my * MW;
      for (let D = dx0; D < dx1; D++) {
        const mx = D - X * S;
        if (mx < 0 || mx >= MW) continue;
        const g = glass[mRow + mx]!;
        if (g <= 0) continue; // frame / highlight streak / outside the glass
        const sX = K - D;
        if (sX < rx0 || sX >= rx1) continue;
        const di = (rowBase + (D - rx0)) * 4;
        const si = (rowBase + (sX - rx0)) * 4;
        if (g >= 1) {
          px[di] = snap[si]!; px[di + 1] = snap[si + 1]!; px[di + 2] = snap[si + 2]!; px[di + 3] = 255;
        } else { // soft rim: blend so the oval edge stays anti-aliased
          const n = 1 - g;
          px[di] = snap[si]! * g + snap[di]! * n;
          px[di + 1] = snap[si + 1]! * g + snap[di + 1]! * n;
          px[di + 2] = snap[si + 2]! * g + snap[di + 2]! * n;
          px[di + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, rx0, ry0);
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
   * Wall over the water-wobbled background. Only the background wobbles (a per-row
   * sinusoidal horizontal shift, Kresli2), so it is drawn as horizontal bands —
   * consecutive native rows that round to the same shift `k` share one draw — then
   * the wall (its matted alpha carries the doorway hole) is drawn flat on top.
   */
  private paintBackground(ctx: CanvasRenderingContext2D, room: Room, bg: ImageBitmap, wall: ImageBitmap, count: number): void {
    const S = this.scale;
    const H = this.nativeHeight;
    const W = bg.width;
    const { wamp, wper, wspd } = room;
    if (wamp === 0) {
      ctx.drawImage(bg, 0, 0);
    } else {
      let bandStart = 0;
      let bandK = delphiRound((wamp / 2) * Math.sin(0 / wper + count / wspd));
      const flush = (endRow: number) => {
        const sy = bandStart * S;
        const sh = (endRow - bandStart) * S;
        const dx = -bandK * S; // dest[j] = bg[j+k] ⇒ shift the image left by k
        ctx.drawImage(bg, 0, sy, W, sh, dx, sy, W, sh);
        if (bandK > 0) ctx.drawImage(bg, W - 1, sy, 1, sh, W - bandK * S, sy, bandK * S, sh); // clamp right edge
        else if (bandK < 0) ctx.drawImage(bg, 0, sy, 1, sh, 0, sy, -bandK * S, sh); // clamp left edge
      };
      for (let i = 1; i < H; i++) {
        const k = delphiRound((wamp / 2) * Math.sin(i / wper + count / wspd));
        if (k !== bandK) { flush(i); bandStart = i; bandK = k; }
      }
      flush(H);
    }
    ctx.drawImage(wall, 0, 0);
  }

  /**
   * An item's AI sprite(s) at its slid hi-res position. Matches the enhanced
   * spec=10 flip (statically-spec=10 art is pre-mirrored ⇒ drawn as-is; a runtime
   * spec=10 toggle mirrors the base art), and draws every sprite bound to this item
   * index in manifest order (stacked cabins etc.). Missing AI art falls back to
   * drawClassicItem(): the room's own FFR bitmap nearest-scaled ×S, mirroring
   * EnhancedArtSource's per-element fallback.
   */
  private drawItem(ctx: CanvasRenderingContext2D, item: Item, index: number, x0: number, y0: number, room: Room): void {
    const preMirrored = (item.initSpec ?? item.spec) === 10;
    const mirror = (item.spec === 10) !== preMirrored;
    let drew = false;
    for (const obj of this.objects) {
      if (obj.item !== index || obj.frames.length === 0) continue;
      const spr = obj.frames[frameIndex(item.afaze, obj.frames.length)]!;
      this.blit(ctx, spr, x0, y0, mirror);
      drew = true;
    }
    // Not every item has staged FFNG art (e.g. WIN's bonus-window fish, items 10/11,
    // are absent from objects.json). The enhanced source silently falls through to
    // classicItem() in that case; without the same fallback the AI tier would simply
    // DROP those items. Draw the room's own FFR bitmap, nearest-scaled ×S.
    if (!drew) this.drawClassicItem(ctx, room, item, x0, y0);
  }

  /**
   * classicItem() at S×: the palette FFR bitmap with `item.mask` as the transparent
   * index, magnified nearest-neighbour so it lines up with the rest of the ×S
   * composite. Cached per bitmap+mask — the art is static, only the position moves.
   */
  private drawClassicItem(ctx: CanvasRenderingContext2D, room: Room, item: Item, x0: number, y0: number): void {
    const bmp = room.bitmaps[item.bmp + item.afaze];
    if (!bmp) return;
    const cv = this.classicSprite(room, bmp, item.mask, `i${item.bmp + item.afaze}`);
    if (!cv) return;
    if (item.spec === 10) {                            // KresliRev
      ctx.save();
      ctx.translate(x0 + cv.width, y0);
      ctx.scale(-1, 1);
      ctx.drawImage(cv, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(cv, x0, y0);
    }
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
  private drawFish(ctx: CanvasRenderingContext2D, room: Room, which: 'little' | 'big', x0: number, y0: number, frame: FishFrame, item: Item): void {
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
      this.drawDisintegrating(ctx, skel, x0, y0, rozpad);
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
      if (cv) this.blit2(ctx, cv, x0, y0, facingRight);
      return;
    }
    const body = set.get(bodyFile);
    if (!body) return;
    this.blit(ctx, body, x0, y0, false);
    if (frame.headFrame > 0) {
      const headFile = FISH_HEAD_FILE[frame.headFrame];
      const head = headFile ? set.get(headFile) : undefined;
      if (head) this.blit(ctx, head, x0, y0, false);
    }
  }

  /**
   * KresliK's dithered dissolve at S×. The original keeps a source pixel only
   * where `RANDPOLE[(row*w + col) & 255] < rozpad`, so as rozpad counts down the
   * skeleton erodes away. The threshold is evaluated per ORIGINAL pixel (the AI
   * sprite is S× that grid), so the dissolve keeps the same coarse granularity as
   * the faithful render rather than turning into fine noise. Composed on a scratch
   * canvas — punching the holes with clearRect there and blitting once keeps the
   * room composite untouched.
   */
  private drawDisintegrating(ctx: CanvasRenderingContext2D, spr: ImageBitmap, x0: number, y0: number, rozpad: number): void {
    const S = this.scale;
    const nw = Math.max(1, Math.round(spr.width / S));
    const nh = Math.max(1, Math.round(spr.height / S));
    let cv = this.dissolveCanvas;
    if (!cv || cv.width !== spr.width || cv.height !== spr.height) {
      cv = document.createElement('canvas');
      cv.width = spr.width; cv.height = spr.height;
      this.dissolveCanvas = cv;
    }
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(spr, 0, 0);
    for (let i = 0; i < nh; i++) {
      const pBase = (i * nw) & 255;
      for (let j = 0; j < nw; j++) {
        if (RANDPOLE[(pBase + j) & 255]! < rozpad) continue; // survives
        g.clearRect(j * S, i * S, S, S);
      }
    }
    ctx.drawImage(cv, x0, y0);
  }

  /** blit() for a canvas source (the classic ×S sprites). */
  private blit2(ctx: CanvasRenderingContext2D, spr: HTMLCanvasElement, x: number, y: number, mirror: boolean): void {
    if (!mirror) { ctx.drawImage(spr, x, y); return; }
    ctx.save();
    ctx.translate(x + spr.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0);
    ctx.restore();
  }

  private blit(ctx: CanvasRenderingContext2D, spr: ImageBitmap, x: number, y: number, mirror: boolean): void {
    if (!mirror) { ctx.drawImage(spr, x, y); return; }
    ctx.save();
    ctx.translate(x + spr.width, y);
    ctx.scale(-1, 1);
    ctx.drawImage(spr, 0, 0);
    ctx.restore();
  }
}
