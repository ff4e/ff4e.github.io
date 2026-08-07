/**
 * The phone gate (src/app/deviceGate.ts).
 *
 * The rule reads two signals — is it touch-capable, and is the screen phone-sized — and
 * BOTH must hold before it refuses. The cases below are the whole specification: each is
 * a real class of device, and what matters is that the awkward ones land on the right
 * side of the line.
 *
 * `showUnsupportedNotice` is not covered here: it is DOM work, this suite runs in node
 * with no DOM environment, and adding one for two assertions would be a heavier
 * dependency than the check is worth. It is covered against a real browser instead, by
 * tools/test-desktop-only.mjs.
 */
import { describe, it, expect } from 'vitest';
import {
  isUnsupportedDevice,
  PHONE_MAX_SHORT_SIDE,
  type GateWindow,
} from '../src/app/deviceGate.js';

const FINE = '(any-pointer: fine)';
const COARSE = '(any-pointer: coarse)';

/** A window stub: which media queries match, and what the screen reports. */
function win(matching: string[], screen?: { width?: number; height?: number }): GateWindow {
  return {
    matchMedia: ((q: string) => ({ matches: matching.includes(q) })) as Window['matchMedia'],
    screen,
  };
}

/** Real devices, in CSS pixels, portrait. */
const SCREEN = {
  iPhoneSE: { width: 375, height: 667 },
  iPhone15ProMax: { width: 430, height: 932 }, // the biggest phone — the tight case
  pixel7Pro: { width: 412, height: 892 },
  iPadMini: { width: 744, height: 1133 }, // the smallest tablet — the other tight case
  iPad: { width: 820, height: 1180 },
  desktop: { width: 2560, height: 1440 },
};

describe('isUnsupportedDevice — refused', () => {
  it('refuses a phone (touch-only, phone-sized)', () => {
    expect(isUnsupportedDevice(win([COARSE], SCREEN.iPhone15ProMax))).toBe(true);
    expect(isUnsupportedDevice(win([COARSE], SCREEN.iPhoneSE))).toBe(true);
    expect(isUnsupportedDevice(win([COARSE], SCREEN.pixel7Pro))).toBe(true);
  });

  it('refuses a phone held in landscape — the SHORT side is what is measured', () => {
    const landscape = { width: SCREEN.iPhone15ProMax.height, height: SCREEN.iPhone15ProMax.width };
    expect(isUnsupportedDevice(win([COARSE], landscape))).toBe(true);
  });

  it('refuses a phone with a mouse paired to it — it is still a phone', () => {
    // The one case the two rules could disagree on, so it is pinned rather than left to
    // whichever branch happens to run first: a fine pointer does NOT buy a way in, size
    // decides. Without this, dropping or re-adding a `(any-pointer: fine)` shortcut
    // would go unnoticed (a mutation test caught exactly that).
    expect(isUnsupportedDevice(win([FINE, COARSE], SCREEN.iPhone15ProMax))).toBe(true);
  });
});

describe('isUnsupportedDevice — allowed', () => {
  it('lets a plain desktop through (mouse, no touch)', () => {
    expect(isUnsupportedDevice(win([FINE], SCREEN.desktop))).toBe(false);
  });

  it('lets a touchscreen laptop through — touch-capable, but nowhere near phone-sized', () => {
    // The case a user-agent regex gets wrong. Here it is size, not the pointer, that
    // saves it: it reports coarse touch exactly like a phone does.
    expect(isUnsupportedDevice(win([FINE, COARSE], SCREEN.desktop))).toBe(false);
  });

  it('lets a bare tablet through — big enough for the control panel', () => {
    // Deliberate: only phones are refused. A tablet is touch-only exactly like a phone,
    // so the pointer signal alone would block it; the size signal is what saves it.
    expect(isUnsupportedDevice(win([COARSE], SCREEN.iPadMini))).toBe(false);
    expect(isUnsupportedDevice(win([COARSE], SCREEN.iPad))).toBe(false);
  });

  it('lets an iPad with a trackpad through', () => {
    // iPadOS reports `any-pointer: fine` once a trackpad/mouse is attached. The rule no
    // longer consults that, and does not need to: the iPad is allowed on size either way.
    expect(isUnsupportedDevice(win([FINE, COARSE], SCREEN.iPad))).toBe(false);
  });
});

describe('isUnsupportedDevice — the size boundary', () => {
  it('refuses at the threshold and allows one pixel above it', () => {
    const at = PHONE_MAX_SHORT_SIDE;
    expect(isUnsupportedDevice(win([COARSE], { width: at, height: 2000 }))).toBe(true);
    expect(isUnsupportedDevice(win([COARSE], { width: at + 1, height: 2000 }))).toBe(false);
  });

  it('keeps a real margin either side of the gap it sits in', () => {
    // The threshold is only defensible while no real device is near it: the biggest
    // phone and the smallest tablet must both stay well clear. If a future device
    // narrows that gap, this fails and the choice gets revisited rather than silently
    // drifting into misclassifying real hardware.
    expect(PHONE_MAX_SHORT_SIDE).toBeGreaterThan(SCREEN.iPhone15ProMax.width + 100);
    expect(PHONE_MAX_SHORT_SIDE).toBeLessThan(SCREEN.iPadMini.width - 100);
  });
});

describe('isUnsupportedDevice — fails open', () => {
  it('allows when the browser answers no pointer query', () => {
    // An old browser without `any-pointer` support matches neither query. Refusing a
    // desktop is unrecoverable (there is no override), so lean towards admitting.
    expect(isUnsupportedDevice(win([], SCREEN.iPhoneSE))).toBe(false);
  });

  it('allows when matchMedia throws', () => {
    const thrower: GateWindow = {
      matchMedia: (() => {
        throw new Error('no matchMedia');
      }) as Window['matchMedia'],
      screen: SCREEN.iPhoneSE,
    };
    expect(isUnsupportedDevice(thrower)).toBe(false);
  });

  it('allows a touch-only device that reports no usable screen size', () => {
    // Every branch of "size unknown" must admit rather than refuse: absent screen,
    // absent fields, and zeroes — which Math.min would otherwise read as a tiny phone.
    expect(isUnsupportedDevice(win([COARSE]))).toBe(false);
    expect(isUnsupportedDevice(win([COARSE], {}))).toBe(false);
    expect(isUnsupportedDevice(win([COARSE], { width: 0, height: 0 }))).toBe(false);
  });
});
