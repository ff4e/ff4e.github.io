/**
 * The web's `Surface2D`: a canvas and its 2D context.
 *
 * Every method is the one context call the screens made before they drew through the
 * interface, with the same arguments, so the picture is the identical one by construction
 * rather than within a tolerance. Keep it that way: an implementation detail added here
 * (a cached state, a rounding) would change the web's pixels to suit a seam that exists
 * for another platform.
 */
import { createScratchCanvas } from './scratchCanvas.js';
import type { Image2D, Surface2D, SurfaceBlend } from './surface2d.js';

export class CanvasSurface2D implements Surface2D {
  /** An off-screen surface, from the scratch-canvas factory (the DOM unless injected). */
  static offscreen(w: number, h: number): CanvasSurface2D {
    const canvas = createScratchCanvas();
    canvas.width = w;
    canvas.height = h;
    return new CanvasSurface2D(canvas, canvas.getContext('2d')!);
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly ctx: CanvasRenderingContext2D,
  ) {}

  get width(): number {
    return this.canvas.width;
  }

  get height(): number {
    return this.canvas.height;
  }

  setSmoothing(on: boolean): void {
    this.ctx.imageSmoothingEnabled = on;
  }

  setAlpha(alpha: number): void {
    this.ctx.globalAlpha = alpha;
  }

  setBlend(mode: SurfaceBlend): void {
    this.ctx.globalCompositeOperation = mode;
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y);
  }

  scale(x: number, y: number): void {
    this.ctx.scale(x, y);
  }

  save(): void {
    this.ctx.save();
  }

  restore(): void {
    this.ctx.restore();
  }

  drawImage(img: Image2D, dx: number, dy: number, dw?: number, dh?: number): void {
    if (dw === undefined || dh === undefined) this.ctx.drawImage(source(img), dx, dy);
    else this.ctx.drawImage(source(img), dx, dy, dw, dh);
  }

  drawImageRect(
    img: Image2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void {
    this.ctx.drawImage(source(img), sx, sy, sw, sh, dx, dy, dw, dh);
  }

  fillRect(x: number, y: number, w: number, h: number, rgb: number): void {
    this.ctx.fillStyle = `#${rgb.toString(16).padStart(6, '0')}`;
    this.ctx.fillRect(x, y, w, h);
  }

  /**
   * Coverage × colour, through a scratch canvas: the mask's rect is copied there, tinted with
   * 'source-in', and drawn back. Not a context call the screens made — nothing on the web
   * draws through it (see `Surface2D.fillMask`).
   */
  fillMask(
    mask: Image2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
    rgb: number,
  ): void {
    const tint = createScratchCanvas();
    tint.width = Math.max(1, Math.ceil(sw));
    tint.height = Math.max(1, Math.ceil(sh));
    const t = tint.getContext('2d')!;
    t.drawImage(source(mask), sx, sy, sw, sh, 0, 0, sw, sh);
    t.globalCompositeOperation = 'source-in';
    t.fillStyle = `#${rgb.toString(16).padStart(6, '0')}`;
    t.fillRect(0, 0, sw, sh);
    this.ctx.drawImage(tint, 0, 0, sw, sh, dx, dy, dw, dh);
  }

  clear(): void {
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();
  }

  putPixels(rgba: Uint8ClampedArray<ArrayBuffer>): void {
    this.ctx.putImageData(new ImageData(rgba, this.canvas.width, this.canvas.height), 0, 0);
  }
}

/** What the context draws: a surface's canvas, or the image itself (a bitmap, a canvas). */
function source(img: Image2D): CanvasImageSource {
  return img instanceof CanvasSurface2D ? img.canvas : (img as unknown as CanvasImageSource);
}
