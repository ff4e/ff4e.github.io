/**
 * Is the game being played by touch (src/app/touchMode.ts).
 *
 * Two things are worth pinning here and neither is the happy path. First, that a DESKTOP
 * is never in touch mode by the rule — that is the guarantee the whole touch series rests
 * on, and it is one line away from being lost every time this file is edited. Second,
 * that the override's precedence is URL, then storage, then the device: the URL is the
 * carrier that survives storage being unavailable, and it is what a probe boots into.
 *
 * `touchButtons.ts` is not covered here (DOM, no environment in node); it is covered
 * against a real browser by tools/test-touchbar.mjs.
 */
import { describe, it, expect } from 'vitest';
import { afterEach } from 'vitest';
import {
  readTouchOverride,
  resetTouchSession,
  touchModeActive,
  writeTouchOverride,
  TOUCH_KEY,
  type TouchWindow,
} from '../src/app/touchMode.js';

// `writeTouchOverride` sets a module-level session slot that outlives a single test.
afterEach(resetTouchSession);

const FINE = '(any-pointer: fine)';
const COARSE = '(any-pointer: coarse)';

/** A window stub: pointer signals, screen size, and the two override carriers. */
function win(
  matching: string[],
  screen?: { width?: number; height?: number },
  extra: { search?: string; stored?: string; throws?: boolean } = {},
): TouchWindow {
  return {
    matchMedia: ((q: string) => ({ matches: matching.includes(q) })) as Window['matchMedia'],
    screen,
    location: { search: extra.search ?? '' },
    localStorage: {
      getItem: (k: string) => {
        if (extra.throws) throw new Error('storage disabled');
        return k === TOUCH_KEY ? (extra.stored ?? null) : null;
      },
      setItem: () => {
        if (extra.throws) throw new Error('storage disabled');
      },
    },
  };
}

const PHONE = { width: 390, height: 844 };
const TABLET = { width: 820, height: 1180 };
const DESKTOP = { width: 2560, height: 1440 };

describe('touchModeActive — the device decides', () => {
  it('is on for a phone and for a tablet', () => {
    // The tablet is in deliberately: the gate admits it because the faithful panel FITS,
    // which is not the same as being pleasant to hit with a thumb.
    expect(touchModeActive(win([COARSE], PHONE))).toBe(true);
    expect(touchModeActive(win([COARSE], TABLET))).toBe(true);
  });

  it('is OFF for a desktop — the guarantee the whole touch series rests on', () => {
    expect(touchModeActive(win([FINE], DESKTOP))).toBe(false);
    // And for a browser that cannot answer the pointer query at all: unknown means
    // "leave the mouse-and-keyboard game exactly as it was".
    expect(touchModeActive(win([], DESKTOP))).toBe(false);
  });
});

describe('touchModeActive — the dev override', () => {
  it('forces the touch UI onto a desktop, which is what it is for', () => {
    expect(touchModeActive(win([FINE], DESKTOP, { search: '?touch=on' }))).toBe(true);
    expect(touchModeActive(win([FINE], DESKTOP, { stored: 'on' }))).toBe(true);
  });

  it('forces it off a touch device', () => {
    expect(touchModeActive(win([COARSE], PHONE, { search: '?touch=off' }))).toBe(false);
    expect(touchModeActive(win([COARSE], TABLET, { stored: 'off' }))).toBe(false);
  });

  it('lets the URL beat storage', () => {
    // The precedence that matters when a machine has been left forced one way and a
    // probe needs the other.
    expect(touchModeActive(win([FINE], DESKTOP, { search: '?touch=on', stored: 'off' }))).toBe(true);
    expect(touchModeActive(win([COARSE], PHONE, { search: '?touch=off', stored: 'on' }))).toBe(
      false,
    );
  });

  it('ignores anything that is not one of the three words', () => {
    expect(readTouchOverride(win([FINE], DESKTOP, { search: '?touch=yes' }))).toBe('auto');
    expect(readTouchOverride(win([FINE], DESKTOP, { search: '?touch=1' }))).toBe('auto');
    expect(readTouchOverride(win([FINE], DESKTOP, { stored: 'true' }))).toBe('auto');
    // ...and therefore falls back to the device, rather than to either extreme.
    expect(touchModeActive(win([COARSE], PHONE, { stored: 'true' }))).toBe(true);
    expect(touchModeActive(win([FINE], DESKTOP, { stored: 'true' }))).toBe(false);
  });

  it('falls back to the device when storage throws, and never throws itself', () => {
    expect(readTouchOverride(win([COARSE], PHONE, { throws: true }))).toBe('auto');
    expect(touchModeActive(win([COARSE], PHONE, { throws: true }))).toBe(true);
    expect(touchModeActive(win([FINE], DESKTOP, { throws: true }))).toBe(false);
    expect(() => writeTouchOverride(win([FINE], DESKTOP, { throws: true }), 'on')).not.toThrow();
    expect(() => writeTouchOverride({}, 'on')).not.toThrow();
  });

  it('still reads the URL when storage throws', () => {
    expect(touchModeActive(win([FINE], DESKTOP, { search: '?touch=on', throws: true }))).toBe(true);
  });
});

/**
 * The session slot, and the bug it exists for.
 *
 * Two independent reviewers found the same defect: with the URL ahead of everything, a
 * page loaded with `?touch=on` could never be switched OFF from the dev bar — the
 * control wrote storage, the URL kept winning, and the control looked dead. An action
 * taken now must beat a parameter typed earlier.
 */
describe('the dev-bar choice, made during a session', () => {
  it('beats a ?touch= that was on the URL when the page loaded', () => {
    const w = win([FINE], DESKTOP, { search: '?touch=on' });
    expect(touchModeActive(w)).toBe(true);
    writeTouchOverride(w, 'off');
    expect(touchModeActive(w)).toBe(false);
  });

  it('beats it in the other direction too', () => {
    const w = win([COARSE], PHONE, { search: '?touch=off' });
    expect(touchModeActive(w)).toBe(false);
    writeTouchOverride(w, 'on');
    expect(touchModeActive(w)).toBe(true);
  });

  it('takes effect even when the write to storage throws', () => {
    // The other half of the same finding: a failed persist must not silently discard
    // the choice for this session.
    const w = win([FINE], DESKTOP, { throws: true });
    writeTouchOverride(w, 'on');
    expect(touchModeActive(w)).toBe(true);
  });

  it('can be put back to auto, and the device decides again', () => {
    const w = win([COARSE], PHONE, { search: '?touch=off' });
    writeTouchOverride(w, 'on');
    expect(touchModeActive(w)).toBe(true);
    writeTouchOverride(w, 'auto');
    expect(readTouchOverride(w)).toBe('auto');
    expect(touchModeActive(w)).toBe(true); // ...and the device says phone
  });

  it('is forgotten on reload, so the URL and storage decide again', () => {
    const w = win([FINE], DESKTOP, { search: '?touch=on' });
    writeTouchOverride(w, 'off');
    expect(touchModeActive(w)).toBe(false);
    resetTouchSession(); // what a fresh page load does
    expect(touchModeActive(w)).toBe(true);
  });
});
