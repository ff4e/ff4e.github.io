/**
 * Scaling/layout maths for the public-release stage (Approach D, with the graded C
 * options — 'medium' is what ships as the default; see core/settings.ts).
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
  stageBoxCeiling,
  stageBoxWidth,
  STAGE_W,
  STAGE_H,
  STAGE_GAP,
  STAGE_EDGE,
  MAX_CONTENT_W,
  PANEL_NATIVE_W,
  PANEL_NATIVE_H,
  PANEL_FOOTPRINT_W,
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
    const l = computeStageLayout(4000, 3000, 'medium');
    expect(l.stageW).toBeCloseTo(l.boxW * l.scale, 5);
    expect(l.stageH).toBeCloseTo(STAGE_H * l.scale, 5);
    expect(l.panelW).toBeCloseTo(PANEL_NATIVE_W * l.scale, 5);
    expect(l.gap).toBeCloseTo(STAGE_GAP * l.scale, 5);
  });
});

/**
 * The elastic stage box (see stageBoxWidth). The room is centred in the box and the panel
 * sits BESIDE the box, so the box width — not the panel's position — is the only thing
 * that can enlarge a room whose fit is width-bound. These pin the three properties that
 * make that safe: it never shrinks, it never exceeds what the mode can use, and it is one
 * width shared by every room.
 */
describe('stageBoxWidth — the elastic stage box', () => {
  // 967x600 footprint => any viewport wider than 1.611:1 leaves width over.
  const wide = { w: 2048, h: 1017 }; // 2.01:1 — a maximised window on a 4K-scaled display
  const narrow = { w: 1512, h: 982 }; // 1.54:1 — a 16:10 laptop panel at true fullscreen
  const box = (v: { w: number; h: number }, mode: Parameters<typeof stageBoxWidth>[3]) =>
    computeStageLayout(v.w, v.h, mode).boxW;

  it('never goes below the old fixed width, at any viewport or mode', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of [
        [1, 1],
        [320, 240],
        [narrow.w, narrow.h],
        [wide.w, wide.h],
        [3440, 1400],
        [100000, 100],
      ] as const) {
        expect(computeStageLayout(w, h, mode).boxW).toBeGreaterThanOrEqual(STAGE_W);
      }
    }
  });

  it('gives a width-bound viewport exactly the old box (no slack to spend)', () => {
    // Narrower than the footprint's aspect: the scale is already limited by width.
    expect(box(narrow, 'medium')).toBe(STAGE_W);
    expect(computeStageScale(narrow.w, narrow.h)).toBeCloseTo(
      narrow.w / (STAGE_W + STAGE_GAP + PANEL_NATIVE_W),
      5,
    );
  });

  it('spends the leftover width of a height-bound viewport', () => {
    expect(box(wide, 'medium')).toBeGreaterThan(STAGE_W);
    // The scale itself is untouched — the box grows into width the scale declined to use,
    // so subtitle sizing (which reads stage.scale) cannot move.
    expect(computeStageScale(wide.w, wide.h)).toBeCloseTo(wide.h / STAGE_H, 5);
  });

  it('keeps the whole group inside the viewport, with the edge margin reserved', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of [
        [1512, 860],
        [wide.w, wide.h],
        [3440, 1400],
        [2560, 1380],
      ] as const) {
        const l = computeStageLayout(w, h, mode);
        const used = l.stageW + l.gap + l.panelW + 2 * STAGE_EDGE * l.scale;
        expect(used).toBeLessThanOrEqual(w + 1e-6);
      }
    }
  });

  it('never exceeds the width the mode can actually use', () => {
    for (const mode of FIT_MODES) {
      const ceiling = stageBoxCeiling(mode);
      // A viewport far wider than anything real, so only the ceiling can bind.
      const l = computeStageLayout(100000, 1200, mode);
      expect(l.boxW).toBeLessThanOrEqual(Math.max(STAGE_W, ceiling) + 1e-6);
    }
  });

  it('the ceiling is the point past which the widest room stops growing', () => {
    // medium: 795 x 1.35 = 1073. Beyond it the widest content is already at its bound.
    expect(stageBoxCeiling('medium')).toBeCloseTo(MAX_CONTENT_W * FIT_FACTORS.medium, 9);
    expect(stageBoxCeiling('large')).toBeCloseTo(MAX_CONTENT_W * FIT_FACTORS.large, 9);
    const stageScale = 2;
    const [w, h] = [795, 435]; // DRAKAR — the widest room, and width-bound in the old box
    const atCeiling = contentScale(w, h, stageScale, 'medium', 1, stageBoxCeiling('medium'));
    const wayPast = contentScale(w, h, stageScale, 'medium', 1, stageBoxCeiling('medium') * 4);
    expect(wayPast).toBeCloseTo(atCeiling, 9);
  });

  it("'fixed' never widens the box — a wider one cannot help it", () => {
    // contentScale === stageScale in 'fixed', so the box is irrelevant to it. Its bound
    // is 1, which lands below STAGE_W, so the floor wins — no special case needed.
    expect(stageBoxCeiling('fixed')).toBeLessThan(STAGE_W);
    expect(box(wide, 'fixed')).toBe(STAGE_W);
    const l = computeStageLayout(wide.w, wide.h, 'fixed');
    for (const [w, h] of ROOMS) {
      expect(contentScale(w, h, l.scale, 'fixed', 1, l.boxW)).toBe(l.scale);
    }
  });

  it('is one box that contains every room at a given viewport', () => {
    // The box takes no room argument, so "room-independent" is structural — what is
    // worth asserting is the consequence: ONE box, and every room fits inside that same
    // one. A box derived per room would let a room fill a box of its own and break the
    // containment that keeps rooms comparable in size (see the file header).
    for (const mode of FIT_MODES) {
      const l = computeStageLayout(wide.w, wide.h, mode);
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, l.scale, mode, 1, l.boxW);
        expect(w * s).toBeLessThanOrEqual(l.boxW * l.scale + 1e-6);
        expect(h * s).toBeLessThanOrEqual(STAGE_H * l.scale + 1e-6);
      }
    }
  });

  it('the ceiling never denies a crisp-integer mode a scale the viewport allows', () => {
    // NATIVE_TARGET is PHYSICAL px per game px; the box is native px and bounds `fill`,
    // a multiplier on stageScale. A native-px ceiling built from that target mixes units.
    // Regression case: 1600x500, dpr 1, 'x1', UTES 780x225 — a 936 box is available, and
    // 'x1' means exactly 1.0. A 795-based ceiling clamped the box to STAGE_W and gave
    // 0.855 instead.
    const l = computeStageLayout(1600, 500, 'x1');
    expect(contentScale(780, 225, l.scale, 'x1', 1, l.boxW)).toBeCloseTo(1, 9);
    for (const mode of ['native', 'x1', 'x2', 'x3', 'x4'] as const) {
      expect(stageBoxCeiling(mode)).toBe(Infinity);
    }
    // The graded modes keep a real ceiling — that is where a wider box genuinely stops
    // buying anything.
    expect(stageBoxCeiling('medium')).toBeCloseTo(MAX_CONTENT_W * FIT_FACTORS.medium, 9);
  });
});

/**
 * Touch mode retires the side panel, and the layout stops reserving its footprint.
 *
 * Two halves, and the first one is the important one: the mouse layout must be
 * bit-for-bit what it was, which is why `panel` defaults to true and is asserted to be a
 * no-op when passed explicitly. The second is the point of the change — 167 native px of
 * panel + gap go back to the room.
 */
describe('the panel footprint — retired in touch mode', () => {
  const VIEWPORTS = [
    [1512, 982], // a 16:10 laptop panel, width-bound
    [2048, 1017], // a wide window, height-bound
    [852, 393], // a phone in landscape
    [393, 852], // the same phone in portrait
    [3440, 1400],
  ] as const;

  it('is the panel plus the gap it travels with', () => {
    expect(PANEL_FOOTPRINT_W).toBe(STAGE_GAP + PANEL_NATIVE_W);
  });

  it('is reserved by default — the mouse layout cannot move', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of VIEWPORTS) {
        expect(computeStageLayout(w, h, mode, true)).toEqual(computeStageLayout(w, h, mode));
        expect(computeStageScale(w, h, true)).toBe(computeStageScale(w, h));
        const s = computeStageScale(w, h);
        expect(stageBoxWidth(w, h, s, mode, true)).toBe(stageBoxWidth(w, h, s, mode));
      }
    }
  });

  it('and the default is still the OLD footprint, rebuilt from the parts', () => {
    // The test above only proves the parameter defaults to `true`; it takes its
    // expectation from the same code it is testing, so it cannot fail if the footprint
    // itself changed. This one rebuilds the mouse numbers from `STAGE_GAP` and
    // `PANEL_NATIVE_W` — deliberately NOT from `PANEL_FOOTPRINT_W`, which is the term
    // under test. If you ever simplify this to use that constant, the guarantee the whole
    // touch series rests on stops being checked anywhere.
    for (const [w, h] of VIEWPORTS) {
      const expected = Math.max(
        MIN_STAGE_SCALE,
        Math.min(w / (STAGE_W + STAGE_GAP + PANEL_NATIVE_W), h / STAGE_H),
      );
      expect(computeStageScale(w, h)).toBeCloseTo(expected, 9);
      const l = computeStageLayout(w, h, 'medium');
      expect(l.panelW).toBeCloseTo(PANEL_NATIVE_W * expected, 9);
      expect(l.panelH).toBeCloseTo(PANEL_NATIVE_H * expected, 9);
      expect(l.gap).toBeCloseTo(STAGE_GAP * expected, 9);
    }
  });

  it('drops out of the width the scale has to fit', () => {
    // Width-bound BOTH ways (w/STAGE_W < h/STAGE_H), so the scale is exactly
    // availW / footprint and the footprint is the only thing that changed.
    const w = 1512;
    const h = 1200;
    expect(computeStageScale(w, h, true)).toBeCloseTo(w / (STAGE_W + PANEL_FOOTPRINT_W), 9);
    expect(computeStageScale(w, h, false)).toBeCloseTo(w / STAGE_W, 9);
  });

  it('leaves a height-bound viewport at the same scale, and widens its box instead', () => {
    const [w, h] = [2048, 1017] as const;
    expect(computeStageScale(w, h, false)).toBe(computeStageScale(w, h, true));
    // The scale declined to use that width, so it lands in the elastic box — up to the
    // mode's ceiling, past which nothing can use it.
    const withPanel = computeStageLayout(w, h, 'medium', true);
    const without = computeStageLayout(w, h, 'medium', false);
    expect(without.boxW).toBeGreaterThanOrEqual(withPanel.boxW);
  });

  it('never leaves the room with LESS space than the panel did', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of VIEWPORTS) {
        const withPanel = computeStageLayout(w, h, mode, true);
        const without = computeStageLayout(w, h, mode, false);
        expect(without.scale).toBeGreaterThanOrEqual(withPanel.scale - 1e-9);
        expect(without.boxW * without.scale).toBeGreaterThanOrEqual(
          withPanel.boxW * withPanel.scale - 1e-9,
        );
      }
    }
  });

  it('reports no panel and no gap to draw', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of VIEWPORTS) {
        const l = computeStageLayout(w, h, mode, false);
        expect(l.panelW).toBe(0);
        expect(l.panelH).toBe(0);
        expect(l.gap).toBe(0);
      }
    }
  });

  it('still keeps the group inside the viewport, with the edge margin reserved', () => {
    // Same invariant as the panelled case, and the same viewports: above the
    // MIN_STAGE_SCALE floor, where the maths — not the floor — decides the fit.
    for (const mode of FIT_MODES) {
      for (const [w, h] of [
        [1512, 860],
        [2048, 1017],
        [3440, 1400],
        [2560, 1380],
      ] as const) {
        const l = computeStageLayout(w, h, mode, false);
        const used = l.stageW + l.gap + l.panelW + 2 * STAGE_EDGE * l.scale;
        expect(used).toBeLessThanOrEqual(w + 1e-6);
      }
    }
  });

  it('does NOT fit a 393px phone in portrait — the floor is what is left over there', () => {
    // Retiring the panel is most of the phone-portrait clip, and deliberately not all of
    // it. Measured at 393x852, touch on: rooms overhang the viewport by 22-93px with the
    // panel and by at most 7px without it. The 7 are MIN_STAGE_SCALE, not the panel:
    // 393/800 = 0.491 is below the floor, so the scale is 0.5 whatever the width says,
    // and the logical box is 400 display px in a 393px viewport. Only a room wide enough
    // to fill the box pays it (795-native-wide ones do; KOSTE at 540 has 32px of slack).
    // Asserted so a change that makes it WORSE fails, and so the residual is written
    // down rather than remembered.
    const l = computeStageLayout(393, 786, 'medium', false);
    expect(l.scale).toBe(MIN_STAGE_SCALE);
    expect(l.stageW).toBeCloseTo(STAGE_W * MIN_STAGE_SCALE, 9);
    expect(l.stageW - 393).toBeCloseTo(7, 9);
    // With the panel it was very much worse — that part IS fixed.
    const panelled = computeStageLayout(393, 786, 'medium', true);
    expect(panelled.stageW + panelled.gap + panelled.panelW - 393).toBeGreaterThan(85);
  });
});

describe('contentScale — with an elastic box', () => {
  const stageScale = 2;
  const wider = 1000; // between STAGE_W and the 'medium' ceiling

  it('enlarges a width-bound room and leaves a height-bound one alone', () => {
    // UTES 780x225 is width-bound in the 800 box (800/780 = 1.026 < 600/225 = 2.67).
    const utesBefore = contentScale(780, 225, stageScale, 'medium', 1, STAGE_W);
    const utesAfter = contentScale(780, 225, stageScale, 'medium', 1, wider);
    expect(utesAfter).toBeGreaterThan(utesBefore);
    // VRAK 315x555 is height-bound; a wider box cannot help it.
    expect(contentScale(315, 555, stageScale, 'medium', 1, wider)).toBe(
      contentScale(315, 555, stageScale, 'medium', 1, STAGE_W),
    );
  });

  it('still never enlarges content past the box it was given', () => {
    for (const mode of ['small', 'medium', 'large', 'fill', 'native'] as const) {
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, stageScale, mode, 1, wider);
        expect(w * s).toBeLessThanOrEqual(wider * stageScale + 1e-6);
        expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
      }
    }
  });

  it('still respects the per-mode enlargement bound', () => {
    for (const [w, h] of ROOMS) {
      const f = contentScale(w, h, stageScale, 'medium', 1, wider) / stageScale;
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(CAPPED_MAX + 1e-9);
    }
  });

  it('defaults to the old fixed box when no box is passed', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of ROOMS) {
        expect(contentScale(w, h, stageScale, mode)).toBe(
          contentScale(w, h, stageScale, mode, 1, STAGE_W),
        );
      }
    }
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
