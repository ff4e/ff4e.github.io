/**
 * WIN "Favorites" palette gag (URoom.pas:1312-1355): the pink placeholder colours are
 * replaced with the Windows system theme. Verifies the two most visible mappings —
 * the magenta button-face becomes Win95 grey, and the desktop placeholder becomes teal.
 */
import { describe, it, expect } from 'vitest';
import { applyWinDesktopPalette } from '../src/data/winPalette.js';
import type { FfrPaletteEntry } from '../src/data/ffr.js';

// The 17 placeholder colours in original order (URoom.pas:1314-1330), placed at distinct
// indices 20..36 so each maps to its own entry (as in the real WIN palette).
const PLACEHOLDERS: [number, number, number][] = [
  [255, 0, 192], [192, 64, 192], [255, 64, 192], [128, 0, 64], [125, 0, 125],
  [255, 192, 255], [255, 224, 255], [192, 0, 255], [255, 128, 192], [255, 64, 255],
  [192, 0, 192], [255, 168, 255], [255, 128, 255], [255, 0, 255], [168, 0, 168],
  [192, 64, 255], [128, 255, 0],
];
const BASE = 20;
const IDX = {
  window: BASE + 6, // clWindow (255,224,255)
  background: BASE + 10, // clBackGround (192,0,192)
  btnFace: BASE + 13, // clBtnFace / magenta (255,0,255)
};

function palette(): FfrPaletteEntry[] {
  const p: FfrPaletteEntry[] = Array.from({ length: 256 }, () => ({ r: 5, g: 5, b: 5 }));
  PLACEHOLDERS.forEach(([r, g, b], k) => (p[BASE + k] = { r, g, b }));
  return p;
}

describe('WIN desktop palette gag', () => {
  it('replaces the magenta button-face with Win95 grey and the desktop with teal', () => {
    const out = applyWinDesktopPalette(palette());
    expect(out[IDX.btnFace]).toEqual({ r: 192, g: 192, b: 192 }); // magenta -> Win95 grey
    expect(out[IDX.background]).toEqual({ r: 0, g: 128, b: 128 }); // desktop -> teal
    expect(out[IDX.window]).toEqual({ r: 255, g: 255, b: 255 }); // window -> white
  });

  it('leaves the original palette untouched (returns a copy)', () => {
    const p = palette();
    applyWinDesktopPalette(p);
    expect(p[IDX.btnFace]).toEqual({ r: 255, g: 0, b: 255 });
  });
});
