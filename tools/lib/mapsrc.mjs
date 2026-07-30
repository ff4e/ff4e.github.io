/**
 * Shared source helpers for the world-map AI tools (build-map-ai.mjs, build-map-matrix.mjs).
 *
 * These mirror the game's own BMP decode (src/data/bmp.ts) so the tool-side colours are
 * byte-identical to what the runtime renders — important because the map art is 8-bit
 * palette-indexed BMP with a colour-key top-left pixel for the node sprites.
 *
 * Kept in one place so the many upcoming "regenerate the map with model X" passes only ever
 * touch the model table, never the decode/matte plumbing.
 */

/** Minimal 8-bit (256-colour) Windows BMP reader. Returns {w,h,pixels(index),palette}. */
export function parseBmp(data) {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const dataOffset = dv.getUint32(10, true);
  const w = dv.getInt32(18, true);
  const hRaw = dv.getInt32(22, true);
  const h = Math.abs(hRaw);
  const bottomUp = hRaw > 0;
  const palStart = 14 + dv.getUint32(14, true);
  const palCount = (dataOffset - palStart) >> 2;
  const palette = [];
  for (let i = 0; i < 256; i++) {
    if (i < palCount) {
      const o = palStart + i * 4;
      palette.push({ b: data[o], g: data[o + 1], r: data[o + 2] });
    } else palette.push({ r: 0, g: 0, b: 0 });
  }
  const rowSize = (w + 3) & ~3;
  const pixels = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const src = dataOffset + (bottomUp ? h - 1 - row : row) * rowSize;
    pixels.set(data.subarray(src, src + w), row * w);
  }
  return { w, h, pixels, palette };
}

/** Palette-indexed pixels -> top-down RGB24 Buffer. */
export function indicesToRgb24(pixels, palette, w, h) {
  const rgb = Buffer.allocUnsafe(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const c = palette[pixels[i]];
    rgb[i * 3] = c.r;
    rgb[i * 3 + 1] = c.g;
    rgb[i * 3 + 2] = c.b;
  }
  return rgb;
}

/**
 * Dilate non-key colours into the transparent-key region so an upscaler never blends
 * ball<->key (which would leave a coloured fringe once the alpha is re-cut). Returns a
 * copy of `pixels` with key cells near an edge filled by a non-key neighbour.
 */
export function bleedKey(pixels, w, h, key, passes) {
  let cur = Uint8Array.from(pixels);
  for (let p = 0; p < passes; p++) {
    const next = Uint8Array.from(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (cur[i] !== key) continue;
        const nb = [
          x > 0 ? cur[i - 1] : key,
          x < w - 1 ? cur[i + 1] : key,
          y > 0 ? cur[i - w] : key,
          y < h - 1 ? cur[i + w] : key,
        ].find((v) => v !== key);
        if (nb !== undefined) next[i] = nb;
      }
    }
    cur = next;
  }
  return cur;
}

/** Smoothstep (Hermite) — a soft 0->1 ramp between edges `a` and `b`. */
export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
