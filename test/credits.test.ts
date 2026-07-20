/**
 * Scrolling-credits compositor (UMain.pas KresliCredits:1171): the static
 * frame's transparent window reveals the scroll strip at offset `posun`, showing
 * the background colour before the strip enters and after it leaves.
 */
import { describe, it, expect } from 'vitest';
import { Credits } from '../src/render/credits.js';
import type { Bmp } from '../src/data/bmp.js';

// Grey-ramp palette so an RGBA red channel equals the palette index it came from.
const RAMP = Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i }));

// 2x2 static frame: black = pixel[0] = 5, transp = pixel[3] = 7 (only at (1,1)).
const stat: Bmp = { w: 2, h: 2, pixels: new Uint8Array([5, 9, 9, 7]), palette: RAMP };
// 2x3 scroll strip (top-down). Delphi reads it bottom-up, so row yobs=0 is the
// image's bottom row [14,15].
const mov: Bmp = { w: 2, h: 3, pixels: new Uint8Array([10, 11, 12, 13, 14, 15]), palette: RAMP };

/** The palette index shown at (x,y) for a render (red channel == index via RAMP). */
function idxAt(c: Credits, posun: number, x: number, y: number): number {
  return c.render(posun)[(y * c.w + x) * 4]!;
}

describe('credits compositor', () => {
  const c = new Credits(stat, mov);

  it('exposes the scroll-strip height and close points', () => {
    expect(c.delka).toBe(3);
    expect(c.maxScroll).toBe(3 + 150);
    expect(c.closeAt).toBe(3 + 150 + 600);
  });

  it('keeps non-transparent static pixels regardless of scroll', () => {
    for (const posun of [0, 1, 4]) {
      expect(idxAt(c, posun, 0, 0)).toBe(5);
      expect(idxAt(c, posun, 1, 0)).toBe(9);
      expect(idxAt(c, posun, 0, 1)).toBe(9);
    }
  });

  it('shows background through the window before the strip enters', () => {
    // posun=0 → yobs=-1 at (1,1): out of range → black (5).
    expect(idxAt(c, 0, 1, 1)).toBe(5);
  });

  it('reveals the strip (bottom-up) through the window', () => {
    // posun=1 → yobs=0 → mov[(3-1-0)*2 + 1] = mov[5] = 15.
    expect(idxAt(c, 1, 1, 1)).toBe(15);
  });

  it('shows background again once the strip has scrolled past', () => {
    // posun=4 → yobs=3, not < delka(3) → black (5).
    expect(idxAt(c, 4, 1, 1)).toBe(5);
  });
});
