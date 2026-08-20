/**
 * One door for the network, checked statically.
 *
 * ── Why a test and not a rule ─────────────────────────────────────────────────
 * The old design FAILED OPEN. A loader that forgot to handle a failure produced
 * silence, because after boot the app deliberately ignored unhandled rejections — so
 * "I forgot" and "I decided this is optional" compiled to the same program. Nobody ever
 * chose that for the 14 kinds of asset that ended up failing silently; it was the
 * default, applied 14 times.
 *
 * Sweeping the call sites once fixes the list of the day and leaves the trap armed for
 * the next asset anyone adds. What closes it is that there is exactly ONE way to reach
 * the network, and that way makes the question mandatory:
 *
 *   - `requiredAsset(url, what)` — must exist; 404 or failure ends the session.
 *   - `optionalAsset(url)` — null when absent BY DESIGN; a failure still throws.
 *
 * This test is what keeps that true. A new bare `fetch` cannot be added without it
 * going red and the author writing a sentence about why — which is the whole mechanism:
 * not prevention, but a forced sentence.
 *
 * ── What it does NOT cover ────────────────────────────────────────────────────
 * `<video src>` in `intro.ts`. A media element streams, and its `error` event cannot
 * tell a 404 from a dropped connection — the exact distinction the policy rests on — so
 * routing it through this door would buy a label the platform cannot supply. The intro
 * movie is skippable by design (`IntroPlayer`'s error handler goes to the map), which is
 * the same reason it was never in the audit. If that ever changes, it needs a
 * `requiredAsset` HEAD probe, not an exemption here.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `fileURLToPath`, not `new URL(...).pathname`: the latter is not a filesystem path once
// the directory contains a space (%20) or the platform is Windows (/C:/...).
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');

/**
 * The ONE file allowed to call `fetch`, and it is the file this whole test exists to
 * funnel everything into. A second entry here is not a formality — it is the sentence
 * the author owes the next reader, so it goes in with a comment saying why.
 */
const ALLOWED = new Set(['src/render/assetFetch.ts']);

/**
 * `fetch(`, but not `fetchAsset(`, `prefetch(` or `refetch(`.
 *
 * The lookbehind rejects an identifier character before the name, so `fetchFoo` and
 * `xfetch` are not matches; requiring `(` immediately after (modulo spaces) rejects
 * `fetchAsset`. `window.fetch(` and `globalThis.fetch(` ARE matched — a dot is not an
 * identifier character — which is deliberate: they are the same door with a hat on.
 */
const BARE_FETCH = /(?<![A-Za-z0-9_$])fetch\s*\(/;

/** Every `.ts` file under `src/`, as repo-relative POSIX paths. */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (name.endsWith('.ts')) out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

/** Strip comments and string bodies, so prose about `fetch(` is not a violation. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '``')
    .replace(/'(?:\\[\s\S]|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\[\s\S]|[^"\\\n])*"/g, '""');
}

const HOWTO =
  'Every request for a game asset goes through src/render/assetFetch.ts. Pick a DOOR: requiredAsset(url, ' +
  'what, tier) when the file must exist, or optionalAsset(url, tier) when its ABSENCE is the design — the ' +
  'enhanced tiers, the credits port strip, the AI movie probe. Then pick a TIER, which is a different ' +
  'question and has no default: mustHave (a failure ends the session), shouldHave (a note, and play goes ' +
  'on) or niceToHave (silent). If a gesture — a hover, a draw frame — can start your fetch, it is ' +
  'shouldHave at most; see test/asset-tier-discipline.test.ts.';

describe('asset fetch discipline', () => {
  const files = sourceFiles(srcDir);

  it('finds the sources to check', () => {
    // A path mistake would make every check below pass vacuously — this is the guard on
    // the guard. The repo has ~450 files under src/, tools/ and test/.
    expect(files.length).toBeGreaterThan(100);
    for (const allowed of ALLOWED) expect(files).toContain(allowed);
  });

  it('routes every network request through the one door', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (ALLOWED.has(file)) continue;
      const lines = code(readFileSync(join(root, file), 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (BARE_FETCH.test(line)) offenders.push(`${file}:${i + 1} — ${line.trim()}`);
      });
    }
    expect(offenders, HOWTO).toEqual([]);
  });

  it('keeps the allowlist to the door itself', () => {
    // The allowlist is the escape hatch, so it is worth noticing when it grows. One
    // entry, and adding a second should be a decision somebody argues for in a PR.
    expect([...ALLOWED]).toEqual(['src/render/assetFetch.ts']);
  });

  it('offers no way to reach the network without answering the question', () => {
    // `fetchAsset` classifies but does not decide, so a caller holding one is a caller
    // that has not chosen a policy. It is module-private for that reason; if it is ever
    // exported again, every guarantee above becomes advisory.
    const door = readFileSync(join(root, 'src/render/assetFetch.ts'), 'utf8');
    expect(door).toMatch(/^async function fetchAsset\(/m);
    expect(door).not.toMatch(/^export (async )?function fetchAsset\(/m);
  });

  it('can actually fail — a bare fetch in a source file is caught', () => {
    // A guard test that cannot go red is worse than no test, because it is read as
    // evidence. The mutation is applied to the real checker, not to a copy of its regex.
    const mutated = 'const r = await fetch(url);';
    expect(BARE_FETCH.test(code(mutated))).toBe(true);
    expect(BARE_FETCH.test(code('const r = await window.fetch(url);'))).toBe(true);
    // ...and does not fire on the things that merely look like it.
    expect(BARE_FETCH.test(code('await fetchAsset(url);'))).toBe(false);
    expect(BARE_FETCH.test(code('await prefetch(url);'))).toBe(false);
    expect(BARE_FETCH.test(code('// a bare fetch( in a comment'))).toBe(false);
    expect(BARE_FETCH.test(code("const s = 'fetch(';"))).toBe(false);
  });
});
