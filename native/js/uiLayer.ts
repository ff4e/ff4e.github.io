/**
 * The UI layer: one window-sized surface, drawn each frame over the room or the map and
 * handed to the host's `present` / `presentTexture` (drawn at one texel per window pixel).
 * It holds the menu on top (`menus.ts`) and the button legend (`legend.ts`); nothing here
 * is drawn into the room's picture, which stays the game's.
 */
import { helpScreens } from '../../src/app/screenState.js';
import { drawLegend, legendItems, legendScreen } from './legend.js';
import { mapBusy, mapPanelOpen } from './mapScreen.js';
import { paintConfirm, paintPause } from './menuPaint.js';
import { topMenu } from './menus.js';
import { NativeSurface } from './nativeSurface.js';
import { paintOptions } from './optionsPaint.js';
import { paintHelp } from './helpPaint.js';
import { subLang } from './seams/playerSettings.js';
import { Ui, loadUiFonts, type UiFonts, type UiOp } from './uiDraw.js';
import { lastInput } from './uiInput.js';

let fonts: UiFonts | null = null;
let surface: NativeSurface | null = null;

/** Load what the layer draws with. Before the first frame. */
export async function initUiLayer(): Promise<void> {
  fonts = await loadUiFonts();
}

export type Box = readonly [number, number, number, number];

/**
 * Draw the layer for a `w`×`h` window whose picture (the room, the map, a story page) is
 * shown in `picture`. Returns the surface and what was drawn on it, or null before the
 * fonts have loaded.
 */
export function paintUi(w: number, h: number, picture: Box): { surface: NativeSurface; ops: readonly UiOp[] } | null {
  if (!fonts || w <= 0 || h <= 0) return null;
  if (!surface || surface.width !== w || surface.height !== h) surface = new NativeSurface(w, h);
  surface.clear();
  const ui = new Ui(surface, fonts);
  const top = topMenu();
  let box: Box = picture;
  if (top?.kind === 'pause') paintPause(ui, w, h, top.sel);
  else if (top?.kind === 'confirm') paintConfirm(ui, w, h, top.verb, lastInput());
  else if (top?.kind === 'options') box = paintOptions(ui, w, h, top.row);
  else if (top?.kind === 'help') box = paintHelp(ui, w, h, subLang(), helpScreens.page);
  const screen = legendScreen(top, mapPanelOpen(), mapBusy());
  if (screen) drawLegend(ui, legendItems(screen, lastInput()), w, h, box);
  return { surface, ops: ui.ops };
}

/** The window's size, and where a `cw`×`ch` picture is shown in it; null with no window. */
export function windowLayout(cw: number, ch: number): { w: number; h: number; picture: Box } | null {
  const size = __native.windowSize();
  const rect = __native.presentRect(cw, ch);
  if (!size || !rect) return null;
  return { w: size[0], h: size[1], picture: [rect[0], rect[1], rect[2], rect[3]] };
}
