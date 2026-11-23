/**
 * The few shapes and the text the screens around the movies draw natively — the start
 * splash's button, the controller glyph in it, the skip hint — through `Surface2D`.
 *
 * Shapes are coverage masks made here (4×4 samples a pixel) and uploaded once per size, then
 * filled with `fillMask` like a glyph; text is the subtitle path's FreeType glyphs
 * (`GlyphAtlas`), fill only. Sizes are given in device pixels: the callers turn the web's CSS
 * px into them with the window's density.
 */
import type { Surface2D } from '../../src/render/surface2d.js';
import { GlyphAtlas } from './subtitleDraw.js';
import { NativeFace } from './subtitleFonts.js';
import { readBytes } from './shims.js';
import type { NativeImage } from './nativeSurface.js';

type Mask = NativeImage;
const masks = new Map<string, Mask>();

/** A premultiplied white × coverage texture of `w`×`h` from a coverage test at a point. */
function maskOf(key: string, w: number, h: number, inside: (x: number, y: number) => boolean): Mask {
  const hit = masks.get(key);
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
  masks.set(key, m);
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
