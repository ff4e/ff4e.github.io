/**
 * The shared vector-subtitle geometry (src/render/subtitleGeom.ts).
 *
 * Both renderers measure from this module — `drawVector` onto a canvas, `subtitleDom`
 * into real text — so these are the rules that decide where a subtitle actually appears,
 * in either. They used to exist twice, once per renderer, which is how the two drifted:
 * the DOM path had no 8px floor on the fit and started its wave one step early. Pinned
 * here at ~2.5 ms a test rather than in a ~7.4 s probe, which is the reason the module is
 * pure and import-free.
 */
import { describe, it, expect } from 'vitest';
import {
  BORDERTITLE,
  SUB_FONT_PX,
  SUB_SCALE,
  UNDERTITLE,
  VECTOR_GEOM,
  WAVE_LEN,
  WAVE_PER_TICK,
  bevelBottomRgb,
  bevelSpan,
  fitFontPx,
  lineAnchor,
  strokeWidth,
  waveDy,
  wavePhase,
} from '../src/render/subtitleGeom.js';

const SCREEN_W = 780; // a wide room
const maxW = SCREEN_W - BORDERTITLE * 2;

describe('fitFontPx — shrink a long line to the room, never wrap it', () => {
  it('leaves a line that fits at the full size', () => {
    expect(fitFontPx(maxW - 1, SCREEN_W)).toBe(SUB_FONT_PX);
    expect(fitFontPx(1, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  // Exactly at the limit is not "too wide" — the canvas path's condition is `>`, and a
  // line that fits to the pixel must not be shrunk by a rounding hair.
  it('does not shrink a line that fits exactly', () => {
    expect(fitFontPx(maxW, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  it('scales the font by exactly the overflow ratio', () => {
    // Twice the budget -> half the size.
    expect(fitFontPx(maxW * 2, SCREEN_W)).toBeCloseTo(SUB_FONT_PX / 2, 10);
    expect(fitFontPx(maxW * 1.25, SCREEN_W)).toBeCloseTo(SUB_FONT_PX / 1.25, 10);
  });

  // The floor is drawVector's. Without it a pathological line collapses to something
  // unreadable, and shrinking past 8px would not make it fit anyway.
  it('never goes below the 8px floor', () => {
    expect(fitFontPx(maxW * 1000, SCREEN_W)).toBe(8);
  });

  // Guards against a divide-by-zero reaching the font size: a measurement of 0 means the
  // caller could not measure, and the honest answer is the unshrunk size.
  it('treats an unmeasurable line as fitting', () => {
    expect(fitFontPx(0, SCREEN_W)).toBe(SUB_FONT_PX);
    expect(fitFontPx(-1, SCREEN_W)).toBe(SUB_FONT_PX);
  });

  it('uses a narrower budget in a narrower room', () => {
    const narrow = 435;
    const wide = fitFontPx(500, 780);
    const tight = fitFontPx(500, narrow);
    expect(tight).toBeLessThan(wide);
    expect(tight).toBeCloseTo((SUB_FONT_PX * (narrow - BORDERTITLE * 2)) / 500, 10);
  });
});

describe('wavePhase — which glyphs have started', () => {
  // PisStringF counts characters from 1 (p = cas*5 - index), so glyph 0 starts one step
  // in. Getting this off by one is what makes a line appear a frame early or late.
  it('is cas*5 - (index + 1)', () => {
    expect(wavePhase(0, 0)).toBe(-1);
    expect(wavePhase(1, 0)).toBe(WAVE_PER_TICK - 1);
    expect(wavePhase(2, 3)).toBe(2 * WAVE_PER_TICK - 4);
  });

  it('is negative for a glyph that has not started, which is what hides it', () => {
    expect(wavePhase(0, 5)).toBeLessThan(0);
    expect(wavePhase(0.1, 0)).toBeLessThan(0);
    // ...and reaches exactly 0 the moment the first glyph is due, a fifth of a tick in.
    expect(wavePhase(1 / WAVE_PER_TICK, 0)).toBe(0);
  });

  it('advances WAVE_PER_TICK per logic tick', () => {
    expect(wavePhase(3, 0) - wavePhase(2, 0)).toBe(WAVE_PER_TICK);
  });

  it('staggers the glyphs by one step each, which is the letter-by-letter reveal', () => {
    expect(wavePhase(10, 0) - wavePhase(10, 1)).toBe(1);
  });
});

describe('waveDy — the damped cosine a glyph rides in on', () => {
  it('starts at the full amplitude', () => {
    expect(waveDy(0, 100)).toBeCloseTo(100, 10);
  });

  it('is exactly zero once the wave is over, so a settled line sits on its baseline', () => {
    expect(waveDy(WAVE_LEN, 100)).toBe(0);
    expect(waveDy(WAVE_LEN + 1, 100)).toBe(0);
    expect(waveDy(1e6, 100)).toBe(0);
  });

  it('decays as it goes: the envelope shrinks toward the end', () => {
    const at = (p: number) => Math.abs(waveDy(p, 100));
    expect(at(45)).toBeLessThan(at(5));
  });

  it('crosses the baseline — it is a cosine, not a slide', () => {
    const sampled = [];
    for (let p = 0; p < WAVE_LEN; p += 0.5) sampled.push(waveDy(p, 100));
    expect(sampled.some((v) => v > 0)).toBe(true);
    expect(sampled.some((v) => v < 0)).toBe(true);
  });

  it('scales linearly with the amplitude', () => {
    expect(waveDy(7, 200)).toBeCloseTo(waveDy(7, 100) * 2, 10);
  });

  it('is flat when there is no amplitude left to travel', () => {
    expect(waveDy(3, 0)).toBe(0);
  });
});

describe('lineAnchor — where a line sits and how far its wave swings', () => {
  const screenH = 225;

  it('takes ys through SUB_SCALE, so the row pitch grows with the glyphs', () => {
    const a = lineAnchor(-26, screenH);
    expect(a.baseline).toBeCloseTo(-26 * SUB_SCALE + screenH + VECTOR_GEOM.baselineOff, 10);
  });

  it('measures the wave from UNDERTITLE, below the resting row', () => {
    const a = lineAnchor(-26, screenH);
    expect(a.amp).toBeCloseTo(UNDERTITLE * SUB_SCALE - -26 * SUB_SCALE, 10);
  });

  // A line resting AT the wave's origin has nowhere to travel; anything above it does.
  it('gives a line further up the screen a longer travel', () => {
    expect(lineAnchor(-100, screenH).amp).toBeGreaterThan(lineAnchor(-26, screenH).amp);
  });

  it('moves the baseline down with a taller screen, since ys is measured from the bottom', () => {
    expect(lineAnchor(-26, 400).baseline - lineAnchor(-26, 225).baseline).toBeCloseTo(175, 10);
  });
});

describe('strokeWidth and bevelSpan — the glyph decoration', () => {
  it('the outline is 16% of the font size (drawVector strokeText)', () => {
    expect(strokeWidth(30)).toBeCloseTo(4.8, 10);
  });

  // Anchored to the glyph's OWN baseline, not to the line box: spreading the ramp over a
  // CSS line box instead is what made the DOM text look washed out.
  it('the bevel ramps across the cap height, above the baseline and a little below', () => {
    const s = bevelSpan(30);
    expect(s.top).toBeCloseTo(-21.6, 10);
    expect(s.bottom).toBeCloseTo(3, 10);
    expect(s.top).toBeLessThan(0);
    expect(s.bottom).toBeGreaterThan(0);
  });

  it('both scale with the font, so a shrunk line keeps its proportions', () => {
    expect(strokeWidth(15) * 2).toBeCloseTo(strokeWidth(30), 10);
    expect(bevelSpan(15).top * 2).toBeCloseTo(bevelSpan(30).top, 10);
  });

  it('the bevel darkens to 42% of the speaker colour, rounded', () => {
    expect(bevelBottomRgb(255, 150, 0)).toEqual([107, 63, 0]);
    expect(bevelBottomRgb(0, 0, 0)).toEqual([0, 0, 0]);
  });
});

describe('VECTOR_GEOM — the numbers a renderer places text from', () => {
  it('agrees with the constants it is built from', () => {
    expect(VECTOR_GEOM.fontPx).toBe(SUB_FONT_PX);
    expect(VECTOR_GEOM.scale).toBe(SUB_SCALE);
    expect(VECTOR_GEOM.border).toBe(BORDERTITLE);
    expect(VECTOR_GEOM.under).toBe(UNDERTITLE);
    expect(VECTOR_GEOM.waveLen).toBe(WAVE_LEN);
    expect(VECTOR_GEOM.wavePerTick).toBe(WAVE_PER_TICK);
  });

  it('is frozen, so a renderer cannot reach in and retune the other one', () => {
    expect(Object.isFrozen(VECTOR_GEOM)).toBe(true);
  });
});
