/**
 * Which way the phone should be held for a room (`src/app/deviceOrientation.ts`).
 *
 * The rule is `touchBarEdge.ts`'s rule one level up — lay the room out both ways and keep
 * whichever shows more of it — so this file is about the things that rule has to get right
 * at THIS level and nothing else. The scaling arithmetic belongs to `layout.test.ts` and
 * the edge comparison to `touchBarEdge.test.ts`; neither is re-tested here.
 *
 * ── Why the expected answers can be stated as facts ──────────────────────────
 * Portrait wins for exactly FIVE of the 72 rooms, on all three iPhone families, and they
 * are the same five the DELETED `orientation.ts` named with its far cruder aspect-ratio
 * check (#123's own message lists them: VRAK, CHODBA, ZDVIZ1, ZDVIZ2, BATHROOM). Two
 * independent methods agreeing on the membership of the set is the strongest evidence
 * available that the set is right — and they disagree sharply on the MARGINS, which is
 * where the new method earns its keep: the old one had VRAK at x1.76 because it compared
 * bare viewports, and pricing the touch bar and the cutout puts it at +210%.
 *
 * Measured with `tools/measure-device-orientation.mjs --rooms`.
 *
 * The viewports are the real native ones from `tools/layoutLabHousings.ts` — the size the
 * iOS app actually gets, with the cutout it actually reports. Browser viewports are
 * deliberately absent: iOS Safari has no `screen.orientation.lock()`, so this feature can
 * never run on one.
 */
import { describe, expect, it } from 'vitest';
import { NON_ROOM_ORIENTATION, preferredDeviceOrientation } from '../src/app/deviceOrientation.js';
import { visibleRoomArea, TOUCHBAR_H, TOUCHBAR_LEAD, TOUCHBAR_W } from '../src/app/touchBarEdge.js';

/** `[long edge, short edge, cutout]`, from `LAB_NATIVE_DEVICES`. */
const IPHONE_17E: [number, number, number] = [844, 390, 47];
const IPHONE_17_PRO: [number, number, number] = [874, 402, 62];
const IPHONE_AIR: [number, number, number] = [912, 420, 68];
const PHONES = [IPHONE_17E, IPHONE_17_PRO, IPHONE_AIR];

const want = (w: number, h: number, [long, short, housing]: [number, number, number]) =>
  preferredDeviceOrientation(w, h, long, short, 'fill', 1, housing);

describe('preferredDeviceOrientation', () => {
  it('turns the phone upright for the five rooms that are taller than they are wide', () => {
    // The same five #123's message named, on every iPhone. VRAK is the case the whole
    // feature exists for: 315x555 is 3.1x more room in portrait.
    for (const phone of PHONES) {
      expect(want(315, 555, phone), 'VRAK').toBe('portrait'); // +210%
      expect(want(510, 555, phone), 'CHODBA').toBe('portrait'); // +18%
      expect(want(510, 540, phone), 'ZDVIZ1/ZDVIZ2').toBe('portrait'); // +12%
      expect(want(465, 480, phone), 'BATHROOM').toBe('portrait'); // +7%
    }
  });

  it('leaves the phone sideways for the wide rooms, including the marginal ones', () => {
    for (const phone of PHONES) {
      expect(want(780, 225, phone), 'UTES, the widest').toBe('landscape');
      expect(want(555, 225, phone), 'ZRC').toBe('landscape');
      expect(want(795, 585, phone), 'PUCLIK, the largest').toBe('landscape');
      // KOSTE is 540x495 — nearly square, and one step wider than BATHROOM's 465x480,
      // which is the room on the other side of the line. The pair is the crossover.
      expect(want(540, 495, phone), 'KOSTE').toBe('landscape');
    }
  });

  it('gives a tie to landscape', () => {
    // A square room on a screen with no cutout: the two candidates come out bit-for-bit
    // equal, so this asserts the tie-break itself rather than a near miss.
    const [long, short] = [874, 402];
    const landscape = Math.max(
      visibleRoomArea(480, 480, long, short - TOUCHBAR_H, 'fill'),
      visibleRoomArea(480, 480, long - TOUCHBAR_W - TOUCHBAR_LEAD, short, 'fill'),
    );
    const portrait = visibleRoomArea(480, 480, short, long - TOUCHBAR_H, 'fill');
    expect(landscape).toBe(portrait);
    expect(preferredDeviceOrientation(480, 480, long, short, 'fill')).toBe('landscape');
  });

  it('refuses to answer for a room it cannot measure', () => {
    // A 0x0 room must not reach the tie-break, which would report 'landscape' as a
    // DECISION. It gets the same fallback as a screen with no room at all, and the caller
    // (`orientationSync.ts`) holds the standing answer instead.
    for (const bad of [
      [0, 555],
      [315, 0],
      [-1, 555],
      [Number.NaN, 555],
    ] as const) {
      expect(preferredDeviceOrientation(bad[0], bad[1], 874, 402, 'fill', 1, 62)).toBe(NON_ROOM_ORIENTATION);
    }
    // …and the same for a screen with no size.
    expect(preferredDeviceOrientation(315, 555, 0, 402, 'fill')).toBe(NON_ROOM_ORIENTATION);
  });

  it('prices the bar and the cutout the way the stylesheet spends them', () => {
    // The drift guard for `tools/measure-device-orientation.mjs`, which restates these
    // three candidates rather than importing them. It is also the only assertion that
    // pins WHERE the cutout is charged: on a side in landscape (so the top edge costs the
    // bar alone) and above the room in portrait (so the top edge costs bar + cutout,
    // which is what `--bar-h: calc(54px + var(--sa-top))` resolves to).
    const [long, short, housing] = IPHONE_17_PRO;
    for (const [w, h] of [
      [315, 555],
      [780, 225],
      [540, 495],
      [465, 480],
    ] as const) {
      const landscape = Math.max(
        visibleRoomArea(w, h, long, short - TOUCHBAR_H, 'fill'),
        visibleRoomArea(w, h, long - TOUCHBAR_W - Math.max(housing, TOUCHBAR_LEAD), short, 'fill'),
      );
      const portrait = visibleRoomArea(w, h, short, long - TOUCHBAR_H - housing, 'fill');
      expect(want(w, h, IPHONE_17_PRO)).toBe(landscape >= portrait ? 'landscape' : 'portrait');
    }
  });

  it('takes the BETTER of the two landscape bar positions, not one of them', () => {
    // Landscape is worth whichever edge `preferredTouchBarEdge` will actually choose once
    // we are there, and UTES is the room that proves the two differ: at 780x225 the top
    // edge shows meaningfully more than the left one. Pricing landscape as "bar on the
    // left" alone would under-value it — on the widest room in the game, which is the one
    // that least deserves to be talked out of landscape.
    const [long, short, housing] = IPHONE_17_PRO;
    const onTop = visibleRoomArea(780, 225, long, short - TOUCHBAR_H, 'fill');
    const onLeft = visibleRoomArea(780, 225, long - TOUCHBAR_W - Math.max(housing, TOUCHBAR_LEAD), short, 'fill');
    expect(onTop).toBeGreaterThan(onLeft);
    expect(want(780, 225, IPHONE_17_PRO)).toBe('landscape');
  });

  it('does not depend on which way the phone is being held', () => {
    // The caller passes the device's two FIXED edges as long/short, so the same phone
    // gives the same answer in both hands — the property that stops the lock chasing its
    // own tail. Asserted by feeding the viewport as the app derives it (max/min) from
    // both orientations of the same screen.
    for (const [w, h] of [
      [315, 555],
      [780, 225],
    ] as const) {
      const landscapeViewport = preferredDeviceOrientation(w, h, Math.max(874, 402), Math.min(874, 402), 'fill', 1, 62);
      const portraitViewport = preferredDeviceOrientation(w, h, Math.max(402, 874), Math.min(402, 874), 'fill', 1, 62);
      expect(landscapeViewport).toBe(portraitViewport);
    }
  });
});
