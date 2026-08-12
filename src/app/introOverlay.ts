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
import { setSubOverlayPainted, setSubOverlaySig, subFontFamily, subFontWeight, subOverlayPainted } from './stageState.js';
import { canvas, subCanvas, subCtx } from './dom.js';
import { contentScaleFor, roomGeometry } from './stageGeometry.js';
import { alpha, count, room, subs } from './gameState.js';
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
 * Applied as a pure PRESENTATION transform in `applySubScale` — the engine's own line
 * positions (`ys`/`cilys`, advanced by PosunTitulky at the logic tick) are shared with the
 * faithful bitmap path and must not move. So this scales what is drawn, not what is
 * computed: classic and enhanced are byte-identical, and tools/test-subtitles-parity.mjs
 * (which pins the vector overlay against a from-first-principles reference) still runs on
 * the enhanced tier untouched.
 */
// `let` for the same reason as waterAnimMs and RIPPLE: it is a look decision, so it has
// to be judgeable on screen without a rebuild. Nothing in the game writes to it.
export let aiSubScale = 0.5;

/**
 * Shrink the subtitle overlay about its bottom-centre anchor for the `ai` tier.
 *
 * Bottom-centre because that is where the layout is anchored: `drawVector` centres each
 * line on `screenW` and puts its baseline at `ys + screenH`, with `ys` negative. Scaling
 * about that point keeps the block centred and sitting on the same bottom edge, and
 * shrinks the line spacing and the wave amplitude by the same factor — i.e. the whole
 * subtitle gets smaller, rather than the glyphs shrinking inside unchanged spacing.
 *
 * The overlay's repaint cache is invalidated by `graphics` in `subOverlaySignature`, and
 * by `__ff.subScale()` clearing the signature directly — not by anything returned here.
 */
export function applySubScale(ctx: CanvasRenderingContext2D, sys: SubtitleSystem): void {
  const s = graphics === 'ai' ? aiSubScale : 1;
  if (s === 1) return;
  const { w, h } = sys.vectorScreen;
  ctx.translate(w / 2, h);
  ctx.scale(s, s);
  ctx.translate(-w / 2, -h);
}

/**
 * How far down the game box the overlay canvas starts, in the coordinates `drawVector`
 * draws in. Zero for a full-height overlay (the cutscene path); the room path sets it
 * to the top of the subtitle band, and `framePainter` shifts its drawing origin by it.
 */
export let subBandTop = 0;

/**
 * Size the subtitle overlay at device resolution.
 *
 * `cssTop` offsets it down the game box, so the room path can allocate only the band
 * subtitles actually occupy instead of the whole room (see `syncSubOverlay`). The
 * element is `position:absolute; top:0` (dom.ts), so the offset is applied there.
 */
export function syncSubOverlaySized(cssW: number, cssH: number, cssTop = 0, bandTop = 0): void {
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (subCanvas.width !== bw || subCanvas.height !== bh) {
    subCanvas.width = bw;
    subCanvas.height = bh;
  }
  subBandTop = bandTop;
  subCanvas.style.width = `${cssW}px`;
  subCanvas.style.height = `${cssH}px`;
  const top = `${cssTop}px`;
  if (subCanvas.style.top !== top) subCanvas.style.top = top;
}

/**
 * Size the subtitle overlay to the ROOM's on-screen box.
 *
 * Derived from the room's NATIVE size, not from `canvas.width`. Those were the same
 * thing until the `ai` tier arrived: its backing store is ×scale, so sizing from it
 * ran the ×4 dimensions back through contentScaleFor and produced an overlay that did
 * not match the room — 595px against the room's 435px in the integer-snap fit modes,
 * and 1607px against 595px in `fill`. Nothing moved on screen (the text is positioned
 * in native coordinates from a shared origin), but the overlay's backing store was up
 * to 2.7x wider than needed and was cleared and composited on every subtitle frame.
 */
export function syncSubOverlay(): void {
  if (!room) {
    // No room (shouldn't happen on the room-subtitle paths): keep the old behaviour
    // rather than leaving the overlay at a stale size.
    const cs = contentScaleFor(canvas.width, canvas.height);
    syncSubOverlaySized(canvas.width * cs, canvas.height * cs);
    return;
  }
  const g = roomGeometry(room);
  // Only the BAND the subtitles occupy, not the whole room.
  //
  // The JS cost of a repaint is flat in the canvas size (measured 0.20 ms in Chromium
  // at 0.63, 3.32 and 5.02 Mpx alike), so the size is not about our own work — it is
  // about what the browser does with the backing store afterwards, which is why a
  // 2-megapixel overlay for text occupying a strip at the bottom showed up as a frame
  // rate. Treat the height of this canvas as a rendering-cost decision, not a memory
  // one. How large the win is depends on the browser and machine; it was reported on
  // Safari, where the room's overlay was 1674x1184.
  //
  // `vectorInkTop` is in the subtitle system's own coordinates; `applySubScale` then
  // shrinks the drawing about the bottom edge in the `ai` tier, which pulls the ink
  // DOWN the box. The band has to be measured after that, or the ai tier would reserve
  // room it no longer uses — and, far worse, the enhanced and classic tiers (which draw
  // at full size, several rows up the box) would have their top rows clipped.
  // `vectorInkTop` is in the subtitle system's own height and this band is in the
  // room's; they are the same number by construction — both are the wall bitmap
  // (`room.bitmaps[room.wallItem.bmp]`), which buildRoom hands the SubtitleSystem and
  // `roomScreenSize` reads back for the geometry.
  const band = subs === null ? 0 : bandTopFor(subs.vectorInkTop(), g.nativeH);
  syncSubOverlaySized(g.cssW, (g.nativeH - band) * g.scale, band * g.scale, band);
}

/**
 * Where the subtitle band starts, in native game rows.
 *
 * Snapped DOWN to a grid so the canvas is not reallocated for a one-pixel change (a
 * resize wipes it, and the repaint that follows is the thing being economised), and
 * clamped into the box so a pathological line can never produce a negative or
 * zero-height canvas.
 */
function bandTopFor(inkTop: number, nativeH: number): number {
  const s = graphics === 'ai' ? aiSubScale : 1;
  // Where that ink lands once applySubScale has shrunk the drawing about the bottom.
  const scaled = nativeH + (inkTop - nativeH) * s;
  const snapped = Math.floor(scaled / BAND_GRID) * BAND_GRID;
  return Math.min(Math.max(snapped, 0), nativeH - BAND_GRID);
}

/** Native rows the band is snapped to (see bandTopFor). */
const BAND_GRID = 16;

/**
 * Key for what the vector overlay currently shows. Beyond the subtitle system's own
 * signature it covers everything else the drawn image depends on: which system owns
 * the overlay (room vs cutscene), the selected face (F cycles it), the display scale
 * and the backing-store size — a resize wipes the canvas, so the key must change.
 */
export function subOverlaySignature(who: string, sys: SubtitleSystem, scale: number): string {
  // `graphics` is in the key because the ai tier draws the overlay smaller
  // (`aiSubScale`); without it, switching tier could serve the previous tier's cached
  // overlay, which is exactly the class of bug this gate exists around.
  // `subBandTop` is in the key even though it cannot currently move without the canvas
  // height moving with it: it is what the drawing origin is shifted by, so a future
  // change to how the band is derived must not be able to serve an image drawn at a
  // different offset.
  return `${who}|${graphics}|${subFontFamily}|${subFontWeight}|${subCanvas.width}x${subCanvas.height}@${subBandTop}|${scale}|${sys.vectorSignature(count, alpha)}`;
}

/** Clear the subtitle overlay (used off the room screen). */
export function clearSubOverlay(): void {
  setSubOverlaySig(''); // whatever the overlay held is gone: never match a stale key
  // Give up the room's band offset as well. The canvas keeps its size until the next
  // owner sets one, but anchored back at the top it is guaranteed to stay inside the
  // game box — a stale band could otherwise leave an (empty) layer hanging past the
  // bottom of a smaller room or screen.
  subBandTop = 0;
  if (subCanvas.style.top !== '0px') subCanvas.style.top = '0px';
  if (!subOverlayPainted) return; // already clear — skip the (large) clearRect
  subCtx.setTransform(1, 0, 0, 1, 0, 0);
  subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
  setSubOverlayPainted(false);
}

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
