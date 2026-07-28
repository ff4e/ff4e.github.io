/**
 * Enhanced (vector) subtitle rendering — SubtitleSystem.drawVector (the FreeSans-Bold
 * overlay). Driven through a mock 2D context that records draw calls, so the layout,
 * per-character wave gating (PisStringF), centering, speaker colour and fit-to-width
 * shrink are all verified deterministically without a real canvas.
 */
import { describe, it, expect } from 'vitest';
import { SubtitleSystem, SUB_SUBSTEPS } from '../src/render/subtitles.js';
import type { FontData } from '../src/render/font.js';
import type { FfrPaletteEntry } from '../src/data/ffr.js';

const CHAR_W = 10; // every glyph (incl. space) advances 10px in the mock context
const SUB_FONT_PX = 23; // must match subtitles.ts

/** A fake font: fixed 10px advance, plus the two speaker colours we assert on. */
const fakeFont = {
  coltab: new Map([
    ['M', { r: 255, g: 150, b: 0 }],
    ['V', { r: 0, g: 200, b: 220 }],
  ]),
  coltab2: new Map(),
  textWidth: (s: string) => [...s].length * CHAR_W,
} as unknown as FontData;

const palette: FfrPaletteEntry[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 }));

interface FillCall {
  ch: string;
  x: number;
  y: number;
  topColor: string | null;
}

/** Minimal CanvasRenderingContext2D stand-in that records the calls drawVector makes.
 *  `charW` is the per-glyph advance the *vector* context reports (independent of the
 *  wrap metrics), so tests can model a font that measures wider than the wrap font. */
function mockCtx(charW = CHAR_W) {
  const fonts: string[] = [];
  const fill: FillCall[] = [];
  const stroke: { ch: string; x: number }[] = [];
  const counts = { measure: 0, gradient: 0 };
  let curTop: string | null = null;
  const ctx = {
    textAlign: '',
    textBaseline: '',
    lineJoin: '',
    miterLimit: 0,
    lineWidth: 0,
    strokeStyle: '',
    _font: '',
    set font(v: string) {
      this._font = v;
      fonts.push(v);
    },
    get font(): string {
      return this._font;
    },
    _fill: null as unknown,
    set fillStyle(v: unknown) {
      // The gradient stub carries its first colour stop for assertions.
      curTop = (v as { topColor?: string })?.topColor ?? (typeof v === 'string' ? v : null);
      this._fill = v;
    },
    get fillStyle(): unknown {
      return this._fill;
    },
    measureText: (s: string) => {
      counts.measure++;
      return { width: [...s].length * charW };
    },
    createLinearGradient: () => {
      counts.gradient++;
      const g: { topColor: string | null; addColorStop: (o: number, c: string) => void } = {
        topColor: null,
        addColorStop: (o: number, c: string) => {
          if (o === 0) g.topColor = c;
        },
      };
      return g;
    },
    strokeText: (ch: string, x: number) => stroke.push({ ch, x }),
    fillText: (ch: string, x: number, y: number) => fill.push({ ch, x, y, topColor: curTop }),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fonts, fill, stroke, counts };
}

const SCREEN_W = 300;
const SCREEN_H = 200;

function makeSub(): SubtitleSystem {
  return new SubtitleSystem(fakeFont, palette, 20, SCREEN_W, SCREEN_H);
}

describe('drawVector (enhanced subtitle overlay)', () => {
  it('draws one glyph per visible character, centred, in the speaker colour', () => {
    const sub = makeSub();
    sub.newSubtitle('Fillet', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X'); // large count -> fully settled, all glyphs shown

    expect(m.fill.length).toBe('Fillet'.length);
    expect(m.stroke.length).toBe('Fillet'.length); // outline stroked for every glyph too
    // Centred: first glyph starts at (screenW - lineWidth) / 2.
    const lineW = 'Fillet'.length * CHAR_W;
    expect(m.fill[0]!.x).toBeCloseTo((SCREEN_W - lineW) / 2, 5);
    // Speaker colour = coltab['M'] as the gradient's top stop.
    expect(m.fill.every((f) => f.topColor === 'rgb(255,150,0)')).toBe(true);
  });

  it('never draws spaces', () => {
    const sub = makeSub();
    sub.newSubtitle('A B', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X');
    expect(m.fill.map((f) => f.ch)).toEqual(['A', 'B']);
  });

  it('reveals glyphs progressively via the wave (p = cas*5 - index >= 0)', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0); // added at count 0
    // At the same tick nothing has risen in yet (cas = 0 -> p < 0 for all).
    const t0 = mockCtx();
    sub.drawVector(t0.ctx, 0, 'X');
    expect(t0.fill.length).toBe(0);
    // A tick later a few leading glyphs have appeared, but not all.
    const t1 = mockCtx();
    sub.drawVector(t1.ctx, 1, 'X');
    expect(t1.fill.length).toBeGreaterThan(0);
    expect(t1.fill.length).toBeLessThan('Careful'.length);
    // Well after, the whole line is shown.
    const t2 = mockCtx();
    sub.drawVector(t2.ctx, 100, 'X');
    expect(t2.fill.length).toBe('Careful'.length);
  });

  it('uses the other speaker colour for the big fish (V)', () => {
    const sub = makeSub();
    sub.newSubtitle('Hi', 'V', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X');
    expect(m.fill.every((f) => f.topColor === 'rgb(0,200,220)')).toBe(true);
  });

  it('shrinks the font when the vector line is wider than the wrap metrics allow', () => {
    const sub = makeSub();
    const maxW = SCREEN_W - 40; // BORDERTITLE*2 = 260
    // 20 chars fit the wrap font (200px <= 260) so it stays ONE line, but the vector
    // context below measures 15px/char (300px) -> drawVector must shrink to fit.
    const wide = 'A'.repeat(20);
    sub.newSubtitle(wide, 'M', 0);
    const px = (f: string) => Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 0);

    const VEC_CHAR_W = 15;
    const m = mockCtx(VEC_CHAR_W);
    sub.drawVector(m.ctx, 200, 'X');
    const used = m.fonts.map(px).filter((n) => n > 0);
    expect(used.some((n) => n < SUB_FONT_PX)).toBe(true); // it shrank
    // drawVector sets fs = SUB_FONT_PX * maxW / vectorLineWidth.
    expect(Math.min(...used)).toBeCloseTo((SUB_FONT_PX * maxW) / (wide.length * VEC_CHAR_W), 1);
  });

  it('a line that already fits keeps the full font size', () => {
    const sub = makeSub();
    sub.newSubtitle('short', 'M', 0);
    const px = (f: string) => Number(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] ?? 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 200, 'X');
    expect(m.fonts.map(px).filter((n) => n > 0).every((n) => n === SUB_FONT_PX)).toBe(true);
  });

  it('applies the weight argument as the leading token of ctx.font', () => {
    const sub = makeSub();
    sub.newSubtitle('Weighty', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'Mulish', '500');
    // Every font string drawVector sets is `<weight> <px>px <family>`.
    expect(m.fonts.length).toBeGreaterThan(0);
    expect(m.fonts.every((f) => /^500 \d/.test(f))).toBe(true);
    expect(m.fonts.every((f) => f.endsWith('Mulish'))).toBe(true);
  });

  it('defaults the weight to 700 when omitted', () => {
    const sub = makeSub();
    sub.newSubtitle('Bold', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X');
    expect(m.fonts.every((f) => /^700 \d/.test(f))).toBe(true);
  });
});

describe('drawVector cost model (the per-frame work it must NOT redo)', () => {
  it('shapes a line once and reuses the measurements on later frames', () => {
    const sub = makeSub();
    sub.newSubtitle('Fillet', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X');
    const first = m.counts.measure;
    // A settled 6-glyph line: the fit measurement, the re-measure guard and one
    // advance per glyph — all of it invariant for the life of the line.
    expect(first).toBeGreaterThan(0);
    m.counts.measure = 0;
    for (let f = 0; f < 10; f++) sub.drawVector(m.ctx, 100 + f, 'X');
    expect(m.counts.measure).toBe(0); // ten more frames, zero re-shaping
    // …and the glyphs are still drawn, at the same places.
    expect(m.fill.length).toBe('Fillet'.length * 11);
    expect(m.fill[0]!.x).toBe(m.fill['Fillet'.length]!.x);
  });

  it('re-measures when the font changes (F cycles the face)', () => {
    const sub = makeSub();
    sub.newSubtitle('Fillet', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'Mulish', '500');
    m.counts.measure = 0;
    sub.drawVector(m.ctx, 100, 'Mulish', '500');
    expect(m.counts.measure).toBe(0); // same face: cached
    sub.drawVector(m.ctx, 100, 'Jost', '500');
    expect(m.counts.measure).toBeGreaterThan(0); // different family: re-measured
    m.counts.measure = 0;
    sub.drawVector(m.ctx, 100, 'Jost', '700');
    expect(m.counts.measure).toBeGreaterThan(0); // different weight: re-measured
  });

  it('shares one bevel gradient per line once the wave has settled', () => {
    const sub = makeSub();
    sub.newSubtitle('Fillet', 'M', 0);
    const m = mockCtx();
    sub.drawVector(m.ctx, 100, 'X'); // settled: every glyph sits at dy = 0
    expect(m.counts.gradient).toBe(1);
    expect(m.fill.length).toBe('Fillet'.length); // still one fill per glyph
    // Mid-wave the glyphs are at different offsets, so they cannot share one — but
    // there is still at most one gradient per distinct offset, never one per glyph.
    const w = mockCtx();
    sub.drawVector(w.ctx, 2, 'X');
    expect(w.counts.gradient).toBeGreaterThan(0);
    expect(w.counts.gradient).toBeLessThanOrEqual(w.fill.length);
  });
});

describe('vectorSignature (the repaint gate)', () => {
  it('is stable within a logic tick and changes while the wave runs', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0);
    const a = sub.vectorSignature(3);
    expect(sub.vectorSignature(3)).toBe(a); // same tick -> same image -> no repaint
    expect(sub.vectorSignature(4)).not.toBe(a); // the wave advanced
  });

  it('stops changing once the line has settled and finished scrolling', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0);
    for (let c = 1; c <= 30; c++) sub.tick(c); // scroll to cilys, wave-in completes
    const s30 = sub.vectorSignature(30);
    expect(sub.vectorSignature(31)).toBe(s30);
    expect(sub.vectorSignature(35)).toBe(s30); // a static line needs no repaints at all
  });

  it('changes when a new line arrives, when lines scroll, and when one expires', () => {
    const sub = makeSub();
    sub.newSubtitle('First', 'M', 0);
    const one = sub.vectorSignature(0);
    sub.newSubtitle('Second', 'V', 0);
    expect(sub.vectorSignature(0)).not.toBe(one); // a line was added (and pushed up)
    const before = sub.vectorSignature(1);
    sub.tick(1); // lines scroll toward cilys
    expect(sub.vectorSignature(1)).not.toBe(before);
    for (let c = 2; c <= 60; c++) sub.tick(c); // outlive killcount
    expect(sub.active).toBe(false);
    expect(sub.vectorSignature(60)).toBe(''); // nothing on screen
  });

  it('cannot be collided by subtitle text containing its own delimiters', () => {
    // Two lines "A" and "B" vs. ONE line whose text is the encoding of the second.
    const two = makeSub();
    two.newSubtitle('A', 'M', 0);
    two.newSubtitle('B', 'V', 0);
    const one = makeSub();
    one.newSubtitle('A|-52|x;1:VB', 'M', 0);
    expect(two.vectorSignature(100)).not.toBe(one.vectorSignature(100));
  });

  it('distinguishes two lines that differ only in speaker colour', () => {
    const a = makeSub();
    a.newSubtitle('Hi', 'M', 0);
    const b = makeSub();
    b.newSubtitle('Hi', 'V', 0);
    expect(a.vectorSignature(5)).not.toBe(b.vectorSignature(5));
  });
});

describe('sub-tick animation (the wave is interpolated between logic ticks)', () => {
  it('places every glyph exactly on the analytic PisStringF curve for the fractional tick', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0); // added at count 0 -> ys = 0, so the wave amp is UNDERTITLE
    const draw = (count: number, alpha: number) => {
      const m = mockCtx();
      sub.drawVector(m.ctx, count, 'X', 700, alpha);
      return m.fill;
    };
    // Independent oracle: PisStringF's damped cosine evaluated at the CONTINUOUS
    // tick, which is the whole specification of the interpolation. Anything that
    // overshoots the next tick, lags, or mis-scales `frac` lands off this curve.
    const UNDERTITLE = 15;
    const SUB_BASELINE_OFF = -6;
    const expected = (cas: number, frac: number, index: number) => {
      const p = cas * 5 - index;
      if (p < 0) return null; // not revealed yet
      // The line was added at count 0 with ys = 0 and cilys = BASETITLE - ROWTITLE,
      // and has not been ticked, so PosunTitulky's next step is ys - SPEEDTITLE.
      const ys = 0 + (Math.max(-26, 0 - 2) - 0) * frac;
      const amp = UNDERTITLE - ys;
      const dy = p < 50 ? ((amp * (50 - p)) / 50) * Math.cos((3.5 * Math.PI * p) / 50) : 0;
      return ys + SCREEN_H + SUB_BASELINE_OFF + dy;
    };
    for (const [count, alpha, frac] of [
      [2, 0, 0],
      [2, 0.25, 0.2],
      [2, 0.5, 0.4],
      [2, 0.99, 0.8],
      [3, 0, 0],
      [7, 0.45, 0.4],
    ] as const) {
      const fill = draw(count, alpha);
      // Rebuild the expected set of visible glyphs and their baselines from scratch.
      const want: number[] = [];
      for (let i = 1; i <= 'Careful'.length; i++) {
        if ('Careful'[i - 1] === ' ') continue;
        const y = expected(count + frac, frac, i);
        if (y !== null) want.push(y);
      }
      expect(fill.length, `visible glyph count at ${count}+${frac}`).toBe(want.length);
      fill.forEach((f, k) => expect(f.y, `glyph ${k} at ${count}+${frac}`).toBeCloseTo(want[k]!, 9));
    }
    // …and the sub-steps really are distinct frames, not the same one five times.
    expect(new Set([0, 0.25, 0.5, 0.99].map((a) => JSON.stringify(draw(2, a).map((f) => f.y)))).size).toBe(4);
  });

  it('quantises the fraction onto the step grid (bounded repaint cost)', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0);
    const sig = (alpha: number) => sub.vectorSignature(2, alpha);
    const steps = new Set([0, 0.1, 0.19, 0.2, 0.35, 0.4, 0.6, 0.8, 0.99].map(sig));
    expect(steps.size).toBe(SUB_SUBSTEPS); // five distinct images per tick, not one per frame
    expect(sig(0.1)).toBe(sig(0.19)); // within a step: nothing to repaint
    expect(sig(0.19)).not.toBe(sig(0.2)); // across a step boundary: repaint
  });

  it('interpolates the line scroll toward its target row, and stops when it arrives', () => {
    const sub = makeSub();
    sub.newSubtitle('First', 'M', 0);
    sub.newSubtitle('Second', 'V', 0); // pushes the first line up (cilys -= ROWTITLE)
    const yOf = (alpha: number) => {
      const m = mockCtx();
      sub.drawVector(m.ctx, 100, 'X', 700, alpha);
      return m.fill[0]!.y;
    };
    const y0 = yOf(0);
    expect(yOf(0.4)).toBeLessThan(y0); // scrolling up between ticks
    expect(yOf(0.8)).toBeLessThan(yOf(0.4));
    // PosunTitulky moves SPEEDTITLE=2 px per tick, so every sub-step must stay
    // strictly inside that one step — the projection may not run ahead of the tick.
    for (const f of [0.2, 0.4, 0.6, 0.8, 0.99]) {
      expect(yOf(f)).toBeLessThan(y0);
      expect(yOf(f)).toBeGreaterThan(y0 - 2);
    }
    for (let c = 1; c <= 30; c++) sub.tick(c); // let both lines reach cilys
    const rested = yOf(0);
    expect(yOf(0.8)).toBe(rested); // parked: no sub-tick movement left
  });

  it('reports whether anything is still moving (drives the idle throttle)', () => {
    const sub = makeSub();
    sub.newSubtitle('Careful', 'M', 0);
    expect(sub.vectorAnimating(0)).toBe(true); // wave just started
    for (let c = 1; c <= 30; c++) sub.tick(c);
    expect(sub.vectorAnimating(30)).toBe(false); // settled and parked
    expect(sub.active).toBe(true); // …but still on screen
  });
});
