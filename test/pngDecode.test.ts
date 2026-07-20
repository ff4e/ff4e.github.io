/**
 * pngDecode: exercised against the port's own encoder (colour type 6, filter 0)
 * plus hand-built palette (type 3 + tRNS) and per-filter (type 2) PNGs so every
 * colour-type and scanline filter branch is covered deterministically without
 * depending on any external asset.
 */
import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../src/render/pngDecode.js';
import { encodePng } from '../src/render/png.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Assemble a PNG from an already-filtered raw stream (leading filter byte/row). */
function buildPng(
  w: number,
  h: number,
  colorType: number,
  filteredRaw: Uint8Array,
  plte?: Uint8Array,
  trns?: Uint8Array,
  bitDepth = 8,
): Uint8Array {
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const iv = new DataView(ihdr.buffer);
  iv.setUint32(0, w);
  iv.setUint32(4, h);
  ihdr[8] = bitDepth;
  ihdr[9] = colorType;
  const parts: Uint8Array[] = [sig, chunk('IHDR', ihdr)];
  if (plte) parts.push(chunk('PLTE', plte));
  if (trns) parts.push(chunk('tRNS', trns));
  parts.push(chunk('IDAT', deflateSync(filteredRaw, { level: 9 })));
  parts.push(chunk('IEND', new Uint8Array(0)));
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('decodePng', () => {
  it('round-trips RGBA through the port encoder (type 6, filter 0)', () => {
    const w = 5;
    const h = 3;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = (i * 37) & 255;
      rgba[i * 4 + 1] = (i * 91) & 255;
      rgba[i * 4 + 2] = (255 - i * 13) & 255;
      rgba[i * 4 + 3] = i % 4 === 0 ? 0 : 255;
    }
    const dec = decodePng(encodePng(rgba, w, h));
    expect(dec.w).toBe(w);
    expect(dec.h).toBe(h);
    expect(Array.from(dec.rgba)).toEqual(Array.from(rgba));
  });

  it('decodes a palette image with tRNS (type 3)', () => {
    // 2x2, palette [red, green, blue, white]; index 2 (blue) fully transparent.
    const plte = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]);
    const trns = new Uint8Array([255, 255, 0]); // idx0,1 opaque; idx2 transparent
    const rows = [
      [0, 1],
      [2, 3],
    ];
    const raw = new Uint8Array(2 * (2 + 1));
    for (let y = 0; y < 2; y++) {
      raw[y * 3] = 0; // filter none
      raw[y * 3 + 1] = rows[y]![0]!;
      raw[y * 3 + 2] = rows[y]![1]!;
    }
    const dec = decodePng(buildPng(2, 2, 3, raw, plte, trns));
    expect(Array.from(dec.rgba.subarray(0, 8))).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    // second row: blue transparent, then opaque white
    expect(Array.from(dec.rgba.subarray(8, 16))).toEqual([0, 0, 255, 0, 255, 255, 255, 255]);
  });

  it('applies all five scanline filters (type 2 RGB)', () => {
    const w = 4;
    const h = 5;
    const ch = 3;
    // A deterministic RGB image.
    const img = new Uint8Array(w * h * ch);
    for (let i = 0; i < img.length; i++) img[i] = (i * 17 + 3) & 255;

    const paeth = (a: number, b: number, c: number): number => {
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      if (pa <= pb && pa <= pc) return a;
      return pb <= pc ? b : c;
    };

    // Filter each row with a different filter type (0..4) and assemble the raw stream.
    const stride = w * ch;
    const raw = new Uint8Array(h * (stride + 1));
    for (let y = 0; y < h; y++) {
      const filter = y; // rows 0..4 use filters 0..4
      raw[y * (stride + 1)] = filter;
      for (let x = 0; x < stride; x++) {
        const cur = img[y * stride + x]!;
        const a = x >= ch ? img[y * stride + x - ch]! : 0;
        const b = y > 0 ? img[(y - 1) * stride + x]! : 0;
        const c = x >= ch && y > 0 ? img[(y - 1) * stride + x - ch]! : 0;
        let enc = cur;
        if (filter === 1) enc = cur - a;
        else if (filter === 2) enc = cur - b;
        else if (filter === 3) enc = cur - ((a + b) >> 1);
        else if (filter === 4) enc = cur - paeth(a, b, c);
        raw[y * (stride + 1) + 1 + x] = enc & 255;
      }
    }

    const dec = decodePng(buildPng(w, h, 2, raw));
    // Reconstruct expected RGBA from img (alpha 255).
    for (let i = 0; i < w * h; i++) {
      expect(dec.rgba[i * 4]).toBe(img[i * 3]);
      expect(dec.rgba[i * 4 + 1]).toBe(img[i * 3 + 1]);
      expect(dec.rgba[i * 4 + 2]).toBe(img[i * 3 + 2]);
      expect(dec.rgba[i * 4 + 3]).toBe(255);
    }
  });

  it('rejects a non-PNG buffer', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/signature/);
  });

  it('decodes a 4-bit palette image (sub-8-bit unpacking)', () => {
    // 4x1 palette image, 4 bits/pixel -> 2 bytes/row. Indices [1,2,3,0].
    const plte = new Uint8Array([10, 10, 10, 20, 20, 20, 30, 30, 30, 40, 40, 40]);
    const raw = new Uint8Array([0, 0x12, 0x30]); // filter 0, then nibbles 1,2 | 3,0
    const png = buildPng(4, 1, 3, raw, plte, undefined, 4);
    const dec = decodePng(png);
    expect(dec.w).toBe(4);
    expect(Array.from(dec.rgba.subarray(0, 16))).toEqual([
      20, 20, 20, 255, // idx1
      30, 30, 30, 255, // idx2
      40, 40, 40, 255, // idx3
      10, 10, 10, 255, // idx0
    ]);
  });
});
