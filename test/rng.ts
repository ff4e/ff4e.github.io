/**
 * Deterministic randomness for the unit suite.
 *
 * The game keeps REAL randomness: nothing here lives under `src/`, and nothing here runs
 * outside vitest. The suite's setup file (`test/rng.setup.ts`, wired in vite.config.ts)
 * swaps the global `Math.random` for a seeded PRNG while the unit tests run. Every draw
 * in the port funnels through `Math.random` — `Script.random` (src/core/script.ts:236,
 * Pascal's `random`, URoom.pas), the ZX band width (renderRoom.ts:320), the sound-variant
 * pick (audio.ts:483), the host's chatter/blink draws (main.ts) — so the one swap covers
 * all of them without a per-callsite injection seam in game code.
 *
 * Each test gets its OWN stream, seeded from its file + test name, so a test's draws never
 * depend on how many draws the tests before it happened to make. The base seed comes from
 * `FF_TEST_SEED` (default 1), so sweeping the whole suite through different draw sequences
 * is a one-liner:
 *
 *     for s in $(seq 1 200); do FF_TEST_SEED=$s npx vitest run || break; done
 *
 * The stream must keep VARYING. A constant `Math.random` hangs the suite, because some
 * generators redraw until they get a value different from the last one (the idle-chatter
 * picker, main.ts:4392-4395). Both helpers below therefore stay non-constant by
 * construction — `pinRandom` falls back to the stream once its values run out, and
 * `pinRandomRange` squeezes the stream instead of replacing it.
 */

const REAL_RANDOM = Math.random;

/** The active draw source. `Math.random` delegates to this so pins can layer onto it. */
let stream: () => number = REAL_RANDOM;

/** FNV-1a 32-bit: turns a test's identity into a seed. */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, well-distributed; good enough to stand in for Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The suite-wide base seed: `FF_TEST_SEED` if set and numeric, else 1. */
export function baseSeed(): number {
  const raw = globalThis.process?.env?.FF_TEST_SEED;
  const n = raw === undefined ? NaN : Number(raw);
  return Number.isFinite(n) ? n >>> 0 : 1;
}

/** Install a fresh seeded stream as `Math.random`, keyed on `label` (file + test name). */
export function seedRandom(label: string): void {
  stream = mulberry32((fnv1a(label) ^ baseSeed()) >>> 0);
  Math.random = () => stream();
}

/** Hand the real `Math.random` back (the setup file does this once the file's tests end). */
export function restoreRandom(): void {
  Math.random = REAL_RANDOM;
  stream = REAL_RANDOM;
}

/**
 * Force the next draws to exact values, then let the seeded stream resume.
 *
 * Use it when a test needs one specific branch of a `random()` — say `pinRandom(0)` for
 * `random(2) -> 0`. Prefer it over `vi.spyOn(Math, 'random').mockReturnValue(v)`: that
 * pins EVERY later draw to one constant, which both over-constrains the test and risks
 * the redraw-until-different hang described at the top of this file.
 */
export function pinRandom(...values: number[]): void {
  for (const v of values) {
    if (!(v >= 0 && v < 1)) throw new RangeError(`pinRandom: ${v} is not in [0, 1)`);
  }
  const rest = stream;
  let i = 0;
  stream = () => (i < values.length ? values[i++]! : rest());
}

/**
 * Squeeze every draw for the rest of the test into `[lo, hi)`, keeping it varied.
 *
 * Use it to decide a whole CLASS of draws rather than one call — most often to stop a
 * rare easter egg from firing (`pinRandomRange(0.5, 1)` makes every `random(n) < k`
 * low-probability test false) or to make it fire on purpose (`pinRandomRange(0, 0.005)`).
 * That is the readable way to say "this branch is not what the test is about", without
 * having to count how many draws the room script makes before the one you care about.
 *
 * Calls compose: a second squeeze narrows whatever the first left, not the raw [0, 1).
 */
export function pinRandomRange(lo: number, hi: number): void {
  if (!(lo >= 0 && hi <= 1 && lo < hi)) {
    throw new RangeError(`pinRandomRange: [${lo}, ${hi}) is not a sub-range of [0, 1)`);
  }
  const rest = stream;
  stream = () => lo + (hi - lo) * rest();
}
