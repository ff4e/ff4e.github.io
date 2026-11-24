/**
 * The UI layer: one window-sized surface, drawn each frame over the room or the map and
 * handed to the host's `present` / `presentTexture` (drawn at one texel per window pixel).
 * It holds the menu on top (`menus.ts`) and the button legend (`legend.ts`); nothing here
 * is drawn into the room's picture, which stays the game's.
 *
 * Everything on it is laid out inside the window's title-safe area (`safeArea.ts`): the
 * layer is still the whole window, but its drawing is moved into the safe rectangle and laid
 * out for that rectangle's size, as if it were the window — so on a desktop (no insets)
 * nothing changes, and on a TV the menus and the legend are sized for the safe height.
 */
import { helpScreens } from '../../src/app/screenState.js';
import { drawLegend, legendItems, legendScreen } from './legend.js';
import { mapBusy, mapPanelOpen } from './mapScreen.js';
import { paintConfirm, paintPause, warmMenuIcons } from './menuPaint.js';
import { topMenu } from './menus.js';
import { NativeSurface } from './nativeSurface.js';
import { paintOptions } from './optionsPaint.js';
import { paintHelp } from './helpPaint.js';
import { subLang } from './seams/playerSettings.js';
import { Ui, loadUiFonts, type UiFonts, type UiOp } from './uiDraw.js';
import { lastInput } from './uiInput.js';
import { safeInsets, type Insets } from './safeArea.js';

let fonts: UiFonts | null = null;
let surface: NativeSurface | null = null;
/** The safe area's height the menus' icons are ready for. */
let warmFor = 0;

export type Box = readonly [number, number, number, number];

/** Load what the layer draws with, and rasterise the menus' icons for the window. Before the first frame. */
export async function initUiLayer(): Promise<void> {
  fonts = await loadUiFonts();
  const size = __native.windowSize();
  if (!size) return;
  const [, t, , b] = safeInsets(size[0], size[1]);
  if (warmMenuIcons(size[1] - t - b)) warmFor = size[1] - t - b;
}

/**
 * Draw the layer for a `w`×`h` window whose picture (the room, the map, a story page) is
 * shown in `picture`, everything inside `insets` (by default the window's own). Returns the
 * surface and what was drawn on it, in the safe area's coordinates — no surface when there
 * is nothing to draw (no menu, and no legend: the keyboard's case), so nothing is cleared
 * or composited — or null before the fonts have loaded.
 */
export function paintUi(
  w: number, h: number, picture: Box, insets: Insets = safeInsets(w, h),
): { surface: NativeSurface | null; ops: readonly UiOp[] } | null {
  if (!fonts || w <= 0 || h <= 0) return null;
  const [l, t, r, b] = insets;
  const sw = w - l - r, sh = h - t - b;
  if (sw <= 0 || sh <= 0) return null;
  const top = topMenu();
  // The window changed size: the menus' icons for the new one, one a frame, before a menu needs them.
  if (!top && warmFor !== sh && warmMenuIcons(sh, 1)) warmFor = sh;
  const screen = legendScreen(top, mapPanelOpen(), mapBusy());
  const legend = screen ? legendItems(screen, lastInput()) : [];
  if (!top && legend.length === 0) return { surface: null, ops: [] };
  if (!surface || surface.width !== w || surface.height !== h) surface = new NativeSurface(w, h);
  surface.clear();
  surface.save();
  surface.translate(l, t);
  const ui = new Ui(surface, fonts);
  ui.bleed = insets;
  let box: Box = [picture[0] - l, picture[1] - t, picture[2], picture[3]];
  if (top?.kind === 'pause') paintPause(ui, sw, sh, top.sel);
  else if (top?.kind === 'confirm') paintConfirm(ui, sw, sh, top.verb, lastInput());
  else if (top?.kind === 'options') box = paintOptions(ui, sw, sh, top.row);
  else if (top?.kind === 'help') box = paintHelp(ui, sw, sh, subLang(), helpScreens.page);
  drawLegend(ui, legend, sw, sh, box);
  surface.restore();
  return { surface, ops: ui.ops };
}

/** The window's size, and where a `cw`×`ch` picture is shown in it; null with no window. */
export function windowLayout(cw: number, ch: number): { w: number; h: number; picture: Box } | null {
  const size = __native.windowSize();
  const rect = __native.presentRect(cw, ch);
  if (!size || !rect) return null;
  return { w: size[0], h: size[1], picture: [rect[0], rect[1], rect[2], rect[3]] };
}
