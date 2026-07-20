/**
 * WIN ("Favorites") palette gag (URoom.pas:1312-1355). The Favorites room's art is
 * painted in ~17 magenta/pink PLACEHOLDER colours; at load time the original replaces
 * each with the machine's actual Windows system colour (clActiveCaption, clWindow,
 * clBtnFace, clBackGround, …) — so the fake "windows" looked like the player's own
 * desktop theme. We reproduce it with the classic Windows-95/98 "Windows Standard"
 * default scheme (the theme the vast majority of players ran).
 *
 * Each placeholder is matched to the nearest palette index (Najdi, the engine's weighted
 * colour distance) and that entry is overwritten (Nahrad) with the system colour.
 */
import type { FfrPaletteEntry } from './ffr.js';

type RGB = [number, number, number];

/** [placeholder RGB, replacement system colour] pairs, in original order (URoom.pas:1314-1349). */
const SUBSTITUTIONS: ReadonlyArray<readonly [RGB, RGB]> = [
  [[255, 0, 192], [0, 0, 128]], // clActiveCaption — title bar (navy)
  [[192, 64, 192], [255, 255, 255]], // clCaptionText (white)
  [[255, 64, 192], [192, 192, 192]], // clMenu (grey)
  [[128, 0, 64], [0, 0, 0]], // clMenuText (black)
  [[125, 0, 125], [128, 128, 128]], // clInactiveCaption (grey)
  [[255, 192, 255], [192, 192, 192]], // clInactiveCaptionText
  [[255, 224, 255], [255, 255, 255]], // clWindow (white)
  [[192, 0, 255], [0, 0, 0]], // clWindowText (black)
  [[255, 128, 192], [192, 192, 192]], // clActiveBorder
  [[255, 64, 255], [192, 192, 192]], // clInactiveBorder
  [[192, 0, 192], [0, 128, 128]], // clBackGround — the iconic Win95 teal desktop
  [[255, 168, 255], [0, 0, 0]], // clBtnText (black)
  [[255, 128, 255], [255, 255, 255]], // clBtnHighlight (white)
  [[255, 0, 255], [192, 192, 192]], // clBtnFace — the classic button grey (index 25)
  [[168, 0, 168], [128, 128, 128]], // clBtnShadow
  [[192, 64, 255], [0, 0, 128]], // clHighlight — selection blue
  // buf[1016]: Najdi(128,255,0) -> clWhite/clBlack by clBackGround brightness. clBackGround
  // = (0,128,128), sum 256 <= 384, so it maps to white (URoom.pas:1350-1353).
  [[128, 255, 0], [255, 255, 255]],
];

/** Najdi (URoom.pas:1095): nearest palette index by the engine's weighted colour distance. */
function nearest(palette: readonly FfrPaletteEntry[], [r, g, b]: RGB): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i]!;
    const err = 0.35 * (r - c.r) ** 2 + 0.5 * (g - c.g) ** 2 + 0.15 * (b - c.b) ** 2;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

/** Return a copy of `palette` with the WIN placeholder colours replaced by system colours. */
export function applyWinDesktopPalette(palette: readonly FfrPaletteEntry[]): FfrPaletteEntry[] {
  const out = palette.map((c) => ({ ...c }));
  for (const [placeholder, [r, g, b]] of SUBSTITUTIONS) {
    const idx = nearest(palette, placeholder); // match against the ORIGINAL palette
    out[idx] = { r, g, b };
  }
  return out;
}
