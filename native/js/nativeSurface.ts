/**
 * `Surface2D` (src/render/surface2d.ts) on the native GPU — what the screens around the room
 * draw through natively: the world map and its record panel, plaques, parchment and
 * selection ring, the story pages.
 *
 * Each surface is a render target in the host (`surfCreate`), holding premultiplied colour
 * as a canvas does. The state a canvas keeps — the axis-aligned transform, alpha,
 * smoothing, blend, and their save/restore stack — is kept HERE, and applied on the CPU to
 * each quad before it is handed over: a quad's four corners always carry an axis-aligned
 * transform, so nothing about it needs the GPU. The host batches the quads (`surfQuad`,
 * native/host/main.c) and orders uploads and clears among them.
 *
 * What it can match byte for byte and what only approximately is the interface's header;
 * native/compare-map.mjs measures it.
 */
import type { Image2D, Surface2D, SurfaceBlend } from '../../src/render/surface2d.js';
import type { NativeTexture } from './nativeApi.js';

interface State {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
  alpha: number;
  smooth: boolean;
  blend: SurfaceBlend;
}

/** Frees a surface's texture once nothing references it. */
const reclaim = typeof FinalizationRegistry === 'function'
  ? new FinalizationRegistry<number>((id) => __native.releaseTexture(id))
  : null;

/** A decoded image a surface can draw: premultiplied, from `__native.decodeImage`. */
export type NativeImage = NativeTexture & { readonly premultiplied: true };

/** Decode a WebP or PNG for drawing on a surface. */
export function decodeImage(buf: ArrayBuffer): NativeImage {
  return { ...__native.decodeImage(buf), premultiplied: true };
}

function texOf(img: Image2D): number {
  if (img instanceof NativeSurface) return img.id;
  const t = img as Partial<NativeImage>;
  if (t.premultiplied !== true || typeof t.id !== 'number') {
    throw new Error('a native surface was handed an image it cannot draw (not a surface or a decodeImage result)');
  }
  return t.id;
}

export class NativeSurface implements Surface2D {
  readonly id: number;
  // The canvas defaults, which surface2d.ts requires a new surface to start in.
  private st: State = { tx: 0, ty: 0, sx: 1, sy: 1, alpha: 1, smooth: true, blend: 'source-over' };
  private readonly stack: State[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.id = __native.surfCreate(width, height);
    reclaim?.register(this, this.id);
  }

  setSmoothing(on: boolean): void {
    this.st.smooth = on;
  }

  setAlpha(alpha: number): void {
    // A canvas ignores a globalAlpha outside 0..1 rather than clamping it.
    if (alpha >= 0 && alpha <= 1) this.st.alpha = alpha;
  }

  setBlend(mode: SurfaceBlend): void {
    this.st.blend = mode;
  }

  translate(x: number, y: number): void {
    this.st.tx += this.st.sx * x;
    this.st.ty += this.st.sy * y;
  }

  scale(x: number, y: number): void {
    this.st.sx *= x;
    this.st.sy *= y;
  }

  save(): void {
    this.stack.push({ ...this.st });
  }

  restore(): void {
    const s = this.stack.pop();
    if (s) this.st = s;
  }

  drawImage(img: Image2D, dx: number, dy: number, dw?: number, dh?: number): void {
    this.drawImageRect(img, 0, 0, img.width, img.height, dx, dy, dw ?? img.width, dh ?? img.height);
  }

  drawImageRect(
    img: Image2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void {
    const a = this.st.alpha;
    this.quad(texOf(img), dx, dy, dw, dh, sx / img.width, sy / img.height, (sx + sw) / img.width, (sy + sh) / img.height, a, a, a, a);
  }

  fillRect(x: number, y: number, w: number, h: number, rgb: number): void {
    const a = this.st.alpha;
    const c = (shift: number): number => (((rgb >> shift) & 255) / 255) * a;
    this.quad(0, x, y, w, h, 0, 0, 1, 1, c(16), c(8), c(0), a);
  }

  fillMask(
    mask: Image2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
    rgb: number,
  ): void {
    // The mask is premultiplied white × coverage, so the quad's colour multiplier is the
    // whole of the tint: (c·r, c·g, c·b, c) at alpha 1.
    const a = this.st.alpha;
    const c = (shift: number): number => (((rgb >> shift) & 255) / 255) * a;
    this.quad(texOf(mask), dx, dy, dw, dh, sx / mask.width, sy / mask.height, (sx + sw) / mask.width, (sy + sh) / mask.height, c(16), c(8), c(0), a);
  }

  clear(): void {
    __native.surfClear(this.id);
  }

  putPixels(rgba: Uint8ClampedArray<ArrayBuffer>): void {
    const whole = rgba.byteOffset === 0 && rgba.byteLength === rgba.buffer.byteLength;
    __native.surfPut(this.id, whole ? rgba.buffer : rgba.slice().buffer);
  }

  private quad(
    tex: number, x: number, y: number, w: number, h: number,
    u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number,
  ): void {
    const s = this.st;
    if (a <= 0 && s.blend === 'source-over') return; // a canvas draws nothing at alpha 0
    __native.surfQuad(
      this.id, tex, s.smooth, s.blend === 'destination-in' ? 1 : 0,
      s.tx + s.sx * x, s.ty + s.sy * y, s.tx + s.sx * (x + w), s.ty + s.sy * (y + h),
      u0, v0, u1, v1, r, g, b, a,
    );
  }
}

/** The factory `setSurfaceFactory` takes (native/js/main.ts). */
export const nativeSurface = (w: number, h: number): Surface2D => new NativeSurface(w, h);
