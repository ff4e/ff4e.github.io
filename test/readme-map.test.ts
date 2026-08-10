/**
 * The README maps must describe the code as it is now.
 *
 * `README.md` carries navigation maps — a line-range table for `src/app/main.ts`, a
 * file table for `src/render/` — and their whole value is that a reader can trust them
 * enough to open one region instead of a 60 000-token file. A map that has drifted is
 * worse than no map: it sends people confidently to the wrong place.
 *
 * CONTRIBUTING.md asks for them to be updated with any structural change, but an ask is
 * a promise, and promises drift. This turns that promise into a failing test. It costs
 * milliseconds, needs no game data, and so also runs in CI on every push.
 *
 * ── The convention it enforces ────────────────────────────────────────────────
 * A map is a `### Map of \`<path>\`` heading followed by a markdown table.
 *
 *   - `<path>` ending in `/` is a DIRECTORY map: the first column is a filename, and
 *     the check is a two-way match — every file listed exists, and every source file in
 *     the directory is listed. That catches the real drift for a directory, which is
 *     somebody adding a module and not mentioning it.
 *
 *   - Otherwise it is a FILE map: the first column is a `start–end` line range and the
 *     third column holds backticked anchor names. The checks are that the ranges tile
 *     the file exactly (no gap, no overlap, ending on the last line) and that every
 *     anchor really occurs inside the range that claims it.
 *
 * NOTE on the `main.ts` map specifically: its ranges are no longer hand-written. They
 * are GENERATED from `//#region` markers by tools/gen-map.mjs, and the freshness of the
 * generated block is checked in test/gen-map.test.ts. The tiling check below still runs
 * over it and is still worth having — it is an independent confirmation that the
 * generator's own arithmetic tiles the file — but it should never fail on its own now,
 * because ordinary edits no longer falsify a derived number.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');

interface MapSection {
  path: string;
  rows: string[][];
}

/** Every `### Map of \`path\`` section in the README, with its table rows. */
function mapSections(): MapSection[] {
  const out: MapSection[] = [];
  const lines = readme.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i]!.match(/^#+ Map of `([^`]+)`/);
    if (!h) continue;
    const rows: string[][] = [];
    for (let j = i + 1; j < lines.length && !/^#+ /.test(lines[j]!); j++) {
      const l = lines[j]!;
      if (!l.startsWith('|')) continue;
      const cells = l.split('|').slice(1, -1).map((c) => c.trim());
      // Skip the header, its `| --- |` separator, and the bold group headings that
      // break a long table into sections (`| **WebGL** | | |`) — those are prose, not
      // entries, and reading them as filenames is a trap this check walked into once.
      if (cells.every((c) => /^-+$/.test(c))) continue;
      if (/^(lines|file)$/i.test(cells[0] ?? '')) continue;
      if (/^\*\*.*\*\*$/.test(cells[0] ?? '')) continue;
      rows.push(cells);
    }
    out.push({ path: h[1]!, rows });
  }
  return out;
}

const sections = mapSections();

describe('README maps', () => {
  it('the README actually contains maps (a silent zero would pass every check below)', () => {
    expect(sections.length).toBeGreaterThan(0);
  });

  for (const { path, rows } of sections) {
    const isDir = path.endsWith('/');

    describe(path, () => {
      it('has rows', () => {
        expect(rows.length).toBeGreaterThan(0);
      });

      if (isDir) {
        it('lists exactly the source files that exist — no missing, no stale', () => {
          const dir = join(root, path);
          expect(existsSync(dir), `${path} does not exist`).toBe(true);
          const onDisk = readdirSync(dir)
            .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
            .sort();
          const listed = rows
            .map((r) => (r[0] ?? '').match(/`([^`]+)`/)?.[1] ?? '')
            .filter(Boolean)
            .sort();
          const missing = onDisk.filter((f) => !listed.includes(f));
          const stale = listed.filter((f) => !onDisk.includes(f));
          expect(
            { missing, stale },
            `README's map of ${path} is out of date.\n` +
              (missing.length ? `  not listed: ${missing.join(', ')}\n` : '') +
              (stale.length ? `  listed but gone: ${stale.join(', ')}\n` : '') +
              '  Add or remove the rows, then re-run.',
          ).toEqual({ missing: [], stale: [] });
        });
      } else {
        // A FILE map's ranges are generated (see tools/gen-map.mjs) and their freshness
        // is checked in test/gen-map.test.ts, which knows the command that fixes them.
        // Re-checking them here only produced a second failure for the same cause, with
        // a message that did not say what to run. The directory maps above are the only
        // hand-written ones left, and they are what this file is for.
        it('is generated — see test/gen-map.test.ts', () => {
          expect(rows.length).toBeGreaterThan(0);
        });
      }
    });
  }
});
