/**
 * vitest setup: give every unit test its own seeded `Math.random` stream.
 *
 * Runs once per test file, before the file's tests. See test/rng.ts for the why and for
 * the `pinRandom` / `pinRandomRange` helpers a test uses when it wants a specific draw.
 */
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { restoreRandom, seedRandom } from './rng.js';

/** Cover draws made outside a test body (module top level, beforeAll) too. */
seedRandom(expect.getState().testPath ?? 'file');
beforeAll(() => seedRandom(expect.getState().testPath ?? 'file'));

beforeEach(() => {
  const { testPath, currentTestName } = expect.getState();
  seedRandom(`${testPath ?? ''}\u0000${currentTestName ?? ''}`);
});

afterAll(() => restoreRandom());
