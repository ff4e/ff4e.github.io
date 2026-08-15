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

/**
 * A wrapped sentence is several lines, and the vector renderer has to know which lines
 * came from one `newSubtitle` call so it can size them together (see `fitBlockFontPx`).
 * That is the only reason `block` exists — the original never needed it, because the
 * bitmap path draws every line at the same size.
 */
describe('id: which row is which', () => {
  // The DOM renderer keeps one element per row and recognises the row again next frame.
  // It used to do that by (startcount, speaker, text), which is not an identity — two
  // rows can agree on all three, and the renderer then drew one element where the engine
  // had two rows, losing one.
  it('gives every row a distinct id, even when two rows are identical', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 40, 600, 100);
    sub.newSubtitle('same line', 'M', 7);
    sub.newSubtitle('same line', 'M', 7); // same tick, same speaker, same text
    const ls = sub.debugLines();
    expect(ls).toHaveLength(2);
    expect(ls[0]!.id).not.toBe(ls[1]!.id);
  });

  // Not reset by `clear()`: an id that can come round again is not an identity, and the
  // renderer would match a fresh row against the element of a dead one.
  it('never reuses an id after a clear', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 40, 600, 100);
    sub.newSubtitle('a line', 'M', 0);
    const first = sub.debugLines()[0]!.id;
    sub.clear();
    sub.newSubtitle('a line', 'M', 0);
    expect(sub.debugLines()[0]!.id).not.toBe(first);
  });
});

describe('block: which lines are one message', () => {
  it('tags every line of a wrapped sentence with the same block', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 9, 140, 100);
    sub.newSubtitle('aaaa bbbb cccc dddd', 'a', 0);
    const ls = sub.debugLines();
    expect(ls.length).toBeGreaterThan(1); // it wrapped, so there is something to group
    expect(new Set(ls.map((l) => l.block)).size).toBe(1);
  });

  // The reason a `startcount`+speaker key is not enough: two calls CAN land on the same
  // tick with the same colour code (a scripted line while `talk()` fires, or the
  // `pushSubtitle` debug hook), and merging them would size one sentence to another's
  // longest row.
  it('separates two messages sent on the same tick by the same speaker', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 40, 600, 100);
    sub.newSubtitle('first line', 'M', 7);
    sub.newSubtitle('second line', 'M', 7);
    const ls = sub.debugLines();
    expect(ls).toHaveLength(2);
    expect(ls[0]!.block).not.toBe(ls[1]!.block);
  });
});

/**
 * `vectorAnimating` is what holds the render loop off the idle throttle while a line is
 * still moving (framePacing.ts) — so the interesting edge is the FALSE case: a line that
 * has settled and parked is still on screen, and the loop must be allowed to throttle
 * again. Nothing else asserts that; the probes only ever catch the true case, because
 * they sample while a line waves in.
 *
 * This test used to live in `subtitles-vector.test.ts`, which was deleted whole with the
 * canvas renderer. `vectorAnimating` was not part of that renderer and survived it.
 */
describe('vectorAnimating drives the idle throttle', () => {
  it('reports whether anything is still moving', () => {
    const sub = new SubtitleSystem(fakeFont, palette, 40, 600, 100);
    sub.newSubtitle('Careful', 'M', 0);
    expect(sub.vectorAnimating(0)).toBe(true); // wave just started
    for (let c = 1; c <= 30; c++) sub.tick(c);
    expect(sub.vectorAnimating(30)).toBe(false); // settled and parked
    expect(sub.active).toBe(true); // …but still on screen
  });
});
