/**
 * The hidden input overlay: the input log's last lines (native/host/main.c, `input_log` — the
 * remote's buttons as SDL and GameController report them, its touches, who owns Back, and
 * what the router made of each press) drawn over the top right of the screen, for testing
 * the remote on an Apple TV with no device console to hand. Off by default; holding the
 * remote's Play/Pause for 5 s, the hold begun on the world map, turns it on or off (its
 * press opens Options as it always does, and the toggle closes that again). Not saved: every
 * launch starts with it off. native/README.md, "Reading the remote's input log".
 */
import type { Ui } from './uiDraw.js';

/** How long Play/Pause is held to toggle the overlay, ms. */
export const OVERLAY_HOLD_MS = 5000;

let on = false;

export function inputOverlayOn(): boolean {
  return on;
}

export function toggleInputOverlay(): void {
  on = !on;
  __native.inputLog(`input overlay ${on ? 'on' : 'off'}`);
}

/**
 * Draw the log over the `w`×`h` window's top right, `dx`/`dy` from the coordinates `ui`
 * draws in to the window's (the UI layer is laid out inside the title-safe area).
 */
export function drawInputOverlay(ui: Ui, w: number, h: number, dx: number, dy: number): void {
  if (!on) return;
  const lines = __native.inputLog();
  const u = Math.max(2 / 3, h / 1080);
  const px = 16 * u, line = 21 * u, pad = 10 * u, edge = 20 * u;
  const tw = Math.min(w * 0.6, Math.max(240 * u, ...lines.map((s) => ui.measure(s, px))));
  const fit = (s: string): string => {
    while (s.length > 1 && ui.measure(s, px) > tw) s = s.slice(0, -1);
    return s;
  };
  const bw = tw + 2 * pad, bh = Math.max(1, lines.length) * line + 2 * pad;
  const x = w - edge - bw - dx, y = edge - dy;
  ui.rect(x, y, bw, bh, 0x000000, 0.72, 6 * u);
  lines.forEach((s, i) => ui.text(fit(s), x + pad, y + pad + (i + 0.8) * line, px, i === lines.length - 1 ? 0xffffaa : 0xddeeee));
}
