/**
 * Device classification (src/app/deviceGate.ts).
 *
 * The rule reads two signals — is it touch-capable, and is the screen phone-sized — and
 * BOTH must hold before anything is called a phone. The cases below are the whole
 * specification: each is a real class of device, and what matters is that the awkward
 * ones land on the right side of the line.
 *
 * This used to be the phone GATE's test, back when a phone was refused outright. The
 * refusal is gone and the question is not: `touchMode.ts` asks it to decide whether the
 * game is played by touch, so every case here still buys the same thing — misclassify a
 * device and it gets the wrong controls instead of the wrong verdict.
 */
import { describe, it, expect } from 'vitest';
import { deviceClass, PHONE_MAX_SHORT_SIDE, type GateWindow } from '../src/app/deviceGate.js';

const FINE = '(any-pointer: fine)';
const COARSE = '(any-pointer: coarse)';

/** A window stub: which media queries match, and what the screen reports. */
function win(matching: string[], screen?: { width?: number; height?: number }): GateWindow {
  return {
    matchMedia: ((q: string) => ({
      matches: matching.includes(q),
    })) as Window['matchMedia'],
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

describe('deviceClass — phones', () => {
  it('knows a phone (touch-only, phone-sized)', () => {
    expect(deviceClass(win([COARSE], SCREEN.iPhone15ProMax))).toBe('phone');
    expect(deviceClass(win([COARSE], SCREEN.iPhoneSE))).toBe('phone');
    expect(deviceClass(win([COARSE], SCREEN.pixel7Pro))).toBe('phone');
  });

  it('knows a phone held in landscape — the SHORT side is what is measured', () => {
    const landscape = {
      width: SCREEN.iPhone15ProMax.height,
      height: SCREEN.iPhone15ProMax.width,
    };
    expect(deviceClass(win([COARSE], landscape))).toBe('phone');
  });

  it('knows a phone with a mouse paired to it — it is still a phone', () => {
    // The one case the two rules could disagree on, so it is pinned rather than left to
    // whichever branch happens to run first: a fine pointer does NOT change the answer,
    // size decides. Without this, dropping or re-adding a `(any-pointer: fine)` shortcut
    // would go unnoticed (a mutation test caught exactly that).
    expect(deviceClass(win([FINE, COARSE], SCREEN.iPhone15ProMax))).toBe('phone');
  });
});

describe('deviceClass — everything bigger', () => {
  it('knows a plain desktop (mouse, no touch)', () => {
    expect(deviceClass(win([FINE], SCREEN.desktop))).toBe('desktop');
  });

  it('knows a touchscreen laptop — touch-capable, but nowhere near phone-sized', () => {
    // The case a user-agent regex gets wrong. Here it is size, not the pointer, that
    // decides: it reports coarse touch exactly like a phone does. It reads as a tablet,
    // which is the honest answer — Chromium cannot be made to report a fine AND a coarse
    // pointer the way such a laptop really does, so nothing here can tell the two apart.
    expect(deviceClass(win([FINE, COARSE], SCREEN.desktop))).toBe('tablet');
  });

  it('knows a bare tablet — touch-only like a phone, and only size separates them', () => {
    expect(deviceClass(win([COARSE], SCREEN.iPadMini))).toBe('tablet');
    expect(deviceClass(win([COARSE], SCREEN.iPad))).toBe('tablet');
  });

  it('knows an iPad with a trackpad', () => {
    // iPadOS reports `any-pointer: fine` once a trackpad/mouse is attached. The rule does
    // not consult that, and does not need to: the iPad is a tablet on size either way.
    expect(deviceClass(win([FINE, COARSE], SCREEN.iPad))).toBe('tablet');
  });
});

describe('deviceClass — the size boundary', () => {
  it('is a phone at the threshold and a tablet one pixel above it', () => {
    const at = PHONE_MAX_SHORT_SIDE;
    expect(deviceClass(win([COARSE], { width: at, height: 2000 }))).toBe('phone');
    expect(deviceClass(win([COARSE], { width: at + 1, height: 2000 }))).toBe('tablet');
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

describe('deviceClass — fails open', () => {
  it('is a desktop when the browser answers no pointer query', () => {
    // An old browser without `any-pointer` support matches neither query. Every unknown
    // leans the same way — towards the keyboard-and-mouse game, which is what the device
    // probably is and what the port has always been.
    expect(deviceClass(win([], SCREEN.iPhoneSE))).toBe('desktop');
  });

  it('is a desktop when matchMedia throws', () => {
    const thrower: GateWindow = {
      matchMedia: (() => {
        throw new Error('no matchMedia');
      }) as Window['matchMedia'],
      screen: SCREEN.iPhoneSE,
    };
    expect(deviceClass(thrower)).toBe('desktop');
  });

  it('is a tablet — never a phone — when the screen size cannot be read', () => {
    // Every branch of "size unknown" must land above the phone line: absent screen,
    // absent fields, and zeroes — which Math.min would otherwise read as a tiny phone.
    expect(deviceClass(win([COARSE]))).toBe('tablet');
    expect(deviceClass(win([COARSE], {}))).toBe('tablet');
    expect(deviceClass(win([COARSE], { width: 0, height: 0 }))).toBe('tablet');
  });
});
