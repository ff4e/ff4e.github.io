/**
 * The top bar and the confirm prompt, drawn (`menus.ts` holds their state), in the web
 * touch UI's paint (`src/styles/nativeMenu.css`, through `uiGlass.ts` and the room's
 * palette, `uiPalette.ts`).
 *
 * The bar is an Apple TV app's tab bar (B6): a slim capsule of the touch UI's popup glass
 * centred across the top of the title-safe area, over the running room and without dimming
 * it, holding one tab per verb — the rustic carved icon (`rusticIcons.ts`) and its word. The
 * focused tab is the touch UI's pressed state, as a held button looks, where tvOS lifts its
 * focused tab; a tab that cannot act now is faded. The focused tab's corners are rounded, not
 * a capsule's: a box that narrow with a capsule's radius cannot be drawn by its corners alone
 * (`uiDraw.ts`, `sliced`), and six of them at 2160 lines doubled the rehearsal's rasterising. Sized for a TV: the words are
 * 30 px at 1080 lines, and the whole bar shrinks to fit a narrower window.
 *
 * The prompt asks before a save, a load or a restart, and its answers are the legend's small
 * hints ("Ⓐ Yes  Ⓑ No"); the keyboard gets none (Enter and Esc still answer). The words are
 * in the UI's language.
 */
import { BAR_ITEMS, barItemEnabled, type BarItem, type Verb } from './menus.js';
import { confirmItems, drawHintRow, hintRowWidth, legendMetrics } from './legend.js';
import type { InputSource } from './uiInput.js';
import type { Ui } from './uiDraw.js';
import { drawIcon, type IconName } from './rusticIcons.js';
import { drawGlass, hairline } from './uiGlass.js';
import { currentPalette, INK, type UiPalette } from './uiPalette.js';
import { t, type UiString } from './uiStrings.js';

const BAR_LABEL: Readonly<Record<BarItem, UiString>> = {
  map: 'worldMap', save: 'save', load: 'load', restart: 'restart', options: 'options', help: 'help',
};
const BAR_ICON_NAME: Readonly<Record<BarItem, IconName>> = {
  map: 'map', save: 'save', load: 'load', restart: 'restart', options: 'options', help: 'help',
};
const PROMPT: Readonly<Record<Verb, UiString>> = { save: 'askSave', load: 'askLoad', restart: 'askRestart' };
const VERB_ICON: Readonly<Record<Verb, IconName>> = { save: 'save', load: 'load', restart: 'restart' };

/** The icons' sizes at 1080 lines: the bar's tabs', and the confirm prompt's. */
const BAR_ICON = 34, CONFIRM_ICON = 48;

/** The window's scale: 1 at 1080 lines. */
const scale = (h: number): number => Math.max(0.5, h / 1080);

/** The touch UI's label shadow (`text-shadow: 0 1px 2px #000`), at the window's scale. */
export const labelShadow = (u: number, h: number): { r: number; rgb: number; dy: number; alpha: number } =>
  ({ r: Math.max(1, 1.6 * u), rgb: 0x000000, dy: hairline(h), alpha: 0.7 });

/** Dim everything under a menu: the whole window, past the safe area the menu is laid out in. */
export function scrim(ui: Ui, w: number, h: number, alpha: number): void {
  const [l, t, r, b] = ui.bleed;
  ui.rect(-l, -t, w + l + r, h + t + b, 0x000000, alpha);
}

/** A popup panel (`#phone-menu`'s look): the touch UI's popup glass, its edge and bevel. */
export function popup(ui: Ui, x: number, y: number, w: number, h: number, u: number, wh: number, pal: UiPalette): void {
  drawGlass(ui, x, y, w, h, 12 * u, hairline(wh), pal, 'popup');
}

/** The top bar across the top of a `w`×`h` window (its safe area), tab `sel` focused. Returns its box. */
export function paintBar(ui: Ui, w: number, h: number, sel: number): [number, number, number, number] {
  const pal = currentPalette();
  const hair = hairline(h);
  // The 1080-line sizes, shrunk as a whole should the tabs not fit across the window.
  const fit = (u: number): { u: number; widths: number[]; bw: number } => {
    const widths = BAR_ITEMS.map((item) => (2 * 24 + BAR_ICON + 12) * u + ui.measure(t(BAR_LABEL[item]), 30 * u, true));
    return { u, widths, bw: widths.reduce((a, b) => a + b, 0) + (BAR_ITEMS.length - 1) * 6 * u + 2 * 10 * u };
  };
  let { u, widths, bw } = fit(scale(h));
  if (bw > w) ({ u, widths, bw } = fit(u * (w / bw)));
  const tabH = 60 * u, pad = 10 * u, icon = BAR_ICON * u, px = 30 * u;
  const bh = tabH + 2 * pad;
  const x = (w - bw) / 2, y = 0;
  drawGlass(ui, x, y, bw, bh, bh / 2, hair, pal, 'popup');
  let tx = x + pad;
  BAR_ITEMS.forEach((item, i) => {
    const tw = widths[i]!, ty = y + pad;
    const alpha = barItemEnabled(item) ? 1 : 0.38;
    if (i === sel) drawGlass(ui, tx, ty, tw, tabH, 14 * u, hair, pal, 'pressed', alpha);
    drawIcon(ui, BAR_ICON_NAME[item], tx + 24 * u, ty + (tabH - icon) / 2, icon, pal, alpha);
    ui.text(t(BAR_LABEL[item]), tx + (24 + BAR_ICON + 12) * u, ty + tabH / 2 + px * 0.36, px, INK,
      { bold: true, alpha, outline: labelShadow(u, h) });
    tx += tw + 6 * u;
  });
  return [x, y, bw, bh];
}

/** The confirm prompt (A3): the verb's icon and the question, then "Ⓐ Yes  Ⓑ No" in the last input's glyphs. Returns its box. */
export function paintConfirm(ui: Ui, w: number, h: number, verb: Verb, source: InputSource): [number, number, number, number] {
  const u = scale(h);
  const pal = currentPalette();
  scrim(ui, w, h, 0.67);
  const q = t(PROMPT[verb]);
  const qpx = 36 * u, icon = CONFIRM_ICON * u, iconGap = 18 * u;
  const answers = confirmItems(source);
  const m = legendMetrics(h);
  const hintW = hintRowWidth(ui, answers, m);
  const lineW = icon + iconGap + ui.measure(q, qpx, true);
  const cw = Math.max(lineW, hintW) + 2 * 56 * u;
  const ch = answers.length ? 182 * u : 128 * u;
  const x = (w - cw) / 2, y = (h - ch) / 2;
  popup(ui, x, y, cw, ch, u, h, pal);
  const lx = x + (cw - lineW) / 2;
  drawIcon(ui, VERB_ICON[verb], lx, y + 40 * u, icon, pal);
  ui.text(q, lx + icon + iconGap, y + 77 * u, qpx, INK, { bold: true, outline: labelShadow(u, h) });
  if (answers.length) drawHintRow(ui, answers, x + (cw - hintW) / 2, y + 120 * u, m, pal, true);
  return [x, y, cw, ch];
}
