/**
 * The faithful (classic / enhanced) room renderer: the entry points, the
 * `RoomWalkSink` that drives them, the classic draw helpers (KresliRybu,
 * URoom.pas:25658-25785, and KresliObjekt) and the fishing hooks.
 *
 * The traversal itself — TRoom.Priprav (URoom.pas:26167-26283), i.e. which items are
 * drawn, in what order, at what coordinates, including the slide of an item with a
 * pending `dir` — lives in `roomWalk.ts` and is shared with the `ai` tier. Look there
 * for the visibility, gspec and effect-anchor rules, not here.
 *
 * Draws from live `Room` state. Each fish is drawn from an explicit animation
 * descriptor (body frame + head frame) that the host computes from the engine's frame
 * tables; a crushed fish is drawn as an eroding skeleton.
 *
 * Fish frame tables (URoom.pas:380-398): tl_zaklad=[1,2,3] (idle), tl_plav=
 * [4..9] (swim L/R), tl_otocka=[10,11,12] (turn), tl_nahoru=[13..18] /
 * tl_dolu=[18..13] (swim up/down), tl_kostra=19 (skeleton); heads hl_tlaci=1,
 * hl_mrk=2 (blink). dxhlavy head split = (14,19).
 */
import { type FfrRoom, type FfrBitmap, Kind } from '../data/ffr.js';
import { Room, type Item } from '../core/room.js';
import { IndexedScreen, type CompositeTarget } from './framebuffer.js';
import { RgbaScreen } from './rgbaScreen.js';
import { ClassicArtSource } from './classicArtSource.js';
import { walkRoom, FSIZE, TL_ZAKLAD, type RoomWalkSink, type FishFrame } from './roomWalk.js';
import type { ArtSource } from './artSource.js';
import { advanceZxBands } from './zxBands.js';

export { FSIZE, TL_ZAKLAD, type FishFrame };
const DXRYBY = { little: 45, big: 60 } as const;
const DXHLAVY = { little: 14, big: 19 } as const;
const TL_KOSTRA = 19;
/** tl_tma (URoom.pas:389): the dark silhouette body used in gspec=2 darkness rooms. */
export const TL_TMA = 23;

/**
 * gspec=2 darkness body frame (KresliRybu, URoom.pas:25746-25748). In a darkness
 * room the fish body is the dark silhouette `Tela[.,tl_tma]`; but while turning
 * (`otocka`) or on a ~6% per-tick flicker it becomes `Tela[.,0]` — a nil bitmap
 * (URoom.pas:1293/1300) → nothing is drawn, so the fish momentarily winks out.
 */
export function darkBodyFrame(winkOut: boolean): number {
  return winkOut ? 0 : TL_TMA;
}

export const TL_PLAV = [4, 5, 6, 7, 8, 9] as const;
export const TL_OTOCKA = [10, 11, 12] as const;
export const TL_NAHORU = [13, 14, 15, 16, 17, 18] as const;
export const TL_DOLU = [18, 17, 16, 15, 14, 13] as const;
/** tl_mluvi_na (URoom.pas:387): body frames when a fish is turned to talk to its partner. */
export const TL_MLUVI_NA = [20, 21, 22] as const;
export const HL_TLACI = 1;
export const HL_MRK = 2;
/** hl_mluvi (URoom.pas:398): talking head frames, cycled while a voice plays (0 = mouth closed). */
export const HL_MLUVI = [0, 5, 6] as const;

/**
 * Which Tela body frame and Hlavy head frame to draw for a fish — see
 * `FishFrame` in roomWalk.ts, re-exported above. `TL_ZAKLAD` lives there too,
 * because the resting `BASE_FRAME` the walk falls back to is derived from it.
 */

export interface RenderOptions {
  /** Engine frame counter; drives the water displacement. Default 0. */
  count?: number;
  /** Slide progress in [0,1] applied to items with a pending dir. Default 0. */
  slide?: number;
  /** Per-fish body/head frame selection; defaults to the resting base pose. */
  fishAnim?: { little: FishFrame; big: FishFrame };
  /** Hacky fishing hooks (KresliHacky): line + tip + a dragged caught fish. */
  hooks?: ReadonlyArray<{
    stav: number;
    x: number;
    y: number;
    facingRight: boolean;
    cil: 'little' | 'big';
  }>;
}

/** Faithful wall bitmap for a room (defines the BMScreen dimensions). */
function wallBaseOf(room: Room): FfrBitmap {
  const wallBase = room.bitmaps[room.wallItem.bmp];
  if (!wallBase) throw new Error('room is missing its wall bitmap');
  return wallBase;
}

/** Render the current room state into a fresh indexed screen buffer. */
export function renderRoomState(room: Room, opts: RenderOptions = {}): IndexedScreen {
  const wallBase = wallBaseOf(room);
  const screen = new IndexedScreen(wallBase.w, wallBase.h);
  renderInto(screen, room, opts, new ClassicArtSource(room.palette));
  return screen;
}

/**
 * Render the current room state into a fresh RGBA screen, colouring through the
 * given art source. For the classic art source the resulting `rgba` plane is
 * byte-for-byte identical to `renderRoomState(room, opts).toRgba(room.palette)`.
 */
export function renderRoomRgba(room: Room, art: ArtSource, opts: RenderOptions = {}): RgbaScreen {
  const wallBase = wallBaseOf(room);
  const screen = new RgbaScreen(wallBase.w, wallBase.h, art);
  renderInto(screen, room, opts, art);
  return screen;
}

/**
 * Render the room through the shared compositor into an arbitrary
 * `CompositeTarget` — the seam the WebGL backend (`GlScreen`) plugs into. Same
 * `renderInto` code path as the CPU `RgbaScreen`, so structure (z-order,
 * visibility, effect geometry) is identical and the backend is the only switch.
 * The target must already be sized to the room's wall dimensions.
 */
export function renderRoomInto(
  target: CompositeTarget,
  room: Room,
  art: ArtSource,
  opts: RenderOptions = {},
): void {
  renderInto(target, room, opts, art);
}

/**
 * The wall + background bitmaps and water-wobble parameters for a room's Kresli2
 * background (URoom.pas:26223) — where the frame choice lives, for the compositor,
 * the isolated background reference render and the WebGL texture upload alike:
 *   Bitmaps[BMP + afaze] (wall foreground) and Bitmaps[BgBMP + Bgfaze] (background).
 *
 * BgBMP is always 1 (URoom.pas:1238). `Bgfaze` is only ever set — by STEEL's red alert
 * (URoom.pas:9983/9990) — to the same value it writes to the wall item's `afaze`
 * (URoom.pas:9999), so in every shipped room `Bgfaze === wallItem.afaze`. Keying both
 * frames off `wallItem.afaze` reproduces STEEL's whole-room red alert (afaze=0
 * elsewhere, so this is a no-op for every other room).
 */
export function backgroundInputs(room: Room): {
  wall: FfrBitmap;
  bg: FfrBitmap;
  mask: number;
  wamp: number;
  wper: number;
  wspd: number;
  gspec: number;
} {
  const wallBase = wallBaseOf(room);
  const faze = room.wallItem.afaze;
  const wall = room.bitmaps[room.wallItem.bmp + faze] ?? wallBase;
  const bg = room.bitmaps[1 + faze] ?? room.bgBmp;
  return { wall, bg, mask: room.wallItem.mask, wamp: room.wamp, wper: room.wper, wspd: room.wspd, gspec: room.gspec };
}

/**
 * CPU reference render of ONLY the background layer (wall + wobbled bg, no
 * items/fish/effects), used to validate the WebGL background shader in isolation.
 */
export function renderRoomBackgroundRgba(room: Room, art: ArtSource, opts: RenderOptions = {}): RgbaScreen {
  const wallBase = wallBaseOf(room);
  const screen = new RgbaScreen(wallBase.w, wallBase.h, art);
  const { wall, bg } = backgroundInputs(room);
  art.paintBackground(screen, room, wall, bg, opts.count ?? 0);
  return screen;
}

/**
 * The faithful renderer's `RoomWalkSink` — a pure forwarder over the target and the
 * art source. Every coordinate the walk emits is already native, which is exactly what
 * `ArtSource` takes, so nothing is translated on the way through.
 */
function faithfulSink(screen: CompositeTarget, art: ArtSource): RoomWalkSink {
  return {
    // The art source paints it — classic (palette) or enhanced (FFNG truecolor); the
    // ZX / darkness / no-master cases delegate to classicBackground.
    background: (room, count) => {
      const { wall, bg } = backgroundInputs(room);
      art.paintBackground(screen, room, wall, bg, count);
    },
    item: (room, item, index, sx, sy) => art.drawItem(screen, room, item, index, sx, sy),
    fish: (room, which, item, sx, sy, frame) => art.drawFish(screen, room, which, item, sx, sy, frame),
    // The target's own `mirror` primitive: a CPU pixel loop, or a GPU shader pass.
    mirror: (_room, at) => screen.mirror(at.x, at.y, at.bmp.w, at.bmp.h),
    rope: (_room, x1, y1, x2, y2, col) => screen.drawRope(x1, y1, x2, y2, col),
  };
}

/**
 * Render the room into a `CompositeTarget` — the palette-indexed `IndexedScreen`, the
 * RGBA `RgbaScreen`, or the WebGL `GlScreen`. Structure comes from the shared
 * `walkRoom`; this function adds only the fishing hooks, which the `ai` tier never
 * draws (`aiRoomGateAllows` hands those frames back here) and which therefore have no
 * business in the shared walk.
 */
function renderInto(screen: CompositeTarget, room: Room, opts: RenderOptions, art: ArtSource): void {
  walkRoom(faithfulSink(screen, art), room, opts.count ?? 0, opts.slide ?? 0, opts.fishAnim);

  // Hacky (KresliHacky, URoom.pas:25987): the fishing hooks, drawn on top of all.
  if (opts.hooks && opts.hooks.length > 0) drawHooks(screen, room, opts.hooks);
}

/**
 * KresliHacky (URoom.pas:25987): draw each active fishing hook — a 2px vertical
 * line from the ceiling to the hook tip, a small hook glyph, and (once caught) the
 * yanked fish's body dragged up on the line. The line colours are palette-dependent
 * `fontcol['w',1/4]` in the original (a computed near-white); we approximate with
 * the palette's two brightest indices.
 */
function drawHooks(
  screen: CompositeTarget,
  room: Room,
  hooks: NonNullable<RenderOptions['hooks']>,
): void {
  const [c1, c2] = brightestPair(room.palette);
  for (const h of hooks) {
    if (h.stav === 0) continue; // idle hooks are not on-screen
    const lx = h.x * FSIZE;
    // The 2px line from the ceiling down to the hook tip.
    for (let y = 0; y < h.y; y++) {
      if (y < 0 || y >= screen.height) continue;
      if (lx >= 0 && lx < screen.width) screen.setIndex(lx, y, c1);
      if (lx + 1 >= 0 && lx + 1 < screen.width) screen.setIndex(lx + 1, y, c2);
    }
    if (h.stav !== 3) {
      // A small hook shape at the tip (a short vertical stroke + a barb).
      for (let k = 0; k < 6; k++) plot(screen, lx, h.y + k, c1);
      plot(screen, lx - 1, h.y + 6, c1);
      plot(screen, lx - 2, h.y + 5, c1);
      plot(screen, lx - 2, h.y + 4, c1);
    } else {
      // Caught: drag the fish's body up the line (Ulovena*, URoom.pas:26017).
      const bodies = h.cil === 'little' ? room.bodies.small : room.bodies.big;
      const body = bodies[1] ?? null; // Tela[.,1] — the resting frame
      const mask = room.items[h.cil === 'little' ? room.littleIdx : room.bigIdx]!.mask;
      if (body) {
        const bx = h.facingRight ? lx - body.w + 4 : lx - 3;
        screen.blitFishComposite(bx, h.y, body, null, mask, 0, h.facingRight);
      }
    }
  }
}

/** Set one pixel if in bounds. */
function plot(screen: CompositeTarget, x: number, y: number, col: number): void {
  if (x < 0 || x >= screen.width || y < 0 || y >= screen.height) return;
  screen.setIndex(x, y, col);
}

/** fontcol['w',4] (URoom.pas:1109-1114 with i=4 → target colour (0,0,0)): the palette
 *  index nearest to pure black under the engine's weighted colour distance
 *  (0.35·r² + 0.5·g² + 0.15·b²). Used as the gspec=2 darkness fill. */
export function darkestIndex(palette: readonly { r: number; g: number; b: number }[]): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const err = 0.35 * c.r * c.r + 0.5 * c.g * c.g + 0.15 * c.b * c.b;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/** The palette's two brightest (near-white) indices, for the hook line. */
function brightestPair(palette: readonly { r: number; g: number; b: number }[]): [number, number] {
  let b1 = 1;
  let b2 = 1;
  let s1 = -1;
  let s2 = -1;
  for (let i = 1; i < palette.length; i++) {
    const p = palette[i]!;
    const s = p.r + p.g + p.b;
    if (s > s1) {
      s2 = s1;
      b2 = b1;
      s1 = s;
      b1 = i;
    } else if (s > s2) {
      s2 = s;
      b2 = i;
    }
  }
  return [b1, b2];
}


/**
 * Classic background painter (all gspec modes) — the shared helper both art
 * sources reuse: the classic look calls it wholesale, and the enhanced look calls
 * it for the ZX / darkness / no-master cases it can't render in truecolor.
 * VyplnMistnost darkness fill (URoom.pas:26210), the gspec=42 ZX band render
 * (URoom.pas:26214), or the normal Kresli2 wall-over-wobbled-bg.
 */
export function classicBackground(
  screen: CompositeTarget,
  room: Room,
  wall: FfrBitmap,
  bg: FfrBitmap,
  count: number,
): void {
  if (room.gspec === 2) {
    // In a darkness room the whole screen is the palette's near-black index; only
    // lit items (spec=2) and the fish silhouettes are drawn on top.
    screen.fillIndex(darkestIndex(room.palette));
  } else if (room.gspec === 42) {
    // The ZX-Spectrum "emulator" wall render — advance the loading-stripe band
    // height per frame, then blit the wall with opaque pixels replaced by bands.
    // The advance lives in zxBands.ts so the ×S renderer runs the same sequence.
    const colors = advanceZxBands(room, wall, count);
    screen.blitZX(0, 0, wall, bg, room.wallItem.mask, count, room.wamp, room.wper, room.wspd, colors, room.zx);
  } else {
    screen.blit2(0, 0, wall, bg, room.wallItem.mask, count, room.wamp, room.wper, room.wspd);
  }
}

/**
 * Classic item draw (KresliObjekt, URoom.pas:25787): blit the item's current
 * animation frame at its slid screen position. spec=10 items are drawn
 * horizontally mirrored (KresliRev) — DRAKAR1's band vikings, PARTY2's portholes.
 */
export function classicItem(screen: CompositeTarget, room: Room, item: Item, sx: number, sy: number): void {
  const bmp = room.bitmaps[item.bmp + item.afaze];
  if (!bmp) return;
  if (item.spec === 10) screen.blitRev(item.x * FSIZE + sx, item.y * FSIZE + sy, bmp, item.mask);
  else screen.blit(item.x * FSIZE + sx, item.y * FSIZE + sy, bmp, item.mask);
}

/**
 * Classic fish draw (KresliRybu, URoom.pas:25664): the body+head composite, or an
 * eroding skeleton for a dead fish. Shared with the enhanced art source, which
 * calls it for the skeleton / un-mapped-frame fallbacks.
 */
export function classicFish(
  screen: CompositeTarget,
  room: Room,
  which: 'big' | 'little',
  item: Item,
  sx: number,
  sy: number,
  af: FishFrame,
): void {
  if (which === 'big' ? room.venku.big : room.venku.little) return; // exited: gone
  const alive = which === 'big' ? room.alive.big : room.alive.little;
  const dead = which === 'big' ? room.kostra.big : room.kostra.little;
  // A fish that is neither alive nor a skeleton is not drawn (fully gone).
  if (!alive && !dead) return;
  const facingRight = which === 'big' ? room.facingRight.big : room.facingRight.little;
  const dxr = which === 'big' ? DXRYBY.big : DXRYBY.little;
  const bodies = which === 'big' ? room.bodies.big : room.bodies.small;
  const heads = which === 'big' ? room.heads.big : room.heads.small;
  const x0 = item.x * FSIZE + sx;
  const y0 = item.y * FSIZE + sy;
  // rev anchor: facing right draws mirrored from x0+dxryby-1 (URoom.pas:25766).
  const ax = facingRight ? x0 + dxr - 1 : x0;

  if (dead) {
    const skel = bodies[TL_KOSTRA];
    if (!skel) return;
    const rozpad = Math.min(which === 'big' ? room.rozpad.big : room.rozpad.little, 255);
    screen.blitDisintegrate(ax, y0, skel, item.mask, rozpad, facingRight);
    return;
  }

  const body = bodies[af.bodyFrame];
  if (!body) return;
  // Head 0 (or nil Hlavy[.,0]) => no overlay; the body's built-in face shows.
  const head = af.headFrame > 0 ? (heads[af.headFrame] ?? null) : null;
  const split = which === 'big' ? DXHLAVY.big : DXHLAVY.little;
  screen.blitFishComposite(ax, y0, body, head, item.mask, split, facingRight);
}

/**
 * The room's native screen dimensions (wall base bitmap), for sizing a render
 * target without compositing — used by the WebGL backend to `begin()` a frame.
 */
export function roomScreenSize(room: Room): { w: number; h: number } {
  const wb = wallBaseOf(room);
  return { w: wb.w, h: wb.h };
}

/** Convenience for the M0/M1 tools: render an FFR's initial resting frame. */
export function renderRoomStatic(ffr: FfrRoom, opts: RenderOptions = {}): IndexedScreen {
  return renderRoomState(new Room(ffr), opts);
}

export { Kind };
