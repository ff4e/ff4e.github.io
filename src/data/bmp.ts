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
