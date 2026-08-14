/**
 * The logo and intro movies, and the vector-subtitle layer that sits above the game canvas.
 *
 * They share a file because they share a surface: both draw over the stage rather than into
 * it, and both have to be told the display scale rather than reading it from a canvas.
 *
 * Needs NOTHING from `main.ts` — the last of its dependencies went when the subtitle font
 * and overlay signature moved to `stageState.ts`. It is the second module to come out with
 * no host object at all.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * `new IntroPlayer(...)` touches the DOM and `probeAiMovies()` issues HEAD requests, so both
 * happen in `initIntro()` rather than at import time. `main.ts` refuses to run on a phone
 * before any other side effect, and firing network probes ahead of that gate is exactly what
 * the rule forbids. See AGENTS.md, "the module-evaluation trap".
 */
import { IntroPlayer } from './intro.js';
import type { SubtitleSystem } from '../render/subtitles.js';
import { canvas } from './dom.js';
import { contentScaleFor, roomGeometry } from './stageGeometry.js';
import { alpha, count, room } from './gameState.js';
import { graphics } from './renderSettings.js';

/** The intro/logo movie player. Constructed in initIntro(), never at import time. */
export let intro!: IntroPlayer;

export const LOGO_MOVIE = '/data/Movie/logo.mp4';
// The "cleaned" intro (intro_clean.mp4): identical to the faithful transcode
// except the ~2s Cinepak block "burst" on the globe (~12–14s), which is patched
// with FFNG's clean frames of the same footage (see tools/MOVIES.md).
// build-movies.mjs always produces this file (a copy of the faithful transcode
// when FFNG isn't available); if it's missing entirely, the IntroPlayer's load-
// error handler simply skips to the map.
export const INTRO_MOVIE = '/data/Movie/intro_clean.mp4';
// AI-upscaled movie variants (Phase A), used ONLY under the `ai` graphics level and
// ONLY when the file actually exists (probed at boot) — otherwise the AI level
// falls back to the faithful/clean encode above. Produced by tools/build-movies-ai.mjs.
export const LOGO_MOVIE_AI = '/data/Movie/logo_ai.mp4';
export const INTRO_MOVIE_AI = '/data/Movie/intro_ai.mp4';
// Which AI movies are present (HEAD-probed at boot; missing ⇒ false ⇒ fall back).
export const aiMovieAvailable: Record<string, boolean> = {};
export async function probeAiMovies(): Promise<void> {
  await Promise.all(
    [LOGO_MOVIE_AI, INTRO_MOVIE_AI].map(async (u) => {
      try {
        aiMovieAvailable[u] = (await fetch(u, { method: 'HEAD' })).ok;
      } catch {
        aiMovieAvailable[u] = false;
      }
    }),
  );
}
/** Resolve the logo/intro movie URL for the active level: the AI upscale when the
 * `ai` level is active AND the upscaled file exists, else the faithful/clean encode. */
export const logoMovie = (): string =>
  graphics === 'ai' && aiMovieAvailable[LOGO_MOVIE_AI] ? LOGO_MOVIE_AI : LOGO_MOVIE;
export const introMovie = (): string =>
  graphics === 'ai' && aiMovieAvailable[INTRO_MOVIE_AI] ? INTRO_MOVIE_AI : INTRO_MOVIE;

/**
 * Vector-subtitle size in the `ai` tier, as a fraction of the faithful size.
 *
 * The subtitle overlay draws in NATIVE game pixels in every tier, so the text has always
 * been the same size relative to the room. That reads as correct against classic and
 * enhanced art, and too heavy against the AI upscale: next to art carrying four times the
 * detail, a line sized for a 1998 bitmap font is the coarsest thing on screen.
 *
 * Applied as a pure PRESENTATION transform by the subtitle layer's own container scale —
 * the engine's line positions (`ys`/`cilys`, advanced by PosunTitulky at the logic tick)
 * are shared with the faithful bitmap path and must not move. So this scales what is
 * drawn, not what is computed: classic is byte-identical, and tools/test-aisubs.mjs pins
 * the size, the bottom anchoring and the centring on the rendered text rather than on
 * this constant, so a transform about the wrong origin fails there.
 */
// `let` for the same reason as waterAnimMs and RIPPLE: it is a look decision, so it has
// to be judgeable on screen without a rebuild. Nothing in the game writes to it.
export let aiSubScale = 0.5;

/** Build the intro player and probe for the AI movie variants. Call once, from `main.ts`. */
export function initIntro(): void {
  intro = new IntroPlayer({
    layer: document.getElementById('intro-layer') as HTMLElement,
    video: document.getElementById('intro-video') as HTMLVideoElement,
    startBtn: document.getElementById('intro-start') as HTMLElement,
    cover: document.getElementById('intro-cover') as HTMLElement,
    hint: document.getElementById('intro-hint') as HTMLElement,
  });
  void probeAiMovies();
}

/** Probe-only: `__ff.setAiSubScale` tunes the ai tier's subtitle scale live. */
export function setAiSubScale(v: number): void {
  aiSubScale = v;
}
