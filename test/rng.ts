/**
 * Deterministic randomness for the unit suite.
 *
 * The game keeps REAL randomness: nothing here lives under `src/`, and nothing here runs
 * outside vitest. The suite's setup file (`test/rng.setup.ts`, wired in vite.config.ts)
 * swaps the global `Math.random` for a seeded PRNG while the unit tests run. Every draw
 * the port makes at RUNTIME funnels through `Math.random` — `Script.random`
 * (src/core/script.ts:236, Pascal's `random`, URoom.pas), the ZX band width
 * (renderRoom.ts:320), the sound-variant pick (audio.ts:483), the host's lip-sync and
 * blink draws (main.ts) — so the one swap covers all of them without a per-callsite
 * injection seam in game code.
 *
 * It is a floor, not the only mechanism. Where a unit already takes an injected `rnd`
 * (stepEngine.ts:37, ambient.ts, hooks.ts, lode-game.ts:48), pass it — that stays the
 * house style, and a pin here does NOT reach those draws, because they never call
 * `Math.random`.
 *
 * Each test gets its OWN stream, seeded from its file + test name, so a test's draws never
 * depend on how many draws the tests before it happened to make. The base seed comes from
 * `FF_TEST_SEED` (default 1), so sweeping the whole suite through different draw sequences
 * is one command:
 *
 *     npm run test:seeds              # seeds 1..100
 *     FF_SEEDS=500 npm run test:seeds
 *
 * The stream must keep VARYING. A CONSTANT `Math.random` hangs the suite: the idle-chatter
 * picker redraws until it gets a group different from the last three
 * (`do { n = s.random(6) + 1 } while (...)`, src/core/chatter.ts:235-237, URoom.pas:3370),
 * so a constant spins forever. Both pins below stay non-constant by construction, which is
 * why they exist instead of `vi.spyOn(Math, 'random').mockReturnValue(v)`.
 */

const REAL_RANDOM = Math.random;

/** The active draw source. `Math.random` delegates to this so a pin can layer onto it. */
let stream: () => number = REAL_RANDOM;

/**
 * The largest `n` for which the pins are exact: `random(n)` is `floor(draw * n)`, so a
 * draw in `[0, EPS)` is `0` and one in `[1 - EPS, 1)` is `n - 1` for every `n` up to
 * this. The largest draw in the port is `random(10000)`, so this leaves 10x margin — and
 * each interval still holds billions of distinct values, so a pinned stream keeps varying
 * and cannot hang a redraw-until-different loop. Asserted in test/rng.test.ts.
 */
export const PIN_MAX_N = 100_000;

/** How far a pinned draw sits from the end of its range. */
const EPS = 1 / PIN_MAX_N;

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

/** The suite-wide base seed: `FF_TEST_SEED` if set to a finite number, else 1. */
export function baseSeed(): number {
  const raw = globalThis.process?.env?.FF_TEST_SEED?.trim();
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.abs(Math.trunc(n)) >>> 0 : 1;
}

/** Install a fresh seeded stream as `Math.random`, keyed on `label` (file + test name). */
export function seedRandom(label: string): void {
  // An empty label would silently collapse every test onto one shared stream, which is
  // the same "degrades quietly and nothing says so" failure this file exists to prevent.
  if (!label) throw new Error('seedRandom: refusing to seed on an empty label');
  stream = mulberry32((fnv1a(label) ^ baseSeed()) >>> 0);
  Math.random = () => stream();
}

/** Hand the real `Math.random` back (the setup file does this once a file's tests end). */
export function restoreRandom(): void {
  Math.random = REAL_RANDOM;
  stream = REAL_RANDOM;
}

/** Squeeze every later draw into `[lo, hi)`, keeping it varied. */
function squeeze(lo: number, hi: number): void {
  const rest = stream;
  stream = () => lo + (hi - lo) * rest();
}

/**
 * Send every draw for the rest of the test to its LOWEST outcome: `random(n) === 0`.
 *
 * The readable way to make a rare branch fire on purpose — under this pin
 * `random(100) < 1` is certain. Exact for every `n` up to `PIN_MAX_N`.
 */
export function pinRandomLowest(): void {
  squeeze(0, EPS);
}

/**
 * Send every draw for the rest of the test to its HIGHEST outcome: `random(n) === n - 1`.
 *
 * The readable way to say "no rare easter egg fires here" — under this pin
 * `random(100) < 1` is impossible — without having to count how many draws the room
 * script makes before the one you care about. Exact for every `n` up to `PIN_MAX_N`.
 */
export function pinRandomHighest(): void {
  squeeze(1 - EPS, 1);
}
