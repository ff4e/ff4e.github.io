/**
 * The region blit behind the briefcase cutscene's `"model": "original"` frames
 * (src/render/indexedRegion.ts).
 *
 * Only `regionRgba` is exercised: the blit itself needs a real canvas, and vitest runs in
 * the default `node` environment here with no canvas polyfill — the same constraint
 * test/roomAi.test.ts records. That is not a gap worth minding, because the arithmetic IS
 * the part that can be wrong. The source stride is the WHOLE picture's width while the
 * destination stride is the region's, so an off-by-one there reads a diagonal smear out
 * of the frame and still produces a plausible-looking image.
 */
import { describe, it, expect } from 'vitest';
import { regionRgba } from '../src/render/indexedRegion.js';

/** A 6x4 indexed picture whose value is its own index, so a misread is traceable. */
const SRC_W = 6;
const SRC_H = 4;
const pixels = new Uint8Array(SRC_W * SRC_H);
for (let i = 0; i < pixels.length; i++) pixels[i] = i;

/** Palette entry n encodes n in the red channel, and its row/column in green/blue. */
const palette = Array.from({ length: 256 }, (_, n) => ({
  r: n,
  g: Math.floor(n / SRC_W),
  b: n % SRC_W,
}));

const at = (rgba: Uint8ClampedArray, w: number, x: number, y: number) => {
  const o = (y * w + x) * 4;
  return { r: rgba[o], g: rgba[o + 1], b: rgba[o + 2], a: rgba[o + 3] };
};

describe('regionRgba', () => {
  it('reads the region with the SOURCE stride, not the region width', () => {
    const region = { x: 2, y: 1, w: 3, h: 2 };
    const rgba = regionRgba(pixels, palette, SRC_W, region);

    expect(rgba.length).toBe(region.w * region.h * 4);
    // Top-left of the region is source (2,1) = index 1*6+2 = 8.
    expect(at(rgba, region.w, 0, 0).r).toBe(8);
    // Walking right walks the source row.
    expect(at(rgba, region.w, 1, 0).r).toBe(9);
    expect(at(rgba, region.w, 2, 0).r).toBe(10);
    // Walking DOWN must jump a full source row (6), not a region row (3).
    expect(at(rgba, region.w, 0, 1).r).toBe(14);
    expect(at(rgba, region.w, 2, 1).r).toBe(16);
  });

  it('keeps the palette colour and makes every pixel opaque', () => {
    const region = { x: 0, y: 0, w: 2, h: 2 };
    const rgba = regionRgba(pixels, palette, SRC_W, region);
    // (1,1) is source index 7: row 1, column 1.
    expect(at(rgba, 2, 1, 1)).toEqual({ r: 7, g: 1, b: 1, a: 255 });
    for (let i = 3; i < rgba.length; i += 4) expect(rgba[i]).toBe(255);
  });

  it('covers the whole picture when the region is the whole picture', () => {
    const rgba = regionRgba(pixels, palette, SRC_W, { x: 0, y: 0, w: SRC_W, h: SRC_H });
    for (let i = 0; i < SRC_W * SRC_H; i++) expect(rgba[i * 4]).toBe(i);
  });

  it('leaves a pixel transparent rather than throwing on a palette hole', () => {
    // A short palette is the shape of a corrupt/short PAL, and dropping the pixel is the
    // one behaviour that keeps the rest of the frame renderable.
    const rgba = regionRgba(pixels, palette.slice(0, 5), SRC_W, { x: 0, y: 0, w: 3, h: 2 });
    expect(at(rgba, 3, 0, 0).r).toBe(0);
    expect(at(rgba, 3, 0, 1).a).toBe(0); // source index 6, past the short palette
  });
});
