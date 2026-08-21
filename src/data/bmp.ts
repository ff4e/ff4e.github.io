/**
 * Minimal 8-bit (256-colour) Windows BMP reader, used by the briefcase cutscene
 * and the world map (mapa-*, maska, n0..n4). Returns a top-down indexed image
 * plus its palette.
 */
export interface Bmp {
  w: number;
  h: number;
  /** top-down, one palette index per pixel */
  pixels: Uint8Array;
  palette: { r: number; g: number; b: number }[];
}

export function parseBmp(data: Uint8Array): Bmp {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const h = Math.abs(hRaw);
  const bottomUp = hRaw > 0;
  const palStart = 14 + dv.getUint32(14, true); // after the info header
  const palCount = (dataOffset - palStart) >> 2;
  const palette: { r: number; g: number; b: number }[] = [];
  for (let i = 0; i < 256; i++) {
    if (i < palCount) {
      const o = palStart + i * 4;
      palette.push({ b: data[o]!, g: data[o + 1]!, r: data[o + 2]! });
    } else {
      palette.push({ r: 0, g: 0, b: 0 });
    }
  }
  const rowSize = (w + 3) & ~3; // padded to 4 bytes
  const pixels = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const src = dataOffset + (bottomUp ? h - 1 - row : row) * rowSize;
    pixels.set(data.subarray(src, src + w), row * w);
  }
  return { w, h, pixels, palette };
}

/**
 * The inverse of `bmpToRgba`: rebuild an indexed image from RGBA and a known palette.
 *
 * Needed because a compressed image format is colour, not indices, while the renderers
 * that read these bitmaps composite on INDICES — the credits pick their transparent and
 * background colours as the static frame's corner PIXELS and compare index to index
 * (render/credits.ts, UMain.pas:1171,1179-1181). Re-encoding an 8-bit BMP as WebP
 * therefore has to be undone here, or the compositing rule would have to change.
 *
 * Exact only if the palette is INJECTIVE, which is a property of the asset and not
 * something this function can assume: two indices sharing an RGB triple would make the
 * recovery ambiguous. The caller owns that check (`tools/build-credits-webp.py` asserts
 * it at build time, `test/creditsAsset.test.ts` pins it), and this function reports the
 * collision rather than silently picking one.
 *
 * A colour that is not in the palette THROWS. That is the whole safety argument for
 * shipping these as WebP: the decoder is the browser's now, not ours, so if one ever
 * hands back a shifted colour — colour management, a codec bug — the result is a loud
 * failure through the asset door, never a credits roll quietly rendered in wrong
 * colours. Not knowing must not be recorded as knowing.
 */
export function rgbaToIndexed(
  rgba: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  palette: { r: number; g: number; b: number }[],
): Bmp {
  if (rgba.length < w * h * 4) {
    throw new Error(`rgbaToIndexed: ${rgba.length} bytes is short of ${w}x${h} RGBA`);
  }
  // Packed RGB -> index. A Map of 256 entries, not a 16 MB direct-addressed table: this
  // runs once per asset, and the lookup is not what costs.
  const index = new Map<number, number>();
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const key = (c.r << 16) | (c.g << 8) | c.b;
    const seen = index.get(key);
    if (seen !== undefined) {
      throw new Error(`rgbaToIndexed: palette is not injective (${seen} and ${i} are both #${key.toString(16).padStart(6, '0')})`);
    }
    index.set(key, i);
  }
  const pixels = new Uint8Array(w * h);
  for (let p = 0; p < pixels.length; p++) {
    const o = p * 4;
    const key = (rgba[o]! << 16) | (rgba[o + 1]! << 8) | rgba[o + 2]!;
    const idx = index.get(key);
    if (idx === undefined) {
      throw new Error(`rgbaToIndexed: pixel ${p} is #${key.toString(16).padStart(6, '0')}, which is not in the palette`);
    }
    pixels[p] = idx;
  }
  return { w, h, pixels, palette };
}

/** Flatten an indexed image to RGBA using its palette (row-major, top-down). */
export function bmpToRgba(bmp: Bmp): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(bmp.w * bmp.h * 4);
  for (let i = 0; i < bmp.pixels.length; i++) {
    const c = bmp.palette[bmp.pixels[i]!]!;
    rgba[i * 4] = c.r;
    rgba[i * 4 + 1] = c.g;
    rgba[i * 4 + 2] = c.b;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
