/**
 * The UI layer: one window-sized surface, drawn each frame over the room or the map and
 * handed to the host's `present` / `presentTexture` (drawn at one texel per window pixel).
 * It holds the menu on top (`menus.ts`) and the button legend (`legend.ts`); nothing here
 * is drawn into the room's picture, which stays the game's.
 *
 * The menus on it are laid out inside the window's title-safe area (`safeArea.ts`): the
 * layer is still the whole window, but its drawing is moved into the safe rectangle and laid
 * out for that rectangle's size, as if it were the window — so on a desktop (no insets)
 * nothing changes, and on a TV the menus are sized for the safe height. The legend is the
 * exception: it lays itself out against the whole window, near its edge (`legend.ts`).
 *
 * A menu must open on the frame it is asked for, and its first drawing at a window's size
 * would rasterise its icons, its words' glyphs and its shapes for that size — in the
 * interpreter, which on an Apple TV is several times slower than on a Mac. So the menus are
 * REHEARSED before they are needed: drawn onto a surface that keeps nothing, which fills the
 * caches the real drawing then finds full (`prepareMenus`). That happens when the UI starts,
 * for the window it starts in, and again whenever what they would draw changes — the window's
 * size, the language, the input's glyphs, the screen, a setting a menu shows — a few
 * milliseconds a frame while no menu is up (`uiCost.ts`'s `rehearse`), so play does not
 * hitch. When a menu opens, what its first frame cost is logged, by phase.
 */
import { helpScreens, ui as screenUi } from '../../src/app/screenState.js';
import type { Image2D, Surface2D } from '../../src/render/surface2d.js';
import { drawLegend, legendItems, legendScreen, type LegendItem } from './legend.js';
import { paintBar, paintConfirm } from './menuPaint.js';
import { BAR_ITEMS, OPTIONS_ROWS, topMenu, type Layer } from './menus.js';
import { NativeSurface } from './nativeSurface.js';
import { paintOptions } from './optionsPaint.js';
import { paintHelp } from './helpPaint.js';
import { settings, subLang } from './seams/playerSettings.js';
import { Ui, loadUiFonts, type UiFonts, type UiOp } from './uiDraw.js';
import { costed, currentCost, describeCost, rehearse, resetCost } from './uiCost.js';
import { lastInput } from './uiInput.js';
import { safeInsets, type Insets } from './safeArea.js';
import { drawInputOverlay, inputOverlayOn } from './inputOverlay.js';

let fonts: UiFonts | null = null;
let surface: NativeSurface | null = null;

export type Box = readonly [number, number, number, number];

/** What a rehearsal may spend on rasterising in one frame, ms. */
const SLICE_MS = 2;

/**
 * Load what the layer draws with, and get the menus ready for the window as it is, all at
 * once (before the first frame: nothing is on screen to hitch). `picture` is where the first
 * screen's picture will be (the legend under a menu goes beside it). Set the input source and
 * the safe area first: the rehearsal draws in their glyphs and inside their insets.
 */
export async function initUiLayer(picture?: Box): Promise<void> {
  fonts = await loadUiFonts();
  const size = __native.windowSize();
  if (!size || !picture) return;
  const [w, h] = size;
  const [l, t, r, b] = safeInsets(w, h);
  const t0 = __native.now();
  resetCost();
  prepareMenus(w - l - r, h - t - b, [l, t, r, b], [picture[0] - l, picture[1] - t, picture[2], picture[3]], Infinity);
  console.log(`ui: menus ready for ${w}×${h} at start, ${describeCost(currentCost(), __native.now() - t0)}`);
}

/**
 * What a menu's paint takes, apart from the menu: its legend, the picture's box, the help's
 * page. Returns where in `ui.ops` the legend's ops begin.
 */
function drawTop(ui: Ui, top: Layer | null, legend: readonly LegendItem[], w: number, h: number, picture: Box, helpPage: number): number {
  let box = picture;
  if (top?.kind === 'bar') paintBar(ui, w, h, top.sel);
  else if (top?.kind === 'confirm') paintConfirm(ui, w, h, top.verb, lastInput());
  else if (top?.kind === 'options') box = paintOptions(ui, w, h, top.row);
  else if (top?.kind === 'help') box = paintHelp(ui, w, h, subLang(), helpPage);
  const at = ui.ops.length;
  drawLegend(ui, legend, w, h, box);
  return at;
}

/** Every menu as it first opens: what a rehearsal draws, one a frame. */
const REHEARSALS: readonly Layer[] = [
  ...BAR_ITEMS.map((_, sel): Layer => ({ kind: 'bar', sel })),
  ...(['save', 'load', 'restart'] as const).map((verb): Layer => ({ kind: 'confirm', verb })),
  ...OPTIONS_ROWS.map((_, row): Layer => ({ kind: 'options', row })),
  { kind: 'help' },
];

/** The state the menus were last rehearsed in, and the next rehearsal to run. */
let ready = { key: '', next: 0, frames: 0, ms: 0, t0: 0 };

/** A surface that draws nothing: a rehearsal's (it is drawn for the caches alone). */
class NullSurface implements Surface2D {
  constructor(readonly width: number, readonly height: number) {}
  setSmoothing(): void {}
  setAlpha(): void {}
  setBlend(): void {}
  translate(): void {}
  scale(): void {}
  save(): void {}
  restore(): void {}
  drawImage(_img: Image2D): void {}
  drawImageRect(_img: Image2D): void {}
  fillRect(): void {}
  fillMask(_mask: Image2D): void {}
  clear(): void {}
  putPixels(): void {}
}

/**
 * Rehearse the menus for a `w`×`h` safe area (inside `insets`; `picture` in its coordinates),
 * spending at most about `budgetMs` on rasterising: the next rehearsal, and the ones after it
 * while the budget lasts. Starts over when anything they would draw differently has changed.
 */
function prepareMenus(w: number, h: number, insets: Insets, picture: Box, budgetMs: number): void {
  if (!fonts) return;
  const key = [w, h, ...insets, ...picture, subLang(), lastInput(), screenUi.screen,
    settings.subtitles, settings.volume.effect, settings.volume.voice, settings.volume.music].join('|');
  if (key !== ready.key) ready = { key, next: 0, frames: 0, ms: 0, t0: __native.now() };
  if (ready.next >= REHEARSALS.length) return;
  ready.frames++;
  const ui = new Ui(new NullSurface(w, h), fonts);
  ui.bleed = insets;
  const before = totalCost(), t0 = __native.now();
  // The budget is the frame's time, the drawing included: a rehearsal that rasterises nothing
  // still walks a whole menu, and all of them at once would be a hitch of its own.
  while (ready.next < REHEARSALS.length) {
    const top = REHEARSALS[ready.next]!;
    const screen = legendScreen(top);
    const legend = screen ? legendItems(screen, lastInput()) : [];
    const spent = __native.now() - t0;
    if (spent >= budgetMs || !rehearse(() => drawTop(ui, top, legend, w, h, picture, 0), budgetMs - spent)) break;
    ready.next++;
  }
  ready.ms += totalCost() - before;
  if (ready.next === REHEARSALS.length && budgetMs !== Infinity && ready.ms >= 5) {
    console.log(`ui: menus ready for ${w}×${h} (safe area) in ${ready.frames} frames, ${ready.ms.toFixed(1)} ms of rasterising`);
  }
}

const totalCost = (): number => Object.values(currentCost().ms).reduce((a, b) => a + b, 0);

/** Whether the menus are rehearsed for the state they were last asked about (the smoke's). */
export function menusReady(): boolean {
  return ready.key !== '' && ready.next >= REHEARSALS.length;
}

/** The menu drawn on the last frame: a newly opened one has its first frame's cost logged. */
let shownTop: Layer | null = null;

/**
 * Draw the layer for a `w`×`h` window whose picture (the room, the map, a story page) is
 * shown in `picture`, everything inside `insets` (by default the window's own). Returns the
 * surface and what was drawn on it, in the safe area's coordinates (from `legendAt` on, the
 * legend's, which may reach past the safe area to the window's edge) — no surface when there
 * is nothing to draw (no menu, and no legend: the keyboard's case), so nothing is cleared
 * or composited — or null before the fonts have loaded.
 */
export function paintUi(
  w: number, h: number, picture: Box, insets: Insets = safeInsets(w, h),
): { surface: NativeSurface | null; ops: readonly UiOp[]; legendAt: number } | null {
  if (!fonts || w <= 0 || h <= 0) return null;
  const [l, t, r, b] = insets;
  const sw = w - l - r, sh = h - t - b;
  if (sw <= 0 || sh <= 0) return null;
  const t0 = __native.now();
  resetCost();
  const top = topMenu();
  const box: Box = [picture[0] - l, picture[1] - t, picture[2], picture[3]];
  if (!top) prepareMenus(sw, sh, insets, box, SLICE_MS);
  const opened = top !== null && top !== shownTop;
  shownTop = top;
  const screen = legendScreen(top);
  const legend = screen ? legendItems(screen, lastInput()) : [];
  if (!top && legend.length === 0 && !inputOverlayOn()) return { surface: null, ops: [], legendAt: 0 };
  if (!surface || surface.width !== w || surface.height !== h) surface = costed('surface', () => new NativeSurface(w, h));
  surface.clear();
  surface.save();
  surface.translate(l, t);
  const ui = new Ui(surface, fonts);
  ui.bleed = insets;
  const legendAt = drawTop(ui, top, legend, sw, sh, box, helpScreens.page);
  drawInputOverlay(ui, w, h, l, t);
  surface.restore();
  if (opened) console.log(`ui: ${top.kind} opened at ${w}×${h}, its first frame ${describeCost(currentCost(), __native.now() - t0)}`);
  return { surface, ops: ui.ops, legendAt };
}

/** The window's size, and where a `cw`×`ch` picture is shown in it; null with no window. */
export function windowLayout(cw: number, ch: number): { w: number; h: number; picture: Box } | null {
  const size = __native.windowSize();
  const rect = __native.presentRect(cw, ch);
  if (!size || !rect) return null;
  return { w: size[0], h: size[1], picture: [rect[0], rect[1], rect[2], rect[3]] };
}
