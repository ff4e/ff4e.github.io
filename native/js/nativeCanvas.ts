/**
 * The scratch canvas the native host injects into the render path
 * (`setScratchCanvasFactory`, src/render/scratchCanvas.ts) — a CPU byte buffer that
 * answers the few canvas-2D calls the `ai` tier makes on its off-screen canvases:
 *
 *   - `classicSprite` (roomAi.ts): createImageData, putImageData, then a nearest-neighbour
 *     ×S drawImage of that canvas — the fallback for art with no AI file;
 *   - `glassMask`, `wreckSprite`, `makeWreckBg`: drawImage of a decoded bitmap at (0,0),
 *     then getImageData;
 *   - `syncWreck` / `resetWreckBg`: getImageData / putImageData of a rect, clearRect.
 *
 * Every drawImage here lands on a transparent canvas, so source-over IS a copy; anything
 * that would need real blending, smoothing, or a source rect throws rather than guess.
 * So does any method not defined below.
 *
 * The pixels are held STRAIGHT, but rounded the way Chromium's canvas rounds them: it
 * stores premultiplied 8-bit, so a translucent pixel written and read back comes out
 * changed. The browser side of `compare.mjs` reads its mirror mask through exactly that
 * round trip, so this one must too — see `roundTrip`.
 */
import type { NativeTexture } from './nativeApi.js';

/** A decoded bitmap as `createImageBitmap` hands it out natively (see shims.ts). */
export type NativeBitmap = NativeTexture & { close(): void };

interface ImageDataLike { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }

/** The compressed bytes each bitmap was decoded from, to re-decode its pixels on demand. */
const bitmapSources = new WeakMap<object, ArrayBuffer>();
const bitmapPixels = new WeakMap<object, Uint8Array>();

/** Called by the `createImageBitmap` shim: the GPU texture is all the hot path needs. */
export function rememberBitmapSource(bmp: NativeBitmap, webp: ArrayBuffer): void {
  bitmapSources.set(bmp, webp);
}

function pixelsOf(bmp: NativeBitmap): Uint8Array {
  let px = bitmapPixels.get(bmp);
  if (!px) {
    const src = bitmapSources.get(bmp);
    if (!src) throw new Error('native canvas: drawImage of an image with no CPU pixels');
    px = new Uint8Array(__native.decodeWebpRgba(src));
    bitmapPixels.set(bmp, px);
  }
  return px;
}

/**
 * Chromium's premultiply-then-unpremultiply of one channel value `c` at alpha `a`, as
 * `putImageData` / `drawImage(bitmap)` followed by `getImageData` returns it.
 *
 * Measured, not assumed: every (c, a) pair through a real canvas in the Chromium
 * `compare.mjs` drives, against candidate formulas. The one that matches all 65 536 is
 * Skia's raster pipeline: premultiply rounds to nearest, unpremultiply runs in FP32
 * (`x · (1/255)` times `1 / (a · (1/255))`) and stores with round-half-to-EVEN.
 */
let rtLut: Uint8Array | null = null;
function roundTripLut(): Uint8Array {
  if (rtLut) return rtLut;
  const f = Math.fround;
  const lut = new Uint8Array(256 * 256);
  for (let a = 1; a < 256; a++) {
    const inv = f(1 / f(a * f(1 / 255)));
    for (let c = 0; c < 256; c++) {
      const p = Math.round((c * a) / 255);
      const v = Math.min(f(f(p * f(1 / 255)) * inv), 1);
      const s = f(v * 255);
      const fl = Math.floor(s);
      const r = s - fl;
      lut[a * 256 + c] = r < 0.5 ? fl : r > 0.5 ? fl + 1 : fl % 2 ? fl + 1 : fl;
    }
  }
  return (rtLut = lut);
}

/** Copy one straight-RGBA pixel through the canvas's premultiplied storage. */
function storePixel(dst: Uint8ClampedArray, di: number, src: ArrayLike<number>, si: number): void {
  const a = src[si + 3]!;
  if (a === 255) {
    dst[di] = src[si]!; dst[di + 1] = src[si + 1]!; dst[di + 2] = src[si + 2]!; dst[di + 3] = 255;
  } else if (a === 0) {
    dst[di] = 0; dst[di + 1] = 0; dst[di + 2] = 0; dst[di + 3] = 0;
  } else {
    const lut = roundTripLut();
    const o = a * 256;
    dst[di] = lut[o + src[si]!]!; dst[di + 1] = lut[o + src[si + 1]!]!; dst[di + 2] = lut[o + src[si + 2]!]!; dst[di + 3] = a;
  }
}

export class NativeCanvas {
  private w = 300;
  private h = 150;
  /** Straight RGBA, already rounded as the browser's storage would be. */
  data = new Uint8ClampedArray(this.w * this.h * 4);
  private ctx: NativeContext2D | null = null;

  get width(): number { return this.w; }
  set width(v: number) { this.w = v; this.data = new Uint8ClampedArray(this.w * this.h * 4); }
  get height(): number { return this.h; }
  set height(v: number) { this.h = v; this.data = new Uint8ClampedArray(this.w * this.h * 4); }

  getContext(id: string): NativeContext2D | null {
    if (id !== '2d') return null;
    return (this.ctx ??= new NativeContext2D(this));
  }
}

class NativeContext2D {
  imageSmoothingEnabled = true;
  constructor(readonly canvas: NativeCanvas) {}

  createImageData(w: number, h: number): ImageDataLike {
    return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  }

  getImageData(x: number, y: number, w: number, h: number): ImageDataLike {
    const out = this.createImageData(w, h);
    const cv = this.canvas;
    for (let j = 0; j < h; j++) {
      const sy = y + j;
      if (sy < 0 || sy >= cv.height) continue;
      for (let i = 0; i < w; i++) {
        const sx = x + i;
        if (sx < 0 || sx >= cv.width) continue;
        const si = (sy * cv.width + sx) * 4;
        out.data.set(cv.data.subarray(si, si + 4), (j * w + i) * 4);
      }
    }
    return out;
  }

  putImageData(img: ImageDataLike, x: number, y: number): void {
    const cv = this.canvas;
    for (let j = 0; j < img.height; j++) {
      const dy = y + j;
      if (dy < 0 || dy >= cv.height) continue;
      for (let i = 0; i < img.width; i++) {
        const dx = x + i;
        if (dx < 0 || dx >= cv.width) continue;
        storePixel(cv.data, (dy * cv.width + dx) * 4, img.data, (j * img.width + i) * 4);
      }
    }
  }

  clearRect(x: number, y: number, w: number, h: number): void {
    const cv = this.canvas;
    const x0 = Math.max(0, x), x1 = Math.min(cv.width, x + w);
    const y0 = Math.max(0, y), y1 = Math.min(cv.height, y + h);
    for (let j = y0; j < y1; j++) cv.data.fill(0, (j * cv.width + x0) * 4, (j * cv.width + x1) * 4);
  }

  /**
   * `drawImage(src, dx, dy)` or `drawImage(src, dx, dy, dw, dh)`, integer placement,
   * nearest-neighbour when scaled. A canvas source is copied as stored (the browser
   * copies premultiplied storage to premultiplied storage); a bitmap source goes in
   * through `storePixel`, as Chromium premultiplies it on the way in.
   */
  drawImage(src: NativeCanvas | NativeBitmap, dx: number, dy: number, dw?: number, dh?: number, ...rest: unknown[]): void {
    if (rest.length) throw new Error('native canvas: drawImage with a source rect is not implemented');
    const sw = src.width, sh = src.height;
    dw ??= sw;
    dh ??= sh;
    if ((dw !== sw || dh !== sh) && this.imageSmoothingEnabled) {
      throw new Error('native canvas: smoothed scaling is not implemented (set imageSmoothingEnabled = false)');
    }
    if (![dx, dy, dw, dh].every(Number.isInteger)) throw new Error('native canvas: drawImage at a fractional position');
    const fromCanvas = src instanceof NativeCanvas;
    const spx: ArrayLike<number> = fromCanvas ? src.data : pixelsOf(src);
    const cv = this.canvas;
    const x0 = Math.max(0, dx), x1 = Math.min(cv.width, dx + dw);
    const y0 = Math.max(0, dy), y1 = Math.min(cv.height, dy + dh);
    for (let y = y0; y < y1; y++) {
      const sy = Math.floor(((y - dy + 0.5) * sh) / dh);
      for (let x = x0; x < x1; x++) {
        const sx = Math.floor(((x - dx + 0.5) * sw) / dw);
        const si = (sy * sw + sx) * 4;
        const a = spx[si + 3]!;
        if (a === 0) continue;                              // source-over: nothing to add
        const di = (y * cv.width + x) * 4;
        if (a !== 255 && cv.data[di + 3] !== 0) {
          throw new Error('native canvas: blending a translucent pixel over another is not implemented');
        }
        if (fromCanvas) cv.data.set((spx as Uint8ClampedArray).subarray(si, si + 4), di);
        else storePixel(cv.data, di, spx, si);
      }
    }
  }
}

/** The factory `main.ts` injects. Typed as the DOM canvas it stands in for. */
export function nativeScratchCanvas(): HTMLCanvasElement {
  return new NativeCanvas() as unknown as HTMLCanvasElement;
}
