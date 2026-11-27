/**
 * The button legend (the controller spec's A4): what each button does on the screen that
 * is up, as small "[glyph] Label" hints — an Xbox-style pad's buttons (A5) or the Siri
 * Remote's (B3). The shape is the first Xbox WebView prototype's `.pad-hints` (the
 * `xbox-port` branch's index.html, its 10-foot sizes at 1080 lines): a small round glyph,
 * the word to its right, one row or a short list. The paint is the web touch UI's
 * (`src/styles/nativeMenu.css`, `uiPalette.ts`): each glyph a little room-toned glass chip
 * with its hairline edge and its symbol in the room's carved-icon colour, and the words in
 * the touch UI's ink with its soft dark shadow. The pad's A/B/X/Y keep their colours, muted
 * to the palette's lightness, so they stay apart at a glance.
 *
 * It goes in the letterbox margin beside the picture when it fits there — a short list
 * down the left margin, or one row in the top one, muted (75 %, as the prototype's) — and
 * otherwise as one row along the top edge on a strip of the touch UI's popup glass, at full
 * strength. The top, not the bottom: in a room the subtitles have the bottom. Nothing on
 * the map's side has hints (`legendScreen`). Either way it hugs the SCREEN's
 * edge, a small fixed margin in — on a TV too: unlike the menus, the hints do not keep to
 * tvOS's title-safe area (`safeArea.ts`), whose insets are fixed and large (80 pt at the
 * sides, 60 above and below, whatever the set), which put them far from the edge on the
 * TVs that do not overscan, as nearly none does now (TestFlight feedback, twice). So on a TV
 * the legend is laid out against the whole window, sized for its height, 20 px in at 1080
 * lines (1.9 %): a little more than a desktop window's 12, for a set that still overscans a
 * little.
 *
 * Where it goes depends on the window, the picture's box and the screen's words, never on
 * the game's state: an item's width is fixed whatever it shows — the "switch fish" item
 * reserves the wider of the two fish pictures — so switching fish, or an item greying, can
 * never move the legend from the margin to the top and back.
 *
 * The keyboard gets no legend at all: a player at a keyboard knows its keys, and keycaps
 * on a TV picture only cover it. Items that cannot act now are dimmer (A6): Save while the
 * room cannot save, Load with no save, Undo with nothing to undo. With the remote, the
 * "switch fish" item carries the active fish's picture at the chip's height, after its word
 * (B3, TV only): the touch UI's badge art and its visibility rule. The words are in the UI's
 * language (`uiStrings.ts`). Nothing is drawn into the room itself.
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
import { drawGlass, hairline } from './uiGlass.js';
import { currentPalette, INK, type UiPalette } from './uiPalette.js';
import { t, type UiString } from './uiStrings.js';
import { pulsePhase, tutorialHintVerb } from './tutorialHint.js';

/**
 * One glyph of an item: a round chip (a pill when its text is wider) with a letter on it —
 * in the room's symbol colour, or `hue`'s (the pad's face buttons) — or a shape.
 */
export type Glyph =
  | { readonly kind: 'chip'; readonly text: string; readonly hue?: number }
  | { readonly kind: 'shape'; readonly shape: Shape }
  | { readonly kind: 'clickpad'; readonly edge: boolean };

export interface LegendItem {
  readonly glyphs: readonly Glyph[];
  /** What the item says, as a `uiStrings` key. */
  readonly key: UiString;
  readonly label: string;
  readonly enabled: boolean;
  /** The item has the active fish's picture after its word (B3): its slot is always there. */
  readonly fishSlot?: boolean;
  /** The picture in that slot now, or null while the badge would be hidden. */
  readonly picture?: Image2D | null;
  /** The tutorial is talking about this item's verb: its glyphs pulse (`tutorialHint.ts`). */
  readonly pulse?: boolean;
}

/** Where the legend is: the screen it describes. */
export type LegendScreen = 'room' | 'cutscene' | 'options' | 'help';

const chip = (text: string, hue?: number): Glyph => (hue === undefined ? { kind: 'chip', text } : { kind: 'chip', text, hue });
// The pad's face-button hues (A green, B red, X blue, Y yellow), at the room symbol's lightness.
const A = chip('A', 125);
const B = chip('B', 2);
const X = chip('X', 215);
const Y = chip('Y', 46);
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

const item = (glyphs: readonly Glyph[], key: UiString, enabled = true): LegendItem => ({ glyphs, key, label: t(key), enabled });
const fishItem = (glyphs: readonly Glyph[], key: UiString): LegendItem =>
  ({ ...item(glyphs, key), fishSlot: true, picture: activeFishPicture() });

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
    case 'room': {
      const cue = tutorialHintVerb();
      const pulsing = (it: LegendItem, on: boolean): LegendItem => (on ? { ...it, pulse: true } : it);
      if (remote) {
        return [item([EDGE], 'move'), fishItem([CLICK], 'switchFish'),
          item([PLAY], 'undo', verbAvailable('undo')), pulsing(item([BACK], 'menu'), cue !== null)];
      }
      return [item([L], 'little'), item([R], 'big'), item([B], 'map'),
        pulsing(item([LB], 'save', verbAvailable('save')), cue === 'save'),
        pulsing(item([RB], 'load', verbAvailable('load')), cue === 'load'),
        item([X], 'restart'), item([MENU], 'menu'), item([Y], 'undo', verbAvailable('undo'))];
    }
    case 'cutscene':
      return [item([remote ? BACK : B], 'skip')]; // A4: "B: Skip"; B2: Back (or a click) skips
    case 'options':
      if (remote) return [item([EDGE], 'change'), item([CLICK], 'select'), item([BACK], 'done')];
      return [item([DPAD], 'change'), item([A], 'select'), item([B], 'done')];
    case 'help':
      if (remote) return [item([EDGE], 'page'), item([BACK], 'close')];
      return [item([LB, RB], 'page'), item([B], 'close')];
  }
}

/**
 * The confirm prompt's hints, under its OK and Cancel: Ⓐ presses the focused button and Ⓑ
 * cancels — the remote's click and Back; none for the keyboard (Enter and Esc).
 */
export function confirmItems(source: InputSource): LegendItem[] {
  if (source === 'pad') return [item([A], 'select'), item([B], 'cancel')];
  if (source === 'remote') return [item([CLICK], 'select'), item([BACK], 'cancel')];
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
  /** Off the window's edge, which the hints hug. */
  readonly edge: number;
  /** At least this far from the picture, beside or above it in its margin. */
  readonly clear: number;
  /** The web's 1 CSS px. */
  readonly hair: number;
}

/**
 * The prototype's 10-foot sizes — a 26 px chip, 18 px words, 30 px between items — at 1080
 * lines, scaled with the window, and no smaller than at 720 (a 17 px chip, 12 px words).
 * `tv`: the window is a TV's (it has title-safe insets), whose edge gets a little more margin.
 */
export function legendMetrics(h: number, tv = false): HintMetrics {
  const u = Math.max(2 / 3, h / 1080);
  return {
    u, glyph: 26 * u, label: 18 * u, labelGap: 8 * u, gap: 30 * u, line: 38 * u,
    edge: (tv ? TV_EDGE : DESKTOP_EDGE) * u, clear: 24 * u, hair: hairline(h),
  };
}

/** Off a TV screen's edge, px at 1080 lines (not off its title-safe area: see the header). */
export const TV_EDGE = 20;
/** Off a desktop window's edge, px at 1080 lines. */
const DESKTOP_EDGE = 12;

/**
 * The legend's frame: the whole window, though `ui` may be laid out inside title-safe insets
 * (a TV, or `--tv-safe-area`) — `w`×`h` and the picture's box `rect` are in the safe area's
 * coordinates, the result in the window's, and (dx, dy) takes a window point back to `ui`'s.
 */
function windowFrame(ui: Ui, w: number, h: number, rect: readonly [number, number, number, number]):
  { w: number; h: number; rect: readonly [number, number, number, number]; dx: number; dy: number; tv: boolean } {
  const [l, t, r, b] = ui.bleed;
  return { w: w + l + r, h: h + t + b, rect: [rect[0] + l, rect[1] + t, rect[2], rect[3]], dx: -l, dy: -t, tv: ui.bleed.some((v) => v > 0) };
}

/** Over the black margin the hints are muted as the prototype's (`opacity: 0.75`). */
const ON_ALPHA = 0.75;
/** On the strip over the picture: full strength. */
const STRIP_ON_ALPHA = 1;
/** Greyed (cannot act), anywhere: about the web's disabled touch button. */
const OFF_ALPHA = 0.35;
/** The widest fish picture's width / height (the little fish's 180×60): the slot reserved for either. */
const FISH_SLOT_ASPECT = 3;

const chipTextPx = (size: number): number => size * 0.56;

/** A face button's letter: its hue at the room symbol's saturation and lightness. */
const faceInk = (hue: number): number => {
  const k = (n: number): number => (n + hue / 30) % 12;
  const s = 0.5, l = 0.7, a = s * Math.min(l, 1 - l);
  const f = (n: number): number => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
};

function glyphWidth(ui: Ui, g: Glyph, size: number): number {
  // The prototype's `min-width` with `padding: 0 7px` (at 26 px): a pill for "LB".
  return g.kind === 'chip' ? Math.max(size, ui.measure(g.text, chipTextPx(size), true) + size * 0.54) : size;
}

/** The glyphs of an item, side by side, as wide as they draw. */
function glyphsWidth(ui: Ui, it: LegendItem, size: number): number {
  return it.glyphs.reduce((a, g) => a + glyphWidth(ui, g, size), 0) + (it.glyphs.length - 1) * size * 0.2;
}

/** The word, and the fish slot after it, as wide as they draw — whichever fish is in it. */
function wordWidth(ui: Ui, it: LegendItem, m: HintMetrics): number {
  return ui.measure(it.label, m.label, true) + (it.fishSlot ? m.labelGap + FISH_SLOT_ASPECT * m.glyph : 0);
}

/** A baseline that centres capitals on `cy`. */
const capBaseline = (cy: number, px: number): number => cy + px * 0.36;

/** One glyph in its `size`-tall box at (x, y), in `pal`'s colours. Returns its width. */
export function drawGlyph(ui: Ui, g: Glyph, x: number, y: number, size: number, pal: UiPalette, alpha = 1, hair = 1): number {
  const w = glyphWidth(ui, g, size);
  ui.rect(x, y, w, size, pal.glass.rgb, pal.glass.a * alpha, size / 2);
  ui.frame(x, y, w, size, hair, pal.edge.rgb, pal.edge.a * alpha, size / 2);
  const cx = x + w / 2, cy = y + size / 2;
  switch (g.kind) {
    case 'chip': {
      const ink = g.hue === undefined ? pal.symbol : faceInk(g.hue);
      ui.text(g.text, cx, capBaseline(cy, chipTextPx(size)), chipTextPx(size), ink, { align: 'center', bold: true, alpha });
      break;
    }
    case 'shape': {
      const s = size * 0.62;
      ui.shape(g.shape, cx - s / 2, cy - s / 2, s, pal.symbol, alpha, Math.max(1.5, s * 0.12));
      break;
    }
    case 'clickpad':
      if (g.edge) {
        // The pad's four edges: what an edge click presses.
        const d = Math.max(2, size * 0.16);
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          ui.shape('disc', cx + dx * size * 0.29 - d / 2, cy + dy * size * 0.29 - d / 2, d, pal.symbol, alpha);
        }
      } else {
        const d = size * 0.34;
        ui.shape('disc', cx - d / 2, cy - d / 2, d, pal.symbol, alpha);
      }
      break;
  }
  return w;
}

/**
 * An item's glyphs, right-aligned to `glyphsRight`, then its word (and the active fish's
 * picture after it, so the words of a list stay in one column). Returns where it ends.
 */
function drawItem(ui: Ui, it: LegendItem, glyphsRight: number, y: number, m: HintMetrics, pal: UiPalette, strip: boolean): number {
  const alpha = it.enabled ? (strip ? STRIP_ON_ALPHA : ON_ALPHA) : OFF_ALPHA;
  let gx = glyphsRight - glyphsWidth(ui, it, m.glyph);
  if (it.pulse) {
    // The touch button's `dialogue-hint-pulse`: a ring of #aee at 0.6 growing to 3 px and back.
    const k = pulsePhase(), r = 3 * m.u * k;
    if (r > 0.25) ui.frame(gx - r, y - r, glyphsWidth(ui, it, m.glyph) + 2 * r, m.glyph + 2 * r, r, 0xaaeeee, 0.6, m.glyph / 2 + r);
  }
  it.glyphs.forEach((g, i) => {
    gx += drawGlyph(ui, g, gx, y, m.glyph, pal, alpha, m.hair) + (i < it.glyphs.length - 1 ? m.glyph * 0.2 : 0);
  });
  let x = glyphsRight + m.labelGap;
  // The touch UI's label: bold ink with `text-shadow: 0 1px 2px #000`.
  x += ui.text(it.label, x, capBaseline(y + m.glyph / 2, m.label), m.label, INK,
    { alpha, bold: true, outline: { r: Math.max(1, 1.2 * m.u), rgb: 0x000000, dy: m.hair, alpha: 0.7 } });
  if (!it.fishSlot) return x;
  const slot = FISH_SLOT_ASPECT * m.glyph;
  if (it.picture) {
    const pw = Math.min(slot, (it.picture.width / it.picture.height) * m.glyph);
    ui.image(it.picture, x + m.labelGap, y, pw, m.glyph, true, alpha, 'active-fish');
  }
  return x + m.labelGap + slot;
}

const itemWidth = (ui: Ui, it: LegendItem, m: HintMetrics): number =>
  glyphsWidth(ui, it, m.glyph) + m.labelGap + wordWidth(ui, it, m);

/** The width of `items` as one row. */
export function hintRowWidth(ui: Ui, items: readonly LegendItem[], m: HintMetrics): number {
  return items.reduce((a, it) => a + itemWidth(ui, it, m), 0) + Math.max(0, items.length - 1) * m.gap;
}

/**
 * `items` as one row, from `x`, the chips' tops at `y`; `strip` when it lies on its strip
 * over the picture (full strength), not on a card or the margin (muted).
 */
export function drawHintRow(ui: Ui, items: readonly LegendItem[], x: number, y: number, m: HintMetrics, pal: UiPalette, strip = false): void {
  for (const it of items) x = drawItem(ui, it, x + glyphsWidth(ui, it, m.glyph), y, m, pal, strip) + m.gap;
}

/** How far the strip behind hints reaches past them, across and down. */
const stripPad = (m: HintMetrics): [number, number] => [14 * m.u, 6 * m.u];

/** The strip behind hints over the picture: the touch UI's popup glass round the `w`×`h` box at (x, y). */
function drawStrip(ui: Ui, x: number, y: number, w: number, h: number, m: HintMetrics, pal: UiPalette): void {
  const [px, py] = stripPad(m);
  ui.record(['strip', Math.round(x - px), Math.round(y - py), Math.round(w + 2 * px), Math.round(h + 2 * py)]);
  drawGlass(ui, x - px, y - py, w + 2 * px, h + 2 * py, 10 * m.u, m.hair, pal, 'popup');
}

/** Where `drawLegend` puts `items`: a list down the margin, a row in the top margin, or a row (or list) on a strip. */
export type LegendPlacement = 'list' | 'row' | 'row-strip' | 'list-strip';

/** Where `items` go in the `w`×`h` window beside the picture's box `rect`. Pure: words, window and box only. */
export function legendPlacement(ui: Ui, items: readonly LegendItem[], sw: number, sh: number, srect: readonly [number, number, number, number]): LegendPlacement {
  const { w, h, rect, tv } = windowFrame(ui, sw, sh, srect);
  const m = legendMetrics(h, tv);
  const listW = Math.max(...items.map((it) => glyphsWidth(ui, it, m.glyph))) + m.labelGap + Math.max(...items.map((it) => wordWidth(ui, it, m)));
  if (m.edge + listW + m.clear <= rect[0]) return 'list';
  if (hintRowWidth(ui, items, m) + 2 * stripPad(m)[0] > w - 2 * m.edge) return 'list-strip';
  return m.edge + m.glyph + m.clear <= rect[1] ? 'row' : 'row-strip';
}

/**
 * Draw `items` into the window, beside the picture's box (`[x, y, w, h]`): down the left
 * margin if the list fits there, else as a row in the top margin if that fits, else as a row
 * on its strip along the top edge over the picture — each against the window's edge
 * (`HintMetrics.edge`), a strip's glass too. `sw`×`sh` and `srect` are in `ui`'s coordinates:
 * the title-safe area's on a TV, which the legend alone of the UI does not keep to.
 */
export function drawLegend(ui: Ui, items: readonly LegendItem[], sw: number, sh: number, srect: readonly [number, number, number, number]): void {
  if (items.length === 0) return;
  const { w, h, dx, dy, tv } = windowFrame(ui, sw, sh, srect);
  const m = legendMetrics(h, tv);
  const pal = currentPalette();
  const where = legendPlacement(ui, items, sw, sh, srect);
  const [px, py] = stripPad(m);
  if (where === 'list' || where === 'list-strip') {
    const glyphsW = Math.max(...items.map((it) => glyphsWidth(ui, it, m.glyph)));
    const listW = glyphsW + m.labelGap + Math.max(...items.map((it) => wordWidth(ui, it, m)));
    const listH = (items.length - 1) * m.line + m.glyph;
    const strip = where === 'list-strip';
    const x = m.edge + (strip ? px : 0) + dx;
    let y = Math.max(m.edge + (strip ? py : 0), (h - listH) / 2) + dy;
    if (strip) drawStrip(ui, x, y, listW, listH, m, pal);
    for (const it of items) {
      drawItem(ui, it, x + glyphsW, y, m, pal, strip);
      y += m.line;
    }
    return;
  }
  const rowW = hintRowWidth(ui, items, m);
  const x = (w - rowW) / 2 + dx;
  if (where === 'row') {
    drawHintRow(ui, items, x, m.edge + dy, m, pal);
    return;
  }
  drawStrip(ui, x, m.edge + py + dy, rowW, m.glyph, m, pal);
  drawHintRow(ui, items, x, m.edge + py + dy, m, pal, true);
}

/**
 * Which legend the screen shows, or null for none. None anywhere on the map's side (B6,
 * after TestFlight build 3): the plain map, its record panel, a launch, a story page and the
 * credits — the selection ring, the panel's lit button and a page's own picture say what a
 * click does. None during the intro (A4: it has its skip hint), on the confirm prompt (its
 * hints are on its card, under its buttons), or under the top bar (B6: the room's hints step aside for it).
 * Options and Help, which can open over the map too, keep theirs: they are menus, not the map.
 */
export function legendScreen(top: { kind: string } | null): LegendScreen | null {
  if (top) return top.kind === 'confirm' || top.kind === 'bar' ? null : (top.kind as LegendScreen);
  if (ui.screen === 'room') return cutscene ? 'cutscene' : 'room';
  return null;
}
