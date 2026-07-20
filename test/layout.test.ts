/**
 * Scaling/layout maths for the public-release stage (Approach D default, C options).
 * Pure functions — verifies the two invariants that drove the design decision:
 *   - 'fixed' (D): every room gets an IDENTICAL on-screen object scale.
 *   - graded fits (C): small-room enlargement is bounded per mode (never unbounded
 *     like a raw fit), except 'fill' which grows to exactly fill the stage box.
 */
import { describe, it, expect } from 'vitest';
import {
  computeStageScale,
  computeStageLayout,
  contentScale,
  STAGE_W,
  STAGE_H,
  STAGE_GAP,
  PANEL_NATIVE_W,
  CAPPED_MAX,
  FIT_FACTORS,
  FIT_MODES,
  isFitMode,
  MIN_STAGE_SCALE,
} from '../src/app/layout.js';

// A representative spread of real room sizes (measured across the 72 rooms).
const ROOMS: ReadonlyArray<[number, number]> = [
  [360, 210], // MIKRO — smallest
  [600, 450],
  [600, 525],
  [720, 555],
  [795, 585], // PUCLIK — largest
];

describe('computeStageScale', () => {
  it('fits stage box + gap + panel into the available width', () => {
    const footprintW = STAGE_W + STAGE_GAP + PANEL_NATIVE_W;
    // Width-limited viewport: scale is availW / footprintW.
    const s = computeStageScale(footprintW * 2, 100000);
    expect(s).toBeCloseTo(2, 5);
  });

  it('is height-limited on a tall narrow viewport', () => {
    const s = computeStageScale(100000, STAGE_H * 3);
    expect(s).toBeCloseTo(3, 5);
  });

  it('never collapses below the floor on a tiny viewport', () => {
    expect(computeStageScale(1, 1)).toBe(MIN_STAGE_SCALE);
    expect(computeStageScale(0, 0)).toBe(MIN_STAGE_SCALE);
  });
});

describe('computeStageLayout', () => {
  it('derives panel + stage display sizes from one scale', () => {
    const l = computeStageLayout(4000, 3000);
    expect(l.stageW).toBeCloseTo(STAGE_W * l.scale, 5);
    expect(l.stageH).toBeCloseTo(STAGE_H * l.scale, 5);
    expect(l.panelW).toBeCloseTo(PANEL_NATIVE_W * l.scale, 5);
    expect(l.gap).toBeCloseTo(STAGE_GAP * l.scale, 5);
  });
});

describe('contentScale — fixed (Approach D)', () => {
  it('gives every room an identical object scale', () => {
    const stageScale = 2.5;
    const scales = ROOMS.map(([w, h]) => contentScale(w, h, stageScale, 'fixed'));
    for (const s of scales) expect(s).toBe(stageScale);
  });

  it('keeps every room within the stage box', () => {
    const stageScale = 2.5;
    for (const [w, h] of ROOMS) {
      const s = contentScale(w, h, stageScale, 'fixed');
      expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });
});

describe('contentScale — capped (Approach C, medium)', () => {
  it('enlarges small rooms but bounds the variance', () => {
    const stageScale = 2;
    const factors = ROOMS.map(([w, h]) => contentScale(w, h, stageScale, 'medium') / stageScale);
    for (const f of factors) {
      expect(f).toBeGreaterThanOrEqual(1); // never smaller than fixed
      expect(f).toBeLessThanOrEqual(CAPPED_MAX + 1e-9); // bounded enlargement
    }
    // The smallest room is enlarged to the cap; the largest stays ~fixed.
    expect(factors[0]).toBeCloseTo(CAPPED_MAX, 5);
    expect(factors[factors.length - 1]).toBeCloseTo(1, 1);
  });

  it('never enlarges content past the stage box', () => {
    const stageScale = 2;
    for (const [w, h] of ROOMS) {
      const s = contentScale(w, h, stageScale, 'medium');
      expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });
});

describe('contentScale — graded fit modes', () => {
  it('the smallest room grows monotonically with the fit level', () => {
    const stageScale = 2;
    const [w, h] = ROOMS[0]; // MIKRO — smallest, so it hits every cap
    const modes = ['fixed', 'small', 'medium', 'large', 'fill'] as const;
    const scales = modes.map((m) => contentScale(w, h, stageScale, m));
    for (let i = 1; i < scales.length; i++) {
      expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1]);
    }
    // 'fixed' is faithful; each step enlarges by exactly its FIT_FACTOR (small room
    // never reaches the grow-to-fill ceiling for the bounded steps).
    expect(scales[0]).toBe(stageScale);
    expect(scales[1]).toBeCloseTo(stageScale * FIT_FACTORS.small, 5);
    expect(scales[2]).toBeCloseTo(stageScale * FIT_FACTORS.medium, 5);
    expect(scales[3]).toBeCloseTo(stageScale * FIT_FACTORS.large, 5);
  });

  it("'fill' grows small content to exactly fill the stage box", () => {
    const stageScale = 2;
    const [w, h] = ROOMS[0];
    const s = contentScale(w, h, stageScale, 'fill');
    // Content touches (at least) one edge of the box and never overflows it.
    const wFrac = (w * s) / (STAGE_W * stageScale);
    const hFrac = (h * s) / (STAGE_H * stageScale);
    expect(Math.max(wFrac, hFrac)).toBeCloseTo(1, 5);
    expect(wFrac).toBeLessThanOrEqual(1 + 1e-9);
    expect(hFrac).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('never enlarges any room past the stage box, in any mode', () => {
    const stageScale = 2;
    const modes = ['small', 'medium', 'large', 'fill'] as const;
    for (const m of modes) {
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, stageScale, m);
        expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
        expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
      }
    }
  });
});

describe('contentScale — native (crisp integer)', () => {
  it('returns a whole-number scale that fits the stage box', () => {
    const stageScale = 2.5;
    for (const [w, h] of ROOMS) {
      const s = contentScale(w, h, stageScale, 'native');
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });

  it('is the largest integer ≤ the fill scale (no fractional upscaling)', () => {
    const stageScale = 2;
    for (const [w, h] of ROOMS) {
      const fill = contentScale(w, h, stageScale, 'fill'); // exact grow-to-fill scale
      const native = contentScale(w, h, stageScale, 'native');
      expect(native).toBe(Math.floor(fill));
      // one more step would overflow the box
      expect((native + 1) * Math.max(w / STAGE_W, h / STAGE_H)).toBeGreaterThan(stageScale);
    }
  });

  it('a small room reaches a higher integer scale than a large one', () => {
    const stageScale = 2;
    const small = contentScale(...ROOMS[0], stageScale, 'native');
    const large = contentScale(...ROOMS[ROOMS.length - 1], stageScale, 'native');
    expect(small).toBeGreaterThanOrEqual(large);
  });

  it('falls back to the fitting scale when even 1× would overflow (tiny viewport)', () => {
    const stageScale = MIN_STAGE_SCALE; // 0.5 — box is smaller than the largest room at 1×
    const [w, h] = ROOMS[ROOMS.length - 1]; // largest room
    const s = contentScale(w, h, stageScale, 'native');
    // No integer fits, so it degrades to the exact fitting scale (< 1) rather than clipping.
    expect(s).toBeLessThan(1);
    expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
    expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
  });

  it('dpr defaults to 1 → plain floor of the fill scale (unchanged behaviour)', () => {
    const stageScale = 2.5;
    for (const [w, h] of ROOMS) {
      const withoutDpr = contentScale(w, h, stageScale, 'native');
      const withDpr1 = contentScale(w, h, stageScale, 'native', 1);
      expect(withDpr1).toBe(withoutDpr);
      expect(Number.isInteger(withDpr1)).toBe(true);
    }
  });

  it('device-pixel-perfect: scale×dpr is always a whole number and fits the box', () => {
    const stageScale = 2.5;
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, stageScale, 'native', dpr);
        // Each game pixel maps to a whole number of PHYSICAL pixels.
        expect(Math.abs(s * dpr - Math.round(s * dpr))).toBeLessThan(1e-9);
        expect(s).toBeGreaterThan(0);
        expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
        expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
      }
    }
  });

  it('a fractional dpr unlocks intermediate CSS scales (finer than integer steps)', () => {
    const stageScale = 2;
    for (const [w, h] of ROOMS) {
      const fill = contentScale(w, h, stageScale, 'fill'); // exact grow-to-fill CSS scale
      const dpr = 2;
      const s = contentScale(w, h, stageScale, 'native', dpr);
      // k = largest integer physical-px-per-game-px; s = k/dpr.
      const k = Math.floor(fill * dpr);
      expect(s).toBeCloseTo(k >= 1 ? k / dpr : fill, 9);
      // At dpr 2 the native scale is at least as large as the dpr=1 (integer) scale.
      expect(s).toBeGreaterThanOrEqual(contentScale(w, h, stageScale, 'native', 1) - 1e-9);
    }
  });
});

describe('contentScale — fixed integer scales (x1…x4)', () => {
  const stageScale = 3; // roomy stage so several integer multiples fit

  it('xN renders each game pixel as exactly N physical pixels (when it fits)', () => {
    for (const dpr of [1, 1.5, 2]) {
      for (const [n, mode] of [
        [1, 'x1'],
        [2, 'x2'],
        [3, 'x3'],
      ] as const) {
        const [w, h] = ROOMS[0]; // smallest room — all these multiples fit
        const s = contentScale(w, h, stageScale, mode, dpr);
        expect(s * dpr).toBeCloseTo(n, 9); // N whole physical px per game px
      }
    }
  });

  it('xN is capped so it never overflows the stage box (falls back to native max)', () => {
    for (const [w, h] of ROOMS) {
      const nativeMax = contentScale(w, h, stageScale, 'native'); // largest that fits
      // A very large request (x4) can never exceed what the box allows.
      const x4 = contentScale(w, h, stageScale, 'x4');
      expect(x4).toBeLessThanOrEqual(nativeMax + 1e-9);
      expect(w * x4).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * x4).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });

  it('the integer choices are ordered x1 ≤ x2 ≤ x3 ≤ x4 (each ≤ native)', () => {
    for (const [w, h] of ROOMS) {
      const [a, b, c, d] = (['x1', 'x2', 'x3', 'x4'] as const).map((m) =>
        contentScale(w, h, stageScale, m),
      );
      const native = contentScale(w, h, stageScale, 'native');
      expect(a).toBeLessThanOrEqual(b + 1e-9);
      expect(b).toBeLessThanOrEqual(c + 1e-9);
      expect(c).toBeLessThanOrEqual(d + 1e-9);
      expect(d).toBeLessThanOrEqual(native + 1e-9);
    }
  });

  it('isFitMode accepts every mode in the dropdown and rejects junk', () => {
    for (const m of FIT_MODES) expect(isFitMode(m)).toBe(true);
    for (const bad of ['capped', 'x5', 'x0', '', 'NATIVE', 42, null, undefined]) {
      expect(isFitMode(bad)).toBe(false);
    }
  });
});
