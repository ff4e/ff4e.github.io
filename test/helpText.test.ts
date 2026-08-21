/**
 * The help transcription (src/data/helpText.ts) against the thing it was transcribed from.
 *
 * Three thousand words of somebody else's Czech and English is exactly the kind of artefact
 * that goes wrong quietly: a page half-typed, a figure renamed, a paragraph that lost its
 * text in an edit. None of that shows up as a crash — it shows up as a help page that is
 * mysteriously short. So the cheap invariants are pinned here rather than trusted.
 *
 * The oracle is the ORIGINAL, not the transcription: the page count, the order and the tab
 * names are read out of `helpy.txt`/`helps.txt` (CP1250, Help.pas:FormShow) at test time,
 * and the figure ids are checked against the files on disk.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { helpFigureIds, helpPages, type HelpBlock, type HelpLang } from '../src/data/helpText.js';

const HELP_DIR = join('public', 'data', 'Help');
const FIG_DIR = join('public', 'help');

/** Parse an index file into its (tab, bitmap) pairs, exactly as the original reads it. */
function readIndex(file: string): { tab: string; bmp: string }[] {
  const text = new TextDecoder('windows-1250').decode(readFileSync(join(HELP_DIR, file)));
  const lines = text.split(/\r?\n/);
  const out: { tab: string; bmp: string }[] = [];
  // Line 0 is `W H margin`; the rest alternate tab name / filename.
  for (let i = 1; i + 1 < lines.length; i += 2) {
    if (!/\.bmp$/i.test(lines[i + 1]!.trim())) continue;
    out.push({ tab: lines[i]!.replace(/\r$/, ''), bmp: lines[i + 1]!.trim() });
  }
  return out;
}

/** Every string a block shows the player. */
function textsOf(b: HelpBlock): string[] {
  switch (b.kind) {
    case 'logo':
      return [b.tagline];
    case 'footer':
      return b.lines;
    case 'list':
      return b.items;
    case 'figures':
      return [];
    case 'inlineFigure':
      return [b.alt];
    default:
      return [b.text];
  }
}

const LANGS: HelpLang[] = ['cz', 'en'];
const INDEX: Record<HelpLang, string> = { cz: 'helpy.txt', en: 'helps.txt' };

describe('help transcription', () => {
  for (const lang of LANGS) {
    const index = readIndex(INDEX[lang]);
    const pages = helpPages(lang);

    it(`${lang}: has one page per entry of ${INDEX[lang]}`, () => {
      expect(index.length).toBe(10);
      expect(pages.length).toBe(index.length);
    });

    it(`${lang}: keeps the original's page order and tab names`, () => {
      expect(pages.map((p) => p.tab)).toEqual(index.map((e) => e.tab));
      expect(pages.map((p) => p.source)).toEqual(index.map((e) => e.bmp));
    });

    it(`${lang}: every page has a heading and body text`, () => {
      for (const page of pages) {
        const kinds = page.blocks.map((b) => b.kind);
        // Page 1 is the logo page: its "heading" is the wordmark.
        expect(kinds).toSatisfy((k: string[]) => k.includes('heading') || k.includes('title') || k.includes('logo'));
        expect(page.blocks.some((b) => b.kind === 'para')).toBe(true);
      }
    });

    it(`${lang}: no block is empty, and no paragraph carries collapsed whitespace`, () => {
      for (const page of pages) {
        for (const b of page.blocks) {
          for (const t of textsOf(b)) {
            expect(t.trim(), `${page.source} ${b.kind}`).not.toBe('');
            expect(t, `${page.source} ${b.kind}`).toBe(t.trim());
            expect(t, `${page.source} ${b.kind}`).not.toMatch(/\s{2}/);
          }
        }
      }
    });

    it(`${lang}: emphasis markers are balanced`, () => {
      for (const page of pages) {
        for (const b of page.blocks) {
          for (const t of textsOf(b)) {
            expect((t.match(/\*/g) ?? []).length % 2, `${page.source}: ${t.slice(0, 40)}`).toBe(0);
          }
        }
      }
    });

    it(`${lang}: the dead addresses are marked as such, never inline in prose`, () => {
      // D3: the 1998-2003 URLs are reproduced verbatim but not as links, so they live in
      // their own `url` blocks. A URL that drifted back into a paragraph would be rendered
      // as ordinary text and lose that marking silently.
      for (const page of pages) {
        for (const b of page.blocks) {
          if (b.kind === 'url') continue;
          for (const t of textsOf(b)) {
            if (b.kind === 'footer') continue; // page 1's copyright block quotes one, by design
            expect(t, `${page.source} ${b.kind}`).not.toMatch(/https?:\/\//);
          }
        }
      }
    });

    it(`${lang}: says exactly once that the addresses are dead`, () => {
      const today = pages.flatMap((p) => p.blocks).filter((b) => b.kind === 'today');
      expect(today.length).toBe(1);
    });
  }

  it('both languages carry the same figures, and every one is on disk', () => {
    const czFigs = helpPages('cz').flatMap((p) => [...(p.column ?? []), ...figIds(p.blocks)]);
    const enFigs = helpPages('en').flatMap((p) => [...(p.column ?? []), ...figIds(p.blocks)]);
    // The artwork is identical in both bitmaps (tools/crop-help-diagrams.ts), so the two
    // languages must reference the same twelve files — a per-language set would mean
    // somebody re-cropped one and the pages have quietly diverged.
    expect(czFigs).toEqual(enFigs);

    const onDisk = new Set(
      readdirSync(FIG_DIR)
        .filter((f) => f.endsWith('.png'))
        .map((f) => f.replace(/\.png$/, '')),
    );
    const referenced = helpFigureIds();
    expect(referenced.length).toBe(12);
    for (const id of referenced) expect(onDisk.has(id), `public/help/${id}.png is missing`).toBe(true);
    // And nothing unreferenced is shipped: a stale crop is 20 kB nobody fetches.
    for (const id of onDisk) expect(referenced.includes(id), `public/help/${id}.png is unreferenced`).toBe(true);
  });

  it('reproduces the original mistakes it promises to reproduce', () => {
    // The header of helpText.ts lists these as deliberate. Pinned so that a well-meaning
    // spellcheck pass has to delete this test on the way, rather than sail through review.
    const cz = helpPages('cz');
    const en = helpPages('en');
    const all = (pages: ReturnType<typeof helpPages>) =>
      pages.flatMap((p) => p.blocks.flatMap(textsOf)).join('\n');
    expect(all(cz)).toContain('jdeš srávnou cestou');
    expect(all(cz)).toContain('pouze na rybce..');
    expect(all(cz)).toContain('kdy je je jeho řešení');
    expect(all(cz)).toContain('a svěřepě odmítala');
    expect(all(en)).toContain('After running the leve the control panel');
    expect(all(en)).toContain('restart th current level');
    expect(all(en)).toContain('but is certainly an option');
    expect(all(en)).toContain('the Lshaped object');
    expect(all(en)).toContain('better tha n the previous one');
    expect(all(en)).toContain('Another titles from ALTAR');
  });
});

function figIds(blocks: HelpBlock[]): string[] {
  return blocks.flatMap((b) => (b.kind === 'figures' ? b.ids : b.kind === 'inlineFigure' ? [b.id] : []));
}
