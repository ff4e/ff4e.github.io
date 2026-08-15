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
 * It matches the phrase `<n> UI probes` rather than a bare `<n> probes`, so that prose
 * about a subset cannot trip it. The two places that said `<n> probes` about the whole
 * suite were reworded to match, rather than the pattern being loosened — a guard that has
 * to be taught about exceptions stops being trusted.
 *
 * Markdown emphasis is allowed between the two, because this file sits in docs whose every
 * other figure is bolded (`**~2.5 ms**`, `**~9.5 s**`): without it, someone writing
 * `**89** UI probes` would drop that claim out of the guard SILENTLY, which is the one
 * outcome a drift test must not have. Failing loudly is fine; going quiet is not.
 *
 * Two holes it does NOT close, stated so nobody assumes otherwise. A count written in a
 * form the phrase misses (`89 probes`, `eighty-nine UI probes`) is invisible to it — the
 * rewording made today's text guardable, it cannot make tomorrow's text guardable. And a
 * NEW markdown file is only covered because the list below is every tracked `*.md` at the
 * repo root rather than a hand-picked pair.
 *
 * What is deliberately NOT guarded is the `window.__ff` entry count, also quoted in
 * AGENTS.md. Not on cost grounds — `window.__ff` is assigned once from a single object
 * literal, so a depth-1 key scan of `debugHooks.ts` counts it in milliseconds without a
 * browser. The reason is that such a scan re-implements the shape of that literal, and a
 * second copy of a rule is how the two drift apart; it would be a guard that fails for
 * being out of date about parsing rather than about the count. It is a hand-checked
 * number: if you change the hook surface, re-read it with `Object.keys(window.__ff).length`
 * in the browser and update `AGENTS.md` and `src/app/main.ts`, which both state it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');

/** The suite is every `tools/test-*.mjs` — the same glob `run-ui-tests.mjs` collects. */
function probeCount(): number {
  return readdirSync(join(root, 'tools')).filter((f) => f.startsWith('test-') && f.endsWith('.mjs')).length;
}

/**
 * Every markdown file at the repo root, rather than a hand-picked pair: only AGENTS.md and
 * README.md state a probe count today, but a list that has to be remembered is one more
 * thing to forget, and reading five small files costs nothing.
 */
function rootDocs(): string[] {
  return readdirSync(root).filter((f) => f.endsWith('.md'));
}

describe('the docs state the real number of UI probes', () => {
  it('every "<n> UI probes" claim matches the files on disk', () => {
    const actual = probeCount();
    // Sanity: if the glob ever stops finding probes, the claims below would all have to
    // become 0 and this test would "pass" by agreeing with nonsense.
    expect(actual).toBeGreaterThan(50);

    let total = 0;
    for (const doc of rootDocs()) {
      const text = readFileSync(join(root, doc), 'utf8');
      // `[*_\s]*` so bolded or italicised counts are still seen — see the header.
      const claims = [...text.matchAll(/(\d+)[*_\s]*\s+UI probes/g)];
      total += claims.length;
      for (const m of claims) {
        expect(Number(m[1]), `${doc} says "${m[0].trim()}" but tools/ has ${actual} probes`).toBe(actual);
      }
    }
    // Otherwise a rewording that hid every claim would leave this test green and useless.
    expect(total, 'the docs should state the probe count somewhere').toBeGreaterThan(0);
  });
});
