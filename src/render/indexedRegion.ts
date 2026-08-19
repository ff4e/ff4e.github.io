/**
 * Draw a rectangle of INDEXED game art onto a 2D context, scaled up with nearest-
 * neighbour.
 *
 * Written for the briefcase cutscene's `"model": "original"` frames: the ones whose 1998
 * art reads better than any upscaler's version of it. Those play inside the upscaled
 * scene, so the region has to be painted over the upscaled base at the base's own scale
 * rather than by handing the frame to the faithful renderer — the two renderers present
 * through different elements and size the canvas differently, so switching between them
 * per frame swaps the source of the WHOLE picture and flashes the background.
 *
 * Nearest-neighbour is the point, not a shortcut: the frame was chosen for its crisp
 * pixels, and smoothing would turn it into a worse imitation of the upscale it beat.
 */
export interface IndexedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Reused across frames — one 380x285 scratch canvas rather than one per painted frame. */
let scratch: HTMLCanvasElement | null = null;

/**
 * The region's pixels expanded to RGBA. Split out from the blit because it is the part
 * that can be WRONG — the source stride is the full picture's width, not the region's,
 * so the row arithmetic is the one thing here worth pinning — and because unit tests run
 * without a canvas (see test/roomAi.test.ts on the same constraint).
 */
export function regionRgba(
  pixels: ArrayLike<number>,
  palette: readonly { r: number; g: number; b: number }[],
  srcWidth: number,
  region: IndexedRegion,
): Uint8ClampedArray<ArrayBuffer> {
  const { x, y, w, h } = region;
  const rgba = new Uint8ClampedArray(new ArrayBuffer(w * h * 4));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const c = palette[pixels[(y + j) * srcWidth + (x + i)]!];
      if (!c) continue;
      const o = (j * w + i) * 4;
      rgba[o] = c.r;
      rgba[o + 1] = c.g;
      rgba[o + 2] = c.b;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}

export function drawIndexedRegion(
  ctx: CanvasRenderingContext2D,
  pixels: ArrayLike<number>,
  palette: readonly { r: number; g: number; b: number }[],
  srcWidth: number,
  region: IndexedRegion,
  scale: number,
): void {
  const { x, y, w, h } = region;
  scratch ??= document.createElement('canvas');
  if (scratch.width !== w || scratch.height !== h) {
    scratch.width = w;
    scratch.height = h;
  }
  const sg = scratch.getContext('2d');
  if (!sg) return;
  sg.putImageData(new ImageData(regionRgba(pixels, palette, srcWidth, region), w, h), 0, 0);
  // Restore rather than assume: the caller's filter is chosen for the upscaled art it
  // draws either side of this, and silently clearing it would soften that.
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(scratch, x * scale, y * scale, w * scale, h * scale);
  ctx.imageSmoothingEnabled = smooth;
}
