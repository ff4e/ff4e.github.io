/**
 * Test helper: sample the RGBA compositor's output plane. Paired with a
 * "distinguishing" palette (index i -> a unique RGBA), an assertion on the
 * sampled colour is equivalent to — and as exact as — an assertion on the
 * palette index, so pixel tests can validate the production RGBA compositor
 * (RgbaScreen) directly.
 */
import type { RgbaScreen } from '../src/render/rgbaScreen.js';
import type { FfrPaletteEntry } from '../src/data/ffr.js';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Read the RGBA at (x,y) from a rendered RgbaScreen. */
export function rgbaAt(screen: RgbaScreen, x: number, y: number): Rgba {
  const o = (y * screen.width + x) * 4;
  return { r: screen.rgba[o]!, g: screen.rgba[o + 1]!, b: screen.rgba[o + 2]!, a: screen.rgba[o + 3]! };
}

/** A 256-entry palette mapping every index to a distinct opaque colour. */
export function distinguishingPalette(): FfrPaletteEntry[] {
  return Array.from({ length: 256 }, (_, i) => ({ r: i, g: (255 - i) & 255, b: (i * 7) & 255 }));
}

/** The expected RGBA for palette index `i` under `distinguishingPalette`. */
export function paletteRgba(i: number): Rgba {
  return { r: i, g: (255 - i) & 255, b: (i * 7) & 255, a: 255 };
}
