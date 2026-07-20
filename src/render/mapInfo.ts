/**
 * The world-map "record" info panel (krokoměr / step-counter, UMain.pas:1364
 * KresliKrokomer) shown when an already-solved room is clicked. Pure geometry +
 * compositing helpers, unit-tested in isolation; the stateful wiring lives in
 * main.ts.
 *
 * Layout constants are the original's absolute map coordinates:
 *   - panel background `krokomer.bmp` at (193,141), 268×186
 *   - three 43×46 button icons from `ikonky.bmp` at y=222: Run x=258 (src col 0),
 *     Replay x=301 (src col 43), Cancel x=344 (src col 86); only the *hovered*
 *     button's highlighted icon is drawn over the panel's baked-in normal icons.
 *   - up to five 19×24 digits from `cisla.bmp` at (275+19·i, 177), each rolling in
 *     from 0 to its value (odometer: `y := 9*24 - 8*faze`, clamped to its digit).
 * Every blit is an opaque `move` (no transparency), matching Kresli (UMain.pas:1350).
 */
import type { Bmp } from '../data/bmp.js';

export const PANEL_X = 193;
export const PANEL_Y = 141;
export const PANEL_W = 268;
export const PANEL_H = 186;

export const ICON_W = 43;
export const ICON_H = 46;
export const ICON_Y = 222;

export const DIGIT_X0 = 275;
export const DIGIT_Y = 177;
export const DIGIT_W = 19;
export const DIGIT_H = 24;
export const INFO_DIGITS = 5;

export type InfoButton = 'run' | 'replay' | 'cancel';

/** The three buttons' map-space icon positions and their `ikonky.bmp` source column. */
export const INFO_BUTTONS: Readonly<Record<InfoButton, { x: number; srcX: number }>> = {
  run: { x: 258, srcX: 0 },
  replay: { x: 301, srcX: ICON_W },
  cancel: { x: 344, srcX: ICON_W * 2 },
};

/**
 * Once `faze` reaches this the odometer is fully settled (digit 9 rolls from
 * y=9·24=216 down to y=0 in steps of 8 → ⌈216/8⌉=27 frames), so callers can stop
 * advancing/repainting the panel.
 */
export const INFO_SETTLE_FAZE = 27;

/**
 * Wall-clock time per odometer frame. The original advances `InfoFaze` once per
 * game timer tick (KresliKrokomer's `Inc(InfoFaze)`), and Timer1.Interval = 100ms
 * (UMain.dfm), so the full roll takes 27·100ms ≈ 2.7s. Advancing per *paint*
 * instead would tie the speed to the frame rate (≈0.45s at 60fps), so the caller
 * gates it on this instead.
 */
export const INFO_FAZE_MS = 100;

/**
 * The button under map coordinate (mx,my) while the panel is open (UMain.pas:1626):
 * the icon band is y∈[222,268), split into Run [258,301) / Replay [301,344) /
 * Cancel [344,387). Anywhere else → null (a click there cancels).
 */
export function hitInfoButton(mx: number, my: number): InfoButton | null {
  if (my < ICON_Y || my >= ICON_Y + ICON_H) return null;
  if (mx >= INFO_BUTTONS.run.x && mx < INFO_BUTTONS.replay.x) return 'run';
  if (mx >= INFO_BUTTONS.replay.x && mx < INFO_BUTTONS.cancel.x) return 'replay';
  if (mx >= INFO_BUTTONS.cancel.x && mx < INFO_BUTTONS.cancel.x + ICON_W) return 'cancel';
  return null;
}

/**
 * The `cisla.bmp` source-y for a digit `cif` (0..9) at animation frame `faze`
 * (UMain.pas:1378): `y := 9*24 - 8*faze`, floored at the digit's resting row
 * `(9-cif)*24`. The atlas stacks digits 9(top)..0(bottom); rolling y downward
 * scrolls 0→…→cif.
 */
export function digitRollY(faze: number, cif: number): number {
  const rest = (9 - cif) * DIGIT_H;
  let y = 9 * DIGIT_H - 8 * faze;
  if (y < rest) y = rest;
  return y;
}

/** Opaque blit of a `w×h` region from a source Bmp (src origin) to (destX,destY). */
function blitRegion(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  bmp: Bmp,
  destX: number,
  destY: number,
  srcX: number,
  srcY: number,
  w: number,
  h: number,
): void {
  for (let row = 0; row < h; row++) {
    const sy = srcY + row;
    const dy = destY + row;
    if (sy < 0 || sy >= bmp.h || dy < 0 || dy >= mapH) continue;
    for (let col = 0; col < w; col++) {
      const sx = srcX + col;
      const dx = destX + col;
      if (sx < 0 || sx >= bmp.w || dx < 0 || dx >= mapW) continue;
      const idx = bmp.pixels[sy * bmp.w + sx]!;
      const c = bmp.palette[idx];
      if (!c) continue;
      const d = (dy * mapW + dx) * 4;
      rgba[d] = c.r;
      rgba[d + 1] = c.g;
      rgba[d + 2] = c.b;
      rgba[d + 3] = 255;
    }
  }
}

/** Darken a map-space rectangle in place (used to grey out a disabled Replay button). */
function darkenRect(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  x: number,
  y: number,
  w: number,
  h: number,
  factor: number,
): void {
  for (let row = 0; row < h; row++) {
    const dy = y + row;
    if (dy < 0 || dy >= mapH) continue;
    for (let col = 0; col < w; col++) {
      const dx = x + col;
      if (dx < 0 || dx >= mapW) continue;
      const d = (dy * mapW + dx) * 4;
      rgba[d] = rgba[d]! * factor;
      rgba[d + 1] = rgba[d + 1]! * factor;
      rgba[d + 2] = rgba[d + 2]! * factor;
    }
  }
}

export interface InfoPanelAssets {
  krokomer: Bmp;
  ikonky: Bmp;
  cisla: Bmp;
}

/**
 * Composite the record panel onto an RGBA map buffer: the `krokomer` background,
 * the hovered button's highlighted icon, and the five odometer digits of `count`
 * (or a blank slot when `count` is null — e.g. a cheat-only room with no genuine
 * best). A disabled Replay (`replayEnabled=false`) is greyed and never highlights.
 */
export function drawInfoPanel(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  assets: InfoPanelAssets,
  count: number | null,
  hover: InfoButton | null,
  faze: number,
  replayEnabled: boolean,
): void {
  // Panel background (opaque 268×186).
  blitRegion(rgba, mapW, mapH, assets.krokomer, PANEL_X, PANEL_Y, 0, 0, PANEL_W, PANEL_H);
  // Hovered button highlight (Replay only if it is enabled).
  if (hover && !(hover === 'replay' && !replayEnabled)) {
    const b = INFO_BUTTONS[hover];
    blitRegion(rgba, mapW, mapH, assets.ikonky, b.x, ICON_Y, b.srcX, 0, ICON_W, ICON_H);
  }
  // Grey out a disabled Replay icon.
  if (!replayEnabled) {
    darkenRect(rgba, mapW, mapH, INFO_BUTTONS.replay.x, ICON_Y, ICON_W, ICON_H, 0.45);
  }
  // Odometer digits (five, zero-padded), rolling in per `faze`.
  if (count !== null) {
    let cis = count;
    for (let i = INFO_DIGITS - 1; i >= 0; i--) {
      const cif = cis % 10;
      cis = Math.floor(cis / 10);
      const y = digitRollY(faze, cif);
      blitRegion(rgba, mapW, mapH, assets.cisla, DIGIT_X0 + DIGIT_W * i, DIGIT_Y, 0, y, DIGIT_W, DIGIT_H);
    }
  }
}
