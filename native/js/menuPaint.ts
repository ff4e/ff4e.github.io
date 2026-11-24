/**
 * The pause menu and the confirm prompt, drawn (`menus.ts` holds their state). A vertical
 * list over the dimmed room, and a centred card asking before a save, a load or a restart
 * (the controller spec's A5 look: a `#18262e` card with a `#6cc` border over a black scrim
 * at ~67%, the focus a 3 px `#7ee6ff` outline offset 4 px) — sized for a TV: the prompt's
 * text is 36 px at 1080 lines, where the tablet's was 24. Its answers are the legend's small
 * hints ("Ⓐ Yes  Ⓑ No"); the keyboard gets none (Enter and Esc still answer).
 */
import { PAUSE_ITEMS, pauseItemEnabled, type PauseItem, type Verb } from './menus.js';
import { confirmItems, drawHintRow, hintRowWidth, legendMetrics } from './legend.js';
import type { InputSource } from './uiInput.js';
import type { Ui } from './uiDraw.js';

export const CARD_RGB = 0x18262e;
export const CARD_BORDER = 0x66cccc;
export const FOCUS_RGB = 0x7ee6ff;
const TEXT_RGB = 0xf2f6f8;

const PAUSE_LABEL: Readonly<Record<PauseItem, string>> = {
  resume: 'Resume', map: 'World map', save: 'Save', load: 'Load', restart: 'Restart', options: 'Options', help: 'Help',
};
const PROMPT: Readonly<Record<Verb, string>> = {
  save: 'Save the game?', load: 'Load the saved game?', restart: 'Restart the room?',
};

/** The focus outline (A5): `t` thick, `off` outside the box. */
export function focusRing(ui: Ui, x: number, y: number, w: number, h: number, u: number): void {
  const t = Math.max(2, 3 * u), off = 4 * u;
  ui.frame(x - off - t, y - off - t, w + 2 * (off + t), h + 2 * (off + t), t, FOCUS_RGB, 1, 10 * u);
}

/** Dim everything under a menu. */
export function scrim(ui: Ui, w: number, h: number, alpha: number): void {
  ui.rect(0, 0, w, h, 0x000000, alpha);
}

/** The pause menu, centred in the window. Returns its box. */
export function paintPause(ui: Ui, w: number, h: number, sel: number): [number, number, number, number] {
  const u = Math.max(0.5, h / 1080);
  scrim(ui, w, h, 0.6);
  const itemH = 74 * u, padX = 40 * u, titleH = 96 * u;
  const cw = 560 * u, ch = titleH + PAUSE_ITEMS.length * itemH + 34 * u;
  const x = (w - cw) / 2, y = (h - ch) / 2;
  ui.rect(x, y, cw, ch, CARD_RGB, 0.96, 18 * u);
  ui.frame(x, y, cw, ch, Math.max(1, 2 * u), CARD_BORDER, 1, 18 * u);
  ui.text('Paused', x + cw / 2, y + 66 * u, 44 * u, TEXT_RGB, { align: 'center', bold: true });
  PAUSE_ITEMS.forEach((item, i) => {
    const iy = y + titleH + i * itemH;
    const on = pauseItemEnabled(item);
    if (i === sel) {
      ui.rect(x + padX / 2, iy + 6 * u, cw - padX, itemH - 12 * u, 0x2a4652, 1, 10 * u);
      focusRing(ui, x + padX / 2, iy + 6 * u, cw - padX, itemH - 12 * u, u);
    }
    ui.text(PAUSE_LABEL[item], x + cw / 2, iy + itemH * 0.66, 34 * u, on ? TEXT_RGB : 0x7b8a90, { align: 'center', bold: i === sel, alpha: on ? 1 : 0.7 });
  });
  return [x, y, cw, ch];
}

/** The confirm prompt (A3): the question, then "Ⓐ Yes  Ⓑ No" in the last input's glyphs. Returns its box. */
export function paintConfirm(ui: Ui, w: number, h: number, verb: Verb, source: InputSource): [number, number, number, number] {
  const u = Math.max(0.5, h / 1080);
  scrim(ui, w, h, 0.67);
  const q = PROMPT[verb];
  const qpx = 36 * u;
  const answers = confirmItems(source);
  const m = legendMetrics(h);
  const hintW = hintRowWidth(ui, answers, m);
  const cw = Math.max(ui.measure(q, qpx, true), hintW) + 2 * 56 * u;
  const ch = answers.length ? 176 * u : 124 * u;
  const x = (w - cw) / 2, y = (h - ch) / 2;
  ui.rect(x, y, cw, ch, CARD_RGB, 1, 18 * u);
  ui.frame(x, y, cw, ch, Math.max(1, 2 * u), CARD_BORDER, 1, 18 * u);
  ui.text(q, x + cw / 2, y + 75 * u, qpx, TEXT_RGB, { align: 'center', bold: true });
  if (answers.length) drawHintRow(ui, answers, x + (cw - hintW) / 2, y + 112 * u, m);
  return [x, y, cw, ch];
}
