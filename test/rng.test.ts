/**
 * The unit suite's own randomness harness (test/rng.ts + test/rng.setup.ts).
 *
 * It is test infrastructure, so it gets tests: if the seeding or the pins quietly stop
 * working, every other test in the suite goes back to running against real entropy and
 * nothing else would say so.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIN_MAX_N,
  baseSeed,
  pinRandomHighest,
  pinRandomLowest,
  restoreRandom,
  seedRandom,
} from './rng.js';

/** Run `fn` with FF_TEST_SEED set to `value` (or unset), then put the environment back. */
function withEnvSeed(value: string | undefined, fn: () => void): void {
  const had = Object.prototype.hasOwnProperty.call(process.env, 'FF_TEST_SEED');
  const before = process.env.FF_TEST_SEED;
  try {
    if (value === undefined) delete process.env.FF_TEST_SEED;
    else process.env.FF_TEST_SEED = value;
    fn();
  } finally {
    if (had) process.env.FF_TEST_SEED = before;
    else delete process.env.FF_TEST_SEED;
  }
}

describe('the seeded Math.random', () => {
  it('is installed: the suite never draws from the platform Math.random', () => {
    // A native Math.random stringifies with "[native code]"; ours does not. If the setup
    // file stops running, every test in the suite silently goes back to real entropy —
    // this is the one assertion that would say so.
    expect(Math.random.toString()).not.toContain('native code');
  });

  it('is the SAME stream the pins mutate (setup and test share one rng module)', () => {
    // `Math.random` closes over this module's `stream`, and the pins mutate only
    // `stream`. If the setup file ever got its own instance of test/rng.ts, the pins
    // would silently become no-ops. This asserts the two are wired together, through
    // the global, rather than trusting vitest's module graph to stay as it is.
    pinRandomHighest();
    expect(Array.from({ length: 500 }, () => Math.random()).every((v) => v > 0.5)).toBe(true);
  });

  it('replays the same sequence for the same seed', () => {
    seedRandom('a-label');
    const first = Array.from({ length: 10 }, () => Math.random());
    seedRandom('a-label');
    expect(Array.from({ length: 10 }, () => Math.random())).toEqual(first);
  });

  it('gives a different stream to a different test', () => {
    // This is what makes a test independent of how many draws ran before it.
    seedRandom('a-label');
    const first = Array.from({ length: 10 }, () => Math.random());
    seedRandom('another-label');
    expect(Array.from({ length: 10 }, () => Math.random())).not.toEqual(first);
  });

  it('keeps varying, so a redraw-until-different loop cannot spin', () => {
    const drawn = new Set(Array.from({ length: 50 }, () => Math.random()));
    expect(drawn.size).toBeGreaterThan(40);
  });

  it('refuses an empty label rather than collapsing every test onto one stream', () => {
    expect(() => seedRandom('')).toThrow(/empty label/);
  });

  it('restoreRandom hands the platform Math.random back', () => {
    restoreRandom();
    try {
      expect(Math.random.toString()).toContain('native code');
    } finally {
      seedRandom('restore-test'); // leave the rest of this file seeded
    }
  });
});

describe('baseSeed', () => {
  it('is 1 when FF_TEST_SEED is unset, empty or not a number', () => {
    for (const v of [undefined, '', '   ', 'abc', 'NaN', 'Infinity']) {
      withEnvSeed(v, () => expect(baseSeed()).toBe(1));
    }
  });

  it('reads a numeric FF_TEST_SEED, which is what a sweep varies', () => {
    withEnvSeed('7', () => expect(baseSeed()).toBe(7));
    withEnvSeed('261', () => expect(baseSeed()).toBe(261));
    withEnvSeed('-3', () => expect(baseSeed()).toBe(3));
    withEnvSeed('1e9', () => expect(baseSeed()).toBe(1000000000));
  });

  it('changes the stream, so a sweep really does explore different draws', () => {
    withEnvSeed('1', () => seedRandom('same-label'));
    const one = Array.from({ length: 10 }, () => Math.random());
    withEnvSeed('2', () => seedRandom('same-label'));
    expect(Array.from({ length: 10 }, () => Math.random())).not.toEqual(one);
  });
});

describe('the draw pins', () => {
  /** `Script.random` (src/core/script.ts:236), reproduced so the pins are tested as used. */
  const random = (n: number): number => (n <= 0 ? 0 : Math.floor(Math.random() * n));

  it('pinRandomLowest sends every draw to 0, for every n the port uses', () => {
    pinRandomLowest();
    for (const n of [2, 3, 6, 10, 100, 250, 1000, 2000, 7000, 10000, PIN_MAX_N]) {
      const drawn = Array.from({ length: 200 }, () => random(n));
      expect({ n, max: Math.max(...drawn) }).toEqual({ n, max: 0 });
    }
  });

  it('pinRandomHighest sends every draw to n-1, for every n the port uses', () => {
    pinRandomHighest();
    for (const n of [2, 3, 6, 10, 100, 250, 1000, 2000, 7000, 10000, PIN_MAX_N]) {
      const drawn = Array.from({ length: 200 }, () => random(n));
      expect({ n, min: Math.min(...drawn) }).toEqual({ n, min: n - 1 });
    }
  });

  it('makes a rare easter egg certain, and impossible, on demand', () => {
    // `random(100) < 1` is the shape the room scripts arm their easter eggs with.
    pinRandomLowest();
    expect(Array.from({ length: 500 }, () => random(100) < 1).every(Boolean)).toBe(true);
    seedRandom('reset');
    pinRandomHighest();
    expect(Array.from({ length: 500 }, () => random(100) < 1).some(Boolean)).toBe(false);
  });

  it('stays varied under a pin, so a pinned test cannot hang', () => {
    // A constant Math.random spins the chatter picker's redraw loop forever
    // (src/core/chatter.ts:235-237). Both pins must keep moving.
    for (const pin of [pinRandomLowest, pinRandomHighest]) {
      seedRandom(`vary-${pin.name}`);
      pin();
      expect(new Set(Array.from({ length: 200 }, () => Math.random())).size).toBeGreaterThan(150);
    }
  });
});

describe('the suite has one way to control randomness', () => {
  it('no test file stubs Math.random directly', () => {
    // The six sites that used to do this were the pre-existing cross-test leak, and a
    // constant stub is also the hang class above. Keep them from coming back.
    const dir = new URL('.', import.meta.url).pathname;
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => {
        const src = readFileSync(join(dir, f), 'utf8');
        return /spyOn\(\s*Math\s*,\s*['"]random['"]\s*\)/.test(src) || /\bMath\.random\s*=/.test(src);
      })
      .filter((f) => f !== 'rng.ts'); // rng.ts is where the one swap lives
    expect(offenders, 'use pinRandomLowest/pinRandomHighest from test/rng.ts — see README').toEqual([]);
  });
});
