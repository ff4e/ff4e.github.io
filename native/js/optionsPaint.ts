/**
 * The native Options: the original game's Options face — the artwork the tablets show
 * (#183, #191), the AI-upscaled panel art `src/render/panelAi.ts` composites — drawn through
 * `Surface2D`, scaled to most of the window's height, with a TV focus ring on the row the
 * remote or the pad is on. Beside it, a caption card names the focused row and its value
 * (the face's sliders are small from a sofa), and holds the one control the 1998 face has no
 * place for: the subtitle font (`ff.subfont`), shown in its own face.
 *
 * The chrome around the face is the web touch UI's, in the room's palette: the caption card
 * is its popup glass (`uiGlass.ts`), and the focus is its touch Options' focus outline
 * (`#touchopts :focus-visible`: `--menu-accent`, offset from the box) on the stone face, the
 * ink on the card. The words are in the UI's language.
 *
 * The face is composited exactly as `AiPanel.drawOptions` composites it — the base image,
 * the subtitle highlight, the three slider handles — at the face's scale rather than the
 * art's. The privacy link and the feedback strip are left out: a TV has no browser tab.
 */
import { OPTIONS_IMG, OPTAKT_IMG, OBLMYSI } from '../../src/render/hud.js';
import { PANEL_H, PANEL_IMAGES, PANEL_W, CUDL_SIZE } from '../../src/data/ffp.js';
import type { Image2D } from '../../src/render/surface2d.js';
import { ui as screenUi } from '../../src/app/screenState.js';
import { settings } from './seams/playerSettings.js';
import { decodeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';
import { OPTIONS_ROWS, type OptionsRow } from './menus.js';
import { labelShadow, popup, scrim } from './menuPaint.js';
import { currentPalette, ACCENT, INK } from './uiPalette.js';
import { t, type UiString } from './uiStrings.js';
import { hairline } from './uiGlass.js';
import { subFontName } from './optionsModel.js';
import { subtitleFace } from './roomSubtitles.js';
import type { Ui } from './uiDraw.js';

interface PanelArt {
  readonly images: readonly Image2D[];
  readonly cudl: Image2D;
  readonly scale: number;
}

let art: PanelArt | null = null;
let artLoad: Promise<void> | null = null;

/**
 * The AI panel art: the 16 colour variants and the slider handle, from the same files the
 * browser's `loadAiPanel` reads, all of which ship.
 * restates src/render/panelAi.ts `export async function loadAiPanel(` @ d71e6f46b90b
 */
export function ensureOptionsArt(): Promise<void> {
  return (artLoad ??= (async () => {
    const dir = '/enhanced-ai/_panel/';
    const man = JSON.parse(new TextDecoder().decode(await readBytes(`${dir}ai.json`))) as { scale?: number };
    const img = async (name: string): Promise<Image2D> => decodeImage((await readBytes(dir + name)).slice().buffer);
    const images = await Promise.all(Array.from({ length: PANEL_IMAGES }, (_, i) => img(`img${String(i).padStart(2, '0')}.webp`)));
    art = { images, cudl: await img('cudl.webp'), scale: Number(man.scale) || AI_PANEL_SCALE };
  })());
}

/** The shipped panel art's upscale when its manifest does not say (panelAi.ts imports the DOM's decoder, so not imported). */
// restates src/render/panelAi.ts `export const AI_PANEL_SCALE =` @ 3b71f037787a
const AI_PANEL_SCALE = 4;

/** Subtitle-highlight left edge per mode (Uovl.pas:465-467). */
// restates src/render/hud.ts `const SUBTITLE_HIGHLIGHT_X:` @ da6eb22f2d31
const SUBTITLE_HIGHLIGHT_X: Record<'cz' | 'en' | 'off', number> = { cz: 5, en: 52, off: 100 };
/** Slider-handle Y per bus (Cudlik …, 85/134/183; Uovl.pas:470-472). */
// restates src/render/hud.ts `const HANDLE_Y =` @ ccfbdcc24290
const HANDLE_Y = { effect: 85, voice: 134, music: 183 } as const;

/** Each row's box on the face, in panel pixels [x1, y1, x2, y2]: its hit region (hud.ts OBLMYSI). */
const ROW_BOX: Readonly<Record<Exclude<OptionsRow, 'font'>, readonly [number, number, number, number]>> = {
  effect: OBLMYSI[17]!.slice(1) as unknown as [number, number, number, number],
  voice: OBLMYSI[18]!.slice(1) as unknown as [number, number, number, number],
  music: OBLMYSI[19]!.slice(1) as unknown as [number, number, number, number],
  subtitles: [OBLMYSI[20]![1]!, OBLMYSI[20]![2]!, OBLMYSI[22]![3]!, OBLMYSI[22]![4]!],
  help: OBLMYSI[23]!.slice(1) as unknown as [number, number, number, number],
  done: OBLMYSI[16]!.slice(1) as unknown as [number, number, number, number],
};

const ROW_NAME: Readonly<Record<OptionsRow, UiString>> = {
  effect: 'effectVolume', voice: 'talkVolume', music: 'musicVolume', subtitles: 'subtitles',
  font: 'subtitleFont', help: 'help', done: 'exitOptions',
};
/** Each language in its own name; "off" in the UI's. */
const subName = (mode: 'cz' | 'en' | 'off'): string => (mode === 'cz' ? 'Čeština' : mode === 'en' ? 'English' : t('subsOff'));

/** A focus outline `t` thick, `off` outside the box, in `rgb`. */
function focusOutline(ui: Ui, x: number, y: number, w: number, h: number, th: number, off: number, rgb: number, r: number): void {
  ui.frame(x - off - th, y - off - th, w + 2 * (off + th), h + 2 * (off + th), th, rgb, 1, r);
}

function rowValue(row: OptionsRow): string {
  switch (row) {
    case 'effect':
    case 'voice':
    case 'music':
      return `${settings.volume[row]} / 12`;
    case 'subtitles':
      return subName(settings.subtitles);
    case 'font':
      return `‹  ${subFontName()}  ›`;
    case 'help':
      return t('helpValue');
    case 'done':
      return t(screenUi.screen === 'room' ? 'backToMenu' : 'backToMap');
  }
}

const clampSlider = (i: number): number => Math.max(0, Math.min(12, Math.floor(i)));

/**
 * The Options over the `w`×`h` window, `row` focused. Returns the box it covers. Nothing but
 * the scrim until the art has landed.
 */
export function paintOptions(ui: Ui, w: number, h: number, row: number): [number, number, number, number] {
  const u = Math.max(0.5, h / 1080);
  scrim(ui, w, h, 0.62);
  void ensureOptionsArt();
  const a = art;
  const f = (h * 0.86) / PANEL_H; // screen px per panel px
  const faceW = PANEL_W * f, faceH = PANEL_H * f;
  const cardW = 440 * u, gap = 40 * u;
  const x0 = Math.round((w - (faceW + gap + cardW)) / 2), y0 = Math.round((h - faceH) / 2);
  const focused = OPTIONS_ROWS[row]!;
  if (a) {
    const S = a.scale;
    const P = (v: number): number => v * f;
    // KresliOptions (Uovl.pas:461), as AiPanel.drawOptions composites it — without the scroll
    // frame (there is no in-room panel face for Options to scroll up from: it opens at once,
    // as the tablet's does) and without Help's lit button (Help opens over the face).
    // restates src/render/panelAi.ts `drawOptions(ctx: CanvasRenderingContext2D, st: OptionsState): void {` @ bbdbca474dbf
    ui.image(a.images[OPTIONS_IMG]!, x0, y0, faceW, faceH, true, 1, 'options-face');
    const akt = a.images[OPTAKT_IMG]!;
    const region = (left: number, top: number, width: number, height: number): void =>
      ui.imageRect(akt, left * S, top * S, width * S, (height + 1) * S, x0 + P(left), y0 + P(top), P(width), P(height + 1), 'options-akt');
    region(SUBTITLE_HIGHLIGHT_X[settings.subtitles], 250, 47, 33);
    for (const bus of ['effect', 'voice', 'music'] as const) {
      const cx = 17 + 10 * clampSlider(settings.volume[bus]);
      ui.image(a.cudl, x0 + P(cx - 8), y0 + P(HANDLE_Y[bus] - 8), P(CUDL_SIZE), P(CUDL_SIZE), true, 1, `handle-${bus}`);
    }
  }
  // The caption card follows the focus; for the font row it IS the control.
  const [bx1, by1, bx2, by2] = focused === 'font' ? ROW_BOX.subtitles : ROW_BOX[focused];
  const cardH = 150 * u;
  const cx = x0 + faceW + gap;
  const cy = Math.max(y0, Math.min(y0 + faceH - cardH, y0 + ((by1 + by2) / 2) * f - cardH / 2 + (focused === 'font' ? 160 * u : 0)));
  const pal = currentPalette();
  popup(ui, cx, cy, cardW, cardH, u, h, pal);
  ui.text(t(ROW_NAME[focused]), cx + 28 * u, cy + 52 * u, 26 * u, pal.symbol, { bold: true, outline: labelShadow(u, h) });
  const face = focused === 'font' ? subtitleFace() ?? undefined : undefined;
  ui.text(rowValue(focused), cx + 28 * u, cy + 112 * u, 36 * u, INK, { bold: !face, outline: labelShadow(u, h), ...(face ? { face } : {}) });
  // The touch Options' `outline: … var(--menu-accent); outline-offset: 2px`, thickened to be
  // seen from a sofa, with the pressed button's ink border (`border-color: var(--menu-ink)`)
  // inside it, so it reads on the bright stone and on the dark card alike.
  const th = Math.max(3, Math.round(4 * u)), off = Math.max(2, Math.round(3 * u)), hair = hairline(h);
  const ring = (x: number, y: number, rw: number, rh: number, r: number): void => {
    focusOutline(ui, x, y, rw, rh, th, off, ACCENT, r);
    focusOutline(ui, x, y, rw, rh, hair, off, INK, r);
  };
  if (focused === 'font') ring(cx, cy, cardW, cardH, 14 * u);
  else ring(x0 + bx1 * f, y0 + by1 * f, (bx2 - bx1 + 1) * f, (by2 - by1 + 1) * f, 6 * u);
  return [x0, y0, faceW + gap + cardW, faceH];
}
