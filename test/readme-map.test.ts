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
 * The tiling check is the powerful one. Line numbers move when anybody adds a line
 * anywhere, so "the last row ends at EOF" fails the moment the file changes size — which
 * is exactly when the map needs attention.
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
        const file = readFileSync(join(root, path), 'utf8').split('\n');
        const ranges = rows.map((r) => {
          const m = (r[0] ?? '').match(/^(\d+)[–-](\d+)$/);
          return m ? { a: Number(m[1]), b: Number(m[2]), label: r[1] ?? '', anchors: r[2] ?? '' } : null;
        });

        it('every row starts with a line range', () => {
          const bad = rows.filter((_, i) => ranges[i] === null).map((r) => r[0]);
          expect(bad, `rows without a "start–end" range: ${bad.join(' | ')}`).toEqual([]);
        });

        const rs = ranges.filter((r): r is NonNullable<typeof r> => r !== null);

        it('the ranges tile the file exactly — no gap, no overlap, ending at the last line', () => {
          const problems: string[] = [];
          if (rs[0] && rs[0].a !== 1) problems.push(`first row starts at ${rs[0].a}, not 1`);
          for (let i = 1; i < rs.length; i++) {
            const prev = rs[i - 1]!;
            const cur = rs[i]!;
            if (cur.a !== prev.b + 1)
              problems.push(`"${cur.label}" starts at ${cur.a}, but "${prev.label}" ended at ${prev.b}`);
          }
          const last = rs[rs.length - 1];
          if (last && last.b !== file.length)
            problems.push(`last row ends at ${last.b}, but ${path} has ${file.length} lines`);
          expect(
            problems,
            `README's map of ${path} no longer matches the file:\n  ${problems.join('\n  ')}\n` +
              '  Line numbers move whenever the file changes size — update the ranges.',
          ).toEqual([]);
        });

        it('every anchor occurs inside the region that claims it', () => {
          const problems: string[] = [];
          for (const r of rs) {
            const names = [...r.anchors.matchAll(/`([^`]+)`/g)].map((m) => m[1]!);
            for (const raw of names) {
              // Anchors are written for a human: `loop()`, `keydown` / `keyup` listeners,
              // `await FontData.load`. Take the leading identifier and look for that.
              const name = raw.replace(/\(.*/, '').replace(/[^\w$].*$/, '');
              if (name.length < 3) continue;
              const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
              if (!file.slice(r.a - 1, r.b).some((l) => re.test(l)))
                problems.push(`\`${name}\` is not in ${r.a}–${r.b} ("${r.label}")`);
            }
          }
          expect(
            problems,
            `README's map of ${path} points at the wrong places:\n  ${problems.join('\n  ')}\n` +
              '  The code moved, or the anchor was renamed.',
          ).toEqual([]);
        });
      }
    });
  }
});
