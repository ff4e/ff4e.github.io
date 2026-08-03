/**
 * Art source — the single pluggable seam that decides *what colour / which
 * pixels* every element of a room is drawn with. It is the ONLY thing that
 * differs between the classic 256-colour look and the enhanced (FFNG truecolor)
 * look; the room compositor (renderInto) is one uniform path that only decides
 * *structure* (positions, z-order, background mode, mirror/ropes/hooks) and asks
 * the art source to draw each element.
 *
 *   - ClassicArtSource   (renderRoom.ts) — draws from the FFR bitmaps + palette.
 *   - EnhancedArtSource  (enhancedArtSource.ts)   — draws from the FFNG truecolor masters,
 *                          delegating to the classic draw helpers for anything
 *                          with no truecolor form (ZX bands, darkness fill, the
 *                          spec=1 mirror glass, dead-fish skeleton, unmapped
 *                          frames, the gspec=5 bonus).
 *
 * There is no per-room eligibility gate and no "if enhanced else classic" branch
 * in the compositor: an art source that can't improve an element simply calls
 * the shared classic helper for it.
 *
 * `lut` is a 256×4 (RGBA) table mapping a palette index to its colour; the RGBA
 * framebuffer copies four bytes from `lut[idx*4 .. idx*4+3]` for every classic
 * pixel it writes, so index-based drawing stays fast.
 */
import type { FfrPaletteEntry, FfrBitmap } from '../data/ffr.js';
import type { Room, Item } from '../core/room.js';
import type { CompositeTarget } from './framebuffer.js';
import type { FishFrame } from './renderRoom.js';

export interface ArtSource {
  /** 256-entry RGBA lookup table (length 1024): index -> {r,g,b,a=255}. */
  readonly lut: Uint8Array;
  /** Draw the wall + water-wobbled background (all gspec modes). */
  paintBackground(screen: CompositeTarget, room: Room, wall: FfrBitmap, bg: FfrBitmap, count: number): void;
  /** Draw item `index` at its slid screen offset (sx,sy). */
  drawItem(screen: CompositeTarget, room: Room, item: Item, index: number, sx: number, sy: number): void;
  /** Draw a fish at its slid screen offset (sx,sy), for the given animation frame. */
  drawFish(
    screen: CompositeTarget,
    room: Room,
    which: 'little' | 'big',
    item: Item,
    sx: number,
    sy: number,
    frame: FishFrame,
  ): void;
}

/** Flatten a room palette into a 256×4 opaque-RGBA lookup table. */
export function buildPaletteLut(palette: readonly FfrPaletteEntry[]): Uint8Array {
  const lut = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) {
    const c = palette[i] ?? { r: 0, g: 0, b: 0 };
    const o = i * 4;
    lut[o] = c.r;
    lut[o + 1] = c.g;
    lut[o + 2] = c.b;
    lut[o + 3] = 255;
  }
  return lut;
}

/**
 * What a wreck replay changed, in NATIVE game pixels, whatever resolution it replayed at.
 *
 * `cells` is the number of distinct native cells that differ — not pixels — so the count
 * is directly comparable between a native-resolution replay and an ×S one. That
 * comparability is the point: `tools/test-ai-wreck.mjs` checks the `ai` tier's ×S replay
 * against the enhanced tier's native replay of the SAME recorded history, and a bounding
 * box alone is far too coarse an oracle for that — a replay that erodes the ship wrongly,
 * or applies a tick's swaps in the wrong order, produces very different pixels inside an
 * identical box. `cells` catches both; the box on its own does not.
 */
export interface WreckDamage {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly cells: number;
}

/**
 * Compare a mutated RGBA buffer against its pristine original and report the damage.
 *
 * Alpha is ignored, because the two tiers deliberately treat it differently (the ×S
 * replay forces written pixels opaque — see applyWreckSwapScaled), and comparing it would
 * make the tiers disagree for a reason that is not a defect.
 *
 * Diagnostic only: it scans the whole buffer, which at ×4 is 25 MB.
 */
export function wreckDamage(
  now: Uint8Array | Uint8ClampedArray,
  was: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  scale: number,
): WreckDamage | null {
  const cw = Math.ceil(width / scale);
  const seen = new Uint8Array(cw * Math.ceil(height / scale));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let cells = 0;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    const ny = Math.floor(y / scale);
    for (let x = 0; x < width; x++) {
      const o = row + x * 4;
      if (now[o] === was[o] && now[o + 1] === was[o + 1] && now[o + 2] === was[o + 2]) continue;
      const nx = Math.floor(x / scale);
      const cell = ny * cw + nx;
      if (seen[cell] === 0) { seen[cell] = 1; cells++; }
      if (nx < x0) x0 = nx;
      if (ny < y0) y0 = ny;
      if (nx > x1) x1 = nx;
      if (ny > y1) y1 = ny;
    }
  }
  return cells === 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, cells };
}
