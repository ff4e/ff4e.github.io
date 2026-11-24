/**
 * The room-toned UI colours, from the web's touch/native menu: the same reviewed static hue
 * per room (`src/data/nativeMenuHues.ts`) through the same `menuPalette`
 * (`src/platform/nativeMenuPalette.ts`) — glass, edge, popup, pressed, and the carved icons'
 * symbol / highlight / shade / detail / outline — parsed from its CSS colours into numbers.
 * The web paints them as `--menu-*` custom properties (`src/styles/nativeMenu.css`); the
 * constants below are that stylesheet's (`--menu-ink`, `--menu-bevel`, the icons' fallbacks
 * in `nativeMenuIcons.svg`, the touch Options' focus `--menu-accent`).
 *
 * Which room: as `syncNativeMenu` (src/app/nativeMenu.ts) picks it — the room on screen once
 * its art is in, and otherwise (loading, the map, a story page) the last one, so the colours
 * do not jump while a room loads. Before any room, the neutral palette.
 */
import { NATIVE_MENU_HUES } from '../../src/data/nativeMenuHues.js';
import { menuPalette, type NativeMenuPalette } from '../../src/platform/nativeMenuPalette.js';
import { ui } from '../../src/app/screenState.js';
import { aiRoomReady, curNum } from './seams/art.js';
import { roomLoading } from './seams/framePacing.js';

/** A colour: `rgb` 0xRRGGBB and an alpha 0..1. */
export interface Rgba {
  readonly rgb: number;
  readonly a: number;
}

export interface UiPalette {
  readonly hue: number | null;
  readonly glass: Rgba;
  readonly edge: Rgba;
  readonly popup: Rgba;
  readonly pressed: Rgba;
  readonly symbol: number;
  readonly highlight: number;
  readonly shade: number;
  readonly detail: number;
  readonly outline: number;
}

/** `--menu-ink`: labels and, with no room hue, the symbols. */
export const INK = 0xf0eee5;
/** `--menu-accent`: the touch Options' focus outline, on the stone face. */
export const ACCENT = 0x796537;
/** The carved icons' fallbacks (`nativeMenuIcons.svg`), used by the neutral palette. */
const FALLBACK = { highlight: 0xfff8dc, shade: 0xaba48e, detail: 0x526965, outline: 0x243039 } as const;

const pct = (s: string): number => (s.endsWith('%') ? Number(s.slice(0, -1)) / 100 : Number(s));

function hslToRgb(h: number, s: number, l: number): number {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** A CSS colour as `menuPalette` writes them: `hsl(h s% l% / a%)`, `rgb(r g b / a%)`, `#rrggbb[aa]`. */
export function parseCss(css: string): Rgba {
  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css);
  if (hex) return { rgb: parseInt(hex[1]!, 16), a: hex[2] ? parseInt(hex[2], 16) / 255 : 1 };
  const fn = /^(hsl|rgb)\(\s*([^)/]+?)\s*(?:\/\s*([^)]+?)\s*)?\)$/.exec(css);
  if (!fn) throw new Error(`not a menu palette colour: ${css}`);
  const [x, y, z] = fn[2]!.split(/\s+/);
  const a = fn[3] ? pct(fn[3]) : 1;
  if (fn[1] === 'rgb') return { rgb: (Number(x) << 16) | (Number(y) << 8) | Number(z), a };
  return { rgb: hslToRgb(Number(x), pct(y!), pct(z!)), a };
}

export function uiPalette(p: NativeMenuPalette): UiPalette {
  const opt = (v: string | null, fallback: number): number => (v === null ? fallback : parseCss(v).rgb);
  return {
    hue: p.hue,
    glass: parseCss(p.glass),
    edge: parseCss(p.edge),
    popup: parseCss(p.popup),
    pressed: parseCss(p.pressed),
    symbol: opt(p.symbol, INK),
    highlight: opt(p.highlight, FALLBACK.highlight),
    shade: opt(p.shade, FALLBACK.shade),
    detail: opt(p.detail, FALLBACK.detail),
    outline: opt(p.outline, FALLBACK.outline),
  };
}

const cache = new Map<number | null, UiPalette>();
let lastRoom = 0;

/** Room `num`'s palette (0: none, the neutral one). */
export function roomPalette(num: number): UiPalette {
  const hue = num > 0 ? NATIVE_MENU_HUES[num - 1] : null;
  if (hue === undefined) throw new Error(`Missing native menu palette for room ${num}`);
  let p = cache.get(hue);
  if (!p) cache.set(hue, (p = uiPalette(menuPalette(hue))));
  return p;
}

/** The palette for what is on screen now. */
export function currentPalette(): UiPalette {
  if (ui.screen === 'room' && curNum > 0 && !roomLoading && aiRoomReady()) lastRoom = curNum;
  return roomPalette(lastRoom);
}
