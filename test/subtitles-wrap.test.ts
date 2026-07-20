/**
 * Subtitle word-wrap (NovyTitulek, URoom.pas:592): every wrapped line must fit within
 * `roomWidth - 2*bordertitle`, so a centered line never spills past the room edges. The
 * old port only stripped ONE trailing word without re-checking, so multi-word lines in
 * narrow rooms stayed too wide and ran off the left edge — this is the regression guard.
 */
import { describe, it, expect } from 'vitest';
import { SubtitleSystem } from '../src/render/subtitles.js';
import type { FontData } from '../src/render/font.js';
import type { FfrPaletteEntry } from '../src/data/ffr.js';

const BORDERTITLE = 20;

/** A fake font: every non-space glyph is 10px wide, a space 8px. */
const fakeFont = {
  coltab: new Map(),
  coltab2: new Map(),
  textWidth: (s: string) => [...s].reduce((w, c) => w + (c === ' ' ? 8 : 10), 0),
} as unknown as FontData;

const palette: FfrPaletteEntry[] = Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 }));

interface Line {
  obsah: string;
  xs: number;
}

function lines(sub: SubtitleSystem): Line[] {
  return (sub as unknown as { titles: Line[] }).titles;
}

describe('subtitle word-wrap fits the room width', () => {
  it('wraps a multi-word line in a narrow room so every line fits (and stays centred)', () => {
    const screenW = 140; // maxW = 100 -> ~10 chars per line
    const maxW = screenW - BORDERTITLE * 2;
    const sub = new SubtitleSystem(fakeFont, palette, 9, screenW, 100);

    // 4 four-letter words = 184px total; the old code emitted "aaaa bbbb cccc" (136px).
    sub.newSubtitle('aaaa bbbb cccc dddd', 'a', 0);

    const ls = lines(sub);
    expect(ls.length).toBeGreaterThan(1); // it actually wrapped
    for (const l of ls) {
      expect(fakeFont.textWidth(l.obsah)).toBeLessThanOrEqual(maxW); // no line overflows
      expect(l.xs).toBeGreaterThanOrEqual(0); // centred line starts on-screen (never off the left)
    }
    // The words are preserved in order across the wrap.
    expect(ls.map((l) => l.obsah).join(' ')).toBe('aaaa bbbb cccc dddd');
  });

  it('keeps a line that already fits on a single line', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 40, 600, 100);
    sub.newSubtitle('short line', 'a', 0);
    expect(lines(sub).length).toBe(1);
    expect(lines(sub)[0]!.obsah).toBe('short line');
  });
});
