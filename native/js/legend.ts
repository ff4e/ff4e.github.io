/**
 * The button legend (the controller spec's A4): what each button does on the screen that
 * is up, as small "[glyph] Label" hints — an Xbox-style pad's chips (A5) or the Siri
 * Remote's (B3). The look is the first Xbox WebView prototype's `.pad-hints` (the
 * `xbox-port` branch's index.html, its 10-foot `body.tv` sizes at 1080 lines): a round
 * chip, the word to its right, no card behind either, muted at 75 %. Over the letterbox
 * margin it needs nothing more; where it lies over the picture the words carry the
 * subtitles' dark outline, and the chips their own dark fill and border.
 *
 * It goes in the letterbox margin beside the picture when it fits there — a short list
 * down the left margin, or one row in the top one — and otherwise as one thin row along
 * the top edge (the subtitles have the bottom).
 *
 * The keyboard gets no legend at all: a player at a keyboard knows its keys, and keycaps
 * on a TV picture only cover it. Items that cannot act now are dimmer (A6): Save while the
 * room cannot save, Load with no save, Undo with nothing to undo. With the remote, the
 * "switch fish" item carries the active fish's picture at the chip's height, after its word
 * (B3, TV only): the touch UI's badge art and its visibility rule. Nothing is drawn into the
 * room itself.
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

/** One glyph of an item: a round chip (a pill when its text is wider) with something on it. */
export type Glyph =
  | { readonly kind: 'chip'; readonly text: string; readonly rgb: number; readonly border: number }
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

// The prototype's chip: #2a2a3a with a #556 border, Ⓐ #1f6f3f / #2f9f5f, Ⓑ #7a2a2a / #b04040.
// It had no Ⓧ or Ⓨ; theirs are the same muted treatment of the pad's blue and yellow.
const CHIP_RGB = 0x2a2a3a;
const CHIP_BORDER = 0x555566;
const INK = 0xe8ecee;
const chip = (text: string, rgb = CHIP_RGB, border = CHIP_BORDER): Glyph => ({ kind: 'chip', text, rgb, border });
const A = chip('A', 0x1f6f3f, 0x2f9f5f);
const B = chip('B', 0x7a2a2a, 0xb04040);
const X = chip('X', 0x1f3f7a, 0x3f6fb0);
const Y = chip('Y', 0x7a6418, 0xb09030);
const LB = chip('LB');
const RB = chip('RB');
const L = chip('L');
const R = chip('R');
const DPAD: Glyph = { kind: 'shape', shape: 'cross' };
const MENU: Glyph = { kind: 'shape', shape: 'bars' };
const CLICK: Glyph = { kind: 'clickpad', edge: false };
const EDGE: Glyph = { kind: 'clickpad', edge: true };
const PLAY: Glyph = { kind: 'shape', shape: 'play' };
const BACK: Glyph = { kind: 'shape', shape: 'chevron' };

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

/** The legend for `screen` in `source`'s glyphs: none for the keyboard. */
export function legendItems(screen: LegendScreen, source: InputSource): LegendItem[] {
  if (source === 'key') return [];
  const remote = source === 'remote';
  switch (screen) {
    case 'room':
      if (remote) {
        return [item([EDGE], 'Move'), item([CLICK], 'Switch fish', true, activeFishPicture()),
          item([PLAY], 'Undo', verbAvailable('undo')), item([BACK], 'Menu')];
      }
      return [item([L], 'Little'), item([R], 'Big'), item([B], 'Map'),
        item([LB], 'Save', verbAvailable('save')), item([RB], 'Load', verbAvailable('load')),
        item([X], 'Restart'), item([MENU], 'Menu'), item([Y], 'Undo', verbAvailable('undo'))];
    case 'map':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Open'), item([PLAY], 'Options'), item([BACK], 'Exit')];
      return [item([L], 'Choose'), item([A], 'Open'), item([MENU], 'Options')];
    case 'panel':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Select'), item([BACK], 'Cancel')];
      return [item([L], 'Choose'), item([A], 'Select'), item([B], 'Cancel')];
    case 'legimage':
      return [item([remote ? CLICK : A], 'Continue')];
    case 'pause':
      if (remote) return [item([EDGE], 'Choose'), item([CLICK], 'Select'), item([BACK], 'Resume')];
      return [item([L], 'Choose'), item([A], 'Select'), item([B], 'Resume')];
    case 'options':
      if (remote) return [item([EDGE], 'Change'), item([CLICK], 'Select'), item([BACK], 'Done')];
      return [item([DPAD], 'Change'), item([A], 'Select'), item([B], 'Done')];
    case 'help':
      if (remote) return [item([EDGE], 'Page'), item([BACK], 'Close')];
      return [item([LB, RB], 'Page'), item([B], 'Close')];
  }
}

/** The confirm prompt's answers (A3): Ⓐ Yes · Ⓑ No, or the remote's click and Back; none for the keyboard. */
export function confirmItems(source: InputSource): LegendItem[] {
  if (source === 'pad') return [item([A], 'Yes'), item([B], 'No')];
  if (source === 'remote') return [item([CLICK], 'Yes'), item([BACK], 'No')];
  return [];
}

// ── Drawing ─────────────────────────────────────────────────────────────────────────

/** Hint sizes for a window `h` pixels tall. */
export interface HintMetrics {
  readonly u: number;
  /** A chip's height (its width, when round). */
  readonly glyph: number;
  /** The words' size, px per em. */
  readonly label: number;
  /** Between a chip and its word. */
  readonly labelGap: number;
  /** Between two items in a row. */
  readonly gap: number;
  /** One item's line in a list. */
  readonly line: number;
  /** Off the window's edges. */
  readonly margin: number;
  /** The words' dark outline, as the subtitles carry one. */
  readonly outline: number;
}

/**
 * The prototype's 10-foot sizes — a 26 px chip, 18 px words, 30 px between items — at 1080
 * lines, scaled with the window, and no smaller than at 720 (a 17 px chip, 12 px words).
 */
export function legendMetrics(h: number): HintMetrics {
  const u = Math.max(2 / 3, h / 1080);
  return { u, glyph: 26 * u, label: 18 * u, labelGap: 8 * u, gap: 30 * u, line: 38 * u, margin: 24 * u, outline: Math.max(1, 1.5 * u) };
}

/** Enabled hints are muted as the prototype's (`opacity: 0.75`); the greyed ones further. */
const ON_ALPHA = 0.75;
const OFF_ALPHA = 0.3;

const chipTextPx = (size: number): number => size * 0.58;

function glyphWidth(ui: Ui, g: Glyph, size: number): number {
  // The prototype's `min-width` with `padding: 0 7px` (at 26 px): a pill for "LB".
  return g.kind === 'chip' ? Math.max(size, ui.measure(g.text, chipTextPx(size), true) + size * 0.54) : size;
}

/** The glyphs of an item, side by side, as wide as they draw. */
function glyphsWidth(ui: Ui, it: LegendItem, size: number): number {
  return it.glyphs.reduce((a, g) => a + glyphWidth(ui, g, size), 0) + (it.glyphs.length - 1) * size * 0.2;
}

/** The word, and the picture after it, as wide as they draw. */
function wordWidth(ui: Ui, it: LegendItem, m: HintMetrics): number {
  return ui.measure(it.label, m.label) + (it.picture ? m.labelGap + pictureW(it.picture, m.glyph) : 0);
}

const pictureW = (img: Image2D, size: number): number => (img.width / img.height) * size;

/** A baseline that centres capitals on `cy`. */
const capBaseline = (cy: number, px: number): number => cy + px * 0.36;

/** One glyph in its `size`-tall box at (x, y). Returns its width. */
export function drawGlyph(ui: Ui, g: Glyph, x: number, y: number, size: number, alpha = 1): number {
  const w = glyphWidth(ui, g, size);
  const rgb = g.kind === 'chip' ? g.rgb : CHIP_RGB, border = g.kind === 'chip' ? g.border : CHIP_BORDER;
  ui.rect(x, y, w, size, rgb, alpha, size / 2);
  ui.frame(x, y, w, size, Math.max(1, size / 26), border, alpha, size / 2);
  const cx = x + w / 2, cy = y + size / 2;
  switch (g.kind) {
    case 'chip':
      ui.text(g.text, cx, capBaseline(cy, chipTextPx(size)), chipTextPx(size), INK, { align: 'center', bold: true, alpha });
      break;
    case 'shape': {
      const s = size * 0.62;
      ui.shape(g.shape, cx - s / 2, cy - s / 2, s, INK, alpha, Math.max(1.5, s * 0.12));
      break;
    }
    case 'clickpad':
      if (g.edge) {
        // The pad's four edges: what an edge click presses.
        const d = Math.max(2, size * 0.16);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          ui.shape('disc', cx + dx * size * 0.29 - d / 2, cy + dy * size * 0.29 - d / 2, d, INK, alpha);
        }
      } else {
        const d = size * 0.34;
        ui.shape('disc', cx - d / 2, cy - d / 2, d, INK, alpha);
      }
      break;
  }
  return w;
}

/**
 * An item's glyphs, right-aligned to `glyphsRight`, then its word (and the active fish's
 * picture after it, so the words of a list stay in one column). Returns where it ends.
 */
function drawItem(ui: Ui, it: LegendItem, glyphsRight: number, y: number, m: HintMetrics): number {
  const alpha = it.enabled ? ON_ALPHA : OFF_ALPHA;
  let gx = glyphsRight - glyphsWidth(ui, it, m.glyph);
  it.glyphs.forEach((g, i) => {
    gx += drawGlyph(ui, g, gx, y, m.glyph, alpha) + (i < it.glyphs.length - 1 ? m.glyph * 0.2 : 0);
  });
  let x = glyphsRight + m.labelGap;
  x += ui.text(it.label, x, capBaseline(y + m.glyph / 2, m.label), m.label, INK, { alpha, outline: { r: m.outline, rgb: OUTLINE_RGB } });
  if (!it.picture) return x;
  const pw = pictureW(it.picture, m.glyph);
  ui.image(it.picture, x + m.labelGap, y, pw, m.glyph, true, alpha, 'active-fish');
  return x + m.labelGap + pw;
}

/** The subtitles' outline colour, rgb(5,5,12). */
const OUTLINE_RGB = 0x05050c;

const itemWidth = (ui: Ui, it: LegendItem, m: HintMetrics): number =>
  glyphsWidth(ui, it, m.glyph) + m.labelGap + wordWidth(ui, it, m);

/** The width of `items` as one row. */
export function hintRowWidth(ui: Ui, items: readonly LegendItem[], m: HintMetrics): number {
  return items.reduce((a, it) => a + itemWidth(ui, it, m), 0) + Math.max(0, items.length - 1) * m.gap;
}

/** `items` as one row, from `x`, the chips' tops at `y`. */
export function drawHintRow(ui: Ui, items: readonly LegendItem[], x: number, y: number, m: HintMetrics): void {
  for (const it of items) x = drawItem(ui, it, x + glyphsWidth(ui, it, m.glyph), y, m) + m.gap;
}

/**
 * Draw `items` into the `w`×`h` window, beside `rect` (the picture's box: `[x, y, w, h]`):
 * down the left margin if the list fits there, else as a row in the top margin if that fits,
 * else as a row along the top edge over the picture.
 */
export function drawLegend(ui: Ui, items: readonly LegendItem[], w: number, h: number, rect: readonly [number, number, number, number]): void {
  if (items.length === 0) return;
  const m = legendMetrics(h);
  const glyphsW = Math.max(...items.map((it) => glyphsWidth(ui, it, m.glyph)));
  const labelsW = Math.max(...items.map((it) => wordWidth(ui, it, m)));
  const colW = m.margin + glyphsW + m.labelGap + labelsW + m.margin;
  const rowW = hintRowWidth(ui, items, m);
  const [rx, ry] = rect;
  if (colW <= rx || rowW > w - 2 * m.margin) {
    // A list, the chips in one column and the words in the next.
    let y = Math.max(m.margin, (h - items.length * m.line) / 2) + (m.line - m.glyph) / 2;
    for (const it of items) {
      drawItem(ui, it, m.margin + glyphsW, y, m);
      y += m.line;
    }
    return;
  }
  // A row, centred: in the top margin, vertically in its middle, when it fits there.
  const y = m.glyph + 2 * m.margin <= ry ? (ry - m.glyph) / 2 : m.margin;
  drawHintRow(ui, items, (w - rowW) / 2, y, m);
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
