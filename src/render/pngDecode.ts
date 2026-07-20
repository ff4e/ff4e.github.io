/**
 * Minimal PNG *decoder* for the enhanced (truecolor) art path.
 *
 * The port already has an encoder (`png.ts`); enhanced mode also needs to read
 * the GPL `fillets-ng-data` PNG masters. This decodes the subset those files
 * actually use — 8-bit, non-interlaced, colour types:
 *   0 greyscale, 2 truecolor RGB, 3 palette (+ optional tRNS), 4 grey+alpha,
 *   6 truecolor RGBA — with all five scanline filters (0 None .. 4 Paeth).
 * Output is always expanded to straight (non-premultiplied) 8-bit RGBA.
 *
 * Dependency-free apart from Node's zlib for the IDAT inflate. In the browser
 * the same bytes can be decoded via `createImageBitmap`; this pure-TS path keeps
 * the render/test tooling free of a DOM and byte-stable for golden tests.
 */
import { inflateSync } from 'node:zlib';

export interface DecodedPng {
  readonly w: number;
  readonly h: number;
  /** Straight RGBA, length w*h*4. */
  readonly rgba: Uint8Array;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Decode PNG bytes to straight 8-bit RGBA. Throws on unsupported variants. */
export function decodePng(buf: Uint8Array): DecodedPng {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  }
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  let w = 0;
  let h = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let plte: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];

  let off = 8;
  while (off + 8 <= buf.length) {
    const len = dv.getUint32(off);
    const type = String.fromCharCode(buf[off + 4]!, buf[off + 5]!, buf[off + 6]!, buf[off + 7]!);
    const dataStart = off + 8;
    const data = buf.subarray(dataStart, dataStart + len);
    if (type === 'IHDR') {
      w = dv.getUint32(dataStart);
      h = dv.getUint32(dataStart + 4);
      bitDepth = buf[dataStart + 8]!;
      colorType = buf[dataStart + 9]!;
      interlace = buf[dataStart + 12]!;
    } else if (type === 'PLTE') {
      plte = data.slice();
    } else if (type === 'tRNS') {
      trns = data.slice();
    } else if (type === 'IDAT') {
      idat.push(data.slice());
    } else if (type === 'IEND') {
      break;
    }
    off = dataStart + len + 4; // + CRC
  }

  if (bitDepth !== 1 && bitDepth !== 2 && bitDepth !== 4 && bitDepth !== 8) {
    throw new Error(`unsupported PNG bit depth ${bitDepth} (only 1/2/4/8)`);
  }
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  if (colorType === 3 && !plte) throw new Error('palette PNG missing PLTE');
  // Sub-8-bit is only valid for greyscale (0) and palette (3), which are 1-sample.
  if (bitDepth < 8 && colorType !== 0 && colorType !== 3) {
    throw new Error(`bit depth ${bitDepth} invalid for colour type ${colorType}`);
  }

  const channels =
    colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1; // 0 grey, 3 palette
  const bpp = Math.max(1, (channels * bitDepth) >> 3); // bytes per pixel for filtering
  const rowBytes = Math.ceil((w * channels * bitDepth) / 8);

  // Concatenate IDAT and inflate.
  let total = 0;
  for (const c of idat) total += c.length;
  const cat = new Uint8Array(total);
  let cp = 0;
  for (const c of idat) {
    cat.set(c, cp);
    cp += c.length;
  }
  const raw = inflateSync(cat);
  if (raw.length < h * (rowBytes + 1)) throw new Error('truncated PNG image data');

  // Defilter into a tight packed-byte buffer (filtering works on bytes; for
  // sub-byte depths the filter "left" distance is 1 byte).
  const px = new Uint8Array(h * rowBytes);
  let ri = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[ri++]!;
    const row = y * rowBytes;
    const prev = row - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const cur = raw[ri++]!;
      const a = x >= bpp ? px[row + x - bpp]! : 0;
      const b = y > 0 ? px[prev + x]! : 0;
      const c = x >= bpp && y > 0 ? px[prev + x - bpp]! : 0;
      let v = cur;
      if (filter === 1) v = cur + a;
      else if (filter === 2) v = cur + b;
      else if (filter === 3) v = cur + ((a + b) >> 1);
      else if (filter === 4) v = cur + paeth(a, b, c);
      else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
      px[row + x] = v & 255;
    }
  }

  // Per-pixel sample accessor. For 8-bit it's a direct byte index; for 1/2/4-bit
  // (single-sample grey/palette) it unpacks the MSB-first bit-packed rows.
  const mask = (1 << bitDepth) - 1;
  const grayScale = bitDepth < 8 ? 255 / mask : 1;
  const sampleAt =
    bitDepth === 8
      ? (i: number, ch: number): number => px[i * channels + ch]!
      : (i: number): number => {
          const row = ((i / w) | 0) * rowBytes;
          const bit = (i % w) * bitDepth;
          const byte = px[row + (bit >> 3)]!;
          return (byte >> (8 - bitDepth - (bit & 7))) & mask;
        };

  // Expand to RGBA.
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    switch (colorType) {
      case 6: {
        rgba[o] = sampleAt(i, 0);
        rgba[o + 1] = sampleAt(i, 1);
        rgba[o + 2] = sampleAt(i, 2);
        rgba[o + 3] = sampleAt(i, 3);
        break;
      }
      case 2: {
        rgba[o] = sampleAt(i, 0);
        rgba[o + 1] = sampleAt(i, 1);
        rgba[o + 2] = sampleAt(i, 2);
        rgba[o + 3] = 255;
        break;
      }
      case 3: {
        const idx = sampleAt(i, 0);
        rgba[o] = plte![idx * 3]!;
        rgba[o + 1] = plte![idx * 3 + 1]!;
        rgba[o + 2] = plte![idx * 3 + 2]!;
        rgba[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
        break;
      }
      case 4: {
        const g = sampleAt(i, 0);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = sampleAt(i, 1);
        break;
      }
      default: {
        // colourType 0 greyscale (possibly sub-8-bit, scaled to 0..255)
        const g = Math.round(sampleAt(i, 0) * grayScale);
        rgba[o] = g;
        rgba[o + 1] = g;
        rgba[o + 2] = g;
        rgba[o + 3] = 255;
      }
    }
  }

  return { w, h, rgba };
}
