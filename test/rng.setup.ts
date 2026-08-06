/**
 * vitest setup: give every unit test its own seeded `Math.random` stream.
 *
 * Runs once per test file. See test/rng.ts for the why and for the `pinRandomLowest` /
 * `pinRandomHighest` helpers a test uses when it wants a draw to go a specific way.
 *
 * Scope, stated honestly: the seed is installed by `beforeAll`/`beforeEach`, so it covers
 * hooks and test bodies. A draw made in a test file's MODULE BODY or in a `describe`
 * callback happens before any hook runs and still sees the platform `Math.random`. No
 * file in this suite draws at import time, and test/rng.test.ts pins that assumption
 * down. The harness also assumes tests run serially within a file — `test.concurrent`
 * would share one stream between interleaved tests.
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect } from 'vitest';
import { baseSeed, restoreRandom, seedRandom } from './rng.js';

/** The test file's path relative to the repo root, so a seed does not depend on the checkout location. */
function filePath(): string {
  const { testPath } = expect.getState();
  if (!testPath) throw new Error('rng.setup: vitest gave no testPath; cannot seed per file');
  const cwd = globalThis.process?.cwd?.() ?? '';
  return cwd && testPath.startsWith(cwd) ? testPath.slice(cwd.length) : testPath;
}

beforeAll(() => seedRandom(filePath()));

beforeEach(() => {
  const { currentTestName } = expect.getState();
  if (!currentTestName) {
    throw new Error('rng.setup: vitest gave no currentTestName; cannot seed per test');
  }
  seedRandom(`${filePath()}\u0000${currentTestName}`);
});

// A sweep that fails on seed 261 of 500 is only useful if you can get back to seed 261.
afterEach((ctx) => {
  if (ctx.task.result?.state !== 'fail') return;
  const where = `.${filePath()} -t ${JSON.stringify(ctx.task.name)}`;
  console.error(`[rng] reproduce with: FF_TEST_SEED=${baseSeed()} npx vitest run ${where}`);
});

afterAll(() => restoreRandom());
