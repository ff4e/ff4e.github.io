/**
 * The web touch UI's button surface (`src/styles/nativeMenu.css`), natively: a room-tinted
 * translucent slate (`--menu-glass`, or `--menu-popup` for a panel, `--menu-pressed` held),
 * a hairline `--menu-edge`, and the inset bevel `--menu-bevel` — a light line inside the top
 * edge and a dark one inside the bottom. Pressed (the TV's focus, as `:active` is the touch
 * UI's) swaps the bevel for an inset shade and the edge for the ink.
 */
import type { Ui } from './uiDraw.js';
import { INK, type UiPalette } from './uiPalette.js';

export type GlassState = 'rest' | 'pressed' | 'popup';

/** A hairline at window height `h`: the web's 1 CSS px, at least one pixel. */
export const hairline = (h: number): number => Math.max(1, Math.round(h / 720));

/** A glass surface `w`×`h` at (x, y), corners `r`, hairlines `t` thick. */
export function drawGlass(ui: Ui, x: number, y: number, w: number, h: number, r: number, t: number, pal: UiPalette, state: GlassState, alpha = 1): void {
  const fill = state === 'pressed' ? pal.pressed : state === 'popup' ? pal.popup : pal.glass;
  ui.rect(x, y, w, h, fill.rgb, fill.a * alpha, r);
  const inset = Math.max(r * 0.7, t);
  if (state === 'pressed') {
    // inset 0 1px 3px #0007
    ui.rect(x + inset, y + t, w - 2 * inset, 2 * t, 0x000000, 0.45 * alpha);
    ui.frame(x, y, w, h, t, INK, alpha, r);
  } else {
    // inset 0 1px #fff3, inset 0 -1px #0005
    ui.rect(x + inset, y + t, w - 2 * inset, t, 0xffffff, 0.2 * alpha);
    ui.rect(x + inset, y + h - 2 * t, w - 2 * inset, t, 0x000000, 0.33 * alpha);
    ui.frame(x, y, w, h, t, pal.edge.rgb, pal.edge.a * alpha, r);
  }
}
