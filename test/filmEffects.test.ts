/**
 * The full-frame cheat effects (URoom.pas: ZpracujInterlaced :26053, Sum :26082,
 * zcernobilit :23914). All three are pure functions over the finished frame, so
 * they can be pinned exactly against the Delphi's scanline arithmetic.
 */
import { describe, it, expect } from 'vitest';
import {
  zpracujInterlaced,
  interlacedSounds,
  sum,
  zcernobilit,
  INTERLACED_OFF,
  INTERLACED_STOP,
  INTERLACED_START,
  type FrameTarget,
} from '../src/render/filmEffects.js';

/** A tiny FrameTarget whose rgba plane just mirrors the index in every channel. */
function target(w: number, h: number, fill: (x: number, y: number) => number): FrameTarget {
  const idx = new Uint8Array(w * h);
  const rgba = new Uint8Array(w * h * 4);
  const t: FrameTarget = {
    width: w,
    height: h,
    idx,
    rgba,
    setIndex(x, y, a) {
      const p = y * w + x;
      idx[p] = a;
      rgba[p * 4] = a;
      rgba[p * 4 + 1] = a;
      rgba[p * 4 + 2] = a;
      rgba[p * 4 + 3] = 255;
    },
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) t.setIndex(x, y, fill(x, y));
  return t;
}

/** The index plane as one value per row (the effects only ever move whole rows). */
function rows(t: FrameTarget): number[] {
  return Array.from({ length: t.height }, (_v, y) => t.idx[y * t.width]!);
}

describe('zpracujInterlaced', () => {
  const H = 8;
  const WHITE = 99;
  /** Rows numbered 1..H so row 0 is distinguishable from the blank fill. */
  const frame = (): FrameTarget => target(3, H, (_x, y) => y + 1);

  it('advances the phase by one and reports the next value', () => {
    expect(zpracujInterlaced(frame(), 0, WHITE)).toBe(1);
    expect(zpracujInterlaced(frame(), 40, WHITE)).toBe(41);
  });

  it('at phase 0 the shift is clamped to 0 and every odd row blanks out', () => {
    // posun = (0-35)*5 = -175 -> clamped to 0. For each row i (bar the last),
    // source = i when i is even, else nothing.
    const t = frame();
    zpracujInterlaced(t, INTERLACED_START, WHITE);
    expect(rows(t)).toEqual([1, WHITE, 3, WHITE, 5, WHITE, 7, 8]);
  });

  it('the bottom rows fold over their own mirror image as the shift grows', () => {
    // posun = (36-35)*5 = 5: rows within 5 of the bottom take row i-(H-1-i).
    const t = frame();
    zpracujInterlaced(t, 36, WHITE);
    // i=7 -> src 7; i=6 -> src 5; i=5 -> src 3; i=4 -> src 1; i=3 -> src -1 (blank)
    expect(rows(t).slice(3)).toEqual([WHITE, 2, 4, 6, 8]);
  });

  it('clamps the shift to the frame height', () => {
    const t = frame();
    zpracujInterlaced(t, 500, WHITE); // posun = 2325, clamped to H-1 = 7
    // Every row folds onto its mirror (source = 2i-7); the top half has none.
    expect(rows(t)).toEqual([WHITE, WHITE, WHITE, WHITE, 2, 4, 6, 8]);
  });

  it('moves the rgba plane with the index plane', () => {
    const t = frame();
    zpracujInterlaced(t, INTERLACED_START, WHITE);
    for (let y = 0; y < H; y++) {
      expect(t.rgba[y * t.width * 4]).toBe(t.idx[y * t.width]);
    }
  });

  it('winds down from the stop phase straight to off', () => {
    expect(zpracujInterlaced(frame(), INTERLACED_STOP, WHITE)).toBe(INTERLACED_OFF);
  });

  it('fires the collapse sound exactly on the phase whose shift is -10', () => {
    expect(interlacedSounds(33)).toBe(true);
    expect([0, 30, 32, 34, 35, 40].some(interlacedSounds)).toBe(false);
  });
});

describe('sum (film grain)', () => {
  it('writes only inside the frame, and never on the outer edge', () => {
    const t = target(40, 30, () => 0);
    let n = 0;
    // A deterministic "random" that walks the whole 0..n-1 range.
    const rnd = (m) => (n = (n * 1103515245 + 12345) & 0x7fffffff) % m;
    for (let i = 0; i < 50; i++) sum(t, rnd);
    for (let x = 0; x < t.width; x++) {
      expect(t.idx[x]).toBe(0); // row 0 is excluded by the y>0 guard
    }
    for (let y = 0; y < t.height; y++) {
      expect(t.idx[y * t.width]).toBe(0); // column 0 excluded by the x>0 guard
    }
  });

  it('scratches at most 100 pixels per call', () => {
    const t = target(800, 600, () => 0);
    let seed = 7;
    const rnd = (m) => (seed = (seed * 48271) % 2147483647) % m;
    sum(t, rnd);
    const lit = t.idx.reduce((acc, v) => acc + (v !== 0 ? 1 : 0), 0);
    expect(lit).toBeGreaterThan(0);
    expect(lit).toBeLessThanOrEqual(100);
  });

  it('leaves the frame alone when every pixel it picks is off-screen', () => {
    const t = target(4, 4, () => 0);
    const rnd = (m) => m - 1; // always the far corner of the 800x600 sample field
    sum(t, rnd);
    expect([...t.idx]).toEqual(new Array(16).fill(0));
  });
});

describe('zcernobilit (silent-film tint)', () => {
  /** The Delphi formula, spelled out independently of the implementation. */
  function expected(r: number, g: number, b: number): [number, number, number] {
    const l = Math.min(255, (r * 0.4 + g * 0.5 + b * 0.1) * 1.2);
    return [Math.round(l), Math.round(l * 0.8), Math.round(l * 0.5)];
  }

  it('applies the 0.4/0.5/0.1 luminance, the 1.2 lift and the 1/0.8/0.5 tint', () => {
    const rgba = new Uint8Array([200, 100, 50, 255, 10, 20, 30, 255]);
    zcernobilit(rgba);
    expect([rgba[0], rgba[1], rgba[2]]).toEqual(expected(200, 100, 50));
    expect([rgba[4], rgba[5], rgba[6]]).toEqual(expected(10, 20, 30));
  });

  it('clamps the lifted luminance at 255 rather than wrapping', () => {
    const rgba = new Uint8Array([255, 255, 255, 255]);
    zcernobilit(rgba);
    expect(rgba[0]).toBe(255);
    expect(rgba[1]).toBe(204); // 255 * 0.8
    expect(rgba[2]).toBe(128); // 255 * 0.5, rounded
  });

  it('is warm sepia, not neutral grey — R > G > B for anything lit', () => {
    const rgba = new Uint8Array([120, 130, 140, 255]);
    zcernobilit(rgba);
    expect(rgba[0]).toBeGreaterThan(rgba[1]);
    expect(rgba[1]).toBeGreaterThan(rgba[2]);
  });

  it('leaves the alpha channel untouched', () => {
    const rgba = new Uint8Array([10, 20, 30, 123]);
    zcernobilit(rgba);
    expect(rgba[3]).toBe(123);
  });
});
