/**
 * Where a native subtitle's glyphs go: the layout `src/app/subtitleDom.ts` gives the DOM, as
 * numbers a GPU can draw (native/js/subtitleDraw.ts).
 *
 * What a subtitle SAYS and where its rows sit is not decided here. It is the game's own,
 * shared with the browser: `SubtitleSystem` (src/render/subtitles.ts) wraps the text
 * against the original bitmap font, stacks and scrolls the rows, times them out and
 * resolves the speaker colour, and `subtitleGeom.ts` holds every rule the vector renderer
 * measures from (size, readable band, fit-to-room, baseline, wave, stroke, bevel). Both
 * are DOM-free and imported, not restated.
 *
 * What IS restated is the part of `syncDomSubtitles` that composes those rules — the
 * desktop branch (no phone word flow, no tablet layout: a TV is neither) — because it is
 * welded to DOM mechanics there: the fit is measured with a hidden span, the glyphs are
 * inline-blocks centred by `text-align`, the wave is Web Animations keyframes and the `ai`
 * tier's shrink is a CSS transform on the layer. Sharing it would mean restructuring the web
 * renderer for a host the web does not ship, so the copy is pinned instead: any change to
 * that function fails `npm run test` until this file has been re-read against it.
 *
 * Coordinates are CSS px in the room's on-screen box, with (0, 0) at its top-left — the
 * box `#screen` and the subtitle layer share. Everything is before the tier's shrink, which
 * is returned separately (`origin`, `tier`) because it is a transform of the whole layer.
 */
import {
  VECTOR_GEOM,
  bevelBottomRgb,
  bevelSpan,
  clampTextScale,
  fitBlockFontPx,
  fitScreenW,
  lineAnchor,
  lineOffset,
  strokeWidth,
  waveDy,
} from '../../src/render/subtitleGeom.js';
import { vectorSubtitleText } from '../../src/render/subtitleChars.js';
import type { SubtitleSystem } from '../../src/render/subtitles.js';

/** One row as the subtitle system hands it to a vector renderer. */
export type SubtitleRow = ReturnType<SubtitleSystem['debugLines']>[number];

/** The face the text is drawn in: what a browser would measure, from the host's font. */
export interface SubtitleFace {
  /** Each character's advance at `fontPx`, in CSS px (unkerned: one glyph at a time). */
  advances(chars: readonly string[], fontPx: number): number[];
  /** `[ascent, descent, lineGap]` at `fontPx`, in CSS px — a CSS line box's parts. */
  metrics(fontPx: number): readonly [number, number, number];
}

/** `syncDomSubtitles`' geometry arguments, and the tier's shrink. */
export interface SubtitleBox {
  /** The room's on-screen box, CSS px. */
  readonly cssW: number;
  readonly cssH: number;
  /** CSS px per native px of the room: the box's own scale. */
  readonly boxScale: number;
  /** The text's scale before the readable band (`subtitleScale(stage.scale, boxScale)`). */
  readonly textScale: number;
  /** The `ai` tier's shrink of the whole layer (`aiSubScale`), about its bottom centre. */
  readonly tier: number;
}

export interface LaidGlyph {
  readonly ch: string;
  /** The glyph's pen (left edge, baseline), CSS px, before the wave. */
  readonly x: number;
  /** The wave's vertical offset now, CSS px. */
  readonly dy: number;
}

export interface LaidLine {
  readonly id: number;
  /** Font size the glyphs are drawn at, CSS px (the CSS font string's, to 0.01 px). */
  readonly fontPx: number;
  /** The line's baseline, CSS px. */
  readonly baseline: number;
  /** The outline's width (centred on the glyph's outline: half of it is outside). */
  readonly strokeW: number;
  /** The bevel: `top` colour down to `bevelTop`, ramping to `bottom` at `bevelBottom` (baseline-relative). */
  readonly top: readonly [number, number, number];
  readonly bottom: readonly [number, number, number];
  readonly bevelTop: number;
  readonly bevelBottom: number;
  /** The glyphs that are showing: a space inks nothing and a glyph shows once its wave starts. */
  readonly glyphs: readonly LaidGlyph[];
}

export interface SubtitleFrame {
  readonly lines: readonly LaidLine[];
  /** The tier's shrink, and the point it is about (the layer's bottom centre). */
  readonly tier: number;
  readonly originX: number;
  readonly originY: number;
}

/** The `ai` tier's shrink of the subtitle layer. restates src/app/introOverlay.ts `export let aiSubScale =` @ a11052ca99b4 */
export const AI_SUB_SCALE = 0.75;

/** The outline colour: `-webkit-text-stroke`'s `rgb(5,5,12)` (subtitleDom.ts). */
export const STROKE_RGB = 0x05050c;

// restates src/app/subtitleDom.ts `const WAVE_KEYFRAMES =` @ 2f415f9fdb67
const WAVE_KEYFRAMES = 24;

/** A CSS length as the browser lays it out: LayoutUnit, 1/64 px. */
const layoutUnit = (v: number): number => Math.round(v * 64) / 64;

/**
 * The wave's offset at phase `p`, as the compositor runs it: `waveFrames`' keyframes —
 * `waveDy` sampled 25 times, each written `toFixed(2)` — interpolated linearly, held at the
 * last one once the wave is over. Not `waveDy` itself: that is the curve the keyframes
 * approximate, and the browser shows the approximation.
 * restates src/app/subtitleDom.ts `function waveFrames(` @ a692c320ad5b
 */
export function sampledWaveDy(p: number, amp: number): number {
  const at = (k: number): number => Number(waveDy((k / WAVE_KEYFRAMES) * VECTOR_GEOM.waveLen, amp).toFixed(2));
  const q = Math.max(0, Math.min(1, p / VECTOR_GEOM.waveLen)) * WAVE_KEYFRAMES;
  const k = Math.min(WAVE_KEYFRAMES - 1, Math.floor(q));
  return at(k) + (at(k + 1) - at(k)) * (q - k);
}

interface Built {
  /** The message's fit, decided once when the row was built (`DomLine.fit`). */
  readonly fit: number;
  /** The wave's amplitude, from the row's position when it was built. */
  readonly amp: number;
}

/**
 * The layout of one subtitle system's rows, kept across frames as `syncDomSubtitles` keeps its
 * layer: a row's fit and wave amplitude are decided when it first appears and kept while it
 * lives, and a change of font or fit budget rebuilds them all.
 */
export class SubtitleLayout {
  private readonly built = new Map<number, Built>();
  private lastFont = '';
  private lastFitW = 0;

  constructor(private readonly face: SubtitleFace) {}

  /**
   * Where everything is at `now` — the game's tick count, with the fraction of the tick that
   * has passed (a glyph's wave runs on wall time in the browser, between ticks).
   *
   * restates src/app/subtitleDom.ts `export function syncDomSubtitles(` @ 637f141f0c4d
   * — its desktop branch: `detached` and `tablet` false, the layer at the room's box.
   */
  layout(rows: readonly SubtitleRow[], screenW: number, screenH: number, now: number, box: SubtitleBox, fontKey = ''): SubtitleFrame {
    const textScale = clampTextScale(box.textScale, box.boxScale);
    const fontPx = VECTOR_GEOM.fontPx * textScale;
    const fontCss = Number(fontPx.toFixed(2));
    const font = `${fontKey} ${fontCss}`;
    const fitW = fitScreenW(screenW, box.boxScale, textScale);
    if (font !== this.lastFont || fitW !== this.lastFitW) this.built.clear();
    this.lastFont = font;
    this.lastFitW = fitW;
    const want = new Set(rows.map((t) => t.id));
    for (const id of this.built.keys()) if (!want.has(id)) this.built.delete(id);

    // One fit per message: the smallest of its rows' (`fitBlockFontPx`), rows already built
    // keeping theirs.
    const blockFit = new Map<number, number>();
    const blockNatural = new Map<number, number[]>();
    for (const t of rows) {
      const b = this.built.get(t.id);
      if (b) {
        const cur = blockFit.get(t.block);
        if (cur === undefined || b.fit < cur) blockFit.set(t.block, b.fit);
        continue;
      }
      const natural = this.width(vectorSubtitleText(t.obsah), fontCss) / textScale;
      const list = blockNatural.get(t.block);
      if (list) list.push(natural);
      else blockNatural.set(t.block, [natural]);
    }
    for (const [block, naturals] of blockNatural) {
      const f = fitBlockFontPx(naturals, fitW) / VECTOR_GEOM.fontPx;
      const cur = blockFit.get(block);
      if (cur === undefined || f < cur) blockFit.set(block, f);
    }

    const lines: LaidLine[] = [];
    for (const t of rows) {
      let b = this.built.get(t.id);
      if (!b) {
        b = { fit: blockFit.get(t.block)!, amp: lineAnchor(t.ys, screenH).amp * textScale };
        this.built.set(t.id, b);
      }
      const fs = fontPx * b.fit;
      const lineCss = b.fit === 1 ? fontCss : Number(fs.toFixed(2));
      const baseline = screenH * box.boxScale + lineOffset(t.ys) * textScale;
      const chars = [...vectorSubtitleText(t.obsah)];
      const adv = this.face.advances(chars, lineCss).map((a) => Math.ceil(a * 64) / 64);
      let x = layoutUnit((box.cssW - adv.reduce((s, a) => s + a, 0)) / 2);
      const cas = now - t.startcount;
      const glyphs: LaidGlyph[] = [];
      chars.forEach((ch, i) => {
        const p = cas * VECTOR_GEOM.wavePerTick - (i + 1);
        if (ch !== ' ' && p >= 0) glyphs.push({ ch, x, dy: sampledWaveDy(p, b.amp) });
        x += adv[i]!;
      });
      const [r, g, bl] = t.rgb;
      const { top, bottom } = this.bevel(fs, lineCss);
      lines.push({
        id: t.id, fontPx: lineCss, baseline, strokeW: strokeWidth(fs),
        top: [r, g, bl], bottom: bevelBottomRgb(r, g, bl), bevelTop: top, bevelBottom: bottom, glyphs,
      });
    }
    // The layer's border box is the room's box plus a 1px border, and the shrink is about its
    // bottom centre — one pixel below the room's bottom edge.
    return { lines, tier: box.tier, originX: box.cssW / 2, originY: box.cssH + 1 };
  }

  /** `measureTextWidth`: one run of the text, unkerned. */
  private width(text: string, fontPx: number): number {
    return this.face.advances([...text], fontPx).reduce((s, a) => s + a, 0);
  }

  /**
   * The bevel's ends relative to the baseline, as the browser places them. The ramp is
   * `bevelSpan`, written as percentages of the line box the baseline was measured in, and
   * applied to the fill span — an inline box, whose background is its content area (ascent
   * + descent, no line gap). The two agree for a face with no line gap; FreeSans has one.
   */
  private bevel(fs: number, fontCss: number): { top: number; bottom: number } {
    const [asc, desc, gap] = this.face.metrics(fontCss);
    const inset = gap / 2 + asc;
    const boxH = asc + desc + gap;
    const ramp = bevelSpan(fs);
    const at = (v: number): number => -asc + (Number((((inset + v) / boxH) * 100).toFixed(2)) / 100) * (asc + desc);
    return { top: at(ramp.top), bottom: at(ramp.bottom) };
  }
}
