import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FontData } from '../src/render/font.js';
import { vectorSubtitleText } from '../src/render/subtitleChars.js';

const intro = join(import.meta.dirname, '..', 'public', 'data', 'Intro');
const font = new FontData(
  readFileSync(join(intro, 'Chars.dat')),
  readFileSync(join(intro, 'Chartab.dat')),
  readFileSync(join(intro, 'Charcol.dat')),
);

/** Runs of columns holding any ink (pixel value 4 is transparent). */
function inkRuns(ch: string): number {
  const g = font.glyphs.get(ch)!;
  let runs = 0;
  let inRun = false;
  for (let x = 0; x < g.width; x++) {
    let ink = false;
    for (let y = 0; y < g.height; y++) if (font.fontdat[g.addr + 4 + y * g.width + x] !== 4) ink = true;
    if (ink && !inRun) runs++;
    inRun = ink;
  }
  return runs;
}

describe('vector subtitle characters', () => {
  it('the original font draws `"` as three baseline dots, not a quotation mark', () => {
    const dq = font.glyphs.get('"')!;
    const dot = font.glyphs.get('.')!;
    expect(inkRuns('"')).toBe(3);
    expect(dq.yoff).toBe(dot.yoff);
    expect(dq.height).toBe(dot.height);
  });

  it('draws `"` as an ellipsis and `` ` `` as the closing quote/apostrophe', () => {
    expect(vectorSubtitleText('M: Hmmm" Pohneš s tím.')).toBe('M: Hmmm\u2026 Pohneš s tím.');
    expect(vectorSubtitleText('"we`ll follow your clicks.')).toBe('\u2026we\u2019ll follow your clicks.');
    expect(vectorSubtitleText("V: I think you are going to need that 'monster`.")).toBe(
      "V: I think you are going to need that 'monster\u2019.",
    );
  });

  it('keeps one character per character, so per-glyph wave timing is unchanged', () => {
    const s = 'Ááááá" ch"e`ch';
    expect([...vectorSubtitleText(s)].length).toBe([...s].length);
  });
});
