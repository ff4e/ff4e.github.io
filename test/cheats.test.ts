/**
 * The typed-cheat entry machine and its sprite transforms
 * (Uovl.pas:744-776 / UMain.pas:1750-1786, URoom.pas:23832 + 23892).
 *
 * The twelve cheat words are the XOR-obfuscated table at Uovl.pas:170-182 decoded
 * against key 113 * 113^n mod 256 — the plaintext in the commented-out block just
 * above it is stale in two places (TETRIS, not "cubes"; WEMAKETHERULEZ with a Z),
 * so these tests pin the shipped spellings.
 */
import { describe, it, expect } from 'vitest';
import { CheatEntry, CHEATS, pretoc, morphShrink, morphStretch } from '../src/core/cheats.js';
import type { FfrBitmap } from '../src/data/ffr.js';

/** Feed a whole string; returns every cheat that fired. */
function type(e: CheatEntry, s: string): string[] {
  const fired: string[] = [];
  for (const ch of s) {
    const r = e.press(ch);
    if (r.cheat) fired.push(r.cheat);
  }
  return fired;
}

/** Which keys the machine swallowed (true) versus let through (false). */
function swallowed(e: CheatEntry, s: string): boolean[] {
  return [...s].map((ch) => e.press(ch).swallowed);
}

describe('cheat table', () => {
  it('is the twelve words decoded from the shipped XOR table', () => {
    expect(CHEATS).toEqual([
      'MEGABOMB',
      'TETRIS',
      'UNDEAD',
      'MORPH',
      'FISHER',
      'STORM',
      'INTERLACED',
      'SILENT',
      'WEMAKETHERULEZ',
      'IAMACHEATER',
      'SCORE',
      'ULTRAVIOLENCE',
    ]);
  });

  it('has no word that is a prefix of another (the Delphi takes the first match)', () => {
    for (const a of CHEATS) {
      for (const b of CHEATS) {
        if (a !== b) expect(b.startsWith(a)).toBe(false);
      }
    }
  });
});

describe('CheatEntry', () => {
  it('is inert until X arms it', () => {
    const e = new CheatEntry();
    expect(e.armed).toBe(false);
    expect(type(e, 'STORM')).toEqual([]); // no X: nothing fires
    expect(swallowed(e, 'STORM')).toEqual([false, false, false, false, false]);
  });

  it('fires a code typed after X', () => {
    const e = new CheatEntry();
    expect(type(e, 'XSTORM')).toEqual(['STORM']);
  });

  it('is case-insensitive (the original sees the uppercase VK char)', () => {
    const e = new CheatEntry();
    expect(type(e, 'xmegabomb')).toEqual(['MEGABOMB']);
  });

  it('pins the spellings the port previously got wrong', () => {
    expect(type(new CheatEntry(), 'xwemaketherulez')).toEqual(['WEMAKETHERULEZ']);
    expect(type(new CheatEntry(), 'xwemaketherules')).toEqual([]);
    expect(type(new CheatEntry(), 'xtetris')).toEqual(['TETRIS']);
    expect(type(new CheatEntry(), 'xcubes')).toEqual([]);
  });

  it('swallows the X and every letter of a code in progress', () => {
    const e = new CheatEntry();
    expect(swallowed(e, 'XSTOR')).toEqual([true, true, true, true, true]);
  });

  it('collapses an immediately repeated key (a held key is not typed twice)', () => {
    const e = new CheatEntry();
    expect(type(e, 'XSSTTORM')).toEqual(['STORM']);
  });

  it('does not collapse a legitimately doubled letter across the buffer', () => {
    // MEGABOMB has no doubles, but the rule only ever suppresses an immediate
    // repeat — a letter reappearing later still lands.
    const e = new CheatEntry();
    expect(type(e, 'XMEGABOMB')).toEqual(['MEGABOMB']);
  });

  it('parks itself on the first letter that cannot continue any code, and lets it through', () => {
    const e = new CheatEntry();
    expect(e.press('X').swallowed).toBe(true);
    expect(e.press('S').swallowed).toBe(true); // STORM/SILENT/SCORE all still live
    expect(e.press('Q').swallowed).toBe(false); // dead end: falls through to the game
    expect(e.armed).toBe(false);
    expect(type(e, 'TORM')).toEqual([]); // stays parked until the next X
  });

  it('re-arms on a fresh X mid-code', () => {
    const e = new CheatEntry();
    type(e, 'XSTO');
    expect(type(e, 'XMORPH')).toEqual(['MORPH']);
  });

  it('parks after a code fires, so the next code needs its own X', () => {
    const e = new CheatEntry();
    expect(type(e, 'XSTORM')).toEqual(['STORM']);
    expect(e.armed).toBe(false);
    expect(type(e, 'STORM')).toEqual([]);
    expect(type(e, 'XSTORM')).toEqual(['STORM']);
  });

  it('ignores non-single-character keys', () => {
    const e = new CheatEntry();
    e.press('X');
    expect(e.press('Enter').swallowed).toBe(false);
    expect(e.armed).toBe(true); // and does not disturb the buffer
    expect(type(e, 'STORM')).toEqual(['STORM']);
  });
});

/** Build a bitmap whose pixel values encode their own (x,y) for easy assertions. */
function bmp(w: number, h: number, f: (x: number, y: number) => number): FfrBitmap {
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) pixels[y * w + x] = f(x, y);
  return { w, h, pixels, padded: 0 };
}

describe('pretoc (xundead sprite flip)', () => {
  it('flips the rows and leaves the size alone', () => {
    const src = bmp(3, 4, (_x, y) => y + 1);
    const out = pretoc(src);
    expect(out.w).toBe(3);
    expect(out.h).toBe(4);
    expect([...out.pixels]).toEqual([4, 4, 4, 3, 3, 3, 2, 2, 2, 1, 1, 1]);
  });

  it('is its own inverse, so typing the code twice restores the fish', () => {
    const src = bmp(5, 7, (x, y) => (x * 7 + y * 3) % 251);
    expect([...pretoc(pretoc(src)).pixels]).toEqual([...src.pixels]);
  });

  it('does not touch the source bitmap (the parsed FFR data is shared)', () => {
    const src = bmp(2, 2, (x, y) => x + 2 * y);
    const before = [...src.pixels];
    pretoc(src);
    expect([...src.pixels]).toEqual(before);
  });
});

describe('morph (xmorph sprite reshape)', () => {
  it('shrinks the big fish to 3/4 width and half height', () => {
    const big = bmp(16, 8, () => 0);
    const out = morphShrink(big);
    expect(out.w).toBe(12); // 16 - 16 div 4
    expect(out.h).toBe(4); // 8 div 2
    expect(out.pixels.length).toBe(48);
  });

  it('drops every third source column and every other source row', () => {
    // Row-major source values = the source column index, so the output records
    // exactly which columns survived.
    const big = bmp(16, 4, (x) => x);
    const out = morphShrink(big);
    expect([...out.pixels.subarray(0, 12)]).toEqual([0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]);
    // Second output row comes from source row 2, not row 1.
    const rows = bmp(16, 4, (_x, y) => y);
    const outRows = morphShrink(rows);
    expect(outRows.pixels[0]).toBe(0);
    expect(outRows.pixels[12]).toBe(2);
  });

  it('stretches the little fish to 4/3 width and double height', () => {
    const little = bmp(12, 3, () => 0);
    const out = morphStretch(little);
    expect(out.w).toBe(16); // 12 + 12 div 3
    expect(out.h).toBe(6); // 3 * 2
    expect(out.pixels.length).toBe(96);
  });

  it('repeats every fourth column and each source row twice', () => {
    const little = bmp(12, 2, (x) => x);
    const out = morphStretch(little);
    expect([...out.pixels.subarray(0, 16)]).toEqual([
      0, 0, 1, 2, 3, 3, 4, 5, 6, 6, 7, 8, 9, 9, 10, 11,
    ]);
    const rows = bmp(12, 2, (_x, y) => y);
    const outRows = morphStretch(rows);
    expect(outRows.pixels[0]).toBe(0);
    expect(outRows.pixels[16]).toBe(0); // output row 1 still comes from source row 0
    expect(outRows.pixels[32]).toBe(1); // output row 2 moves on to source row 1
  });

  it('consumes exactly the source width in each direction', () => {
    // The Delphi advances the source pointer once per kept pixel; a mismatch would
    // read past the row end (or leave a column unread) and skew the sprite.
    for (const w of [8, 12, 16, 20, 24]) {
      expect(morphShrink(bmp(w, 2, () => 1)).w).toBeLessThan(w);
      expect(morphStretch(bmp(w, 2, () => 1)).w).toBeGreaterThan(w);
    }
    const shrunk = morphShrink(bmp(16, 2, (x) => x));
    expect(shrunk.pixels[shrunk.w - 1]).toBe(14); // last kept source column
    const grown = morphStretch(bmp(12, 2, (x) => x));
    expect(grown.pixels[grown.w - 1]).toBe(11); // last source column, reached exactly
  });
});
