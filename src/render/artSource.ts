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
