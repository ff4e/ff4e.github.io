/**
 * The pause menu and the confirm prompt, drawn (`menus.ts` holds their state), in the web
 * touch UI's paint (`src/styles/nativeMenu.css`, through `uiGlass.ts` and the room's
 * palette, `uiPalette.ts`): a popup of the touch UI's glass over the dimmed room, its items
 * glass buttons with the rustic carved icons (`rusticIcons.ts`) — the focused one in the
 * touch UI's pressed state, as a held button looks, rather than a separate outline. Sized for
 * a TV: the items' words are 34 px at 1080 lines. The prompt asks before a save, a load or
 * a restart, and its answers are the legend's small hints ("Ⓐ Yes  Ⓑ No"); the keyboard
 * gets none (Enter and Esc still answer). The words are in the UI's language.
 */
import { PAUSE_ITEMS, pauseItemEnabled, type PauseItem, type Verb } from './menus.js';
import { confirmItems, drawHintRow, hintRowWidth, legendMetrics } from './legend.js';
import type { InputSource } from './uiInput.js';
import type { Ui } from './uiDraw.js';
import { drawIcon, iconReady, warmIcon, type IconName } from './rusticIcons.js';
import { drawGlass, hairline } from './uiGlass.js';
import { currentPalette, INK, type UiPalette } from './uiPalette.js';
import { t, type UiString } from './uiStrings.js';

const PAUSE_LABEL: Readonly<Record<PauseItem, UiString>> = {
  resume: 'resume', map: 'worldMap', save: 'save', load: 'load', restart: 'restart', options: 'options', help: 'help',
};
const PAUSE_ICON_NAME: Readonly<Record<PauseItem, IconName>> = {
  resume: 'resume', map: 'map', save: 'save', load: 'load', restart: 'restart', options: 'options', help: 'help',
};
const PROMPT: Readonly<Record<Verb, UiString>> = { save: 'askSave', load: 'askLoad', restart: 'askRestart' };
const VERB_ICON: Readonly<Record<Verb, IconName>> = { save: 'save', load: 'load', restart: 'restart' };

/** The icons' sizes at 1080 lines: the pause menu's items', and the confirm prompt's. */
const PAUSE_ICON = 40, CONFIRM_ICON = 48;

/** The window's scale: 1 at 1080 lines. */
const scale = (h: number): number => Math.max(0.5, h / 1080);

/**
 * Rasterise the icons the pause menu and the confirm prompt draw at a window `h` high, at
 * most `budget` of them now; returns whether all are ready. Their first drawing makes them
 * otherwise, and at a 4K TV's size the first menu would wait for that: the layer calls this
 * when the UI starts, and a frame at a time while no menu is up (after a resize).
 */
export function warmMenuIcons(h: number, budget = Infinity): boolean {
  const u = scale(h);
  const want: [IconName, number][] = [
    ...PAUSE_ITEMS.map((i): [IconName, number] => [PAUSE_ICON_NAME[i], PAUSE_ICON * u]),
    ...Object.values(VERB_ICON).map((n): [IconName, number] => [n, CONFIRM_ICON * u]),
  ];
  for (const [name, size] of want) {
    if (iconReady(name, size)) continue;
    if (budget-- <= 0) return false;
    warmIcon(name, size);
  }
  return true;
}

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

/** The pause menu, centred in the window. Returns its box. */
export function paintPause(ui: Ui, w: number, h: number, sel: number): [number, number, number, number] {
  const u = scale(h);
  const pal = currentPalette();
  const hair = hairline(h);
  scrim(ui, w, h, 0.6);
  const itemH = 64 * u, step = 74 * u, padX = 28 * u, titleH = 92 * u, icon = PAUSE_ICON * u;
  const cw = 520 * u, ch = titleH + PAUSE_ITEMS.length * step + 18 * u;
  const x = (w - cw) / 2, y = (h - ch) / 2;
  popup(ui, x, y, cw, ch, u, h, pal);
  ui.text(t('paused'), x + cw / 2, y + 62 * u, 42 * u, INK, { align: 'center', bold: true, outline: labelShadow(u, h) });
  PAUSE_ITEMS.forEach((item, i) => {
    const bx = x + padX, by = y + titleH + i * step, bw = cw - 2 * padX;
    const on = pauseItemEnabled(item);
    const alpha = on ? 1 : 0.38;
    drawGlass(ui, bx, by, bw, itemH, 8 * u, hair, pal, i === sel ? 'pressed' : 'rest', alpha);
    drawIcon(ui, PAUSE_ICON_NAME[item], bx + 18 * u, by + (itemH - icon) / 2, icon, pal, alpha);
    ui.text(t(PAUSE_LABEL[item]), bx + 18 * u + icon + 20 * u, by + itemH / 2 + 34 * u * 0.36, 34 * u, INK,
      { bold: true, alpha, outline: labelShadow(u, h) });
  });
  return [x, y, cw, ch];
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
