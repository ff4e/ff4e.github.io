/**
 * The README maps must describe the code as it is now.
 *
 * `README.md` carries navigation maps — a file table for `src/app/` and one for
 * `src/render/` — and their whole value is that a reader can trust them enough to open
 * one file instead of reading a directory. A map that has drifted is worse than no map:
 * it sends people confidently to the wrong place.
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
 *   - A path NOT ending in `/` would be a FILE map: a table of line ranges inside one
 *     file. There are none left, and this test now REJECTS them. `src/app/main.ts` had
 *     one, generated from its `//#region` markers, for as long as the app was a single
 *     5 897-line file; it was deleted once the app became 37 files, because a line-range
 *     table is a promise to keep numbers honest across every edit and a directory of
 *     named files needs no such promise. If you find yourself adding one, split the file
 *     instead — that is what the ranges were compensating for.
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
        it('is a directory map — line-range maps are not kept any more', () => {
          expect(
            path,
            `README has a line-range map of ${path}. Those were dropped when src/app/ ` +
              'became a directory of named files: a range table has to be re-derived on ' +
              'every edit that moves a line, and nothing re-derives it now. Map the ' +
              'directory instead, or split the file so its parts have names.',
          ).toMatch(/\/$/);
        });
      }
    });
  }
});
