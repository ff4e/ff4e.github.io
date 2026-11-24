/**
 * The native UI's drawing primitives over `Surface2D`: filled and outlined (rounded)
 * rectangles, circles and the remote's / pad's glyph shapes as coverage masks, text from the
 * host's FreeType, and images. Everything a menu, the legend or a help page draws goes
 * through a `Ui`, which also RECORDS it: the list of what was drawn and where, rounded to
 * whole pixels, is the layout snapshot `menuSmoke.ts` checks (native/ui-layout.snap.json),
 * so a layout change shows up as a diff of positions and strings rather than of pixels.
 *
 * Shapes are rasterised on the CPU once per size (signed distance to coverage, a pixel of
 * anti-aliasing) and kept as premultiplied white × coverage textures — the image
 * `fillMask` tints, as the subtitle glyphs are.
 */
import type { Image2D, Surface2D } from '../../src/render/surface2d.js';
import { GlyphAtlas } from './subtitleDraw.js';
import { NativeFace } from './subtitleFonts.js';
import { readBytes } from './shims.js';
import type { NativeImage } from './nativeSurface.js';

/** One recorded draw. Coordinates in surface pixels, rounded. */
export type UiOp = readonly (string | number)[];

export type Shape = 'rect' | 'ring' | 'disc' | 'play' | 'pause' | 'chevron' | 'bars' | 'view' | 'cross';

interface Mask {
  readonly img: Image2D;
  readonly w: number;
  readonly h: number;
}

const masks = new Map<string, Mask>();

function uploadMask(w: number, h: number, cov: (x: number, y: number) => number): Mask {
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = Math.round(255 * Math.max(0, Math.min(1, cov(x + 0.5, y + 0.5))));
      rgba.fill(c, (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
  }
  const id = __native.createTexture(rgba.buffer, w, h, false);
  return { img: { id, width: w, height: h, premultiplied: true } as unknown as Image2D, w, h };
}

/**
 * A `w`×`h` mask texture, for `Ui.mask`, from each pixel's count of covered samples out of
 * `samples` (row by row).
 */
export function countMask(w: number, h: number, counts: Uint8Array, samples: number): Image2D {
  // White × coverage, premultiplied: all four bytes of a pixel the same, so one word each.
  const level = Uint32Array.from({ length: samples + 1 }, (_, c) => Math.round(255 * (c / samples)) * 0x01010101);
  const rgba = new Uint32Array(w * h);
  for (let p = 0; p < w * h; p++) rgba[p] = level[counts[p]!]!;
  const id = __native.createTexture(rgba.buffer, w, h, false);
  return { id, width: w, height: h, premultiplied: true } as unknown as Image2D;
}

/** Coverage from a signed distance (negative inside), one pixel of anti-aliasing. */
const aa = (d: number): number => 0.5 - d;

/** Signed distance to a rounded rectangle centred at the origin. */
function sdRoundRect(x: number, y: number, hw: number, hh: number, r: number): number {
  const qx = Math.abs(x) - hw + r, qy = Math.abs(y) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Signed distance to the segment a–b, thickened to `t`/2. */
function sdSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number, t: number): number {
  const dx = bx - ax, dy = by - ay;
  const h = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - dx * h, py - ay - dy * h) - t / 2;
}

/** A shape's mask at `w`×`h`; `r` is a corner radius (rect, ring) and `t` a line width. */
function shapeMask(shape: Shape, w: number, h: number, r: number, t: number): Mask {
  const key = `${shape}|${w}|${h}|${r}|${t}`;
  const hit = masks.get(key);
  if (hit) return hit;
  const cx = w / 2, cy = h / 2;
  const m = Math.min(w, h);
  let cov: (x: number, y: number) => number;
  switch (shape) {
    case 'rect':
      cov = (x, y) => aa(sdRoundRect(x - cx, y - cy, cx, cy, r));
      break;
    case 'ring': // an outlined rounded rect (a circle when r = half the side)
      cov = (x, y) => aa(Math.abs(sdRoundRect(x - cx, y - cy, cx - t / 2, cy - t / 2, Math.max(0, r - t / 2))) - t / 2);
      break;
    case 'disc':
      cov = (x, y) => aa(Math.hypot(x - cx, y - cy) - m / 2);
      break;
    case 'play': { // ▶ beside ‖, the remote's Play/Pause
      const s = m;
      cov = (x, y) => {
        const u = (x - (cx - s * 0.42)) / s, v = (y - cy) / s;
        const tri = Math.max(-u, Math.abs(v) * 1.2 + u * 0.75 - 0.3) * s;
        const bar1 = sdRoundRect(x - (cx + s * 0.18), y - cy, s * 0.05, s * 0.3, 0);
        const bar2 = sdRoundRect(x - (cx + s * 0.36), y - cy, s * 0.05, s * 0.3, 0);
        return aa(Math.min(tri, bar1, bar2));
      };
      break;
    }
    case 'pause':
      cov = (x, y) => aa(Math.min(
        sdRoundRect(x - (cx - m * 0.14), y - cy, m * 0.07, m * 0.3, 0),
        sdRoundRect(x - (cx + m * 0.14), y - cy, m * 0.07, m * 0.3, 0)));
      break;
    case 'chevron': // ‹, the remote's Back
      cov = (x, y) => aa(Math.min(
        sdSegment(x, y, cx + m * 0.12, cy - m * 0.3, cx - m * 0.16, cy, t),
        sdSegment(x, y, cx - m * 0.16, cy, cx + m * 0.12, cy + m * 0.3, t)));
      break;
    case 'bars': // ☰
      cov = (x, y) => aa(Math.min(
        sdRoundRect(x - cx, y - (cy - m * 0.22), m * 0.3, t / 2, t / 2),
        sdRoundRect(x - cx, y - cy, m * 0.3, t / 2, t / 2),
        sdRoundRect(x - cx, y - (cy + m * 0.22), m * 0.3, t / 2, t / 2)));
      break;
    case 'view': // ⧉
      cov = (x, y) => aa(Math.min(
        Math.abs(sdRoundRect(x - (cx - m * 0.08), y - (cy - m * 0.08), m * 0.2, m * 0.2, t)) - t / 2,
        Math.abs(sdRoundRect(x - (cx + m * 0.08), y - (cy + m * 0.08), m * 0.2, m * 0.2, t)) - t / 2));
      break;
    case 'cross': // ✚
      cov = (x, y) => aa(Math.min(
        sdRoundRect(x - cx, y - cy, m * 0.34, t / 2, t / 4),
        sdRoundRect(x - cx, y - cy, t / 2, m * 0.34, t / 4)));
      break;
  }
  const mask = uploadMask(w, h, cov);
  masks.set(key, mask);
  return mask;
}

/** The UI's typefaces: Mulish at the subtitles' weight, and bold. */
export interface UiFonts {
  readonly regular: NativeFace;
  readonly bold: NativeFace;
}

let fonts: UiFonts | null = null;

export async function loadUiFonts(): Promise<UiFonts> {
  if (fonts) return fonts;
  const bytes = (await readBytes('/fonts/Mulish.ttf')).slice().buffer;
  fonts = {
    regular: new NativeFace(__native.fontLoad(bytes, 500), 'Mulish 500'),
    bold: new NativeFace(__native.fontLoad(bytes.slice(0), 800), 'Mulish 800'),
  };
  return fonts;
}

const atlas = new GlyphAtlas();
const STEPS = 4;
/** The pen, kept to a quarter pixel (as the subtitles keep it), so masks land on whole pixels. */
function quarter(v: number): [number, number] {
  let whole = Math.floor(v);
  let q = Math.round((v - whole) * STEPS);
  if (q === STEPS) {
    whole++;
    q = 0;
  }
  return [whole, q];
}

export type Align = 'left' | 'center' | 'right';

const r1 = (v: number): number => Math.round(v);

/** A frame's drawing context: a surface, the fonts, and the record of what was drawn. */
export class Ui {
  readonly ops: UiOp[] = [];
  /**
   * How far the window reaches past the area being laid out, `[left, top, right, bottom]`:
   * the title-safe insets (`uiLayer.ts`). Only a scrim reaches into them (`scrim`).
   */
  bleed: readonly [number, number, number, number] = [0, 0, 0, 0];

  constructor(
    readonly s: Surface2D,
    readonly fonts: UiFonts,
  ) {
    s.setSmoothing(false);
  }

  /** A filled rectangle, rounded by `r`, at `alpha`. */
  rect(x: number, y: number, w: number, h: number, rgb: number, alpha = 1, r = 0): void {
    if (w <= 0 || h <= 0) return;
    this.ops.push(['rect', r1(x), r1(y), r1(w), r1(h), rgb, Math.round(alpha * 100)]);
    this.s.save();
    this.s.setAlpha(alpha);
    if (r <= 0) this.s.fillRect(x, y, w, h, rgb);
    else {
      const m = shapeMask('rect', r1(w), r1(h), r1(r), 0);
      this.s.fillMask(m.img, 0, 0, m.w, m.h, r1(x), r1(y), m.w, m.h, rgb);
    }
    this.s.restore();
  }

  /** An outline `t` thick, rounded by `r`, inside the box. */
  frame(x: number, y: number, w: number, h: number, t: number, rgb: number, alpha = 1, r = 0): void {
    if (w <= 0 || h <= 0) return;
    this.ops.push(['frame', r1(x), r1(y), r1(w), r1(h), r1(t), rgb]);
    const m = shapeMask('ring', r1(w), r1(h), r1(r), Math.max(1, r1(t)));
    this.s.save();
    this.s.setAlpha(alpha);
    this.s.fillMask(m.img, 0, 0, m.w, m.h, r1(x), r1(y), m.w, m.h, rgb);
    this.s.restore();
  }

  /** A glyph shape in the `size`×`size` box at (x, y); `t` its line width. */
  shape(kind: Shape, x: number, y: number, size: number, rgb: number, alpha = 1, t = Math.max(2, size * 0.09)): void {
    this.ops.push(['shape', kind, r1(x), r1(y), r1(size), rgb]);
    const s = r1(size);
    const m = shapeMask(kind, s, s, s / 2, r1(t));
    this.s.save();
    this.s.setAlpha(alpha);
    this.s.fillMask(m.img, 0, 0, m.w, m.h, r1(x), r1(y), m.w, m.h, rgb);
    this.s.restore();
  }

  /** Record an op drawn by a helper through `mask` (the icons), so the snapshot names it. */
  record(op: UiOp): void {
    this.ops.push(op);
  }

  /** A coverage mask at its own size, at (x, y), tinted `rgb` at `alpha`. Not recorded. */
  mask(img: Image2D, x: number, y: number, rgb: number, alpha = 1): void {
    this.s.save();
    this.s.setAlpha(alpha);
    this.s.fillMask(img, 0, 0, img.width, img.height, r1(x), r1(y), img.width, img.height, rgb);
    this.s.restore();
  }

  /** An image into the box, nearest or smoothed. */
  image(img: Image2D, x: number, y: number, w: number, h: number, smooth = true, alpha = 1, name = 'image'): void {
    this.ops.push(['image', name, r1(x), r1(y), r1(w), r1(h)]);
    this.s.save();
    this.s.setSmoothing(smooth);
    this.s.setAlpha(alpha);
    this.s.drawImage(img, x, y, w, h);
    this.s.restore();
  }

  /** A part of an image into the box (`drawImageRect`). */
  imageRect(img: Image2D, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, name: string, smooth = true): void {
    this.ops.push(['image', name, r1(dx), r1(dy), r1(dw), r1(dh)]);
    this.s.save();
    this.s.setSmoothing(smooth);
    this.s.drawImageRect(img, sx, sy, sw, sh, dx, dy, dw, dh);
    this.s.restore();
  }

  /** The width of `text` at `px` pixels per em, with `spacing` added after each character. */
  measure(text: string, px: number, bold = false, spacing = 0): number {
    const chars = [...text];
    const face = bold ? this.fonts.bold : this.fonts.regular;
    return face.advances(chars, px).reduce((a, b) => a + b, 0) + spacing * chars.length;
  }

  /**
   * `text` with its baseline at `y`, aligned on `x`. Returns its width. With `outline`, each
   * glyph first gets a rim `r` pixels wide in `rgb` — moved down by `dy` and at `alpha`, it
   * is the web's soft `text-shadow` rather than a subtitle's outline.
   */
  text(text: string, x: number, y: number, px: number, rgb: number, opts: { align?: Align; bold?: boolean; alpha?: number; spacing?: number; face?: NativeFace; outline?: { r: number; rgb: number; dy?: number; alpha?: number } } = {}): number {
    const face = opts.face ?? (opts.bold ? this.fonts.bold : this.fonts.regular);
    const chars = [...text];
    const adv = face.advances(chars, px);
    const spacing = opts.spacing ?? 0;
    const w = adv.reduce((a, b) => a + b, 0) + spacing * chars.length;
    let pen = opts.align === 'center' ? x - w / 2 : opts.align === 'right' ? x - w : x;
    this.ops.push(['text', text, r1(pen), r1(y), Math.round(px * 10) / 10, rgb]);
    this.s.save();
    this.s.setAlpha(opts.alpha ?? 1);
    const [y0, qy] = quarter(y);
    chars.forEach((ch, i) => {
      const [x0, qx] = quarter(pen);
      const g = atlas.get(face, ch, px, opts.outline?.r ?? 0, qx, qy);
      if (g.page && opts.outline) {
        const o = opts.outline;
        if (o.alpha !== undefined) this.s.setAlpha((opts.alpha ?? 1) * o.alpha);
        this.s.fillMask(g.page, g.sx + g.w + 1, g.sy, g.w, g.h, x0 + g.x, y0 + g.y + r1(o.dy ?? 0), g.w, g.h, o.rgb);
        if (o.alpha !== undefined) this.s.setAlpha(opts.alpha ?? 1);
      }
      if (g.page) this.s.fillMask(g.page, g.sx, g.sy, g.w, g.h, x0 + g.x, y0 + g.y, g.w, g.h, rgb);
      pen += adv[i]! + spacing;
    });
    this.s.restore();
    return w;
  }
}

// ── The intro's helpers (introScreen.ts): free functions in device pixels ─────────────
//
// The few shapes and the text the screens around the movies draw — the start splash's
// button, the controller glyph in it, the skip hint. Shapes are coverage masks made here
// (4×4 samples a pixel) and uploaded once per size, then filled with `fillMask` like a glyph;
// text is the subtitle path's FreeType glyphs (`GlyphAtlas`), fill only. Sizes are device
// pixels: the callers turn the web's CSS px into them with the window's density. They are
// not recorded (the intro has no layout snapshot; native/compare-media.mjs checks it).

const sampledMasks = new Map<string, NativeImage>();

/** A premultiplied white × coverage texture of `w`×`h` from a coverage test at a point. */
function maskOf(key: string, w: number, h: number, inside: (x: number, y: number) => boolean): NativeImage {
  const hit = sampledMasks.get(key);
  if (hit) return hit;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if (inside(x + (i + 0.5) / 4, y + (j + 0.5) / 4)) n++;
      px.fill(Math.round((n / 16) * 255), (y * w + x) * 4, (y * w + x) * 4 + 4);
    }
  }
  const m = { id: __native.createTexture(px.buffer, w, h, false), width: w, height: h, premultiplied: true } as const;
  sampledMasks.set(key, m);
  return m;
}

/** A rounded rectangle at (x, y), whole device pixels, filled with `rgb`. */
export function fillRoundRect(s: Surface2D, x: number, y: number, w: number, h: number, r: number, rgb: number): void {
  w = Math.round(w);
  h = Math.round(h);
  const rr = Math.min(r, w / 2, h / 2);
  const m = maskOf(`rr|${w}|${h}|${rr}`, w, h, (px, py) => {
    const dx = Math.max(rr - px, px - (w - rr), 0);
    const dy = Math.max(rr - py, py - (h - rr), 0);
    return dx * dx + dy * dy <= rr * rr;
  });
  s.fillMask(m, 0, 0, w, h, Math.round(x), Math.round(y), w, h, rgb);
}

/** A disc of diameter `d` with its top-left at (x, y). */
export function fillDisc(s: Surface2D, x: number, y: number, d: number, rgb: number): void {
  const n = Math.round(d);
  fillRoundRect(s, x, y, n, n, n / 2, rgb);
}

/** "▶": a play triangle, pointing right, in a `w`×`h` box at (x, y). */
export function fillPlay(s: Surface2D, x: number, y: number, w: number, h: number, rgb: number): void {
  w = Math.round(w);
  h = Math.round(h);
  const m = maskOf(`play|${w}|${h}`, w, h, (px, py) => px >= 0 && Math.abs(py - h / 2) <= (h / 2) * (1 - px / w));
  s.fillMask(m, 0, 0, w, h, Math.round(x), Math.round(y), w, h, rgb);
}

/** A face for the screens' text, at a CSS weight. */
export async function loadUiFace(file: string, weight: number): Promise<NativeFace> {
  return new NativeFace(__native.fontLoad((await readBytes(file)).slice().buffer, weight), `${file}@${weight}`);
}

/** The width of `text` at `px` device pixels per em. */
export function textWidth(face: NativeFace, text: string, px: number): number {
  return face.advances([...text], px).reduce((a, b) => a + b, 0);
}

/** `text` from pen (x, baseline), `px` device pixels per em, filled with `rgb`. */
export function fillText(s: Surface2D, atlas: GlyphAtlas, face: NativeFace, text: string, x: number, baseline: number, px: number, rgb: number): void {
  const chars = [...text];
  const adv = face.advances(chars, px);
  let pen = x;
  chars.forEach((ch, i) => {
    const x0 = Math.floor(pen), y0 = Math.floor(baseline);
    const qx = Math.min(3, Math.round((pen - x0) * 4)), qy = Math.min(3, Math.round((baseline - y0) * 4));
    const a = atlas.get(face, ch, px, 0, qx, qy);
    if (a.page) s.fillMask(a.page, a.sx, a.sy, a.w, a.h, x0 + a.x, y0 + a.y, a.w, a.h, rgb);
    pen += adv[i]!;
  });
}
