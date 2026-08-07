/**
 * The phone/tablet gate (src/app/deviceGate.ts).
 *
 * The rule is expressed in `any-pointer` media queries, so the table below is the whole
 * specification: each row is a real class of device, and what matters is that the two
 * awkward ones — a touchscreen laptop and an iPad claiming to be a Mac — come out on the
 * right side of the line.
 *
 * `showUnsupportedNotice` is not covered here: it is DOM work, this suite runs in node
 * with no DOM environment, and adding one for two assertions would be a heavier
 * dependency than the check is worth. It is covered against a real browser instead, by
 * tools/test-desktop-only.mjs.
 */
import { describe, it, expect } from 'vitest';
import { isUnsupportedDevice } from '../src/app/deviceGate.js';

/** A window stub whose matchMedia answers from a fixed set of matching queries. */
function win(matching: string[]): Pick<Window, 'matchMedia'> {
  return {
    matchMedia: ((q: string) => ({ matches: matching.includes(q) })) as Window['matchMedia'],
  };
}

const FINE = '(any-pointer: fine)';
const COARSE = '(any-pointer: coarse)';

describe('isUnsupportedDevice', () => {
  it('lets a plain desktop through (mouse only)', () => {
    expect(isUnsupportedDevice(win([FINE]))).toBe(false);
  });

  it('refuses a phone or tablet (touch only)', () => {
    expect(isUnsupportedDevice(win([COARSE]))).toBe(true);
  });

  it('lets a touchscreen laptop through — it has a trackpad as well as a screen', () => {
    // The case a user-agent regex gets wrong: it looks touch-capable, but `any-pointer`
    // reports EVERY input, so the trackpad is visible alongside the touchscreen.
    expect(isUnsupportedDevice(win([FINE, COARSE]))).toBe(false);
  });

  it('refuses an iPad even though iPadOS reports itself as a Mac', () => {
    // Safari on iPadOS 13+ sends a "Macintosh" user agent, so only the pointer gives it
    // away: there is no fine pointer to report.
    expect(isUnsupportedDevice(win([COARSE]))).toBe(true);
  });

  it('fails OPEN when the browser answers nothing', () => {
    // An old browser without `any-pointer` support matches neither query. Refusing a
    // desktop is unrecoverable (there is no override); letting a phone through only
    // postpones the refusal to the first shove it cannot right-click, so lean this way.
    expect(isUnsupportedDevice(win([]))).toBe(false);
  });

  it('fails OPEN when matchMedia throws', () => {
    const thrower = {
      matchMedia: (() => {
        throw new Error('no matchMedia');
      }) as Window['matchMedia'],
    };
    expect(isUnsupportedDevice(thrower)).toBe(false);
  });
});
