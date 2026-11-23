/**
 * `Surface2D` — the 2D drawing interface the screens AROUND the room draw through.
 *
 * The room picture has its own seam (`AiTarget`, aiTarget.ts). Everything else on screen
 * — the world map with its record panel, name plaques and room-entry parchment today; the
 * subtitles and the TV menus later — was drawn straight onto a `CanvasRenderingContext2D`,
 * which a host without a browser (native/) does not have. This is the small subset of that
 * context those screens actually use, chosen so that every operation is one thing a GPU
 * quad batcher does directly, with nothing to emulate:
 *
 *   - `drawImage` / `drawImageRect`: one textured quad, source rect → dest rect, through a
 *     nearest (`setSmoothing(false)`) or bilinear (`setSmoothing(true)`) sampler.
 *   - `fillRect`: one untextured quad in a solid colour.
 *   - `setAlpha`: multiplies every later quad's alpha (a uniform or a vertex colour).
 *   - `setBlend`: `'source-over'` is premultiplied over; `'destination-in'` keeps the
 *     destination only where the source is opaque — blend factors (src ZERO, dst SRC_ALPHA)
 *     on colour and alpha alike. Those are the only two the screens use.
 *     PRECONDITION for `'destination-in'`: the draw must cover the WHOLE surface. Canvas
 *     also clears everything outside the drawn rect, which a blended quad does not touch;
 *     the two agree only when there is no outside. Both uses today are full-surface
 *     (worldMapAi.ts `rebuildBase`, mapInfoZoom.ts `aiPanelArt`). A partial
 *     `'destination-in'` draw is outside this contract — add a clear of the rest, or a
 *     full-surface helper, before relying on one.
 *   - `translate` / `scale`: an AXIS-ALIGNED affine, applied to dest rects on the CPU. No
 *     rotation and no skew, so a quad's four corners always carry it.
 *   - `save` / `restore`: a stack of {transform, alpha, smoothing, blend} — exactly the
 *     parts of a canvas's state this interface exposes, saved and restored together.
 *   - `clear` / `putPixels`: whole-surface only — a render-target clear and a texture upload.
 *   - `createSurface`: an off-screen render target, which can itself be drawn as an image.
 *
 * A new surface starts in the canvas defaults: transparent, identity transform, alpha 1,
 * smoothing ON, `'source-over'`. A native implementation has to start there too — some
 * callers rely on the default (mapInfoZoom.ts scales a mask up smoothly without asking).
 *
 * ── What a native implementation can match byte for byte, and what it cannot ──
 * "Directly" is not "identically". A canvas stores premultiplied 8-bit colour, and its
 * bilinear filter is the browser backend's own, so:
 *   - BYTE-EXACT is reachable for nearest-neighbour draws (any integer scale), opaque
 *     blits, opaque `putPixels`, and `'destination-in'` through a BINARY (0/255) mask —
 *     which is the whole `ai` map base, the nodes, the plaques, the parchment, and the
 *     native-resolution overlays (digits, Tetris).
 *   - NOT byte-exact, only close: anything through `setSmoothing(true)` (aiPanelArt's
 *     smoothed mask upscale, and the enlarged panel art drawn with `smooth`); fractional
 *     alpha (`setAlpha(0.55)` on the disabled Replay icon); and `putPixels` of partial
 *     alpha (aiPanelArt's shadow), which the canvas rounds through premultiplied storage.
 *     (native/js/nativeCanvas.ts already emulates that rounding for the room's scratch
 *     canvases; a GPU surface would need the same, or a tolerance.)
 * Native parity tests should set their expectation per path accordingly.
 *
 * What is deliberately NOT here: paths, text, gradients, patterns, filters, shadows, any
 * other composite mode, reading pixels back. None of the ported screens need them, and each
 * one is a thing a native host would have to emulate rather than map. Add an operation when
 * a screen needs it, with the GPU mapping beside it in this list.
 *
 * Images are anything with a size — an `ImageBitmap` or a surface on the web, a texture
 * handle natively. The interface never asks what they are; only the implementation that
 * draws them does.
 *
 * Nothing here runs at import: the factory is a variable a host sets at boot.
 */
import { CanvasSurface2D } from './canvasSurface2d.js';

/** Something drawable: a decoded image or another surface. */
export interface Image2D {
  readonly width: number;
  readonly height: number;
}

export type SurfaceBlend = 'source-over' | 'destination-in';

export interface Surface2D extends Image2D {
  /** Filter later `drawImage`s bilinearly (true) or nearest-neighbour (false). */
  setSmoothing(on: boolean): void;
  /** Multiply the alpha of everything drawn after this by `alpha` (0..1). */
  setAlpha(alpha: number): void;
  /** `'destination-in'` is only defined here for a draw covering the whole surface (see header). */
  setBlend(mode: SurfaceBlend): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  save(): void;
  restore(): void;
  /** The whole image at (dx,dy), at its own size or stretched to dw×dh. */
  drawImage(img: Image2D, dx: number, dy: number, dw?: number, dh?: number): void;
  /** The source rect (sx,sy,sw,sh) of `img` stretched onto the dest rect (dx,dy,dw,dh). */
  drawImageRect(
    img: Image2D,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
  /** A solid rectangle in `rgb` (0xRRGGBB), at the current alpha. */
  fillRect(x: number, y: number, w: number, h: number, rgb: number): void;
  /** The whole surface to transparent, whatever the current transform. */
  clear(): void;
  /** Replace the whole surface with `rgba` (width × height × 4, unpremultiplied RGBA). */
  putPixels(rgba: Uint8ClampedArray<ArrayBuffer>): void;
}

export type SurfaceFactory = (w: number, h: number) => Surface2D;

let factory: SurfaceFactory | null = null;

/** Replace the canvas-backed surfaces with a host's own. `null` restores the canvas. */
export function setSurfaceFactory(f: SurfaceFactory | null): void {
  factory = f;
}

/** A new transparent off-screen surface of `w×h`. */
export function createSurface(w: number, h: number): Surface2D {
  return factory ? factory(w, h) : CanvasSurface2D.offscreen(w, h);
}
