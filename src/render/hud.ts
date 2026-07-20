/**
 * The control-panel HUD (TOvl, Uovl.pas) — faithful compositing + hit-testing of
 * the panel.ffp overlay. The panel is drawn as seven horizontal bands (big-fish
 * D-pad, swap, little-fish D-pad, save, load, exit, restart), each taken from the
 * colour-variant image matching that element's state (VykresliPanel o_normal,
 * Uovl.pas:478-497), plus a "lit" arrow overlay when a direction is pressed.
 */
import { PANEL_W, PANEL_H, PANEL_IMAGES } from '../data/ffp.js';

/** Options-image indices in panel.ffp (Uovl.pas:25-28). */
export const OPTIONS_IMG = 4; // 'options1' — the options sub-panel background
export const OPTAKT_IMG = 5; // 'options2' — the "active" highlight variants
export const SCROLL_MIN = 6; // 'sc1' — first scroll frame
export const SCROLL_MAX = 15; // 'sc10' — last scroll frame (= fully-open options)

/** Colour-variant image indices (Uovl.pas:21-24). */
export const SEDY = 0; // grey / disabled
export const ORANZOVY = 1; // orange / available
export const ZLUTY = 2; // yellow / active fish
export const SVITICI = 3; // lit / pressed

/** Per-element colour state + pressed direction (0 none, 1-4 little, 5-8 big). */
export interface PanelState {
  velka: number;
  space: number;
  mala: number;
  save: number;
  load: number;
  abort: number;
  restart: number;
  pressedDir: number;
}

/** Full-width horizontal bands: [stateKey, topRow, bottomRow] (Uovl.pas:480-486). */
const BANDS: [keyof PanelState, number, number][] = [
  ['velka', 0, 148],
  ['space', 149, 171],
  ['mala', 172, 317],
  ['save', 318, 335],
  ['load', 336, 353],
  ['abort', 354, 371],
  ['restart', 372, 394],
];

/** Lit-arrow overlay rectangles per pressed direction (Uovl.pas:487-496): [left,top,width,height]. */
const PRESSED_REGION: Record<number, [number, number, number, number]> = {
  5: [51, 0, 51, 49], // big up
  6: [52, 98, 50, 48], // big down
  7: [3, 46, 47, 51], // big left
  8: [105, 48, 45, 48], // big right
  1: [52, 171, 48, 49], // little up
  2: [52, 269, 49, 47], // little down
  3: [3, 218, 46, 51], // little left
  4: [105, 219, 45, 48], // little right
};

/**
 * Mouse hit-regions (oblmysi, Uovl.pas:99-117): the normal panel (1..16) plus the
 * options sub-panel (16..23). type 1 = circle [1, cx, cy, r]; type 2 = rect
 * [2, x1, y1, x2, y2].
 */
export const OBLMYSI: readonly (readonly number[])[] = [
  [], // 0 unused
  [1, 75, 197, 20], // 1  little up
  [1, 76, 290, 20], // 2  little down
  [1, 28, 242, 20], // 3  little left
  [1, 124, 243, 20], // 4  little right
  [1, 76, 243, 54], // 5  select little
  [1, 75, 25, 20], // 6  big up
  [1, 76, 118, 20], // 7  big down
  [1, 28, 71, 20], // 8  big left
  [1, 124, 72, 20], // 9  big right
  [1, 76, 72, 54], // 10 select big
  [2, 25, 149, 132, 167], // 11 swap
  [2, 0, 318, 59, 335], // 12 save
  [2, 0, 336, 75, 353], // 13 load
  [2, 0, 354, 86, 371], // 14 exit (abort)
  [2, 0, 372, 99, 392], // 15 restart
  [2, 114, 332, 154, 394], // 16 options (roh)
  [2, 12, 77, 141, 93], // 17 sound-effects volume slider (oblsnd)
  [2, 12, 126, 141, 142], // 18 voices volume slider (obltalk)
  [2, 12, 175, 141, 191], // 19 music volume slider (oblmusic)
  [2, 6, 251, 50, 281], // 20 subtitles: Czech (obltitcz)
  [2, 52, 251, 99, 281], // 21 subtitles: English (obltiteng)
  [2, 101, 251, 147, 281], // 22 subtitles: off (obltitno)
  [2, 18, 323, 94, 354], // 23 help (oblhelp)
];

/** The last region index of each panel state (ZjistiOblast, Uovl.pas:612-616). */
export const OBLROH = 16;
export const NOBLMYSI = 23;

/**
 * ZjistiOblast (Uovl.pas:608): the region index at panel (x,y), or 0. The active
 * region range depends on the panel state — the normal panel exposes 1..16, the
 * options sub-panel exposes 16..23 (the corner button is shared by both).
 */
export function hitTest(x: number, y: number, options = false): number {
  const lo = options ? OBLROH : 1;
  const hi = options ? NOBLMYSI : OBLROH;
  for (let i = lo; i <= hi; i++) {
    const o = OBLMYSI[i]!;
    if (o[0] === 1) {
      const dx = x - o[1]!;
      const dy = y - o[2]!;
      if (dx * dx + dy * dy <= o[3]! * o[3]!) return i;
    } else if (o[0] === 2) {
      if (x >= o[1]! && y >= o[2]! && x <= o[3]! && y <= o[4]!) return i;
    }
  }
  return 0;
}

/**
 * PomObl (Uovl.pas:627): the 0..12 slider index a click at panel x maps to, for the
 * three volume sliders (their handle track runs x 12..141 in 10px steps).
 */
export function sliderIndex(x: number): number {
  return Math.max(0, Math.min(12, Math.floor((x - 12) / 10)));
}

function usek(out: Uint8Array, src: Uint8Array, top: number, bottom: number): void {
  const from = top * PANEL_W;
  const to = (bottom + 1) * PANEL_W;
  out.set(src.subarray(from, to), from);
}

function region(out: Uint8Array, src: Uint8Array, [left, top, width, height]: number[]): void {
  for (let row = top!; row <= top! + height!; row++) {
    const off = row * PANEL_W + left!;
    out.set(src.subarray(off, off + width!), off);
  }
}

/** VykresliPanel (Uovl.pas:375), normal panel: composite the indexed 155x395 image. */
export function composePanel(images: readonly Uint8Array[], st: PanelState): Uint8Array {
  const out = new Uint8Array(PANEL_W * PANEL_H);
  for (const [key, top, bottom] of BANDS) {
    const idx = Math.min(Math.max(st[key], 0), PANEL_IMAGES - 1);
    usek(out, images[idx]!, top, bottom);
  }
  const reg = PRESSED_REGION[st.pressedDir];
  if (reg) region(out, images[SVITICI]!, reg);
  return out;
}

/** Subtitle-highlight left edge for each mode (Uovl.pas:465-467). */
const SUBTITLE_HIGHLIGHT_X: Record<'cz' | 'en' | 'off', number> = { cz: 5, en: 52, off: 100 };
/** Slider-handle Y per category (Cudlik ...,85/134/183; Uovl.pas:470-472). */
const HANDLE_Y = { effect: 85, voice: 134, music: 183 } as const;

/** Live state of the options sub-panel needed to render it. */
export interface OptionsState {
  /** Slider indices 0..12 for effects / voices / music (tahlo_snd/talk/music). */
  volume: { effect: number; voice: number; music: number };
  /** Current subtitle mode (drives the highlighted Czech/English/off button). */
  subtitles: 'cz' | 'en' | 'off';
  /** True while the help screen is open (highlights the help button). */
  helpActive: boolean;
  /** Scroll frame to overlay (6..15) during the open/close animation, or -1 for none. */
  scrollFrame: number;
}

/**
 * Cudlik (Uovl.pas:410): blit the 17x17 slider-handle sprite centred at (x,y),
 * skipping its transparent index (the sprite's top-left pixel).
 */
function cudlik(out: Uint8Array, cudl: Uint8Array, x: number, y: number): void {
  const transparent = cudl[0]!;
  for (let row = 0; row < 17; row++) {
    const dy = y - 8 + row;
    if (dy < 0 || dy >= PANEL_H) continue;
    for (let col = 0; col < 17; col++) {
      const px = cudl[row * 17 + col]!;
      if (px === transparent) continue;
      const dx = x - 8 + col;
      if (dx < 0 || dx >= PANEL_W) continue;
      out[dy * PANEL_W + dx] = px;
    }
  }
}

/**
 * Pruhl (Uovl.pas:382): overlay a source image's non-transparent pixels onto the
 * destination. The transparent index is the pixel at row 394, col 0 of the last
 * scroll frame (Obr[scmax]).
 */
function pruhl(out: Uint8Array, src: Uint8Array, transparent: number): void {
  for (let i = 0; i < out.length; i++) {
    const px = src[i]!;
    if (px !== transparent) out[i] = px;
  }
}

/**
 * KresliOptions (Uovl.pas:461): the options sub-panel — the options background,
 * the highlighted subtitle-mode button, the three slider handles, and (while help
 * is open) the highlighted help button. During the scroll animation the matching
 * scroll frame is overlaid on top (o_sc_up / o_sc_down).
 */
export function composeOptions(
  images: readonly Uint8Array[],
  cudl: Uint8Array,
  st: OptionsState,
): Uint8Array {
  const out = new Uint8Array(PANEL_W * PANEL_H);
  out.set(images[OPTIONS_IMG]!); // Usek(options,0,394)
  // Subtitle-mode highlight: Region(optakt, x, 250, 47, 33).
  region(out, images[OPTAKT_IMG]!, [SUBTITLE_HIGHLIGHT_X[st.subtitles], 250, 47, 33]);
  // Three slider handles at 17 + 10*tahlo.
  cudlik(out, cudl, 17 + 10 * clampSlider(st.volume.effect), HANDLE_Y.effect);
  cudlik(out, cudl, 17 + 10 * clampSlider(st.volume.voice), HANDLE_Y.voice);
  cudlik(out, cudl, 17 + 10 * clampSlider(st.volume.music), HANDLE_Y.music);
  // Help button highlight (shown while the help screen is open): Region(optakt,18,323,76,31).
  if (st.helpActive) region(out, images[OPTAKT_IMG]!, [18, 323, 76, 31]);
  // Scroll animation: overlay the intermediate frame (Pruhl(scroll)).
  if (st.scrollFrame >= SCROLL_MIN && st.scrollFrame <= SCROLL_MAX) {
    const transparent = images[SCROLL_MAX]![394 * PANEL_W]!;
    pruhl(out, images[st.scrollFrame]!, transparent);
  }
  return out;
}

function clampSlider(i: number): number {
  return Math.max(0, Math.min(12, Math.floor(i)));
}

/** Convert a composed indexed panel to RGBA using the FFP palette. */
export function panelToRgba(indexed: Uint8Array, palette: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(indexed.length * 4);
  for (let i = 0; i < indexed.length; i++) {
    const c = indexed[i]! * 3;
    rgba[i * 4] = palette[c]!;
    rgba[i * 4 + 1] = palette[c + 1]!;
    rgba[i * 4 + 2] = palette[c + 2]!;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export { PANEL_W, PANEL_H };
