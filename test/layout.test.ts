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
  effectiveFitMode,
  STAGE_W,
  STAGE_H,
  STAGE_GAP,
  VIEWPORT_MARGIN,
  MAX_CELL_PX,
  MAX_CELL_PX_TOUCH,
  CELL_NATIVE,
  PANEL_NATIVE_W,
  PANEL_NATIVE_H,
  PANEL_FOOTPRINT_W,
  FIT_FACTORS,
  FIT_MODES,
  isFitMode,
  MIN_STAGE_SCALE,
} from '../src/app/layout.js';

/**
 * The old fixed 800x600 stage box, expressed as an AREA in display px at `stageScale`.
 *
 * `contentScale` used to default its last two arguments to `STAGE_W`/`STAGE_H` in native
 * px; it now takes the content's real area in display px and has no default, because a
 * caller that took the old one was silently scaling against an area that did not exist.
 * The tests below that mean "bounded by the stage box" say so through this, so they keep
 * asserting exactly what they always did.
 */
const boxArea = (stageScale: number): [number, number] => [STAGE_W * stageScale, STAGE_H * stageScale];
/** `contentScale` against that box — the shape most of these tests were written in. */
const cs = (w: number, h: number, stageScale: number, mode: FitMode, dpr = 1): number =>
  contentScale(w, h, stageScale, mode, dpr, ...boxArea(stageScale));
/**
 * The same, with the cell ceiling lifted (`MAX_CELL_PX`).
 *
 * The crisp-integer tests below use `fill` as a stand-in for "the exact grow-to-fill scale",
 * which is a property of the AREA and has nothing to do with the ceiling; leaving the
 * ceiling on would have them comparing an integer scale against a bounded reference and
 * failing for a reason that is not about integers at all.
 */
const csUncapped = (w: number, h: number, stageScale: number, mode: FitMode, dpr = 1): number =>
  contentScale(w, h, stageScale, mode, dpr, ...boxArea(stageScale), Infinity);

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

  it('never collapses to nothing on a tiny viewport', () => {
    // The floor is `min(MIN_STAGE_SCALE, availW / footprintW)`: 0.5 unless the viewport is
    // narrower than the box itself, where a smaller game beats a clipped one (see
    // computeStageScale). So a 1x1 viewport no longer reports 0.5 — but it is still
    // positive and finite, which is all anything downstream needs of it.
    const tiny = computeStageScale(1, 1);
    expect(tiny).toBeGreaterThan(0);
    expect(Number.isFinite(tiny)).toBe(true);
    // A viewport wide enough for the box at 0.5 still gets the floor, however short.
    expect(computeStageScale(2000, 1)).toBe(MIN_STAGE_SCALE);
    expect(computeStageScale(0, 0)).toBe(MIN_STAGE_SCALE);
  });
});

describe('computeStageLayout', () => {
  it('derives panel + area display sizes from one scale', () => {
    const l = computeStageLayout(4000, 3000, 'medium');
    expect(l.stageW).toBeCloseTo(l.availW, 9);
    expect(l.stageH).toBeCloseTo(l.availH, 9);
    expect(l.panelW).toBeCloseTo(PANEL_NATIVE_W * l.scale, 5);
    expect(l.panelH).toBeCloseTo(PANEL_NATIVE_H * l.scale, 5);
    expect(l.gap).toBeCloseTo(STAGE_GAP * l.scale, 5);
  });
});

/**
 * The CONTENT AREA — what replaced the elastic stage box.
 *
 * The box was `max(STAGE_W/H, avail/scale - margin)` in NATIVE px, and its floor is what
 * made it larger than the space it sat in on a small viewport, so a room that filled it ran
 * off the screen. `stage.availW/availH` is the real area in DISPLAY px, and `contentScale`
 * may never exceed it. These pin that, and the properties that follow from it — each one
 * chosen because a defect that shipped violated it, or because a doc comment asserted it
 * and nothing tested it.
 */
describe('the content area, and the properties it buys', () => {
  /** A spread that reaches BELOW the 800x600 box on both axes, where the old floors bound. */
  const VIEWPORTS = [
    [240, 200],
    [393, 852],
    [669, 280], // the room-sliced defect
    [852, 393],
    [1180, 820],
    [1491, 1114], // the held-reserve defect
    [1557, 1114], // ... and the width at which it used to vanish
    [1512, 860],
    [2048, 1017],
    [3440, 1400],
  ] as const;

  it('is the viewport minus the margin and the panel column, in display px', () => {
    for (const panel of [true, false]) {
      for (const [w, h] of VIEWPORTS) {
        const l = computeStageLayout(w, h, 'medium', panel);
        expect(l.availW).toBeCloseTo(w - 2 * VIEWPORT_MARGIN - l.gap - l.panelW, 9);
        expect(l.availH).toBeCloseTo(h - 2 * VIEWPORT_MARGIN, 9);
        // The DOM box IS the area — that is what lets `#stagebox`'s `overflow: hidden`
        // stop being something the layout has to stay ahead of.
        expect(l.stageW).toBeCloseTo(l.availW, 9);
        expect(l.stageH).toBeCloseTo(l.availH, 9);
      }
    }
  });

  it('never lets any room be drawn past it, in any mode — the 669x280 defect', () => {
    // ZRC 555x225 at 669x280 was drawn 266px tall into 214px of space, so 52px of the level
    // was not on screen. Asserted for every room, mode and viewport rather than for that
    // one case, because the one case is how it was found and not what was wrong.
    for (const mode of FIT_MODES) {
      for (const panel of [true, false]) {
        for (const [w, h] of VIEWPORTS) {
          const l = computeStageLayout(w, h, mode, panel);
          for (const [rw, rh] of ROOMS) {
            const s = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH);
            expect(s * rw).toBeLessThanOrEqual(l.availW + 1e-6);
            expect(s * rh).toBeLessThanOrEqual(l.availH + 1e-6);
          }
        }
      }
    }
  });

  it('is the whole of the scaling: the mode, the fit, and the cell ceiling', () => {
    // The model, restated independently of the implementation. If this ever needs another
    // term, the file's opening sentence has changed and the change should be argued there.
    for (const mode of ['fixed', 'small', 'medium', 'large', 'fill'] as const) {
      for (const [w, h] of VIEWPORTS) {
        const l = computeStageLayout(w, h, mode);
        for (const [rw, rh] of ROOMS) {
          const fit = Math.min(l.availW / rw, l.availH / rh);
          const base = Math.min(l.scale, fit); // what 'fixed' gives
          const want =
            FIT_FACTORS[mode] <= 1
              ? base
              : Math.max(base, Math.min(l.scale * FIT_FACTORS[mode], fit, MAX_CELL_PX / CELL_NATIVE));
          expect(contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH)).toBeCloseTo(want, 9);
        }
      }
    }
  });

  it('lifting the ceiling restores the plain two-term model', () => {
    // The ceiling is the only thing between `min(stageScale x factor, fitScale)` and what
    // ships, so passing Infinity has to give exactly the old expression back — which is what
    // makes it a bound bolted on top rather than a change to the model underneath.
    for (const mode of ['fixed', 'small', 'medium', 'large', 'fill'] as const) {
      for (const [w, h] of VIEWPORTS) {
        const l = computeStageLayout(w, h, mode);
        for (const [rw, rh] of ROOMS) {
          const fit = Math.min(l.availW / rw, l.availH / rh);
          const want = Math.min(l.scale * FIT_FACTORS[mode], fit);
          expect(
            contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, Infinity),
          ).toBeCloseTo(want, 9);
        }
      }
    }
  });

  it('a bigger viewport never gives a smaller room — except the panel case', () => {
    // Martin's requirement (2026-08-31). The old reserve was 12 NATIVE px, so it cost
    // `12 x stageScale` and grew faster than the space it took from: widening 301 -> 456 at
    // height 300 shrank VRAK by 1.59%. In CSS px the property holds by construction.
    //
    // The exception is real and accepted (see layout.ts's header): on the PANELLED layout a
    // taller window widens the panel, which can cost a width-bound room up to 4.4% in the
    // default mode. It is an impossibility, not an oversight — so it is asserted to be
    // confined to that case rather than asserted away.
    for (const mode of ['medium', 'fill'] as const) {
      for (const [rw, rh] of ROOMS) {
        for (let w = 300; w <= 2000; w += 37) {
          for (let h = 220; h <= 1200; h += 41) {
            const at = (vw: number, vh: number) => {
              const l = computeStageLayout(vw, vh, mode, false);
              return contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
            };
            const here = at(w, h);
            expect(at(w + 1, h)).toBeGreaterThanOrEqual(here - 1e-9);
            expect(at(w, h + 1)).toBeGreaterThanOrEqual(here - 1e-9);
          }
        }
      }
    }
  });

  it('the panel exception is only ever on the HEIGHT axis, and only with a panel', () => {
    let sawIt = false;
    for (const [rw, rh] of ROOMS) {
      for (let w = 400; w <= 2400; w += 53) {
        for (let h = 240; h <= 1400; h += 47) {
          const at = (vw: number, vh: number) => {
            const l = computeStageLayout(vw, vh, 'fill', true);
            return contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH);
          };
          const here = at(w, h);
          // Widening is monotone even with the panel — the panel grows with the width, but
          // so does the row, and the room's share of it never falls.
          expect(at(w + 1, h)).toBeGreaterThanOrEqual(here - 1e-9);
          if (at(w, h + 1) < here - 1e-9) sawIt = true;
        }
      }
    }
    // Pinned as PRESENT, not absent: if a later change removes it, this test should be the
    // thing that says so rather than a comment quietly going stale.
    expect(sawIt).toBe(true);
  });

  it('holds the reserve equally at every viewport, or not at all', () => {
    // The 1491-vs-1557 defect: `stageBoxHeight`'s `max` picked its STAGE_H floor and the
    // margin stopped being subtracted, so the reserve was 21px per side at 1491 and 0 at
    // 1557. In CSS px there is no floor to fall off.
    for (const [w, h] of VIEWPORTS) {
      const l = computeStageLayout(w, h, 'fill', false);
      expect(w - l.availW).toBeCloseTo(2 * VIEWPORT_MARGIN, 9);
      expect(h - l.availH).toBeCloseTo(2 * VIEWPORT_MARGIN, 9);
    }
    // And it moves when asked, which is what a TV's title-safe inset needs.
    const safe = computeStageLayout(1920, 1080, 'fill', false, 27);
    expect(safe.availW).toBeCloseTo(1920 - 54, 9);
    expect(safe.availH).toBeCloseTo(1080 - 54, 9);
  });

  it('is one area for every room — the box invariant, kept', () => {
    // The point of the old fixed box was that it did not depend on the room. Neither does
    // this: `computeStageLayout` never sees a room, so the object-size reference and the
    // area are both room-independent and only `fitScale` varies.
    for (const [w, h] of VIEWPORTS) {
      const l = computeStageLayout(w, h, 'medium');
      for (const [rw, rh] of ROOMS) {
        const again = computeStageLayout(w, h, 'medium');
        expect(again.availW).toBe(l.availW);
        expect(again.availH).toBe(l.availH);
        expect(again.scale).toBe(l.scale);
        expect(rw * rh).toBeGreaterThan(0); // the room is an input to nothing here
      }
    }
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
      const footprint = STAGE_W + STAGE_GAP + PANEL_NATIVE_W;
      const expected = Math.max(
        Math.min(MIN_STAGE_SCALE, w / footprint),
        Math.min(w / footprint, h / STAGE_H),
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

  it('leaves a height-bound viewport at the same scale, and gives the room the width', () => {
    const [w, h] = [2048, 1017] as const;
    expect(computeStageScale(w, h, false)).toBe(computeStageScale(w, h, true));
    // The scale had already declined to use that width, so retiring the panel cannot raise
    // it — the 167 native px go to the CONTENT'S AREA instead, which is the only thing that
    // can enlarge a room whose fit is width-bound.
    const withPanel = computeStageLayout(w, h, 'medium', true);
    const without = computeStageLayout(w, h, 'medium', false);
    expect(without.scale).toBe(withPanel.scale);
    expect(without.availW - withPanel.availW).toBeCloseTo(PANEL_FOOTPRINT_W * without.scale, 9);
  });

  it('never leaves the room with LESS space than the panel did', () => {
    for (const mode of FIT_MODES) {
      for (const [w, h] of VIEWPORTS) {
        const withPanel = computeStageLayout(w, h, mode, true);
        const without = computeStageLayout(w, h, mode, false);
        expect(without.scale).toBeGreaterThanOrEqual(withPanel.scale - 1e-9);
        expect(without.availW).toBeGreaterThanOrEqual(withPanel.availW - 1e-9);
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
        // The reserve is a CSS-px constant taken off the viewport, so this is an equality
        // rather than the old inequality — which restated the formula with the constant on
        // both sides and so could not tell a good value from a bad one.
        expect(l.stageW + l.gap + l.panelW + 2 * VIEWPORT_MARGIN).toBeCloseTo(w, 9);
      }
    }
  });

  it('and now FITS a 393px phone in portrait — the floor no longer overruns the width', () => {
    // Retiring the panel was most of the phone-portrait clip and deliberately not all of
    // it: 393/800 = 0.491 is below MIN_STAGE_SCALE, so the scale was 0.5 whatever the
    // width said, the logical box was 400 display px in a 393px viewport, and a room wide
    // enough to fill it was cut by 7px. The floor now yields to the width
    // (`computeStageScale`), because clipping a room is not a smaller evil than shrinking
    // it by 1.8%. Asserted as an equality: the box is the viewport, to the pixel.
    const l = computeStageLayout(393, 786, 'medium', false);
    expect(l.scale).toBeLessThan(MIN_STAGE_SCALE);
    expect(l.scale).toBeCloseTo(393 / STAGE_W, 9);
    expect(l.stageW).toBeCloseTo(393, 9);
    // With the panel the row now fits too — the floor was overrunning that case as well —
    // but it costs the room 167 native px, which is the whole reason touch retires it.
    const panelled = computeStageLayout(393, 786, 'medium', true);
    expect(panelled.stageW + panelled.gap + panelled.panelW).toBeLessThanOrEqual(393 + 1e-6);
    expect(panelled.scale).toBeLessThan(l.scale);
    expect(l.stageW - panelled.stageW).toBeGreaterThan(60);
  });

  it('keeps the floor everywhere it was not the width that was short', () => {
    // The floor's job — a small window shows a usable game rather than collapsing — is
    // unchanged; only the case where honouring it put the box OUTSIDE the viewport moved.
    // A short, wide window still floors at 0.5 and still letterboxes.
    expect(computeStageScale(1500, 200, false)).toBe(MIN_STAGE_SCALE);
    expect(computeStageScale(0, 0)).toBe(MIN_STAGE_SCALE);
    for (const [w, h] of VIEWPORTS) {
      // Every room the game has, on every viewport in this list: nothing is ever drawn
      // wider than the viewport, which is the property the 7px violated.
      const l = computeStageLayout(w, h, 'medium', false);
      expect(l.stageW).toBeLessThanOrEqual(w + 1e-6);
    }
  });
});

/**
 * Touch takes every pixel: the fit mode is a desktop control, so on a phone the stored
 * value is a setting the player cannot see. See `effectiveFitMode`.
 */
describe('effectiveFitMode — touch is always fill', () => {
  it('leaves the mouse game on the player’s own mode', () => {
    for (const mode of FIT_MODES) {
      expect(effectiveFitMode(mode, true)).toBe(mode);
      expect(effectiveFitMode(mode)).toBe(mode); // the default is the mouse
    }
  });

  it('overrides every mode to fill when there is no panel', () => {
    for (const mode of FIT_MODES) {
      expect(effectiveFitMode(mode, false)).toBe('fill');
    }
  });

  it('is what the layout reports, and what the content must be scaled by', () => {
    for (const mode of FIT_MODES) {
      expect(computeStageLayout(1600, 1017, mode, true).mode).toBe(mode);
      const touch = computeStageLayout(638, 1310, mode, false);
      expect(touch.mode).toBe('fill');
      // Carrying it is the whole point: `contentScaleFor` reads `stage.mode`, and scaling
      // the content by the raw setting while the layout was sized by the effective one is
      // how the two would disagree. Every requested mode lands on the same layout here.
      const asFill = computeStageLayout(638, 1310, 'fill', false);
      expect(touch.availW).toBe(asFill.availW);
      expect(touch.availH).toBe(asFill.availH);
      expect(touch.scale).toBe(asFill.scale);
    }
  });

  it('puts every room at the largest scale a portrait phone allows', () => {
    // The defect this series is about: at 638x1310 the box was 638x479 of a 638x1310 area
    // and 'medium'/'large'/'fill' were bit-identical, so the setting did nothing at all.
    for (const [vw, vh] of [
      [638, 1310],
      [393, 786],
    ] as const) {
      const l = computeStageLayout(vw, vh, 'medium', false);
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, l.scale, l.mode, 1, l.availW, l.availH);
        expect(s).toBeCloseTo(Math.min(l.availW / w, l.availH / h), 9);
      }
    }
  });
});

/**
 * The same three questions the elastic box was asked, now asked of the AREA.
 *
 * They are kept because they are still the right questions — does more room enlarge a
 * width-bound room, does it leave a height-bound one alone, is the per-mode bound still
 * honoured — but the quantity has changed unit, from a native-px box to display px of
 * actual space, so the numbers are written in display px throughout.
 */
describe('contentScale — against the content area', () => {
  const stageScale = 2;
  const [boxW, boxH] = [STAGE_W * stageScale, STAGE_H * stageScale]; // the old box, in display px
  const wider = 1000 * stageScale; // more width than the box had

  it('enlarges a width-bound room and leaves a height-bound one alone', () => {
    // UTES 780x225 is width-bound in the 800 box (800/780 = 1.026 < 600/225 = 2.67).
    // The ceiling is lifted: this is about whether more AREA enlarges the room, and at this
    // hand-picked stageScale of 2 a cell is 30px, so MAX_CELL_PX would mask the answer.
    const utesBefore = contentScale(780, 225, stageScale, 'medium', 1, boxW, boxH, Infinity);
    const utesAfter = contentScale(780, 225, stageScale, 'medium', 1, wider, boxH, Infinity);
    expect(utesAfter).toBeGreaterThan(utesBefore);
    // VRAK 315x555 is height-bound; more width cannot help it.
    expect(contentScale(315, 555, stageScale, 'medium', 1, wider, boxH, Infinity)).toBe(
      contentScale(315, 555, stageScale, 'medium', 1, boxW, boxH, Infinity),
    );
  });

  it('never enlarges content past the area it was given', () => {
    for (const mode of ['small', 'medium', 'large', 'fill', 'native'] as const) {
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, stageScale, mode, 1, wider, boxH);
        expect(w * s).toBeLessThanOrEqual(wider + 1e-6);
        expect(h * s).toBeLessThanOrEqual(boxH + 1e-6);
      }
    }
  });

  it('still respects the per-mode enlargement bound', () => {
    for (const [w, h] of ROOMS) {
      const f = contentScale(w, h, stageScale, 'medium', 1, wider, boxH) / stageScale;
      expect(f).toBeGreaterThanOrEqual(1);
      expect(f).toBeLessThanOrEqual(FIT_FACTORS.medium + 1e-9);
    }
  });

  it('shrinks content that does not fit, in every mode — including fixed', () => {
    // The term the elastic box had no expression for. `fixed` used to return `stageScale`
    // unconditionally, so on an area too small to letterbox into it drew the room off the
    // screen rather than smaller.
    const tightW = 500;
    const tightH = 300;
    for (const mode of FIT_MODES) {
      for (const [w, h] of ROOMS) {
        const s = contentScale(w, h, stageScale, mode, 1, tightW, tightH);
        expect(w * s).toBeLessThanOrEqual(tightW + 1e-6);
        expect(h * s).toBeLessThanOrEqual(tightH + 1e-6);
      }
    }
    expect(contentScale(795, 585, stageScale, 'fixed', 1, tightW, tightH)).toBeLessThan(stageScale);
  });
});

/**
 * The four `describe`s below pin the ENLARGEMENT rule, at a hand-picked `stageScale` of 2 —
 * where one cell is 30px and `MAX_CELL_PX` would bind. They predate the ceiling and are not
 * about it, so they lift it; the ceiling has its own `describe` at the end of the file.
 */
describe('contentScale — fixed (Approach D)', () => {
  it('gives every room an identical object scale', () => {
    const stageScale = 2.5;
    const scales = ROOMS.map(([w, h]) => cs(w, h, stageScale, 'fixed'));
    for (const s of scales) expect(s).toBe(stageScale);
  });

  it('keeps every room within the stage box', () => {
    const stageScale = 2.5;
    for (const [w, h] of ROOMS) {
      const s = cs(w, h, stageScale, 'fixed');
      expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });
});

describe('contentScale — capped (Approach C, medium)', () => {
  it('enlarges small rooms but bounds the variance', () => {
    const stageScale = 2;
    const factors = ROOMS.map(([w, h]) => csUncapped(w, h, stageScale, 'medium') / stageScale);
    for (const f of factors) {
      expect(f).toBeGreaterThanOrEqual(1); // never smaller than fixed
      expect(f).toBeLessThanOrEqual(FIT_FACTORS.medium + 1e-9); // bounded enlargement
    }
    // The smallest room is enlarged to the cap; the largest stays ~fixed.
    expect(factors[0]).toBeCloseTo(FIT_FACTORS.medium, 5);
    expect(factors[factors.length - 1]).toBeCloseTo(1, 1);
  });

  it('never enlarges content past the stage box', () => {
    const stageScale = 2;
    for (const [w, h] of ROOMS) {
      const s = cs(w, h, stageScale, 'medium');
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
    const scales = modes.map((m) => csUncapped(w, h, stageScale, m));
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
    const s = csUncapped(w, h, stageScale, 'fill');
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
        const s = cs(w, h, stageScale, m);
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
      const s = cs(w, h, stageScale, 'native');
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(1);
      expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });

  it('is the largest integer ≤ the fill scale (no fractional upscaling)', () => {
    const stageScale = 2;
    for (const [w, h] of ROOMS) {
      const fill = csUncapped(w, h, stageScale, 'fill'); // exact grow-to-fill scale
      const native = cs(w, h, stageScale, 'native');
      expect(native).toBe(Math.floor(fill));
      // one more step would overflow the box
      expect((native + 1) * Math.max(w / STAGE_W, h / STAGE_H)).toBeGreaterThan(stageScale);
    }
  });

  it('a small room reaches a higher integer scale than a large one', () => {
    const stageScale = 2;
    const small = cs(...ROOMS[0], stageScale, 'native');
    const large = cs(...ROOMS[ROOMS.length - 1], stageScale, 'native');
    expect(small).toBeGreaterThanOrEqual(large);
  });

  it('falls back to the fitting scale when even 1× would overflow (tiny viewport)', () => {
    const stageScale = MIN_STAGE_SCALE; // 0.5 — box is smaller than the largest room at 1×
    const [w, h] = ROOMS[ROOMS.length - 1]; // largest room
    const s = cs(w, h, stageScale, 'native');
    // No integer fits, so it degrades to the exact fitting scale (< 1) rather than clipping.
    expect(s).toBeLessThan(1);
    expect(w * s).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
    expect(h * s).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
  });

  it('dpr defaults to 1 → plain floor of the fill scale (unchanged behaviour)', () => {
    const stageScale = 2.5;
    for (const [w, h] of ROOMS) {
      const withoutDpr = cs(w, h, stageScale, 'native');
      const withDpr1 = cs(w, h, stageScale, 'native', 1);
      expect(withDpr1).toBe(withoutDpr);
      expect(Number.isInteger(withDpr1)).toBe(true);
    }
  });

  it('device-pixel-perfect: scale×dpr is always a whole number and fits the box', () => {
    const stageScale = 2.5;
    for (const dpr of [1, 1.25, 1.5, 2, 3]) {
      for (const [w, h] of ROOMS) {
        const s = cs(w, h, stageScale, 'native', dpr);
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
      const fill = csUncapped(w, h, stageScale, 'fill'); // exact grow-to-fill CSS scale
      const dpr = 2;
      const s = cs(w, h, stageScale, 'native', dpr);
      // k = largest integer physical-px-per-game-px; s = k/dpr.
      const k = Math.floor(fill * dpr);
      expect(s).toBeCloseTo(k >= 1 ? k / dpr : fill, 9);
      // At dpr 2 the native scale is at least as large as the dpr=1 (integer) scale.
      expect(s).toBeGreaterThanOrEqual(cs(w, h, stageScale, 'native', 1) - 1e-9);
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
        const s = cs(w, h, stageScale, mode, dpr);
        expect(s * dpr).toBeCloseTo(n, 9); // N whole physical px per game px
      }
    }
  });

  it('xN is capped so it never overflows the stage box (falls back to native max)', () => {
    for (const [w, h] of ROOMS) {
      const nativeMax = cs(w, h, stageScale, 'native'); // largest that fits
      // A very large request (x4) can never exceed what the box allows.
      const x4 = cs(w, h, stageScale, 'x4');
      expect(x4).toBeLessThanOrEqual(nativeMax + 1e-9);
      expect(w * x4).toBeLessThanOrEqual(STAGE_W * stageScale + 1e-6);
      expect(h * x4).toBeLessThanOrEqual(STAGE_H * stageScale + 1e-6);
    }
  });

  it('the integer choices are ordered x1 ≤ x2 ≤ x3 ≤ x4 (each ≤ native)', () => {
    for (const [w, h] of ROOMS) {
      const [a, b, c, d] = (['x1', 'x2', 'x3', 'x4'] as const).map((m) =>
        cs(w, h, stageScale, m),
      );
      const native = cs(w, h, stageScale, 'native');
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

/**
 * The cell ceiling (`MAX_CELL_PX`) — a bound on ENLARGEMENT, not on the layout.
 *
 * It exists because `fill` and the graded modes enlarge toward the space available, and the
 * space on a modern screen is enormous: one cell of the smallest room came out at 21mm on a
 * 27" monitor, with a 2.6x spread between the smallest and largest room on that one screen.
 * 28px is the value that reproduces the 1998 original's apparent size (an 800x600 window on
 * a period CRT was ~31-35 arc-minutes per cell).
 */
describe('the cell ceiling — how big one square may get', () => {
  /** A 27" desktop: the case the ceiling exists for. */
  const BIG: [number, number] = [2560, 1380];
  /** A phone in landscape: the case that must not be touched. */
  const PHONE: [number, number] = [734, 343];
  /** The touch bar's landscape width, so a touch viewport here is the area the game gets. */
  const TOUCH_STRIP = 72;
  /**
   * Enough room SHAPES that "how many rooms does the ceiling catch" is a real count.
   * `ROOMS` is a five-room spread chosen for the scaling tests; the ceiling's whole
   * behaviour is about the SMALL rooms, so it needs more of them than that.
   */
  const ALL_ROOM_SHAPES: ReadonlyArray<[number, number]> = [
    [285, 210], [360, 210], [420, 300], [480, 345], [540, 405], [555, 225], [585, 465],
    [600, 450], [615, 525], [630, 480], [690, 300], [720, 555], [750, 345], [780, 225],
    [795, 435], [795, 585],
  ];

  it('the layout carries the ceiling for its target, and it is not the same one', () => {
    // The whole reason the ceiling lives on `StageLayout`: the two targets ship DIFFERENT
    // numbers, and only `computeStageLayout` is told which target this is. Asserted directly,
    // because every test below takes it from the layout — so without this one, collapsing the
    // two constants into a single value would pass the entire suite.
    for (const mode of FIT_MODES) {
      for (const [w, h] of [BIG, PHONE] as const) {
        expect(computeStageLayout(w, h, mode, true).maxCellPx).toBe(MAX_CELL_PX);
        expect(computeStageLayout(w, h, mode, false).maxCellPx).toBe(MAX_CELL_PX_TOUCH);
      }
    }
    expect(MAX_CELL_PX_TOUCH).not.toBe(MAX_CELL_PX);
  });

  it('no graded mode draws a cell past the ceiling, unless `fixed` already did', () => {
    for (const mode of ['small', 'medium', 'large', 'fill'] as const) {
      for (const [w, h] of [BIG, PHONE, [1512, 860], [1180, 748], [1366, 952]] as const) {
        for (const panel of [true, false]) {
          const l = computeStageLayout(w, h, mode, panel);
          for (const [rw, rh] of ROOMS) {
            // `l.maxCellPx`, exactly as `stageGeometry.ts` and `touchBarEdge.ts` pass it.
            // Taking the parameter default here would test the DESKTOP ceiling on the touch
            // branch, which ships a different one — so a touch-only regression would pass.
            const s = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
            const fixed = contentScale(rw, rh, l.scale, 'fixed', 1, l.availW, l.availH, l.maxCellPx);
            // The floor is `fixed`: on a big monitor the faithful scale alone can exceed the
            // ceiling, and coming out below it would invert the mode list (see contentScale).
            expect(s * CELL_NATIVE).toBeLessThanOrEqual(
              Math.max(l.maxCellPx, fixed * CELL_NATIVE) + 1e-6,
            );
          }
        }
      }
    }
  });

  it('a tablet is where the touch ceiling actually bites', () => {
    // It never binds on a phone (the next test), so if it were silently the desktop's 42 the
    // only visible difference would be here — which is precisely why this needs its own case.
    // Counted rather than merely bounded, so raising MAX_CELL_PX_TOUCH to 42 fails loudly.
    const capped = (w: number, h: number) => {
      const l = computeStageLayout(w - TOUCH_STRIP, h, 'fill', false);
      let n = 0;
      for (const [rw, rh] of ALL_ROOM_SHAPES) {
        const withCap = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
        const lifted = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, Infinity);
        if (withCap < lifted - 1e-9) n++;
      }
      return n;
    };
    expect(capped(734, 343)).toBe(0); // iPhone 15 landscape — never
    expect(capped(1366, 952)).toBeGreaterThan(0); // iPad Pro landscape — genuinely does
  });

  it('leaves a phone alone — its biggest cell on `fill` is under the TOUCH ceiling', () => {
    // The claim that matters is about `MAX_CELL_PX_TOUCH`, the one a phone actually gets.
    // Asserting it against `MAX_CELL_PX` would be true and irrelevant, since the desktop's is
    // the larger of the two and so the weaker bound.
    const l = computeStageLayout(PHONE[0] - TOUCH_STRIP, PHONE[1], 'fill', false);
    expect(l.maxCellPx).toBe(MAX_CELL_PX_TOUCH);
    let biggest = 0;
    for (const [rw, rh] of ALL_ROOM_SHAPES) {
      const capped = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
      const lifted = contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, Infinity);
      expect(capped).toBeCloseTo(lifted, 9); // the ceiling never binds here
      biggest = Math.max(biggest, capped * CELL_NATIVE);
    }
    expect(biggest).toBeLessThan(MAX_CELL_PX_TOUCH);
  });

  it('exempts `fixed` and the whole crisp-integer family', () => {
    // 'fixed' promises a constant object size and the xN modes promise exactly N physical
    // pixels per game pixel. Both are contracts a ceiling would break silently.
    // `panel: true` only, and not an oversight: `effectiveFitMode` forces touch to `fill`, so
    // none of these modes can be in force there — asking for 'x2' on a phone gets `fill`, and
    // the exemption is about the mode that is actually applied. The touch ceiling's own
    // behaviour is covered by the two tests above.
    for (const mode of ['fixed', 'native', 'x1', 'x2', 'x3', 'x4'] as const) {
      for (const [w, h] of [BIG, PHONE] as const) {
        const l = computeStageLayout(w, h, mode, true);
        expect(l.mode).toBe(mode); // the mode really is the one being exempted
        for (const [rw, rh] of ROOMS) {
          expect(contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx)).toBe(
            contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, Infinity),
          );
        }
      }
    }
  });

  it('never puts a graded mode below `fixed` — the mode list stays ordered', () => {
    // The reason the ceiling has a floor. Without it, 'medium' would come out SMALLER than
    // 'fixed' on a 27", so choosing the faithful mode would make the room bigger.
    for (const [w, h] of [BIG, PHONE, [1512, 860], [1920, 1030]] as const) {
      for (const panel of [true, false]) {
        for (const [rw, rh] of ROOMS) {
          const at = (mode: FitMode) => {
            const l = computeStageLayout(w, h, mode, panel);
            return contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
          };
          const ladder = (['fixed', 'small', 'medium', 'large', 'fill'] as const).map(at);
          for (let i = 1; i < ladder.length; i++) {
            expect(ladder[i]!).toBeGreaterThanOrEqual(ladder[i - 1]! - 1e-9);
          }
        }
      }
    }
  });

  it('cannot break monotonicity — it is constant in the viewport', () => {
    for (const mode of ['medium', 'fill'] as const) {
      for (const [rw, rh] of ROOMS) {
        for (let w = 600; w <= 2600; w += 97) {
          for (let h = 400; h <= 1400; h += 89) {
            const at = (vw: number, vh: number) => {
              const l = computeStageLayout(vw, vh, mode, false);
              return contentScale(rw, rh, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
            };
            const here = at(w, h);
            expect(at(w + 1, h)).toBeGreaterThanOrEqual(here - 1e-9);
            expect(at(w, h + 1)).toBeGreaterThanOrEqual(here - 1e-9);
          }
        }
      }
    }
  });
});
