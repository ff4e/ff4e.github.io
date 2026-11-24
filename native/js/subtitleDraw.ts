/**
 * Native subtitles drawn through `Surface2D`: the layout (subtitleLayout.ts) as quads.
 *
 * Each glyph is two coverage masks from the host's FreeType (native/host/text.c) — the glyph,
 * and the glyph with its outline — kept in an atlas and drawn with `fillMask`, the way
 * subtitleDom.ts builds a glyph: the outline layer in `rgb(5,5,12)` first, the fill over it
 * in the speaker's bevel, glyph after glyph in reading order (each is its own layer there,
 * so a glyph's outline covers the fill of the one before it, as it does here).
 *
 * Everything is placed in DEVICE pixels: the tier's shrink and the display density are
 * applied to the pen, and the glyph is rasterised at the size it is shown at — as a browser
 * rasterises text at its device scale rather than scaling a bitmap. The pen's fraction is
 * kept to a quarter pixel each way (the masks are cached per quarter), so every mask lands
 * on whole pixels through a nearest sampler and the bevel can be coloured row by row: a
 * vertical gradient is one colour per device row, and each run of rows of one colour is one
 * quad.
 */
import type { Image2D, Surface2D } from '../../src/render/surface2d.js';
import { STROKE_RGB, type SubtitleFrame } from './subtitleLayout.js';
import type { NativeFace } from './subtitleFonts.js';
import { costed } from './uiCost.js';

/** One rasterised glyph: where its masks are in the atlas, and where they go from the pen. */
interface AtlasGlyph {
  readonly page: Image2D | null;
  readonly sx: number;
  readonly sy: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The atlas page's side, in texels. */
const PAGE = 1024;
/**
 * Pages kept before the atlas starts over. A session needs one or two (a size per fit and
 * window, sixteen pen positions per glyph); this bounds what resizing a window all evening
 * can pile up.
 */
const MAX_PAGES = 8;
/** Sub-pixel steps of the pen, per axis. */
const STEPS = 4;

/** What the atlas stores glyphs in: a host texture, or (to test the packing) anything. */
export interface AtlasPages {
  create(w: number, h: number): Image2D;
  upload(page: Image2D, x: number, y: number, w: number, h: number, rgba: Uint8Array): void;
  release(page: Image2D): void;
}

/** Host textures, premultiplied white × coverage — the image `NativeSurface.fillMask` draws. */
export const nativePages: AtlasPages = {
  create: (w, h) => ({ id: __native.createTexture(new ArrayBuffer(w * h * 4), w, h, false), width: w, height: h, premultiplied: true }) as Image2D,
  upload: (page, x, y, w, h, rgba) => __native.updateTexture((page as unknown as { id: number }).id, x, y, w, h, rgba.slice().buffer),
  release: (page) => __native.releaseTexture((page as unknown as { id: number }).id),
};

/** A coverage byte as a premultiplied white pixel: the byte in all four channels. */
const WORD = Uint32Array.from({ length: 256 }, (_, c) => c * 0x01010101);

/**
 * The glyph cache: each (face, size, outline, quarter-pixel pen) rasterised once, the fill
 * mask and the outline mask side by side in a shelf-packed page.
 */
export class GlyphAtlas {
  private readonly cache = new Map<string, AtlasGlyph>();
  private readonly all: Image2D[] = [];
  private page: Image2D | null = null;
  private px = 0;
  private py = 0;
  private shelf = 0;

  constructor(private readonly pages: AtlasPages = nativePages) {}

  get(face: NativeFace, ch: string, px: number, r: number, qx: number, qy: number): AtlasGlyph {
    const key = `${face.id}|${ch}|${px.toFixed(3)}|${r.toFixed(3)}|${qx}|${qy}`;
    const hit = this.cache.get(key);
    if (hit) return hit;
    return costed('glyphs', () => this.make(key, face, ch, px, r, qx, qy));
  }

  private make(key: string, face: NativeFace, ch: string, px: number, r: number, qx: number, qy: number): AtlasGlyph {
    const g = __native.fontGlyph(face.id, ch.codePointAt(0)!, px, r, qx / STEPS, qy / STEPS);
    let out: AtlasGlyph = { page: null, sx: 0, sy: 0, x: 0, y: 0, w: 0, h: 0 };
    if (g.w > 0) {
      const w = g.w, h = g.h!;
      const at = this.place(2 * w + 1, h);
      // White × coverage, premultiplied: a pixel's four bytes are its coverage, one word each.
      const row = 2 * w + 1;
      const words = new Uint32Array(row * h);
      const fill = new Uint8Array(g.fill!), stroke = new Uint8Array(g.stroke!);
      for (let j = 0; j < h; j++) {
        for (let i = 0; i < w; i++) {
          words[j * row + i] = WORD[fill[j * w + i]!]!;
          words[j * row + w + 1 + i] = WORD[stroke[j * w + i]!]!;
        }
      }
      this.pages.upload(at.page, at.x, at.y, row, h, new Uint8Array(words.buffer));
      out = { page: at.page, sx: at.x, sy: at.y, x: g.x!, y: g.y!, w, h };
    }
    this.cache.set(key, out);
    return out;
  }

  /** A `w`×`h` spot on the current page's shelf, or a new shelf, or a new page. */
  private place(w: number, h: number): { page: Image2D; x: number; y: number } {
    if (w > PAGE || h > PAGE) throw new Error(`a ${w}×${h} glyph does not fit a subtitle atlas page`);
    if (this.page && this.px + w > PAGE) {
      this.px = 0;
      this.py += this.shelf + 1;
      this.shelf = 0;
    }
    if (!this.page || this.py + h > PAGE) {
      if (this.all.length === MAX_PAGES) {
        // Start over: whatever is still on screen is rasterised again on its next frame.
        for (const p of this.all.splice(0)) this.pages.release(p);
        this.cache.clear();
      }
      this.page = this.pages.create(PAGE, PAGE);
      this.all.push(this.page);
      this.px = 0;
      this.py = 0;
      this.shelf = 0;
    }
    const at = { page: this.page, x: this.px, y: this.py };
    this.px += w + 1;
    this.shelf = Math.max(this.shelf, h);
    return at;
  }
}

const rgbOf = (c: readonly [number, number, number]): number => (c[0] << 16) | (c[1] << 8) | c[2];

/** Split `v` into a whole pixel and a quarter step, carrying a step that rounds up to 4. */
function quarter(v: number): [number, number] {
  let whole = Math.floor(v);
  let q = Math.round((v - whole) * STEPS);
  if (q === STEPS) {
    whole++;
    q = 0;
  }
  return [whole, q];
}

/**
 * Draw a laid-out frame onto `s`, whose pixel (0, 0) is the top-left of the room's box and
 * which holds `density` pixels per CSS px. `s` is drawn in its own pixels (identity transform).
 */
export function drawSubtitles(s: Surface2D, frame: SubtitleFrame, face: NativeFace, atlas: GlyphAtlas, density: number): void {
  const k = frame.tier * density;
  const devX = (x: number): number => (frame.originX + (x - frame.originX) * frame.tier) * density;
  const devY = (y: number): number => (frame.originY + (y - frame.originY) * frame.tier) * density;
  s.setSmoothing(false);
  for (const line of frame.lines) {
    const px = line.fontPx * k;
    const r = (line.strokeW / 2) * k;
    const top = rgbOf(line.top);
    const [tr, tg, tb] = line.top;
    const [br, bg, bb] = line.bottom;
    for (const gl of line.glyphs) {
      const base = line.baseline + gl.dy;
      const [x0, qx] = quarter(devX(gl.x));
      const [y0, qy] = quarter(devY(base));
      const a = atlas.get(face, gl.ch, px, r, qx, qy);
      if (!a.page) continue;
      const dx = x0 + a.x, dy = y0 + a.y;
      s.fillMask(a.page, a.sx + a.w + 1, a.sy, a.w, a.h, dx, dy, a.w, a.h, STROKE_RGB);
      // The bevel, one colour per device row: the gradient at the row's centre, back in the
      // line's own CSS px, relative to the (waving) baseline.
      const yTop = devY(base + line.bevelTop), yBottom = devY(base + line.bevelBottom);
      let runFrom = 0;
      let runRgb = -1;
      for (let j = 0; j <= a.h; j++) {
        let rgb = -1;
        if (j < a.h) {
          const t = Math.max(0, Math.min(1, (dy + j + 0.5 - yTop) / (yBottom - yTop)));
          rgb = t === 0 ? top
            : (Math.round(tr + (br - tr) * t) << 16) | (Math.round(tg + (bg - tg) * t) << 8) | Math.round(tb + (bb - tb) * t);
        }
        if (rgb === runRgb) continue;
        if (runRgb >= 0) s.fillMask(a.page, a.sx, a.sy + runFrom, a.w, j - runFrom, dx, dy + runFrom, a.w, j - runFrom, runRgb);
        runFrom = j;
        runRgb = rgb;
      }
    }
  }
}
