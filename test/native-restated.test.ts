/**
 * Drift guard for the code the native host restates from `src/app/` (native/README.md,
 * "How the browser's flow runs without the browser"). `main.ts` owns `buildRoom`, the save
 * slots, the win bookkeeping and the keyboard router and does not export them, so
 * `native/js/game.ts` carries copies — and a copy nothing ties to its source drifts.
 *
 * Each copy carries a marker naming its source and a hash of it:
 *
 *     // restates src/app/main.ts `function buildRoom(` @ 0123456789ab
 *
 * The test extracts that source span (from the anchor to the end of its statement or
 * block), drops comments and collapses whitespace, and compares the hash. Any change to the
 * source fails here until the copy has been re-read against it and the pin updated — the
 * failure prints the new hash. A comment-only or whitespace-only change does not.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractSpan, spanHash } from './restatedSpan.js';

const repo = join(__dirname, '..');
const MARKER = /restates (src\/\S+) `([^`]+)` @ ([0-9a-f]{12})/g;

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const markers = tsFiles(join(repo, 'native', 'js')).flatMap((file) => {
  const text = readFileSync(file, 'utf8');
  return [...text.matchAll(MARKER)].map((m) => ({
    at: `${relative(repo, file)}:${text.slice(0, m.index).split('\n').length}`,
    source: m[1]!,
    anchor: m[2]!,
    pinned: m[3]!,
  }));
});

describe('native restated code', () => {
  it('pins every copy it knows of', () => {
    // A deleted marker must not pass for a clean check.
    expect(markers.length).toBeGreaterThanOrEqual(45);
  });

  it.each(markers)('$at is still the copy of $source `$anchor`', ({ at, source, anchor, pinned }) => {
    const now = spanHash(extractSpan(readFileSync(join(repo, source), 'utf8'), anchor));
    expect(
      now,
      `${source} \`${anchor}\` changed since ${at} restated it: re-read the copy against it, then pin @ ${now}`,
    ).toBe(pinned);
  });

  it('extracts a whole block, a whole statement, and ignores comments and spacing', () => {
    const src = "x;\nfunction f(a) {\n  // }\n  const s = `}${a + '}'}`;\n  if (a) { return '{'; }\n}\nwindow.on('k', () => g({}));\nrest();";
    expect(extractSpan(src, 'function f(')).toBe("function f(a) { const s = `}${a + '}'}`; if (a) { return '{'; } }");
    expect(extractSpan(src, "window.on('k'")).toBe("window.on('k', () => g({}));");
    expect(spanHash(extractSpan(src.replace('  if', '\n\n    if /* c */'), 'function f('))).toBe(spanHash(extractSpan(src, 'function f(')));
  });
});
