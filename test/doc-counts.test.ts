/**
 * The probe count in the docs must be the probe count on disk.
 *
 * `AGENTS.md` and `README.md` both tell the reader how many UI probes there are, and both
 * had drifted — in three different directions at once: `README.md` said 68, everything
 * else said 86, and there were 89 files. A number nobody re-counts is worse than no
 * number, because it is quoted with the confidence of a measurement: the "86 probes" line
 * sits directly above the advice on what a probe costs, which is the sentence a reader is
 * meant to make a decision from.
 *
 * It rots for the ordinary reason — probes are added and deleted by changes that have
 * nothing to do with the docs, and nothing fails when the sentence is left behind. This
 * turns it into something that fails. It costs ~2.5 ms and needs no browser and no game
 * data, so it runs in CI on every push like the rest of the unit suite.
 *
 * ── Why this shape ───────────────────────────────────────────────────────────
 * It matches the exact phrase `<n> UI probes`, not `<n> probes`, so that ordinary prose
 * about a subset ("the three ~100 s probes", "the 2 flakiest probes") cannot trip it. The
 * two places that said `<n> probes` about the whole suite were reworded to match rather
 * than the pattern being loosened — a guard that has to be taught about exceptions stops
 * being trusted.
 *
 * What is deliberately NOT guarded here is the `window.__ff` entry count, also quoted in
 * AGENTS.md. Counting it honestly means reading `Object.keys(window.__ff)` in a browser,
 * which is a ~7.4 s probe rather than a ~2.5 ms test, and it changes whenever a hook is
 * added — so the guard would cost 3 000x more and fire as routine noise rather than as a
 * signal. It is a hand-checked number; if you change the hook surface, re-read it with
 * `Object.keys(window.__ff).length`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** The suite is every `tools/test-*.mjs` — the same glob `run-ui-tests.mjs` collects. */
function probeCount(): number {
  return readdirSync(join(root, 'tools')).filter((f) => f.startsWith('test-') && f.endsWith('.mjs')).length;
}

const DOCS = ['AGENTS.md', 'README.md'];

describe('the docs state the real number of UI probes', () => {
  it('every "<n> UI probes" claim matches the files on disk', () => {
    const actual = probeCount();
    // Sanity: if the glob ever stops finding probes, the claims below would all have to
    // become 0 and this test would "pass" by agreeing with nonsense.
    expect(actual).toBeGreaterThan(50);

    for (const doc of DOCS) {
      const text = readFileSync(join(root, doc), 'utf8');
      const claims = [...text.matchAll(/(\d+) UI probes/g)];
      expect(claims.length, `${doc} should state the probe count at least once`).toBeGreaterThan(0);
      for (const m of claims) {
        expect(Number(m[1]), `${doc} says "${m[0]}" but tools/ has ${actual} probes`).toBe(actual);
      }
    }
  });
});
