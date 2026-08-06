/**
 * The unit suite's own randomness harness (test/rng.ts + test/rng.setup.ts).
 *
 * It is test infrastructure, so it gets tests: if the seeding or the pins quietly stop
 * working, every other test in the suite goes back to running against real entropy and
 * nothing would say so.
 */
import { describe, it, expect } from 'vitest';
import { baseSeed, pinRandom, pinRandomRange, seedRandom } from './rng.js';

describe('the seeded Math.random', () => {
  it('is installed: the suite never draws from the platform Math.random', () => {
    // A native Math.random stringifies with "[native code]"; ours does not. If the
    // setup file stops running, every test in the suite silently goes back to real
    // entropy — this is the one assertion that would say so.
    expect(Math.random.toString()).not.toContain('native code');
    // Whatever FF_TEST_SEED a sweep passes, the base seed is a usable uint32.
    expect(Number.isInteger(baseSeed()) && baseSeed() >= 0).toBe(true);
  });

  it('replays the same sequence for the same seed', () => {
    seedRandom('a-label');
    const first = Array.from({ length: 10 }, () => Math.random());
    seedRandom('a-label');
    const again = Array.from({ length: 10 }, () => Math.random());
    expect(again).toEqual(first);
  });

  it('gives a different stream to a different test', () => {
    // This is what makes a test independent of how many draws ran before it.
    seedRandom('a-label');
    const first = Array.from({ length: 10 }, () => Math.random());
    seedRandom('another-label');
    const other = Array.from({ length: 10 }, () => Math.random());
    expect(other).not.toEqual(first);
  });

  it('keeps varying, so a redraw-until-different loop cannot spin', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => Math.random()));
    expect(drawn.size).toBeGreaterThan(40);
  });
});

describe('pinRandom', () => {
  it('hands out the given draws, then falls back to the seeded stream', () => {
    pinRandom(0.25, 0.75);
    expect(Math.random()).toBe(0.25);
    expect(Math.random()).toBe(0.75);
    const after = [Math.random(), Math.random(), Math.random()];
    expect(after.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(new Set(after).size).toBe(3); // varied, not stuck on the last pin
  });

  it('rejects a value outside [0, 1)', () => {
    expect(() => pinRandom(1)).toThrow(RangeError);
    expect(() => pinRandom(-0.1)).toThrow(RangeError);
  });
});

describe('pinRandomRange', () => {
  it('squeezes every later draw into the range, still varied', () => {
    pinRandomRange(0.5, 1);
    const drawn = Array.from({ length: 200 }, () => Math.random());
    expect(drawn.every((v) => v >= 0.5 && v < 1)).toBe(true);
    expect(new Set(drawn).size).toBeGreaterThan(150);
  });

  it('makes a rare draw certain, and its opposite impossible', () => {
    // `random(100) < 1` is the shape of the easter eggs the room scripts arm.
    const pct = (): number => Math.floor(Math.random() * 100);
    pinRandomRange(0, 0.005);
    expect(Array.from({ length: 200 }, pct).every((v) => v < 1)).toBe(true);
  });

  it('composes: a later squeeze applies to the already-squeezed stream', () => {
    pinRandomRange(0.5, 1); // -> [0.5, 1)
    pinRandomRange(0, 0.5); // the outer half of those -> [0.25, 0.5)
    const drawn = Array.from({ length: 100 }, () => Math.random());
    expect(drawn.every((v) => v >= 0.25 && v < 0.5)).toBe(true);
  });

  it('rejects a range that is not inside [0, 1)', () => {
    expect(() => pinRandomRange(0.5, 0.5)).toThrow(RangeError);
    expect(() => pinRandomRange(-0.1, 0.5)).toThrow(RangeError);
    expect(() => pinRandomRange(0.5, 1.5)).toThrow(RangeError);
  });
});
