/**
 * The button legend (the controller spec's A4): what each button does on the screen that
 * is up, in the glyphs of the last input used — the keyboard's keys, an Xbox-style pad's
 * coloured chips (A5), or the Siri Remote's outlines (B3). It takes the place the tablet's
 * button strip has, and like that strip it goes down the left edge or along the top,
 * whichever covers less of the picture — here, whichever fits in the letterbox margin, so
 * on most windows it covers nothing at all. Sized for a TV seen from a sofa: an item is
 * about a tenth of the window's height.
 *
 * Items that cannot act now are greyed (A6): Save while the room cannot save, Load with
 * no save, Undo with nothing to undo. With the remote, the "switch fish" item carries the
 * active fish's picture (B3, TV only): the touch UI's badge art and its visibility rule.
 * Nothing is drawn into the room itself.
 */
import { cutscene, engine, loadmode, replaymode, room, showmode } from '../../src/app/gameState.js';
import { roomEntryHeld } from '../../src/app/roomLoad.js';
import { ui } from '../../src/app/screenState.js';
import { inSolvemode } from '../../src/app/solveMode.js';
import type { Image2D } from '../../src/render/surface2d.js';
import { aiRoomReady } from './seams/art.js';
import { roomLoading } from './seams/framePacing.js';
import { decodeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';
import type { Shape, Ui } from './uiDraw.js';
import type { InputSource } from './uiInput.js';
import { verbAvailable } from './menus.js';

/** One glyph of an item. */
export type Glyph =
  | { readonly kind: 'chip'; readonly text: string; readonly rgb: number; readonly ink: number }
  | { readonly kind: 'shoulder'; readonly text: string }
  | { readonly kind: 'stick'; readonly text: string }
  | { readonly kind: 'key'; readonly text: string }
  | { readonly kind: 'shape'; readonly shape: Shape }
  | { readonly kind: 'clickpad'; readonly edge: boolean };

export interface LegendItem {
  readonly glyphs: readonly Glyph[];
  readonly label: string;
  readonly enabled: boolean;
  /** The active fish's picture (B3). */
  readonly picture?: Image2D | null;
}

/** Where the legend is: the screen it describes. */
export type LegendScreen = 'room' | 'map' | 'panel' | 'legimage' | 'pause' | 'options' | 'help';

// The Xbox face buttons (A5): letters on round chips, B/A/X/Y in their colours.
const A: Glyph = { kind: 'chip', text: 'A', rgb: 0x3d9a1f, ink: 0xffffff };
const B: Glyph = { kind: 'chip', text: 'B', rgb: 0xc62a2a, ink: 0xffffff };
const X: Glyph = { kind: 'chip', text: 'X', rgb: 0x2266c4, ink: 0xffffff };
const Y: Glyph = { kind: 'chip', text: 'Y', rgb: 0xd6a00c, ink: 0x1a1a1a };
const LB: Glyph = { kind: 'shoulder', text: 'LB' };
const RB: Glyph = { kind: 'shoulder', text: 'RB' };
const L: Glyph = { kind: 'stick', text: 'L' };
const R: Glyph = { kind: 'stick', text: 'R' };
const DPAD: Glyph = { kind: 'shape', shape: 'cross' };
const MENU: Glyph = { kind: 'shape', shape: 'bars' };
const CLICK: Glyph = { kind: 'clickpad', edge: false };
const EDGE: Glyph = { kind: 'clickpad', edge: true };
const PLAY: Glyph = { kind: 'shape', shape: 'play' };
const BACK: Glyph = { kind: 'shape', shape: 'chevron' };
const key = (text: string): Glyph => ({ kind: 'key', text });

const item = (glyphs: readonly Glyph[], label: string, enabled = true, picture?: Image2D | null): LegendItem =>
  ({ glyphs, label, enabled, ...(picture !== undefined ? { picture } : {}) });

// ── The active fish's picture (activeFishIndicator.ts) ────────────────────────────────

let fishArt: Record<'little' | 'big', Image2D> | null = null;
let fishLoad: Promise<void> | null = null;

function fishPictures(): Record<'little' | 'big', Image2D> | null {
  fishLoad ??= Promise.all(
    (['small', 'big'] as const).map(async (d) =>
      decodeImage((await readBytes(`/enhanced-ai/_fish/x4/${d}/right/body_rest_00.webp`)).slice().buffer)),
  ).then(([little, big]) => {
    fishArt = { little: little!, big: big! };
  }, (e: unknown) => console.warn('the active fish pictures did not load; the legend goes without them', e));
  return fishArt;
}

/** Load the active fish's pictures now (the smoke gate waits for them). */
export async function preloadLegendArt(): Promise<void> {
  fishPictures();
  await fishLoad;
}

/**
 * The active fish's picture, or null while the badge would be hidden: the room loading or
 * its art pending, the room's entry, a cutscene, load/replay/show mode, solve mode, and a
 * dead active fish. (The browser's fatal-error screen has no native counterpart.)
 * restates src/app/activeFishIndicator.ts `export function syncActiveFishIndicator(` @ fc5de0c295c7
 */
function activeFishPicture(): Image2D | null {
  const pics = fishPictures();
  const active = engine?.active;
  const want = !!room && !!active && room.alive[active] &&
    !roomLoading && aiRoomReady() && !roomEntryHeld() &&
    !cutscene && !loadmode && !replaymode && !showmode && !inSolvemode() && !!pics;
  return want && active && pics ? pics[active] : null;
}

/** The legend for `screen` in `source`'s glyphs. */
export function legendItems(screen: LegendScreen, source: InputSource): LegendItem[] {
  const pad = source === 'pad', remote = source === 'remote';
  switch (screen) {
    case 'room':
      if (remote) {
        return [item([EDGE], 'Move'), item([CLICK], 'Switch fish', true, activeFishPicture()),
          item([PLAY], 'Undo', verbAvailable('undo')), item([BACK], 'Menu')];
      }
      if (pad) {
        return [item([L], 'Little'), item([R], 'Big'), item([B], 'Map'),
          item([LB], 'Save', verbAvailable('save')), item([RB], 'Load', verbAvailable('load')),
          item([X], 'Restart'), item([MENU], 'Menu'), item([Y], 'Undo', verbAvailable('undo'))];
      }
      return [item([key('IJKL')], 'Little'), item([key('WASD')], 'Big'), item([key('Space')], 'Switch'),
        item([key('−')], 'Undo', verbAvailable('undo')), item([key('F2')], 'Save', verbAvailable('save')),
        item([key('F3')], 'Load', verbAvailable('load')), item([key('Bksp')], 'Restart'), item([key('Esc')], 'Menu')];
    case 'map':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Open'), item([PLAY], 'Options'), item([BACK], 'Exit')];
      if (pad) return [item([L], 'Choose'), item([A], 'Open'), item([MENU], 'Options')];
      return [item([key('Arrows')], 'Choose'), item([key('Enter')], 'Open'), item([key('Esc')], 'Exit')];
    case 'panel':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Select'), item([BACK], 'Cancel')];
      if (pad) return [item([L], 'Choose'), item([A], 'Select'), item([B], 'Cancel')];
      return [item([key('Arrows')], 'Choose'), item([key('Enter')], 'Select'), item([key('Esc')], 'Cancel')];
    case 'legimage':
      return [item([remote ? CLICK : pad ? A : key('Enter')], 'Continue')];
    case 'pause':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Select'), item([BACK], 'Resume')];
      if (pad) return [item([L], 'Choose'), item([A], 'Select'), item([B], 'Resume')];
      return [item([key('Arrows')], 'Choose'), item([key('Enter')], 'Select'), item([key('Esc')], 'Resume')];
    case 'options':
      if (remote) return [item([EDGE], 'Change'), item([CLICK], 'Select'), item([BACK], 'Done')];
      if (pad) return [item([DPAD], 'Change'), item([A], 'Select'), item([B], 'Done')];
      return [item([key('Arrows')], 'Change'), item([key('Enter')], 'Select'), item([key('Esc')], 'Done')];
    case 'help':
      if (remote) return [item([EDGE], 'Page'), item([BACK], 'Close')];
      if (pad) return [item([LB, RB], 'Page'), item([B], 'Close')];
      return [item([key('Arrows')], 'Page'), item([key('Esc')], 'Close')];
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────

/** The legend's sizes at a window `h` pixels tall: an item is ~a tenth of it. */
export function legendMetrics(h: number): { u: number; itemH: number; minW: number; gap: number; margin: number; glyph: number; label: number } {
  const u = Math.max(0.5, h / 1080);
  return { u, itemH: 104 * u, minW: 118 * u, gap: 10 * u, margin: 16 * u, glyph: 46 * u, label: 23 * u };
}

function glyphWidth(ui: Ui, g: Glyph, size: number): number {
  switch (g.kind) {
    case 'shoulder': return size * 1.45;
    case 'key': return Math.max(size, ui.measure(g.text, size * 0.5, true) + size * 0.5);
    default: return size;
  }
}

/** The glyphs (and the picture) of an item, side by side, as wide as they draw. */
function contentWidth(ui: Ui, it: LegendItem, size: number): number {
  const gw = it.glyphs.reduce((a, g) => a + glyphWidth(ui, g, size), 0) + (it.glyphs.length - 1) * size * 0.15;
  return gw + (it.picture ? size * 0.2 + pictureW(it.picture, size) : 0);
}

const pictureW = (img: Image2D, size: number): number => (img.width / img.height) * size;

/** One glyph in its `size` box at (x, y). */
export function drawGlyph(ui: Ui, g: Glyph, x: number, y: number, size: number, alpha = 1): number {
  const w = glyphWidth(ui, g, size);
  const outline = 0xe8f4f8;
  switch (g.kind) {
    case 'chip':
      ui.shape('disc', x, y, size, g.rgb, alpha);
      ui.text(g.text, x + size / 2, y + size * 0.68, size * 0.52, g.ink, { align: 'center', bold: true, alpha });
      break;
    case 'shoulder':
      ui.rect(x, y + size * 0.14, w, size * 0.72, 0x3a4248, alpha, size * 0.22);
      ui.frame(x, y + size * 0.14, w, size * 0.72, Math.max(1, size * 0.05), outline, alpha, size * 0.22);
      ui.text(g.text, x + w / 2, y + size * 0.64, size * 0.4, outline, { align: 'center', bold: true, alpha });
      break;
    case 'stick':
      ui.frame(x, y, size, size, Math.max(2, size * 0.07), outline, alpha, size / 2);
      ui.text(g.text, x + size / 2, y + size * 0.68, size * 0.5, outline, { align: 'center', bold: true, alpha });
      break;
    case 'key':
      ui.rect(x, y + size * 0.08, w, size * 0.84, 0xe8eef0, alpha, size * 0.16);
      ui.text(g.text, x + w / 2, y + size * 0.66, size * 0.5, 0x10181e, { align: 'center', bold: true, alpha });
      break;
    case 'shape':
      ui.shape(g.shape, x, y, size, outline, alpha);
      break;
    case 'clickpad':
      ui.frame(x, y, size, size, Math.max(2, size * 0.07), outline, alpha, size / 2);
      if (g.edge) {
        // The ring's four edges: what an edge click presses.
        const d = size * 0.16;
        for (const [dx, dy] of [[0.5, 0.17], [0.5, 0.83], [0.17, 0.5], [0.83, 0.5]] as const) {
          ui.shape('disc', x + size * dx - d / 2, y + size * dy - d / 2, d, outline, alpha);
        }
      } else {
        const d = size * 0.36;
        ui.shape('disc', x + (size - d) / 2, y + (size - d) / 2, d, outline, alpha);
      }
      break;
  }
  return w;
}

/**
 * Draw `items` into the `w`×`h` window, beside `rect` (the picture's box: `[x, y, w, h]`):
 * in the left margin if it fits there, else along the top if that fits, else wherever it
 * covers less of the picture.
 */
export function drawLegend(ui: Ui, items: readonly LegendItem[], w: number, h: number, rect: readonly [number, number, number, number]): void {
  if (items.length === 0) return;
  const m = legendMetrics(h);
  const widths = items.map((it) => Math.max(m.minW, contentWidth(ui, it, m.glyph) + 28 * m.u, ui.measure(it.label, m.label, true) + 24 * m.u));
  const colW = Math.max(...widths) + 2 * m.margin;
  const colH = items.length * m.itemH + (items.length - 1) * m.gap;
  const rowW = widths.reduce((a, b) => a + b, 0) + (items.length - 1) * m.gap;
  const rowH = m.itemH + 2 * m.margin;
  const [rx, ry, rw, rh] = rect;
  const coverLeft = Math.max(0, colW - rx) * Math.min(rh, colH);
  const coverTop = Math.max(0, rowH - ry) * Math.min(rw, rowW);
  const vertical = colW <= rx || (rowH > ry && coverLeft <= coverTop);
  let x = vertical ? m.margin : Math.max(m.margin, (w - rowW) / 2);
  let y = vertical ? Math.max(m.margin, (h - colH) / 2) : m.margin;
  const itemW = Math.max(...widths);
  items.forEach((it, i) => {
    const iw = vertical ? itemW : widths[i]!;
    const alpha = it.enabled ? 1 : 0.38;
    ui.rect(x, y, iw, m.itemH, 0x10181e, 0.82, 14 * m.u);
    ui.frame(x, y, iw, m.itemH, Math.max(1, 2 * m.u), 0x35555f, 1, 14 * m.u);
    const cw = contentWidth(ui, it, m.glyph);
    let gx = x + (iw - cw) / 2;
    const gy = y + 12 * m.u;
    it.glyphs.forEach((g) => {
      gx += drawGlyph(ui, g, gx, gy, m.glyph, alpha) + m.glyph * 0.15;
    });
    if (it.picture) {
      const pw = pictureW(it.picture, m.glyph);
      const ph = m.glyph;
      ui.image(it.picture, gx - m.glyph * 0.15 + m.glyph * 0.2, gy, pw, ph, true, alpha, 'active-fish');
    }
    ui.text(it.label, x + iw / 2, y + m.itemH - 18 * m.u, m.label, 0xf2f6f8, { align: 'center', bold: true, alpha });
    if (vertical) y += m.itemH + m.gap;
    else x += iw + m.gap;
  });
}

/** Which legend the screen shows, or null for none (a launch, the confirm prompt). */
export function legendScreen(top: { kind: string } | null, mapPanel: boolean, launching: boolean): LegendScreen | null {
  if (top) return top.kind === 'confirm' ? null : (top.kind as LegendScreen);
  if (ui.screen === 'room') return 'room';
  if (ui.screen === 'legimage' || ui.mapOverlay === 'credits') return 'legimage'; // A4: "A: Continue"
  if (ui.screen === 'intro') return null; // A4: no legend during the intro (it has its skip hint)
  if (launching) return null;
  return mapPanel ? 'panel' : 'map';
}
