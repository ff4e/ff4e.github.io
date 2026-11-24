/**
 * The intro and the ALTAR logo, natively: the browser's intro flow (`src/app/intro.ts`'s
 * IntroPlayer and `mapNav.ts`'s `playIntroMovies`), on the native movie player
 * (`movie.ts`), with the controller spec's start splash (A3 "Intro movies", B2).
 *
 * When it plays is the browser's: on a first run the logo then the intro, behind the start
 * splash, after which `ff.options`' `introSeen` is set and later sessions open on the map; and
 * the intro alone, straight away, from the map's top-left corner. Either way the game's sound
 * is killed first (KillSnd) — the movie carries its own — and the map comes back after it.
 *
 * Controls (the spec's): on the splash only Ⓐ (Space, Enter) starts — anything else is
 * ignored, as the web's splash ignores a stray key, so mashing a button cannot lose the
 * intro; during a movie any button skips it, logo → intro → map.
 *
 * What is drawn is the web's, sized in its CSS px at the window's density: the splash is the
 * title cover (`/cover.webp`, centred 38% down, min(88vw, 1100px) wide, on black) with the
 * start button under it; a movie fills the window as `object-fit: contain` does (the host's
 * letterboxed present), and on a TV the explicit Skip button is replaced by a hint along the
 * bottom (A4: "Press any button to skip"; no legend during the intro). Native is AI-tier only,
 * so the movies are the AI encodes when they are there, as the web's `ai` tier picks them.
 */
import { t, uiLang } from './uiStrings.js';
import { ui } from '../../src/app/screenState.js';
import { saveSettings } from '../../src/core/settings.js';
import { audio } from './seams/audioEngine.js';
import { settings } from './seams/playerSettings.js';
import { NativeMovie } from './movie.js';
import { NativeSurface, decodeImage, type NativeImage } from './nativeSurface.js';
import { GlyphAtlas } from './subtitleDraw.js';
import type { NativeFace } from './subtitleFonts.js';
import { readBytes } from './shims.js';
import { safeInsets } from './safeArea.js';
import { fillDisc, fillPlay, fillRoundRect, fillText, loadUiFace, textWidth } from './uiDraw.js';

// ── Which file (src/app/introOverlay.ts) ─────────────────────────────────────────────

const LOGO_MOVIE = '/data/Movie/logo.mp4';
const INTRO_MOVIE = '/data/Movie/intro_clean.mp4';
const LOGO_MOVIE_AI = '/data/Movie/logo_ai.mp4';
const INTRO_MOVIE_AI = '/data/Movie/intro_ai.mp4';
/** The browser's HEAD probe, as a file check: a build without the AI movies falls back. */
const aiMovieAvailable = (u: string): boolean => __native.fileExists(u);
/** restates src/app/introOverlay.ts `export const logoMovie =` @ fda2b314e6d0 */
export const logoMovie = (): string => (aiMovieAvailable(LOGO_MOVIE_AI) ? LOGO_MOVIE_AI : LOGO_MOVIE);
/** restates src/app/introOverlay.ts `export const introMovie =` @ 832ca1a04187 */
export const introMovie = (): string => (aiMovieAvailable(INTRO_MOVIE_AI) ? INTRO_MOVIE_AI : INTRO_MOVIE);

// ── The player (src/app/intro.ts) ────────────────────────────────────────────────────

/**
 * IntroPlayer without the page: a queue of movies played in order, each URL resolved as it
 * starts; a load or decode error counts as the movie ending, so a missing file cannot wedge
 * the session; a skip on the gated splash does nothing. `confirmStart` is the controller's
 * way off the splash (the Xbox branch's, #165).
 * restates src/app/intro.ts `export class IntroPlayer {` @ 6b2e2a3e3cfc
 */
class NativeIntroPlayer {
  private queue: Array<() => string> = [];
  private onDone: (() => void) | null = null;
  private active = false;
  private splash = false;
  movie: NativeMovie | null = null;

  get playing(): boolean {
    return this.active;
  }

  get gated(): boolean {
    return this.splash;
  }

  start(resolvers: Array<() => string>, onDone: () => void, gated: boolean): void {
    this.queue = resolvers.slice();
    this.onDone = onDone;
    this.active = true;
    this.splash = gated;
    if (!gated) this.playCurrent();
  }

  confirmStart(): boolean {
    if (!this.active || !this.splash) return false;
    this.beginPlayback();
    return true;
  }

  private beginPlayback(): void {
    if (!this.splash) return;
    this.splash = false;
    this.playCurrent();
  }

  private playCurrent(): void {
    const resolve = this.queue[0];
    if (resolve === undefined) {
      this.finish();
      return;
    }
    this.movie?.close();
    this.movie = null;
    const url = resolve(); // resolved now, at play time
    try {
      this.movie = NativeMovie.open(url);
      this.movie.play(performance.now());
    } catch (e) {
      console.warn(`the movie ${url} did not play; going on without it`, e);
      this.movie?.close();
      this.movie = null;
      this.next();
    }
  }

  /** Once a frame: a movie that has run out is the browser's `ended`. */
  update(now: number): void {
    if (this.movie && this.movie.update(now)) this.next();
  }

  private next(): void {
    if (!this.active || this.splash) return;
    this.queue.shift();
    if (this.queue.length === 0) this.finish();
    else this.playCurrent();
  }

  skip(): void {
    if (!this.active || this.splash) return;
    this.next();
  }

  private finish(): void {
    this.active = false;
    this.movie?.close();
    this.movie = null;
    this.splash = false;
    const cb = this.onDone;
    this.onDone = null;
    cb?.();
  }
}

export const intro = new NativeIntroPlayer();

// ── The flow (src/app/mapNav.ts) ─────────────────────────────────────────────────────

let showMap: () => void = () => {};

/** What the intro returns to. Called once, by `game.ts`. */
export function initIntroScreen(h: { showMap: () => void }): void {
  showMap = h.showMap;
}

/** restates src/app/mapNav.ts `export function playIntroMovies(` @ 02da97992bd9 */
export function playIntroMovies(resolvers: Array<() => string>, gated: boolean, onFinish: () => void): void {
  if (intro.playing) return;
  ui.screen = 'intro';
  audio.killAll(); // KillSnd: the movie carries its own sound
  intro.start(resolvers, onFinish, gated);
}

/** restates src/app/mapNav.ts `export function playFirstRunIntro(` @ 89b348a13bf0 */
export function playFirstRunIntro(): void {
  playIntroMovies([logoMovie, introMovie], true, () => {
    settings.introSeen = true;
    saveSettings(settings);
    showMap();
  });
}

/** restates src/app/mapNav.ts `export function replayIntro(` @ 37594ef81fc6 */
export function replayIntro(): void {
  playIntroMovies([introMovie], false, () => showMap());
}

/**
 * Where a session opens (boot.ts): on a first run the intro, behind its splash; after that
 * the map. `force` plays the first-run intro anyway (`--intro`).
 */
export function openSession(force = false): void {
  if (settings.introSeen && !force) showMap();
  else playFirstRunIntro();
}

// ── Input ─────────────────────────────────────────────────────────────────────────────

const START = new Set(['Space', 'Enter', 'NumpadEnter']);
const MODIFIER = /^(Shift|Control|Alt|Meta)/;

/**
 * A key (or a pad button, which arrives as one) while the intro is up: Ⓐ starts from the
 * splash, anything else skips a playing movie. A bare modifier does not skip, nor Tab (the
 * browser leaves it to focus navigation).
 * restates src/app/main.ts `if (intro.playing) {` @ dcc36c87f742
 */
export function introKeyDown(code: string): void {
  if (!intro.playing) return;
  if (intro.gated) {
    if (START.has(code)) intro.confirmStart();
    return;
  }
  if (code === 'Tab' || MODIFIER.test(code)) return;
  intro.skip();
}

// ── Drawing ───────────────────────────────────────────────────────────────────────────

/** Where nothing is to be shown yet (before a movie's first frame): the layer's black. */
let black: NativeSurface | null = null;
let splashSurface: NativeSurface | null = null;
let hintSurface: NativeSurface | null = null;
let drawnFor = '';
let cover: NativeImage | null = null;
let faces: { label: NativeFace; chip: NativeFace; hint: NativeFace } | null = null;
let facesLoad: Promise<void> | null = null;
const atlas = new GlyphAtlas();

/** The splash's art and type: the cover, and Mulish standing in for the web's system-ui. */
export function loadIntroArt(): Promise<void> {
  return (facesLoad ??= (async () => {
    cover = decodeImage((await readBytes('/cover.webp')).slice().buffer);
    faces = {
      label: await loadUiFace('/fonts/Mulish.ttf', 600),
      chip: await loadUiFace('/fonts/Mulish.ttf', 700),
      hint: await loadUiFace('/fonts/Mulish.ttf', 400),
    };
  })());
}

/** The window (or, headless, the default window's 1280×800), and its pixels per CSS px. */
function windowBox(): { w: number; h: number; dpr: number } {
  const ws = __native.windowSize();
  return ws ? { w: ws[0], h: ws[1], dpr: ws[2] } : { w: 1280, h: 800, dpr: 1 };
}

/**
 * The web's start label for a TV, with Ⓐ as the controller's green chip (spec A5), and its
 * skip hint — in the UI's language (`uiStrings.ts`).
 */
const startBefore = (): string => t('pressToStartBefore');
const startAfter = (): string => t('pressToStartAfter');
export const skipHint = (): string => t('skipHint');

/**
 * The splash: #intro-cover's title art over black, and #intro-start under it (bottom 20%,
 * centred; 14px × 28px padding, a 1px #556 border, radius 8, #1a1a24, 600 18px #cdd).
 */
export function paintSplash(s: NativeSurface, dpr: number): void {
  const W = s.width, H = s.height;
  s.setSmoothing(true);
  s.fillRect(0, 0, W, H, 0x000000);
  if (cover) {
    const cw = Math.min(0.88 * W, 1100 * dpr);
    const ch = (cw * cover.height) / cover.width;
    s.drawImage(cover, (W - cw) / 2, (H - ch) * 0.38, cw, ch);
  }
  if (!faces) return;
  s.setSmoothing(false);
  const px = 18 * dpr;
  const chipD = Math.round(20 * dpr);
  const gap = 4 * dpr; // a space's worth either side of the chip
  const playW = Math.round(0.72 * px), playH = Math.round(0.8 * px);
  const wBefore = textWidth(faces.label, startBefore(), px), wAfter = textWidth(faces.label, startAfter(), px);
  const playGap = textWidth(faces.label, ' ', px);
  const contentW = playW + playGap + wBefore + chipD + gap + wAfter;
  const bw = Math.round(contentW + 2 * 28 * dpr + 2 * dpr);
  const bh = Math.round(px + 2 * 14 * dpr + 2 * dpr);
  const bx = Math.round((W - bw) / 2);
  const by = Math.round(H - 0.2 * H - bh);
  fillRoundRect(s, bx, by, bw, bh, 8 * dpr, 0x555566);
  fillRoundRect(s, bx + dpr, by + dpr, bw - 2 * dpr, bh - 2 * dpr, 7 * dpr, 0x1a1a24);
  const [asc, desc] = faces.label.metrics(px);
  const baseline = by + bh / 2 + (asc + desc) / 2; // line-height 1: the glyph box centred
  let x = bx + (bw - contentW) / 2;
  fillPlay(s, x, by + (bh - playH) / 2, playW, playH, 0xccdddd);
  x += playW + playGap;
  fillText(s, atlas, faces.label, startBefore(), x, baseline, px, 0xccdddd);
  x += wBefore;
  const cy = by + (bh - chipD) / 2;
  fillDisc(s, x, cy, chipD, 0x3d9a1f);
  const apx = 11 * dpr;
  const aw = textWidth(faces.chip, 'A', apx);
  const [aa, ad] = faces.chip.metrics(apx);
  fillText(s, atlas, faces.chip, 'A', x + (chipD - aw) / 2, cy + chipD / 2 + (aa + ad) / 2 - 0.1 * apx, apx, 0xffffff);
  x += chipD + gap;
  fillText(s, atlas, faces.label, startAfter(), x, baseline, px, 0xccdddd);
}

/**
 * The skip hint (#intro-hint on a TV): 12px #cdd at half opacity, centred, 18px off the bottom
 * — or, on a TV, on the bottom edge of the title-safe area (`bottom`, its inset), if that is higher.
 */
export function paintHint(s: NativeSurface, dpr: number, bottom = 0): void {
  s.clear();
  if (!faces) return;
  s.setSmoothing(false);
  const px = 12 * dpr;
  const w = textWidth(faces.hint, skipHint(), px);
  const [, desc] = faces.hint.metrics(px);
  s.setAlpha(0.5);
  fillText(s, atlas, faces.hint, skipHint(), (s.width - w) / 2, s.height - Math.max(18 * dpr, bottom) + desc, px, 0xccdddd);
  s.setAlpha(1);
}

/**
 * One frame of the intro: advance the movie to its clock and say what to present — a texture,
 * and the overlay to put over it — or null when the intro has just finished.
 */
export function introFrame(now: number): { tex: number; overlay?: number } | null {
  if (!intro.playing) return null;
  intro.update(now);
  if (!intro.playing) return null;
  const { w, h, dpr } = windowBox();
  const key = `${w}x${h}@${dpr}|${faces ? 1 : 0}|${uiLang()}`;
  if (intro.gated) {
    if (!splashSurface || drawnFor !== key) {
      splashSurface = new NativeSurface(w, h);
      paintSplash(splashSurface, dpr);
      drawnFor = key;
    }
    return { tex: splashSurface.id };
  }
  if (!hintSurface || hintSurface.width !== w || hintSurface.height !== h || drawnFor !== key) {
    hintSurface = new NativeSurface(w, h);
    paintHint(hintSurface, dpr, safeInsets(w, h)[3]);
    drawnFor = key;
    splashSurface = null;
  }
  const tex = intro.movie?.tex ?? 0;
  if (tex) return { tex, overlay: hintSurface.id };
  black ??= new NativeSurface(1, 1);
  return { tex: black.id, overlay: hintSurface.id };
}
