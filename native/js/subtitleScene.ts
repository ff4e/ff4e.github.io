/**
 * The subtitle parity scene: fixed subtitle states, built from the game's own subtitle
 * system and laid out twice — by the browser's real DOM renderer (src/app/subtitleDom.ts, in
 * native/subs-reference.ts) and by the native one (subtitleLayout.ts + subtitleDraw.ts, on
 * the GPU) — and compared by native/compare-subs.mjs.
 *
 * Each case is a room's palette and screen, lines from its subtitle file (or another room's)
 * said at given ticks in one language, the clock it is shown at, the face, and a TV-like window: the room
 * letterboxed into `win` points at `density` pixels a point, as the native host presents it
 * (`presentRect`), with the text sized from the stage as the browser sizes it.
 */
import { FontData } from '../../src/render/font.js';
import { SubtitleSystem } from '../../src/render/subtitles.js';
import { subtitleScale } from '../../src/render/subtitleGeom.js';
import { parseFfr } from '../../src/data/ffr.js';
import { parseFft, type FftEntry } from '../../src/data/fft.js';
import { Room } from '../../src/core/room.js';
import { computeStageScale } from '../../src/app/layout.js';
import { AI_SUB_SCALE, type SubtitleBox } from './subtitleLayout.js';

export interface SubCase {
  readonly name: string;
  readonly what: string;
  readonly room: number;
  readonly lang: 'cz' | 'en';
  /** [tick, FFT line name, the room whose file has it (default: this one)] — said at that tick, in order. */
  readonly say: readonly (readonly [number, string, number?])[];
  /** The tick the frame is shown at. */
  readonly count: number;
  /** The window, in points, and its pixels per point. */
  readonly win: readonly [number, number];
  readonly density: number;
  /** A `SUB_FACES` name; the default face when absent. */
  readonly face?: string;
  /** Something is still waving in: a frame a tick earlier would differ. */
  readonly waving?: boolean;
}

const TV: readonly [number, number] = [1280, 720];

export const SUB_CASES: readonly SubCase[] = [
  {
    name: 'two-speakers', what: 'Czech diacritics, both fish (two speaker colours), settled',
    room: 1, lang: 'cz', say: [[1, '1st-m-cotobylo'], [8, '1st-v-netusim'], [16, '1st-m-pockej']], count: 34, win: TV, density: 1,
  },
  {
    name: 'wrapped', what: 'a room as big as the stage: long lines wrapped, stacked, each message fitted smaller; a digit-coded speaker',
    room: 42, lang: 'cz', say: [[1, 'dr1-v-urcite', 17], [30, 'dr-4-magazin', 17]], count: 60, win: TV, density: 1,
  },
  {
    name: 'quotes', what: 'the FFT bytes " and ` drawn as … and ’ (English)',
    room: 1, lang: 'en', say: [[1, '1st-m-navod4'], [20, '1st-v-navod5'], [36, '1st-m-navod6']], count: 56, win: TV, density: 1,
  },
  {
    name: 'wave', what: 'mid-wave: glyphs appearing letter by letter, riding the damped cosine',
    room: 1, lang: 'cz', say: [[1, '1st-m-cotobylo'], [20, '1st-m-hej']], count: 22, win: TV, density: 1, waving: true,
  },
  {
    name: 'narrow', what: 'the narrowest room (285 px): wrapped to its width, centred in its box',
    room: 39, lang: 'en', say: [[1, 'nog-m-uvedom0'], [30, 'nog-v-smetiste1']], count: 56, win: TV, density: 1,
  },
  {
    name: 'retina', what: 'two speakers at 2 pixels a point',
    room: 1, lang: 'cz', say: [[1, '1st-m-cotobylo'], [8, '1st-v-netusim'], [16, '1st-m-pockej']], count: 34, win: TV, density: 2,
  },
  {
    name: 'freesans', what: 'the original FreeSans Bold face (a line gap: the bevel is placed through it)',
    room: 1, lang: 'cz', say: [[1, '1st-m-hmmm'], [20, '1st-v-ven']], count: 46, win: TV, density: 1, face: 'FreeSans Bold',
  },
];

export interface SubScene {
  readonly sys: SubtitleSystem;
  readonly count: number;
  readonly screenW: number;
  readonly screenH: number;
  readonly box: SubtitleBox;
  /** The room's box in device pixels — the surface the native side draws. */
  readonly devW: number;
  readonly devH: number;
  readonly density: number;
  readonly face: string | null;
}

/**
 * Where the native host puts a `w`×`h` room in a `win` window of `density`: as large as
 * fits, whole device pixels (`letterbox` in native/host/main.c), and the CSS box that is.
 */
export function roomBox(w: number, h: number, win: readonly [number, number], density: number, tier: number): { box: SubtitleBox; devW: number; devH: number } {
  const sw = win[0] * density, sh = win[1] * density;
  const s = Math.min(sw / w, sh / h);
  const devW = Math.floor(w * s), devH = Math.floor(h * s);
  const cssW = devW / density, cssH = devH / density;
  const boxScale = cssW / w;
  // The native host has no panel column and no margins: the stage is the window.
  const stage = computeStageScale(win[0], win[1], false);
  return { box: { cssW, cssH, boxScale, textScale: subtitleScale(stage, boxScale), tier }, devW, devH };
}

export async function buildSubScene(c: SubCase, bytes: (url: string) => Promise<Uint8Array>): Promise<SubScene> {
  const nnn = (n: number): string => String(n).padStart(3, '0');
  const [chars, chartab, charcol, ffrBytes] = await Promise.all([
    bytes('/data/Intro/Chars.dat'), bytes('/data/Intro/Chartab.dat'), bytes('/data/Intro/Charcol.dat'),
    bytes(`/data/Graphic/${nnn(c.room)}.ffr`),
  ]);
  const font = new FontData(chars, chartab, charcol);
  const ffr = parseFfr(ffrBytes);
  const room = new Room(ffr);
  const wall = room.bitmaps[room.wallItem.bmp]!;
  const sys = new SubtitleSystem(font, ffr.palette, ffr.width, wall.w, wall.h);
  const fft = new Map<number, FftEntry[]>();
  for (const [, , from = c.room] of c.say) if (!fft.has(from)) fft.set(from, parseFft(await bytes(`/data/Title/${nnn(from)}.fft`)));
  for (let tick = 0; tick <= c.count; tick++) {
    for (const [at, name, from = c.room] of c.say) {
      if (at !== tick) continue;
      const e = fft.get(from)!.find((x) => x.name === name);
      if (!e) throw new Error(`room ${from} has no subtitle ${name}`);
      const t = c.lang === 'cz' ? e.cz : e.en;
      sys.newSubtitle(t.text, t.color, tick);
    }
    sys.tick(tick);
  }
  const { box, devW, devH } = roomBox(wall.w, wall.h, c.win, c.density, AI_SUB_SCALE);
  return { sys, count: c.count, screenW: wall.w, screenH: wall.h, box, devW, devH, density: c.density, face: c.face ?? null };
}
