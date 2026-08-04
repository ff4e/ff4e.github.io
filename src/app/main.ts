/**
 * Browser host: loads a room's original FFR, renders it with the software-
 * paletted compositor, drives the two fish, and reproduces the engine's animated
 * tick (URoom.pas gstav/gfaze state machine):
 *   - a horizontal press first TURNS the fish (stav_otocka, tl_otocka frames),
 *     a second press swims it;
 *   - a move slides while cycling the swim body frames (stav_vlevo, tl_plav /
 *     tl_nahoru / tl_dolu), then objects settle by falling one cell per step
 *     (stav_ma_padat -> padani -> stav_padani);
 *   - a crushed fish is drawn as an eroding skeleton (KresliK / rozpad).
 * Idle fish gently cycle tl_zaklad and blink (hl_mrk).
 *
 * Keyboard: small fish I/K/J/L, big fish W/S/A/D. Mouse: click a fish to select,
 * click water to BFS-swim there.
 */
import { parseFfr, type FfrRoom, type FfrBitmap } from '../data/ffr.js';
import { applyWinDesktopPalette } from '../data/winPalette.js';
import { parseFft, indexFft, type FftEntry } from '../data/fft.js';
import { Room, ITEM_WATER, ITEM_WALL } from '../core/room.js';
import { HookSystem } from '../core/hooks.js';
import {
  CheatEntry,
  pretoc,
  morphShrink,
  morphStretch,
  pretocRgba,
  morphShrinkRgba,
  morphStretchRgba,
  type Cheat,
} from '../core/cheats.js';
import {
  TetrisGame,
  parseShapes,
  type HiscoreStore,
  type TetrisKey,
  type TetrisShapes,
} from '../core/tetris.js';
import { renderTetris, tetrisRgba, type TetrisArt } from '../render/tetrisRender.js';
import {
  zpracujInterlaced,
  interlacedSounds,
  sum,
  zcernobilit,
  INTERLACED_OFF,
  INTERLACED_STOP,
  INTERLACED_START,
} from '../render/filmEffects.js';
import { Dir } from '../core/dir.js';
import {
  FSIZE,
  renderRoomRgba,
  renderRoomBackgroundRgba,
  renderRoomInto,
  roomScreenSize,
  type RenderOptions,
  type FishFrame,
  TL_ZAKLAD,
  TL_PLAV,
  TL_OTOCKA,
  TL_NAHORU,
  TL_DOLU,
  TL_MLUVI_NA,
  darkBodyFrame,
  HL_TLACI,
  HL_MRK,
  HL_MLUVI,
} from '../render/renderRoom.js';
import type { RgbaScreen } from '../render/rgbaScreen.js';
import { ClassicArtSource } from '../render/classicArtSource.js';
import type { ArtSource } from '../render/artSource.js';
import { GlScreen, webgl2Available } from '../render/glScreen.js';
import { GlAiScreen } from '../render/glRoomAi.js';
import { FontData } from '../render/font.js';
import { SubtitleSystem, SUB_SUBSTEPS } from '../render/subtitles.js';
import { HelpScreens } from '../render/help.js';
import { IndexedScreen } from '../render/framebuffer.js';
import {
  EnhancedArtSource,
  classicOnlyBackground,
  type EnhancedArt,
  type EnhancedObject,
  type EnhancedSprite,
  type FishSprites,
} from '../render/enhancedArtSource.js';
import { parseBmp, bmpToRgba, type Bmp } from '../data/bmp.js';
import { WorldMap, MAP_W, MAP_H, MapAction } from '../render/worldMap.js';
import { loadAiWorldMap, AiWorldMap, AI_MAP_W, AI_MAP_H, AI_MAP_SCALE } from '../render/worldMapAi.js';
import { loadAiRoom, aiRoomGateAllows, AiRoom, AI_ROOM_SCALE } from '../render/roomAi.js';
import type { AiRoomFrame } from '../render/roomAi.js';
import { Canvas2dAiTarget, RIPPLE, activeRipples, faithfulWobbleShifts, nextRippleBirth, smoothWobbleShift, wobblePhase } from '../render/aiTarget.js';
import type { AiWobble } from '../render/aiTarget.js';
import { withLoadSlot } from '../render/loadSlot.js';
import {
  hitInfoButton,
  drawInfoPanel,
  drawInfoDigits,
  drawInfoPanelArtAi,
  INFO_SETTLE_FAZE,
  INFO_FAZE_MS,
  type InfoButton,
  type InfoPanelAssets,
} from '../render/mapInfo.js';
import { parseDesky, blitDeska, DESKA_X_OFFSET, DESKA_Y_OFFSET, type DeskyData } from '../data/desky.js';
import { IntroPlayer } from './intro.js';
import { advancePaintDeadline, shouldSkipPaint } from './paintClock.js';
import { Credits, CREDIT_SPEED, CREDIT_TICK_MS } from '../render/credits.js';
import { loadAiPanel, type AiPanel } from '../render/panelAi.js';
import { loadAiCredits, type AiCredits } from '../render/creditsAi.js';
import { initAnalytics } from '../platform/analytics.js';
import { depthOfRoom, branchOfRoom, REGISTERED_ROOMS } from '../data/world.js';
import { parseFfp, type FfpPanel } from '../data/ffp.js';
import {
  composePanel,
  composeOptions,
  panelToRgba,
  hitTest as panelHitTest,
  sliderIndex,
  PANEL_W,
  PANEL_H,
  SEDY,
  ORANZOVY,
  ZLUTY,
  SVITICI,
  type PanelState,
  type OptionsState,
} from '../render/hud.js';
import { AudioEngine, TALKING_MEZ_SEC, MUSIC_PRIOR } from '../audio/audio.js';
import {
  loadSettings,
  saveSettings,
  busMultiplier,
  VOLUMES,
  type SubtitleMode,
  type VolumeBus,
} from '../core/settings.js';
import { musicForCHud } from '../audio/music.js';
import { Script, type RoomScript, type ScriptSnapshot } from '../core/script.js';
import {
  StepEngine,
  MOVE_FRAMES,
  FALL_FRAMES,
  TURN_FRAMES,
  exitFramesFor,
  type Phase,
} from '../core/stepEngine.js';
import { newChatter, tickChatter, type ChatterState } from '../core/chatter.js';
import { stdSmrt, newDeathState, type DeathState } from '../core/deathlines.js';
import { maybeBubble } from '../core/ambient.js';
import { movesOf, lengthOfRecord } from '../core/record.js';
import { roomScript } from '../rooms/index.js';
import { KufrDemo } from '../intro/kufrDemo.js';
import { parseHelpCap, AKCE, KDO, type CapAction } from '../intro/helpCap.js';
import { ROOMS } from '../data/roomTable.js';
import {
  computeStageLayout,
  contentScale as fitScale,
  isFitMode,
  type StageLayout,
  type FitMode,
} from './layout.js';

// Display scaling (public-release Phase 1). The stage box + side panel are scaled
// together to fill the viewport (`stage`, recomputed on resize/fullscreen); each
// room/map/cutscene is drawn at contentScaleFor() and centered in the stage box.
// Replaces the old fixed `SCALE = 2`. Input stays scale-agnostic (every pointer
// handler maps via getBoundingClientRect ratios), so only display sizing changes.
let stage: StageLayout = computeStageLayout(
  typeof window !== 'undefined' ? window.innerWidth : 1600,
  typeof window !== 'undefined' ? window.innerHeight : 1200,
);

/**
 * Pick the scaling filter for a canvas whose BACKING STORE is `backingW` wide while it
 * is displayed `cssW` wide.
 *
 * The stylesheet sets `image-rendering: pixelated` on every canvas, which is right for
 * native-resolution art (crisp 1998 pixels) but wrong for the ai tier: a ×4 backing
 * store shown smaller gets point-sampled on the way down, which throws most of the
 * upscaled detail away and aliases.
 *
 * Smooth-filter only when the store is genuinely UPSCALED (>= 1.5× the displayed size),
 * not merely minified: a native 155px panel shown at 145px is also "minifying", and
 * smoothing that would soften the faithful tiers, which must keep their exact pixels.
 * Returns the value for style.imageRendering ('' = inherit the stylesheet).
 */
const UPSCALED_STORE_RATIO = 1.5;
function scalingFilterFor(backingW: number, cssW: number): string {
  return backingW >= cssW * UPSCALED_STORE_RATIO ? 'auto' : '';
}

/** Display px per native px for content of size w×h, per the current fit mode. */
function contentScaleFor(w: number, h: number): number {
  // Pass devicePixelRatio so 'native' can snap to whole PHYSICAL pixels (crisp at
  // any browser zoom / display scaling); the other modes ignore it.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return fitScale(w, h, stage.scale, settings.fitMode, dpr);
}

/**
 * Everything about where and how big the current room is drawn — the single source of
 * truth for the room's geometry.
 *
 * It exists because "the room canvas's backing store is the native game resolution" was
 * true for classic and enhanced, so the two were used interchangeably in half a dozen
 * independently-derived places. The `ai` tier falsifies it (its backing store is ×scale)
 * and every one of those places became a chance to conflate them. That produced a real
 * bug — the subtitle overlay was sized from the backing store and came out up to 2.7×
 * wider than the room — and would have produced more.
 *
 * So the two are named separately here and derived once:
 *   native   the resolution the SIMULATION uses; all game coordinates are in these px
 *   css      the on-screen box; every layer stacked over the room must match this
 *   backing  the buffer the frame is COMPOSITED in, which is native×upscale in the ai
 *            tier — the #screen canvas on the canvas-2D path, GlAiScreen's offscreen
 *            FBO on the GPU one (where #screen is left at native size, since nothing
 *            paints into it)
 *
 * `scale` converts native → css, which is what any overlay drawing in game coordinates
 * needs; it is deliberately NOT derived from the backing store.
 */
interface RoomGeometry {
  nativeW: number;
  nativeH: number;
  /** CSS px per NATIVE px (never per backing-store px). */
  scale: number;
  cssW: number;
  cssH: number;
  backingW: number;
  backingH: number;
  /** Backing-store px per native px: 1, or the AI room's upscale factor. */
  upscale: number;
}

function roomGeometry(r: Room): RoomGeometry {
  const { w: nativeW, h: nativeH } = roomScreenSize(r);
  const scale = contentScaleFor(nativeW, nativeH);
  // Only the AI compositor renders above native resolution, and only when it is the
  // path that will actually draw this frame (aiRoomRenderActive covers the gate, the
  // loaded art and the current room).
  const upscale = aiRoomRenderActive(r) && aiRoom ? aiRoom.scale : 1;
  return {
    nativeW,
    nativeH,
    scale,
    cssW: nativeW * scale,
    cssH: nativeH * scale,
    backingW: nativeW * upscale,
    backingH: nativeH * upscale,
    upscale,
  };
}

// The original advances ALL game logic on a fixed WALL-CLOCK timestep, not the
// display refresh and not per audio buffer. The shipped game loop is TRoom.Jedeme
// (URoom.pas:23952, called from UMain.pas:266): a manual busy-wait that spins on
// `Application.ProcessMessages` until ~80ms of system `Time` have elapsed
// (`until curtime > lasttime + 0.08/86400`, i.e. 0.08s), then runs ONE logic step
// (Timer1Timer). So logic runs at ~80ms/step (~12.5 fps). The audio-buffer gate
// that would have locked it to the 139.32ms buffer (`else if Tick=0 then exit`,
// URoom.pas:24061) is COMMENTED OUT; Timer1's Interval=90ms (URoom.dfm) is only a
// secondary/fallback and the 80ms loop out-paces it. We reproduce this fixed
// timestep so dialog `delay`s, idle timers, the `count` clock and animation `fazi`
// counts all run at the authentic rate — otherwise (at the 60fps render rate)
// every scripted pause is ~6.7x too short.
const LOGIC_MS = 80; // ~12.5 game ticks/sec — TRoom.Jedeme's 0.08s wall-clock step
const LOGIC_SEC = LOGIC_MS / 1000;
// Jedeme runs exactly one step per loop iteration: under load the loop just takes
// longer (the game slows), it never fast-forwards. So we step at most once per
// rendered frame — no multi-step catch-up — matching that behaviour.
const MAX_STEPS_PER_FRAME = 1;
const DEFAULT_LINE_TICKS = 12; // readable fallback when a voice line has no audio

// Sound-effect volume vs voices (RSound.pas:33-35): snd_volume=48, talk_volume=64,
// max_volume=64. Effects (landings, death cries, bubbles, script Snd) play at 48/64
// of voice level; the port previously played them at full voice volume, so loud
// near-full-scale effects (e.g. the sp-smrt death scream) overlapping a landing
// summed past 0 dB and hard-clipped — a harsh "beep". Voices/music keep their levels.
const EFFECT_VOL = 48 / 64;


// Animation lengths in game ticks (URoom.pas:425-433) — shared with the step-engine.
const EXIT_CELLS = 5; // cells of travel to slide fully off-screen (render constant)

const canvas = document.getElementById('screen') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
// WebGL present surface (P3): a canvas stacked exactly over #screen, shown only
// while the WebGL backend is active (renderer==='webgl'). #screen stays the
// layout anchor; this overlay covers it when the GPU presents. Created here so
// the GlScreen can bind its context lazily on first use.
const glCanvas = document.createElement('canvas');
glCanvas.id = 'screen-gl';
// Enhanced-graphics subtitle overlay: a smooth (non-pixelated) high-DPI canvas
// laid exactly over the game canvas, so vector subtitles stay crisp above the
// pixel-art frame. Wrap #screen so the overlay can be absolutely positioned on
// top; a transparent 1px border matches #screen's border box for pixel-exact
// alignment.
const subCanvas = document.createElement('canvas');
subCanvas.id = 'subs';
const subCtx = subCanvas.getContext('2d')!;
// The fixed stage box (sized by relayout): rooms/map/cutscene are centered inside
// it and letterboxed, so the side panel stays put while the room canvas resizes.
const stageBox = document.createElement('div');
stageBox.id = 'stagebox';
const wrap = document.createElement('div');
{
  wrap.style.position = 'relative';
  wrap.style.display = 'inline-block';
  wrap.style.lineHeight = '0';
  // Insert the stage box where #screen sat (inside .stage), then nest the wrap
  // (which holds #screen + the GL/subtitle overlays) centered within it.
  canvas.parentNode!.insertBefore(stageBox, canvas);
  stageBox.appendChild(wrap);
  wrap.appendChild(canvas);
  // GL present canvas: absolute over #screen, below the subtitle overlay. It is
  // purely a display surface — the mouse listeners live on #screen underneath, so
  // it must not intercept pointer events (else clicking a fish does nothing in
  // WebGL mode). The subtitle overlay above is transparent to clicks for the same
  // reason.
  glCanvas.style.position = 'absolute';
  glCanvas.style.left = '0';
  glCanvas.style.top = '0';
  glCanvas.style.border = '1px solid transparent';
  glCanvas.style.display = 'none';
  glCanvas.style.pointerEvents = 'none';
  wrap.appendChild(glCanvas);
  subCanvas.style.position = 'absolute';
  subCanvas.style.left = '0';
  subCanvas.style.top = '0';
  subCanvas.style.border = '1px solid transparent';
  subCanvas.style.background = 'transparent';
  subCanvas.style.imageRendering = 'auto';
  subCanvas.style.pointerEvents = 'none';
  wrap.appendChild(subCanvas);
}
// Vector-subtitle font (enhanced mode). All candidates are bundled + OFL-licensed
// so they render identically on every platform. Mulish Medium is the default — a
// clean humanist face close to Avenir Next Medium. The previewer (F key) cycles
// the alternates; the active family+weight are persisted. (Fonts + their OFL
// licenses live in public/fonts/; FreeSans is the original public/enhanced face.)
const SUB_FONT_CANDIDATES: ReadonlyArray<{ name: string; family: string; weight: string }> = [
  { name: 'Mulish Medium', family: 'Mulish, sans-serif', weight: '500' },
  { name: 'Manrope Medium', family: 'Manrope, sans-serif', weight: '500' },
  { name: 'Jost Medium', family: 'Jost, sans-serif', weight: '500' },
  { name: 'FreeSans Bold', family: 'FFSubtitle, sans-serif', weight: '700' },
];
let subFontIdx = ((): number => {
  const saved = localStorage.getItem('ff.subfont');
  const i = saved !== null ? SUB_FONT_CANDIDATES.findIndex((c) => c.name === saved) : -1;
  return i >= 0 ? i : 0;
})();
let subFontFamily = SUB_FONT_CANDIDATES[subFontIdx]!.family;
let subFontWeight = SUB_FONT_CANDIDATES[subFontIdx]!.weight;
let subFontReady = false;
// True while the overlay currently shows a subtitle, so idle frames skip the
// (large) clear/redraw entirely and we wipe it exactly once when it clears.
let subOverlayPainted = false;
// Diagnostics: how many times the vector overlay has actually been re-rendered
// (perf probes read the rate — every redraw between two logic ticks is waste).
let subOverlayPaints = 0;
// What the overlay currently SHOWS (SubtitleSystem.vectorSignature + the inputs
// outside it: which system, the font, the backing size). The wave offset only
// advances on a logic tick and stops entirely once a line has settled, so at 60fps
// most frames would repaint the identical image — this skips them.
let subOverlaySig = '';
// Perf A/B switch (tools/bench-subtitles.mjs): false replays the pre-gate behaviour,
// repainting the overlay on every frame that draws it.
let subOverlayGate = true;
const panelCanvas = document.getElementById('panel') as HTMLCanvasElement;
const panelCtx = panelCanvas.getContext('2d')!;
const select = document.getElementById('room') as HTMLSelectElement;
const fitSelect = document.getElementById('fitmode') as HTMLSelectElement | null;
const rendererSelect = document.getElementById('renderer') as HTMLSelectElement | null;
const graphicsSelect = document.getElementById('graphics') as HTMLSelectElement | null;
const idleDirtyToggle = document.getElementById('idledirty') as HTMLInputElement | null;
const winRoomBtn = document.getElementById('winroom') as HTMLButtonElement | null;
const perfHud = document.getElementById('perfhud') as HTMLElement | null;
const info = document.getElementById('info') as HTMLDivElement;
const stageRow = document.querySelector('.stage') as HTMLElement;

// ── Public-release boot UX: loading indicator, fatal-error screen, and a
// software-renderer note. The loading overlay is present in the HTML (shown before
// this deferred module runs), so the player never sees a blank page while assets
// fetch; the app hides it once boot completes.
const loadingEl = document.getElementById('loading') as HTMLElement | null;
const loadingMsg = document.getElementById('loading-msg') as HTMLElement | null;
const fatalEl = document.getElementById('fatal') as HTMLElement | null;
let booted = false; // true once boot succeeds — before that, any error is fatal

/** Update the loading overlay's status line. */
function setLoadingMsg(msg: string): void {
  if (loadingMsg) loadingMsg.textContent = msg;
}

// ── Post-boot room-loading overlay ────────────────────────────────────────────
// The same #loading markup boot uses, re-armed for room entry. Entering a cold room
// over a slow link takes 17-27s (measured, Slow 4G) and the stage is deliberately
// black for all of it, so the wait needs explaining. Armed on a DELAY: a cached or
// local entry is ready in a few ms and must never flash a spinner.
//
// Driven by the RENDER LOOP off the same `roomLoading || roomArtPending()` predicate
// the frame hold uses, rather than by notifications from every site that can change
// those flags. That is what keeps it honest: the hide happens after the loop has
// painted the frame the overlay was covering, and leaving the room screen (map,
// story page, cutscene) takes it down with no separate teardown call — both of which
// a push-based version had to hand-roll, and could get wrong by forgetting a site.
const ROOM_LOADING_DELAY_MS = 200;
/** When the current room entry started, or 0 when no entry is in progress. */
let roomLoadingSince = 0;

/** Arm the overlay for a room entry (the loop reveals it if the wait is real). */
function beginRoomLoadingUi(num: number): void {
  if (!booted || !loadingEl) return;
  roomLoadingSince = performance.now();
  const desc = ROOMS[num - 1];
  setLoadingMsg(desc ? `Loading ${subLang() === 'cz' ? desc.cz : desc.en}…` : 'Loading…');
  // The boot splash's title and attribution would read as a restart mid-game; the
  // spinner and the room name are the parts that belong to a room entry.
  loadingEl.classList.add('inroom');
}

/**
 * Show or hide the overlay for the frame that has just been painted. Called from
 * loop() AFTER the draw branch, so hiding it can never expose an unpainted stage.
 */
function syncRoomLoadingUi(now: number): void {
  if (!booted || !loadingEl) return;
  const waiting = screen === 'room' && (roomLoading || roomArtPending());
  if (!waiting) roomLoadingSince = 0;
  const show = waiting && roomLoadingSince !== 0 && now - roomLoadingSince >= ROOM_LOADING_DELAY_MS;
  if (loadingEl.hidden === show) loadingEl.hidden = !show;
}

/** Reveal the fatal-error screen (missing/broken assets or a boot exception). */
function showFatal(msg?: string): void {
  if (loadingEl) loadingEl.hidden = true;
  if (fatalEl) {
    const p = document.getElementById('fatal-msg');
    if (p && msg) p.textContent = msg;
    fatalEl.hidden = false;
  }
}
document.getElementById('fatal-reload')?.addEventListener('click', () => location.reload());
// Any unhandled failure DURING boot means the game never became playable → fatal.
// After boot we stop hijacking errors (a mid-game exception shouldn't nuke play).
window.addEventListener('unhandledrejection', (ev) => {
  if (!booted) {
    console.error('boot failed:', ev.reason);
    showFatal();
  }
});
window.addEventListener('error', (ev) => {
  if (!booted) {
    console.error('boot failed:', ev.error ?? ev.message);
    showFatal();
  }
});

/** Software-renderer note when WebGL2 is unavailable (CPU fallback is automatic). */
function maybeShowWebglNote(): void {
  const note = document.getElementById('webgl-note');
  if (!note) return;
  if (webgl2Available() || localStorage.getItem('ff.webglNoteDismissed') === '1') return;
  note.hidden = false;
  document.getElementById('webgl-note-x')?.addEventListener('click', () => {
    note.hidden = true;
    try {
      localStorage.setItem('ff.webglNoteDismissed', '1');
    } catch {
      /* ignore */
    }
  });
}


/**
 * Recompute the stage scale from the available game area and size the stage box +
 * side panel. Called on boot, window resize, and fullscreen change. The room/map/
 * cutscene canvases are sized per-frame in their draw functions from `stage`.
 */
function relayout(): void {
  const availW = stageRow?.clientWidth || window.innerWidth;
  const availH = stageRow?.clientHeight || window.innerHeight;
  stage = computeStageLayout(availW, availH);
  stageBox.style.width = `${Math.round(stage.stageW)}px`;
  stageBox.style.height = `${Math.round(stage.stageH)}px`;
  if (stageRow) stageRow.style.gap = `${Math.round(stage.gap)}px`;
  forceRoomRedraw = true; // the room canvas CSS size is set in draw() — repaint to rescale
  wake();
}

// Intro-movie overlay (UMain.pas daLogo/daIntro): full-screen <video> played
// before the map on first run, and replayable from the map's top-left corner.
const intro = new IntroPlayer({
  layer: document.getElementById('intro-layer') as HTMLElement,
  video: document.getElementById('intro-video') as HTMLVideoElement,
  startBtn: document.getElementById('intro-start') as HTMLElement,
  cover: document.getElementById('intro-cover') as HTMLElement,
  hint: document.getElementById('intro-hint') as HTMLElement,
});
const LOGO_MOVIE = '/data/Movie/logo.mp4';
// The "cleaned" intro (intro_clean.mp4): identical to the faithful transcode
// except the ~2s Cinepak block "burst" on the globe (~12–14s), which is patched
// with FFNG's clean frames of the same footage (see tools/MOVIES.md).
// build-movies.mjs always produces this file (a copy of the faithful transcode
// when FFNG isn't available); if it's missing entirely, the IntroPlayer's load-
// error handler simply skips to the map.
const INTRO_MOVIE = '/data/Movie/intro_clean.mp4';
// AI-upscaled movie variants (Phase A), used ONLY under the `ai` graphics level and
// ONLY when the file actually exists (probed at boot) — otherwise the AI level
// falls back to the faithful/clean encode above. Produced by tools/build-movies-ai.mjs.
const LOGO_MOVIE_AI = '/data/Movie/logo_ai.mp4';
const INTRO_MOVIE_AI = '/data/Movie/intro_ai.mp4';
// Which AI movies are present (HEAD-probed at boot; missing ⇒ false ⇒ fall back).
const aiMovieAvailable: Record<string, boolean> = {};
async function probeAiMovies(): Promise<void> {
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
void probeAiMovies();
/** Resolve the logo/intro movie URL for the active level: the AI upscale when the
 * `ai` level is active AND the upscaled file exists, else the faithful/clean encode. */
const logoMovie = (): string =>
  graphics === 'ai' && aiMovieAvailable[LOGO_MOVIE_AI] ? LOGO_MOVIE_AI : LOGO_MOVIE;
const introMovie = (): string =>
  graphics === 'ai' && aiMovieAvailable[INTRO_MOVIE_AI] ? INTRO_MOVIE_AI : INTRO_MOVIE;

/** Size the subtitle overlay to cover the game canvas at device resolution. */
function syncSubOverlaySized(cssW: number, cssH: number): void {
  const dpr = window.devicePixelRatio || 1;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (subCanvas.width !== bw || subCanvas.height !== bh) {
    subCanvas.width = bw;
    subCanvas.height = bh;
  }
  subCanvas.style.width = `${cssW}px`;
  subCanvas.style.height = `${cssH}px`;
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
function syncSubOverlay(): void {
  if (!room) {
    // No room (shouldn't happen on the room-subtitle paths): keep the old behaviour
    // rather than leaving the overlay at a stale size.
    const cs = contentScaleFor(canvas.width, canvas.height);
    syncSubOverlaySized(canvas.width * cs, canvas.height * cs);
    return;
  }
  const g = roomGeometry(room);
  syncSubOverlaySized(g.cssW, g.cssH);
}

/**
 * Key for what the vector overlay currently shows. Beyond the subtitle system's own
 * signature it covers everything else the drawn image depends on: which system owns
 * the overlay (room vs cutscene), the selected face (F cycles it), the display scale
 * and the backing-store size — a resize wipes the canvas, so the key must change.
 */
function subOverlaySignature(who: string, sys: SubtitleSystem, scale: number): string {
  return `${who}|${subFontFamily}|${subFontWeight}|${subCanvas.width}x${subCanvas.height}|${scale}|${sys.vectorSignature(count, alpha)}`;
}

/** Clear the subtitle overlay (used off the room screen). */
function clearSubOverlay(): void {
  subOverlaySig = ''; // whatever the overlay held is gone: never match a stale key
  if (!subOverlayPainted) return; // already clear — skip the (large) clearRect
  subCtx.setTransform(1, 0, 0, 1, 0, 0);
  subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
  subOverlayPainted = false;
}

let panel: FfpPanel | null = null; // the parsed control-panel graphic (panel.ffp)
let panelPressed = 0; // region currently held down (for the lit-button feedback), or 0
// Per-frame draw caches: the panel and world-map compositions are re-blitted only
// when their inputs change (see drawPanel/drawMap). null forces the next repaint.
let panelSig: string | null = null;
let mapSig: string | null = null;
// Options sub-panel state machine (Ostav, Uovl.pas:184-187): the corner button
// (or a right-click on the panel) scrolls between the normal panel and the options
// sub-panel via the 10 sc-frame animation.
const O_NORMAL = 0;
const O_SC_UP = 1;
const O_OPTIONS = 2;
const O_SC_DOWN = 3;
const SCMIN = 6; // scroll frame indices (Uovl.pas:27-29)
const SCMAX = 15;
let ostav = O_NORMAL;
let scroll = SCMIN;
let scrollAcc = 0; // wall-clock accumulator to advance one scroll frame per ~100ms tick
const PANEL_SCROLL_MS = 100; // the original panel Timer interval (UMain.dfm)
let panelDragBus: VolumeBus | null = null; // the slider currently being dragged, if any
// A menu overlay opened from a map corner (UMain.pas daOptions/daCredits): the
// Options panel or the scrolling credits, shown over the world map.
let mapOverlay: 'none' | 'options' | 'credits' = 'none';
let credits: Credits | null = null; // the parsed credits assets (lazily loaded)
// Hi-res AI art for the two UI surfaces. Loaded once, lazily, only while graphics==='ai';
// null means "not available" and the faithful indexed path is used instead.
let aiPanel: AiPanel | null = null;
let aiCredits: AiCredits | null = null;
let aiPanelTried = false;
let aiCreditsTried = false;
// Last display box the AI credit layers were sized for, so layout() runs on resize
// rather than every frame.
let creditsLayoutW = 0;
let creditsLayoutH = 0;

/** Put the game canvas back after the GPU credits overlay was shown. */
function hideAiCredits(): void {
  if (aiCredits) aiCredits.hide();
  if (canvas.style.display === 'none') canvas.style.display = '';
}
let creditMode = -1; // scroll offset while the credits roll (CreditMode); -1 = idle
let creditsStart = 0; // wall-clock time the roll began (drives the scroll)
// The map corner button under the cursor (dAkce, UMain.pas:1636), lit on hover.
let mapHoverCorner: MapAction | null = null;
// The world-map record info panel (krokoměr, UMain.pas:1364): clicking an already
// solved (or cheated) room opens it instead of launching. `mapInfoRoom` is the
// room whose panel is open (null = closed); `mapInfoHover` the button under the
// cursor; `mapInfoFaze` the odometer roll frame. `mapHoverRoom` is the room node
// hovered on the open map (drives the name plaque, drawn on hover too).
let mapInfoRoom: number | null = null;
let mapInfoHover: InfoButton | null = null;
let mapInfoFaze = 0;
let mapInfoOpenAt = 0; // timestamp of openMapInfo, so the odometer rolls on wall-clock time
let mapHoverRoom: number | null = null;
// Info-panel bitmaps (loaded at boot); the name-plaque data reloads on a language
// change (typdesek<>tit_def, UMain.pas:1437).
let infoPanelAssets: InfoPanelAssets | null = null;
let deskyData: DeskyData | null = null;
let deskyLang: 'cz' | 'en' | null = null;
let helpOpen = false; // true while the help-screens overlay is shown (akce_help / ToggleHelp)
const helpScreens = new HelpScreens(); // the control-help pages (Help.pas), lazily loaded
let worldMap: WorldMap | null = null; // the branch-map screen
// AI-upscaled world-map compositor (Phase B), lazily loaded when the map assets
// load; used ONLY under the `ai` graphics level and only when every AI asset is
// present (else the map falls back to the faithful CPU composite). The overlay
// canvas draws the record panel + name plaques at native res, nearest-neighbour-
// scaled over the hi-res map so digits/text stay crisp.
let aiWorldMap: AiWorldMap | null = null;
let mapOverlayCanvas: HTMLCanvasElement | null = null;
let mapOverlayCtx: CanvasRenderingContext2D | null = null;
let screen: 'map' | 'room' | 'intro' | 'legimage' = 'room'; // which screen is showing
// Leg-completion story image (obrazek, UMain.pas:831 zobraz_obrazek): the full-screen
// "case file" page shown over a frozen map when the last room of a leg (depth 15) is
// won. `legImage` holds the decoded page (null = none); `legImageNum` is the leg (1..8)
// for the __ff hook; `legImageDrawn` gates the one-shot blit while it idles on screen.
let legImage: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;
let legImageNum = -1;
let legImageDrawn = false;
/**
 * The AI-upscaled page for the story image currently on screen, when the `ai` tier is
 * selected and its art loaded. null ⇒ draw the original 640×480 page (every other tier,
 * and any tier if the upscaled file is missing).
 */
let legImageAi: ImageBitmap | null = null;
// When the page is shown on re-entry (Run/Replay of an already-solved depth-15 room,
// UMain.pas:958/1030 daClickAndRun), dismissing it must continue into that room rather
// than return to the map. `legImagePending` holds the deferred launch (null = after-win
// case → dismiss goes to the map).
let legImagePending: { room: number; replay?: string } | null = null;
let mapRevealStart = 0; // wall-clock time the map reveal animation began (Depth = -3)

/** Current localStorage save-data layout version (ff.schema). Bump when the shape
 *  of any persisted `ff.*` key changes, and add a migration step in migrateSaves().
 *  Declared before migrateSaves() runs: the call below reads SAVE_SCHEMA, so the
 *  const must be initialized first (a later declaration would be in its temporal
 *  dead zone → a swallowed ReferenceError that silently skips the migration). */
const SAVE_SCHEMA = 1;

migrateSaves();
const solved = loadSet('ff.solved'); // set of solved (1-based) room numbers, persisted
const cheated = loadSet('ff.cheated'); // rooms completed via the cheat (shown as kCheat)

/**
 * Version + migrate the persisted save data so a future layout change never strands
 * an existing player's progress. Runs once at boot, before any `ff.*` key is read.
 * Pre-versioning saves (no `ff.schema`) are already in the v1 shape, so they are
 * simply stamped; later bumps add `if (from < N)` steps that transform keys in place.
 */
function migrateSaves(): void {
  try {
    const raw = localStorage.getItem('ff.schema');
    const from = raw !== null ? Number(raw) : 0;
    if (from >= SAVE_SCHEMA) return;
    // from 0 (unversioned) -> 1: no key changes needed (ff.solved/cheated/scores/
    // best/graphics/renderer/... already match v1); future migrations go here.
    localStorage.setItem('ff.schema', String(SAVE_SCHEMA));
  } catch {
    /* storage unavailable */
  }
}

/** Load a persisted set of room numbers from localStorage. */
function loadSet(key: string): Set<number> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set<number>(JSON.parse(raw) as number[]);
  } catch {
    /* storage unavailable */
  }
  return new Set<number>();
}

/** Persist a set of room numbers. */
function saveSet(key: string, s: Set<number>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...s]));
  } catch {
    /* storage unavailable */
  }
}

const saveSolved = (): void => saveSet('ff.solved', solved);
const saveCheated = (): void => saveSet('ff.cheated', cheated);

const scores = loadScores(); // room number -> best (lowest) move count on a genuine solve

/**
 * cascisty (USoutez.pas:697): milliseconds spent INSIDE each room, accumulated
 * across every visit and every session. The original keeps this per room in its
 * competition records and adds the visit's elapsed time when the room closes
 * (zaznamenej_zmeny, UMain.pas:283), then persists the records; ZAVER's finale
 * narrates the total as an hour count. Map/menu/intro time never counts, and a
 * restart does not split a visit (TRoom.Restart leaves casstartu alone).
 */
const playTime = loadPlayTime();
/** Date.now() when the current room visit began, or 0 when not in a room. */
let roomEnterAt = 0;
/** The room that visit belongs to. */
let roomClockNum = 0;

/** Load the persisted per-room play time (ms). */
function loadPlayTime(): Map<number, number> {
  try {
    const raw = localStorage.getItem('ff.playtime');
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, number>;
      return new Map(
        Object.entries(obj)
          .map(([k, v]) => [Number(k), Number(v)] as [number, number])
          .filter(([k, v]) => Number.isFinite(k) && Number.isFinite(v) && v >= 0),
      );
    }
  } catch {
    /* storage unavailable */
  }
  return new Map<number, number>();
}

/** Start timing a visit to room `num` (TRoom.Start: casstartu := Date+Time). Armed
 *  by the player entering a room, not by loadRoom — the boot room is pre-loaded
 *  behind the world map and must not accrue play time. The room number is captured
 *  here rather than read from `curNum` at the end, because `curNum` only updates
 *  once the (async) room load succeeds: leaving during the load would otherwise
 *  bank the time against the room the player just came from. */
function startRoomClock(num: number): void {
  roomEnterAt = Date.now();
  roomClockNum = num;
}

/**
 * Close a room visit and bank its elapsed time (zaznamenej_zmeny, UMain.pas:283 ->
 * USoutez.pas:695). Called whenever the room is left, for any reason; time in a
 * visit that is never closed is lost, exactly as it is in the original.
 */
function stopRoomClock(): void {
  if (!roomEnterAt) return;
  const elapsed = Date.now() - roomEnterAt;
  roomEnterAt = 0;
  const n = roomClockNum;
  roomClockNum = 0;
  if (!n || elapsed <= 0) return;
  playTime.set(n, (playTime.get(n) ?? 0) + elapsed);
  try {
    localStorage.setItem('ff.playtime', JSON.stringify(Object.fromEntries(playTime)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * cas_hry (USoutez.pas:263): the whole game's play time, in Delphi day units —
 * the sum over all rooms of their banked time. The visit in progress is NOT
 * included, matching the original, whose current room has not been recorded yet
 * when ZAVER reads it.
 */
function casHry(): number {
  let ms = 0;
  for (const v of playTime.values()) ms += v;
  return ms / 86_400_000;
}

/** Load the persisted per-room best move counts (RoomVysl). */
function loadScores(): Map<number, number> {
  try {
    const raw = localStorage.getItem('ff.scores');
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, number>;
      return new Map(Object.entries(obj).map(([k, v]) => [Number(k), Number(v)]));
    }
  } catch {
    /* storage unavailable */
  }
  return new Map<number, number>();
}

/** Persist the per-room best move counts. */
function saveScores(): void {
  try {
    localStorage.setItem('ff.scores', JSON.stringify(Object.fromEntries(scores)));
  } catch {
    /* storage unavailable */
  }
}

/** RoomVysl:=LengthOfRecord (URoom.pas:24342): record a solve's move count, keeping the best. */
function recordScore(roomNum: number, moves: number): void {
  const prev = scores.get(roomNum);
  if (prev === undefined || moves < prev) {
    scores.set(roomNum, moves);
    saveScores();
  }
}

// The best-solution move records (the original's `nej` save slot), keyed by room.
// Persisted so the map info panel's "Replay" can animate a room's best solution.
const bestRecords = loadBestRecords();

/** Load the persisted per-room best-solution move records (ff.best). */
function loadBestRecords(): Map<number, string> {
  try {
    const raw = localStorage.getItem('ff.best');
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, string>;
      return new Map(Object.entries(obj).map(([k, v]) => [Number(k), String(v)]));
    }
  } catch {
    /* storage unavailable */
  }
  return new Map<number, string>();
}

/** Persist the per-room best-solution move records. */
function saveBestRecords(): void {
  try {
    localStorage.setItem('ff.best', JSON.stringify(Object.fromEntries(bestRecords)));
  } catch {
    /* storage unavailable */
  }
}

/** The best-solution record for a room, if one has been stored (enables Replay). */
function bestRecord(roomNum: number): string | undefined {
  return bestRecords.get(roomNum);
}

/**
 * Store a solve's full move record as the room's best when it beats the stored
 * count (mirrors recordScore's keep-minimum guard so record + count stay in sync;
 * the original's `nej` slot). Called on a genuine win with the winning srecord.
 */
function recordBest(roomNum: number, rec: string, moves: number): void {
  const prev = scores.get(roomNum);
  if (prev === undefined || moves <= prev) {
    bestRecords.set(roomNum, rec);
    saveBestRecords();
  }
}

/**
 * xwemaketherulez (URoom.pas:24666): the original's "solve this room" cheat. Marks
 * the current room completed-via-cheat, records it in the progression, and returns
 * to the map (konec:=1). Handy for testing.
 */
function cheatSolveRoom(): void {
  if (screen !== 'room') return;
  const n = Number(select.value);
  if (Number.isFinite(n)) {
    if (!solved.has(n)) cheated.add(n); // genuinely-won rooms stay "solved", not "cheat"
    saveCheated();
    showMap();
  }
}

/** Dev-only: genuinely win the current room (dev-bar "Win room" button / the W hotkey).
 *  Unlike cheatSolveRoom (xwemaketherulez), which jumps straight to the map and marks the
 *  room "cheated", this drives the real win path — engine.triggerWin -> onWin bookkeeping
 *  (marks the room solved) -> the auto-return countdown -> returnFromRoom — so an
 *  end-of-leg room reveals its story page exactly as a real solve would. Meant purely as a
 *  spot-check aid for the win/story-page flow; armed only while the dev pane is enabled. */
function devWinRoom(): void {
  if (!devEnabled || screen !== 'room' || !engine || !room || engine.phase !== 'idle' || room.won) return;
  engine.triggerWin();
}

// ---------------------------------------------------------------------------
// Typed cheat codes (Uovl.pas:744 in a room, UMain.pas:1750 on the map).
// ---------------------------------------------------------------------------

/** `cheatstring` — the room's entry buffer. Armed by X, parked between codes. */
const roomCheats = new CheatEntry();
/** `dircheat` (UMain.pas:1727) — the map's own buffer; the two never share state. */
const mapCheats = new CheatEntry();

/** ultraviolence (USoutez.pas:24): every room entered from now on spawns a hook
 *  (TRoom.Start, URoom.pas:1503). Armed from the map and never cleared. */
let ultraviolence = false;
/** oldamp/oldper/oldspd (URoom.pas:24607): the water params xstorm displaced. */
let oldWater: { amp: number; per: number; spd: number } | null = null;
/**
 * The sprite cheats currently applied, in the order they were typed. Both are
 * toggles that rewrite the fish head/body frames, and both survive a restart in
 * the original (TRoom.Restart does not reload the sprites), so the port keeps the
 * state and recomputes the frames from the pristine parsed data whenever the Room
 * is rebuilt. The original's xmorph instead restores the bitmaps it saved when it
 * was switched on (Hlavy1/Tela1, URoom.pas:23832) — indistinguishable unless the
 * two cheats are interleaved, where recomputing is the better-behaved of the two.
 */
let spriteCheats: ('UNDEAD' | 'MORPH')[] = [];
/** megabomb (URoom.pas:26192): blank the room white for exactly one painted frame. */
let megabombFlash = false;
/** silentfilm (URoom.pas:181): the xsilent cheat's black-and-white movie mode. */
let silentFilm = false;
/** interlacedfaze (URoom.pas:195): -1 off, -2 winding down, >=0 the collapse phase. */
let interlacedFaze = INTERLACED_OFF;
/** The hidden SCORE bonus room (branch 9, `av:=9; am:=1` — UMain.pas:1774). */
const SCORE_ROOM = 72;

/**
 * xmegabomb (URoom.pas:24534): kill both fish where they float — light-kind
 * skeletons that erode away — then blank the room white for a frame. The original
 * counts both deaths, kills any speech, and drops whatever the fish were holding.
 */
function cheatMegabomb(): void {
  if (!room || !engine) return;
  for (const which of ['little', 'big'] as const) {
    if (room.alive[which]) room.killFish(which);
  }
  audio.snd('sp-smrt1', 3, false, EFFECT_VOL);
  audio.snd('sp-smrt2', 3, false, EFFECT_VOL);
  audio.killVoice(MLUVI_PRIOR.little); // KSnd(mluvi_mala)
  audio.killVoice(MLUVI_PRIOR.big); // KSnd(mluvi_velka)
  activeScript?.s.clearDialog(); // Zrus_dialogy
  room.clearAllDirs();
  if (room.padani()) {
    engine.phase = 'fall'; // gstav := stav_ma_padat
    engine.animFrame = 0;
  }
  megabombFlash = true;
  forceRoomRedraw = true;
}

/** A head/body frame table, as both `Room.heads` and `Room.bodies` are shaped. */
type FrameSet = { big: readonly (FfrBitmap | null)[]; small: readonly (FfrBitmap | null)[] };
/** One facing of the enhanced truecolor fish sprites (both sizes). */
type FishFacing = { small: Map<string, EnhancedSprite>; big: Map<string, EnhancedSprite> };
/** The reshaped enhanced sprites while a sprite cheat is on, else null. */
let cheatFishSprites: FishSprites | null = null;

/** pretoc (URoom.pas:23892) over a whole frame table — the xundead flip. */
function undeadSet(set: FrameSet): FrameSet {
  const flip = (frames: readonly (FfrBitmap | null)[]): (FfrBitmap | null)[] =>
    frames.map((bm) => (bm ? pretoc(bm) : bm));
  return { big: flip(set.big), small: flip(set.small) };
}

/** morph (URoom.pas:23832) over a whole frame table — each fish takes the other's
 *  shape. Both halves derive from the ORIGINALS, as the Delphi does via
 *  bmmala1/bmvelka1, so the swap is a genuine exchange rather than a chain. */
function morphSet(set: FrameSet): FrameSet {
  return {
    small: set.small.map((bm, i) => (bm && set.big[i] ? morphShrink(set.big[i]!) : bm)),
    big: set.big.map((bm, i) => (bm && set.small[i] ? morphStretch(set.small[i]!) : bm)),
  };
}

/** The same two transforms over one facing of the enhanced truecolor fish, which
 *  the enhanced art source blits instead of the FFR frames. Sprites are paired by
 *  filename, so a frame present for only one fish is left alone. */
function undeadFacing(set: FishFacing): FishFacing {
  const out: FishFacing = { small: new Map(), big: new Map() };
  for (const size of ['small', 'big'] as const) {
    for (const [k, v] of set[size]) out[size].set(k, pretocRgba(v));
  }
  return out;
}

function morphFacing(set: FishFacing): FishFacing {
  const out: FishFacing = { small: new Map(set.small), big: new Map(set.big) };
  for (const [k, small] of set.small) {
    const big = set.big.get(k);
    if (!big) continue;
    out.small.set(k, morphShrinkRgba(big));
    out.big.set(k, morphStretchRgba(small));
  }
  return out;
}

/**
 * Recompute the fish sprites: the pristine art, then every active sprite cheat in
 * the order it was typed. Both art sources are covered — the FFR head/body frames
 * the classic renderer uses, and the enhanced truecolor set, which is a wholly
 * separate path (EnhancedArtSource.drawFish) that would otherwise ignore the
 * cheats entirely in the mode the game ships in. Nothing shared is mutated.
 */
function applySpriteCheats(): void {
  if (room && ffr) {
    let heads: FrameSet = ffr.heads;
    let bodies: FrameSet = ffr.bodies;
    for (const c of spriteCheats) {
      const f = c === 'UNDEAD' ? undeadSet : morphSet;
      heads = f(heads);
      bodies = f(bodies);
    }
    room.heads = heads;
    room.bodies = bodies;
  }
  if (!fishSprites || spriteCheats.length === 0) {
    cheatFishSprites = null;
    return;
  }
  let left: FishFacing = { small: fishSprites.small.left, big: fishSprites.big.left };
  let right: FishFacing = { small: fishSprites.small.right, big: fishSprites.big.right };
  for (const c of spriteCheats) {
    const f = c === 'UNDEAD' ? undeadFacing : morphFacing;
    left = f(left);
    right = f(right);
  }
  cheatFishSprites = {
    small: { left: left.small, right: right.small },
    big: { left: left.big, right: right.big },
  };
}

/** Toggle one of the two sprite cheats (xundead URoom.pas:24573, xmorph :24588). */
function toggleSpriteCheat(which: 'UNDEAD' | 'MORPH'): void {
  spriteCheats = spriteCheats.includes(which)
    ? spriteCheats.filter((c) => c !== which)
    : [...spriteCheats, which];
  applySpriteCheats();
  forceRoomRedraw = true;
}

/** xstorm (URoom.pas:24607): whip the water up (wamp/wspd/wper = 10/4/6), or put
 *  it back if it is already storming — the original toggles on those exact values. */
function cheatStorm(): void {
  if (!room) return;
  if (room.wamp === 10 && room.wspd === 4 && room.wper === 6 && oldWater) {
    room.wamp = oldWater.amp;
    room.wper = oldWater.per;
    room.wspd = oldWater.spd;
    oldWater = null;
  } else {
    oldWater = { amp: room.wamp, per: room.wper, spd: room.wspd };
    room.wamp = 10;
    room.wspd = 4;
    room.wper = 6;
  }
  forceRoomRedraw = true;
}

/**
 * xsilent (URoom.pas:24641): silent-movie mode — the sound is cut, the picture
 * goes sepia, film grain scratches over it, and every spoken line becomes an
 * intertitle card instead of a subtitle. Typing it again restores the volumes and
 * the colour; so does leaving the room (TRoom.Done, URoom.pas:1513).
 */
function cheatSilent(): void {
  if (silentFilm) {
    endSilentFilm();
    return;
  }
  for (const bus of ['effect', 'voice', 'music'] as const) audio.setBusGain(bus, 0);
  silentFilm = true;
  syncScriptMusicVolume(); // music_volume := 0, which room scripts can see (VES)
  if (subs) {
    subs.silentFilm = true;
    subs.silentTime = 0; // cassilenttit := 0
  }
  forceRoomRedraw = true;
}

/**
 * Undo silent-film mode — on a second xsilent, and on leaving the room, which is
 * where the original does it (TRoom.Done, URoom.pas:1513-1518).
 *
 * The original restores its `oldmusic`/`oldsnd`/`oldtalk` snapshot; the port
 * restores the persisted settings instead. They are the same thing unless the
 * player moved a slider while the film was running, in which case restoring the
 * snapshot would leave what you HEAR disagreeing with where the slider SITS —
 * the original re-derives its slider from the volume, so it has no such split.
 */
function endSilentFilm(): void {
  if (!silentFilm) return;
  silentFilm = false;
  applyVolumeSettings();
  syncScriptMusicVolume();
  if (subs) {
    subs.silentFilm = false;
    subs.silentTime = 0;
  }
  forceRoomRedraw = true;
}

/** xinterlaced (URoom.pas:24627): start the screen collapsing in on itself, or —
 *  if it already is — ask it to wind down (faze -2 runs one last frame). */
function cheatInterlaced(): void {
  interlacedFaze = interlacedFaze >= 0 ? INTERLACED_STOP : INTERLACED_START;
  forceRoomRedraw = true;
}

/**
 * Advance the film effects' own counters, once per game tick.
 *
 * These live in `KresliMistnost` in the original (URoom.pas:26200-26205, 26079),
 * which is driven from `Jedeme` — i.e. once per ~80ms logic tick, not once per
 * painted frame. The port paints at up to 60fps, so running them from the render
 * path made the intertitle cards and the interlaced collapse play roughly five
 * times too fast.
 */
function tickFrameEffects(): void {
  if (silentFilm && subs && subs.silentTime > 0) subs.silentTime--;
  if (interlacedFaze !== INTERLACED_OFF) {
    // `sp-smrt` fires on the phase whose shift passes -10 (URoom.pas:26058).
    if (interlacedSounds(interlacedFaze)) audio.snd('sp-smrt', -10, false, EFFECT_VOL);
    interlacedFaze++;
  }
}

/** True while a cheat needs the whole finished frame post-processed, which the
 *  GPU path cannot do — those frames render on the CPU instead. */
function frameEffectsActive(): boolean {
  return megabombFlash || silentFilm || interlacedFaze !== INTERLACED_OFF || tetris !== null;
}

/** Blit the minigame's 150x300 board into the middle of an RGBA frame. It has its
 *  own palette, so it goes straight into the colour plane. */
function blitTetris(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
  if (!tetris || !tetrisArt) return;
  const bw = tetrisArt.hole.w;
  const bh = tetrisArt.hole.h;
  const src = tetrisRgba(renderTetris(tetris, tetrisArt), tetrisArt);
  const ox = Math.floor((w - bw) / 2);
  const oy = Math.floor((h - bh) / 2);
  for (let y = 0; y < bh; y++) {
    const dy = oy + y;
    if (dy < 0 || dy >= h) continue;
    for (let x = 0; x < bw; x++) {
      const dx = ox + x;
      if (dx < 0 || dx >= w) continue;
      const s = (y * bw + x) * 4;
      const d = (dy * w + dx) * 4;
      rgba[d] = src[s]!;
      rgba[d + 1] = src[s + 1]!;
      rgba[d + 2] = src[s + 2]!;
      rgba[d + 3] = 255;
    }
  }
}

/**
 * The tail of KresliMistnost (URoom.pas:26192-26281): the megabomb flash, the
 * silent-film intertitle card, the grain, and the interlaced collapse — in the
 * original's order, over the finished frame.
 */
function applyFrameEffects(screen: RgbaScreen, useVecSubs: boolean, grain = true): void {
  const rnd = (n: number): number => Math.floor(Math.random() * n);
  const scratch = (s: RgbaScreen): void => {
    if (grain) sum(s, rnd); // probes disable the random grain to get a stable hash
  };
  if (tetris && tetrisArt) {
    // The minigame sits over the (frozen) room, as its modal window does.
    blitTetris(screen.rgba, screen.width, screen.height);
    return;
  }
  if (megabombFlash) {
    // VyplnMistnost(fontcol['w',1]); KresliTitulky — one white frame, then back.
    megabombFlash = false;
    forceRoomRedraw = true;
    screen.fillIndex(subs?.fontcolIndex('w', 1) ?? 255);
    subs?.draw(screen, count);
    return;
  }
  if (silentFilm && subs?.silentActive) {
    // The card replaces the room entirely while it runs.
    screen.fillIndex(subs.fontcolIndex('w', 4));
    subs.drawSilentTitle(screen);
    scratch(screen);
    zcernobilit(screen.rgba);
    return;
  }
  if (!useVecSubs) subs?.draw(screen, count); // baked subtitles (palette-coloured, on top)
  if (silentFilm) scratch(screen);
  if (interlacedFaze !== INTERLACED_OFF) {
    zpracujInterlaced(screen, interlacedFaze, subs?.fontcolIndex('w', 4) ?? 255);
  }
  if (silentFilm) zcernobilit(screen.rgba);
}

/**
 * xtetris (URoom.pas:24564, UMain.pas:1764): the Tetris minigame. The original
 * opens it as a modal window over the game (`Tetris.ShowModal`), which freezes
 * the room's timer until it closes; the port has no windows, so it draws the
 * 150x300 board centred over the frozen room and takes the keyboard until Escape.
 */
let tetris: TetrisGame | null = null;
let tetrisArt: TetrisArt | null = null;
let tetrisLoading = false;
let tetrisAcc = 0; // ms accumulated toward the next 55ms game tick (Ttr.dfm)
let tetrisTick = 0; // ticks run, so the map's paint cache knows the board moved
let tetrisPending = false; // the cheat fired and the board art is still loading
const TETRIS_TICK_MS = 55;

/** ttr.pic (Ttr.pas:339) — the persistent top-ten, in localStorage here. */
const tetrisHiscores: HiscoreStore = {
  load: () => {
    try {
      const raw = localStorage.getItem('ff.tetris');
      return raw ? (JSON.parse(raw) as number[]) : [];
    } catch {
      return [];
    }
  },
  save: (scores) => {
    try {
      localStorage.setItem('ff.tetris', JSON.stringify(scores));
    } catch {
      /* storage unavailable */
    }
  },
};

/** Load the minigame's atlas + well bitmaps and shape table (nacti, Ttr.pas:89). */
async function ensureTetrisArt(): Promise<TetrisArt | null> {
  if (tetrisArt || tetrisLoading) return tetrisArt;
  tetrisLoading = true;
  try {
    const [all, hole, txt] = await Promise.all([
      fetch('/data/Intro/all.BMP').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/dira.BMP').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/all.txt').then((r) => r.text()),
    ]);
    const shapes = parseShapes(txt);
    tetrisArt = {
      all: parseBmp(new Uint8Array(all)),
      hole: parseBmp(new Uint8Array(hole)),
      xfont: shapes.xfont,
      yfont: shapes.yfont,
    };
    tetrisShapes = shapes;
  } catch {
    tetrisArt = null; // the data is missing: the cheat just does nothing
  } finally {
    tetrisLoading = false;
  }
  return tetrisArt;
}
let tetrisShapes: TetrisShapes | null = null;

/**
 * Open the minigame (Tetris.Create + ShowModal). The original's launch is
 * synchronous; the port has to fetch the board art first, so `tetrisPending`
 * makes the game modal from the instant the code fires — otherwise the room kept
 * running and taking input during the fetch, and the board could pop open on a
 * screen the player had since moved to.
 */
function openTetris(): void {
  if (tetris || tetrisPending) return;
  const screenAtLaunch = screen;
  tetrisPending = true;
  wake();
  void ensureTetrisArt().then(() => {
    if (!tetrisPending) return; // cancelled (Escape) while the art was loading
    tetrisPending = false;
    if (!tetrisArt || !tetrisShapes || tetris || screen !== screenAtLaunch) return;
    tetris = new TetrisGame(tetrisShapes, (n) => Math.floor(Math.random() * n), tetrisHiscores);
    tetrisAcc = 0;
    forceRoomRedraw = true;
    wake();
  });
}

/** Close it (modalresult := mrCancel): the room resumes with no key held
 *  (gstav := stav_klid; keyroom := 0; keyovl := 0 — URoom.pas:24568). */
function closeTetris(): void {
  if (!tetris && !tetrisPending) return;
  tetris = null;
  tetrisPending = false;
  clearHeldKey();
  if (engine) engine.swim = null;
  forceRoomRedraw = true;
  wake();
}

/** True while the minigame owns the game — including the moment between the cheat
 *  firing and its art arriving. */
function tetrisModal(): boolean {
  return tetris !== null || tetrisPending;
}

/** Advance the minigame's own 55ms timer, independent of the game's logic tick. */
function tickTetris(dtMs: number): void {
  if (!tetris) return;
  wake(); // the board animates on its own; never let the idle throttle stall it
  tetrisAcc += dtMs;
  let steps = 0;
  while (tetrisAcc >= TETRIS_TICK_MS && steps < 4) {
    tetrisAcc -= TETRIS_TICK_MS;
    steps++;
    tetrisTick++;
    tetris.tick();
  }
  forceRoomRedraw = true;
}

/**
 * The in-room cheat dispatch (URoom.pas:24534-24690). Codes 11/12 have no case
 * here — SCORE and ULTRAVIOLENCE only work from the map (UMain.pas:1773-1780).
 */function applyRoomCheat(cheat: Cheat): void {
  if (screen !== 'room' || !room) return;
  switch (cheat) {
    case 'MEGABOMB':
      cheatMegabomb();
      break;
    case 'UNDEAD':
      toggleSpriteCheat('UNDEAD');
      break;
    case 'MORPH':
      toggleSpriteCheat('MORPH');
      break;
    case 'FISHER':
      hooks.add(room);
      break;
    case 'TETRIS':
      openTetris();
      break;
    case 'STORM':
      cheatStorm();
      break;
    case 'INTERLACED':
      cheatInterlaced();
      break;
    case 'SILENT':
      cheatSilent();
      break;
    case 'WEMAKETHERULEZ':
      cheatSolveRoom();
      break;
    case 'IAMACHEATER':
      // Deliberately nothing: the original's body is `{soutez:=not soutez;}` —
      // commented out, so the retail build just swallows the code.
      break;
    default:
      break;
  }
}

/** The map-screen cheat dispatch (UMain.pas:1760-1782). Only three codes act here. */
function applyMapCheat(cheat: Cheat): void {
  switch (cheat) {
    case 'SCORE':
      // `av:=9; am:=1; doAkce:=daRun` — run the hidden SCORE bonus room, which is
      // kept off the map and out of the finale, so this code is the only way in.
      void enterRoom(SCORE_ROOM);
      break;
    case 'TETRIS':
      // The map screen launches the minigame too (UMain.pas:1764).
      openTetris();
      break;
    case 'ULTRAVIOLENCE':
      ultraviolence = true;
      break;
    default:
      break;
  }
}


let ffr: FfrRoom | null = null;
let room: Room | null = null;
let font: FontData | null = null;
let subs: SubtitleSystem | null = null;
let fftEntries: FftEntry[] = [];
let chatFft: FftEntry[] = []; // global x03 ambient-chatter subtitles (ob-*)
let deathFft: FftEntry[] = []; // global x02 death-commentary subtitles (smrt-*)
// Player options (volume sliders + subtitle language), persisted across sessions
// (settings.ts). Subtitles extend the port's cz/en with an off state (tit_no);
// `titDef` remembers the last cz/en pick — the one language used for the titles,
// room-name plaques and help (and the subtitles when on). subLang() resolves it.
const settings = loadSettings();
/**
 * True while dialogue text should be shown (titles <> tit_no).
 *
 * Silent-film mode overrides the "off" setting: `Talk` swaps `titles` to `tit_def`
 * for the duration (URoom.pas:630-635), because the cheat has muted every voice
 * and the intertitle cards are all the player has left.
 */
function subsOn(): boolean {
  return settings.subtitles !== 'off' || silentFilm;
}
/** The language to render dialogue text in (falls back to tit_def when off). */
function subLang(): 'cz' | 'en' {
  return settings.subtitles === 'off' ? settings.titDef : settings.subtitles;
}
/**
 * Set the subtitle language (obltitcz/eng/no, Uovl.pas:716-718). Choosing cz/en
 * also updates tit_def (the remembered language used when subtitles are off), so
 * the titles/plaques/help and the subtitles are always the one same language.
 */
function setSubtitleMode(mode: SubtitleMode): void {
  settings.subtitles = mode;
  if (mode !== 'off') settings.titDef = mode;
  saveSettings(settings);
  void ensureDeskyData(); // language may have changed -> reload the room-name plaques
  setInfo();
}
/** Set a volume slider index (tahlo_snd/talk/music) and apply it live. */
function setVolume(bus: VolumeBus, index: number): void {
  settings.volume[bus] = index;
  audio.setBusGain(bus, busMultiplier(bus, index));
  syncScriptMusicVolume();
  saveSettings(settings);
}

/**
 * music_volume (RSound.pas:36) on the original's 0..64 scale — the level the
 * player's 0..12 slider index maps to through Volumes[]. Room scripts (VES's
 * quiet-music easter egg, URoom.pas:12190) compare against this, not the index.
 */
function musicLevel(): number {
  if (silentFilm) return 0; // xsilent sets music_volume := 0 (URoom.pas:24647)
  return VOLUMES[Math.max(0, Math.min(VOLUMES.length - 1, settings.volume.music))]!;
}

/** Push the effective music_volume at the running room script. */
function syncScriptMusicVolume(): void {
  if (activeScript) activeScript.s.musicVolume = musicLevel();
}

/** Push all persisted volume levels into the audio buses (NastavZvuk, on boot). */
function applyVolumeSettings(): void {
  for (const bus of ['effect', 'voice', 'music'] as const) {
    audio.setBusGain(bus, busMultiplier(bus, settings.volume[bus]));
  }
}

// Graphics-quality level (the art source). Three tiers, persisted; defaults to
// enhanced. Cycle with E (classic → enhanced → ai → classic) or the dev-bar combobox:
//  - classic:  the faithful Delphi 256-colour look (FFR bitmaps + palette).
//  - enhanced: render eligible rooms through the single compositor with the FFNG
//    fillets-ng-data masters as the art source (background + object/fish sprites);
//    index-effect rooms (mirror/darkness/ZX/bonus) stay classic (see
//    src/render/enhancedArtSource.ts).
//  - ai:       AI-upscaled tier layered on top of enhanced. AI art is used wherever
//    it exists (intro/logo video, world map, control panel, credits, and rooms +
//    fish via roomAi); anything missing or excluded falls back to enhanced, and
//    thence to classic. enhancedArtActive() (below) still treats ai like enhanced
//    because enhanced IS that fallback, and supplies the shared truecolor-mode
//    behaviour (vector subtitles, the anti-flash load hold).
type GraphicsLevel = 'classic' | 'enhanced' | 'ai';
let graphics: GraphicsLevel =
  ((): GraphicsLevel => {
    const v = localStorage.getItem('ff.graphics');
    // Default: the AI-upscaled tier. Each element falls back to enhanced (and thence
    // to classic) when it has no AI asset, so this is safe even for anything unbuilt.
    return v === 'classic' || v === 'enhanced' || v === 'ai' ? v : 'ai';
  })();

/**
 * True when the active level may use the enhanced (truecolor) art source. The AI
 * level counts too: enhanced is its per-element fallback and supplies the shared
 * truecolor-mode behaviour, so the art must be loaded either way. This is exactly `graphics !==
 * 'classic'`, so classic (false) and enhanced (true) keep their prior behaviour
 * byte-for-byte; only the new `ai` level newly returns true.
 */
const enhancedArtActive = (): boolean => graphics !== 'classic';
// Render backend (P3): the CPU compositor (oracle, fallback) or the WebGL2 GPU
// compositor. Orthogonal to `graphics` (the art source) — both art sources
// composite on either backend, and every room (incl. gspec=42 ZX) is on the GPU.
// Any GL failure falls back to the CPU compositor. Persisted; defaults to webgl.
// The default is webgl unconditionally (not gated on a live webgl2Available()
// probe): the probe spins up a throwaway GL context and, under context pressure,
// can transiently fail on a fresh load and strand the picker on CPU. A genuine GL
// failure at runtime still falls back to the CPU compositor via glFailed, and the
// HUD shows the WEBGL→cpu fallback, so webgl stays the honest intended default.
let renderer: 'cpu' | 'webgl' =
  (localStorage.getItem('ff.renderer') as 'cpu' | 'webgl' | null) ?? 'webgl';
// Render-on-dirty (perf): when true, an idle room is repainted only when its frame
// actually changes (the wobble/animation advances on the 12.5fps logic tick), not
// on every 60fps rAF — cutting idle in-room CPU ~5x. 60fps is kept while anything
// is animating (fish sliding, ZX bands, etc.). Persisted; default on.
let renderOnDirty = localStorage.getItem('ff.renderOnDirty') !== '0';
// Developer pane: persisted, off by default. Enabled via Ctrl+Alt+D — it shows the
// tuning chrome (dev bar) + perf HUD (both gated on body.dev in CSS) and arms the
// one-key dev toggles (E/R/P/F/G). Players never see it.
let devEnabled = localStorage.getItem('ff.devEnabled') === '1';

/** Enable/disable the developer pane; persists and mirrors the body.dev CSS hook. */
function setDevEnabled(v: boolean): void {
  devEnabled = v;
  localStorage.setItem('ff.devEnabled', v ? '1' : '0');
  document.body.classList.toggle('dev', v);
}

/**
 * Switch the render backend (CPU compositor ⇄ WebGL). The CPU path is the parity
 * oracle + fallback; WebGL is re-enabled explicitly even after a prior GL failure
 * (the user is retrying). Persists, keeps the dev-bar select in sync, and forces a
 * room repaint so the switch shows immediately under render-on-dirty.
 */
function setRenderer(r: 'cpu' | 'webgl'): void {
  renderer = r;
  if (renderer === 'webgl') enableWebgl();
  localStorage.setItem('ff.renderer', renderer);
  if (rendererSelect) rendererSelect.value = renderer;
  forceRoomRedraw = true;
  wake();
  setInfo();
}

/** Toggle/set the idle-FPS saver (render-on-dirty); persists + syncs the dev-bar checkbox. */
function setRenderOnDirty(v: boolean): void {
  renderOnDirty = v;
  localStorage.setItem('ff.renderOnDirty', v ? '1' : '0');
  if (idleDirtyToggle) idleDirtyToggle.checked = v;
  forceRoomRedraw = true; // repaint immediately when turning the saver off
  wake();
}

// The graphics-level cycle order for the E hotkey (classic → enhanced → ai → …).
const GRAPHICS_LEVELS: readonly GraphicsLevel[] = ['classic', 'enhanced', 'ai'];

/**
 * Set the graphics-quality level (classic/enhanced/ai). Single entry point shared
 * by the E hotkey, the dev-bar combobox, and the ff.setGraphics hook: persists,
 * ensures the enhanced art for the current room is loaded whenever the new level
 * uses it (enhanced or ai), keeps the dev-bar select in sync, and forces a room
 * repaint so the switch shows immediately under render-on-dirty.
 */
function setGraphics(level: GraphicsLevel): void {
  graphics = level;
  localStorage.setItem('ff.graphics', graphics);
  if (enhancedArtActive() && curNum) void ensureEnhancedArt(curNum);
  if (graphics === 'ai' && curNum) {
    // Hold the frame we already have until the AI art lands, rather than repainting
    // the room in enhanced art and then popping to AI — the same rule room entry
    // follows. Switching away releases it for free: roomArtPending() reads `graphics`.
    aiPending = aiRoom === null || aiRoomNum !== curNum;
    aiPendingNum = aiPending ? curNum : 0;
    void ensureAiRoom(curNum);
  } else {
    aiPending = false;
    aiPendingNum = 0;
    aiRoom = null;
  }
  if (graphicsSelect) graphicsSelect.value = graphics;
  forceRoomRedraw = true;
  mapSig = null; // repaint the map so switching to/from the AI level shows immediately
  wake();
  setInfo();
}

// Set once if a GPU backend throws, disabling it for the session (the CPU compositor
// takes over) so a driver/context failure can never wedge rendering.
//
// One flag PER backend, because they fail independently and share nothing but the
// context. Collapsing them was wrong in both directions: the `ai` tier's ×S buffers are
// an order of magnitude larger than the faithful compositor's, so an AI-only allocation
// failure would have disabled the GPU for `classic`/`enhanced` where it was working
// fine — and conversely, an AI compositor that never built at all left this flag false,
// so the HUD reported a per-frame CPU fallback forever instead of a disabled backend.
let glFailed = false;
let glAiFailed = false;
let enhancedArt: EnhancedArt | null = null; // decoded art for the current room (null = classic)
let enhancedObjects: EnhancedObject[] = []; // decoded truecolor object sprites for the current room
let curNum = 0; // current room number, for enhanced-art lookup
// True from entering a room (in enhanced mode) until its truecolor art has
// resolved. While true, draw() holds the previous frame instead of painting the
// classic look, so a room never flashes classic before popping to enhanced.
let enhancedPending = false;
// AI room art (Phase C): the S× upscaled masters for the current room, when the ai
// level is on and every asset loaded. null ⇒ the room falls back to enhanced/classic.
let aiRoom: AiRoom | null = null;
let aiRoomNum = 0; // room number aiRoom belongs to (guards async races)
// The `ai` tier's counterpart to enhancedPending: true from entering a room (or
// switching to the tier) until that room's AI art has resolved. Without it the room
// painted as soon as the ENHANCED art landed and then visibly swapped to the AI art
// a beat later — measured at a 9-14s visible upgrade over Slow 4G.
let aiPending = false;
let aiPendingNum = 0; // room aiPending refers to (the tier can change under it)

/**
 * Whether the current room is still waiting for the art tier it will actually paint.
 *
 * Deliberately a PREDICATE over live state rather than something the room-load promise
 * awaits. That is what makes "the player switches tier mid-load" free: press E for
 * classic and enhancedArtActive() is false on the very next frame, so the hold releases
 * itself — no generation counter, no waiter set, nothing to cancel. It also leaves
 * loadRoom()'s meaning (and so waitRoom()/roomLoading()) exactly as it was.
 */
function roomArtPending(): boolean {
  if (enhancedArtActive() && enhancedPending) return true;
  return graphics === 'ai' && aiPending && aiPendingNum === curNum;
}
/**
 * jmeno -> loaded AI room (null = no AI art / failed). Keyed on the PROMISE so a second
 * request while a load is in flight joins it instead of starting a duplicate: the entry
 * used to be written only after the await, so cycling tiers with E fired up to five
 * concurrent loads of the same room (590 fetches for 71 distinct URLs).
 *
 * LRU-bounded because each room retains ~50 MB of ×4 pixels; unbounded, a full
 * playthrough held ~4 GB of decoded bitmaps that were never closed.
 */
const aiRoomCache = new Map<string, Promise<AiRoom | null>>();
const AI_ROOM_CACHE_MAX = 3; // current room + the two most recently visited
async function evictAiRooms(keep: string): Promise<void> {
  while (aiRoomCache.size > AI_ROOM_CACHE_MAX) {
    // Map iterates in insertion order, so the first key that is not the room we are
    // about to show is the least recently loaded.
    const oldest = [...aiRoomCache.keys()].find((k) => k !== keep);
    if (oldest === undefined) return;
    const pending = aiRoomCache.get(oldest)!;
    aiRoomCache.delete(oldest);
    const room = await pending.catch(() => null);
    // Never free the art the current frame is drawing from.
    if (room !== null && room !== aiRoom) room.dispose();
  }
}
interface RoomEnhanced {
  art: EnhancedArt | null;
  objects: EnhancedObject[];
}
const enhancedCache = new Map<string, RoomEnhanced>(); // jmeno -> art + objects (art null = no master)

interface ObjManifestEntry {
  item: number;
  frames: string[];
}

/**
 * The dev server serves index.html (HTTP 200) for a missing asset, so `res.ok`
 * is not enough to know a file exists — verify the content-type is an image.
 */
function isPngResponse(res: Response): boolean {
  return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
}

/**
 * Decode a PNG Response into straight RGBA using the browser's native decoder
 * (createImageBitmap + a 2D canvas) — no `node:zlib`, unlike the Node tools.
 */
async function decodePngResponse(res: Response): Promise<{ w: number; h: number; rgba: Uint8Array }> {
  const bmp = await createImageBitmap(await res.blob());
  const w = bmp.width;
  const h = bmp.height;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const g = off.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;
  bmp.close();
  return { w, h, rgba: new Uint8Array(data.buffer.slice(0)) };
}

/**
 * Load (and cache) the enhanced background masters + object sprites for a room,
 * staged under public/enhanced/<JMENO>/ (w.png, p.png, objects.json + obj/*.png).
 * A missing master or decode failure caches an empty result so the room silently
 * falls back to classic. Applies to `num` iff it is still current when resolved.
 */
async function ensureEnhancedArt(num: number): Promise<void> {
  const jmeno = ROOMS[num - 1]?.jmeno;
  if (!jmeno) {
    if (curNum === num) enhancedPending = false;
    return;
  }
  if (enhancedCache.has(jmeno)) {
    const c = enhancedCache.get(jmeno)!;
    if (curNum === num) {
      enhancedArt = c.art;
      enhancedObjects = c.objects;
      enhancedPending = false;
    }
    return;
  }
  try {
    // A fetch that actually returns a PNG (dev server SPA-fallback serves the
    // index HTML with 200 for missing files, so ok/status is not enough).
    const isPng = isPngResponse;
    const [w, p] = await Promise.all([
      fetch(`/enhanced/${jmeno}/w.png`),
      fetch(`/enhanced/${jmeno}/p.png`),
    ]);
    let art: EnhancedArt | null = null;
    if (isPng(w) && isPng(p)) {
      const [wall0, bg0] = await Promise.all([decodePngResponse(w), decodePngResponse(p)]);
      if (wall0.w === bg0.w && wall0.h === bg0.h) {
        // Additional animation frames (STEEL red-alert): w1.png/p1.png, w2.png/p2.png…
        const walls = [wall0.rgba];
        const bgs = [bg0.rgba];
        for (let f = 1; ; f++) {
          const [wf, pf] = await Promise.all([
            fetch(`/enhanced/${jmeno}/w${f}.png`),
            fetch(`/enhanced/${jmeno}/p${f}.png`),
          ]);
          if (!isPng(wf) || !isPng(pf)) break;
          const [wd, pd] = await Promise.all([decodePngResponse(wf), decodePngResponse(pf)]);
          if (wd.w !== wall0.w || wd.h !== wall0.h || pd.w !== wall0.w || pd.h !== wall0.h) break;
          walls.push(wd.rgba);
          bgs.push(pd.rgba);
        }
        art = { w: wall0.w, h: wall0.h, wall: walls, bg: bgs };
      }
    }
    const objects = await loadEnhancedObjects(jmeno);
    const result: RoomEnhanced = { art, objects };
    enhancedCache.set(jmeno, result);
    if (curNum === num) {
      enhancedArt = art;
      enhancedObjects = objects;
      enhancedPending = false;
    }
  } catch {
    enhancedCache.set(jmeno, { art: null, objects: [] });
    if (curNum === num) {
      enhancedArt = null;
      enhancedObjects = [];
      enhancedPending = false;
    }
  }
}

/** Decode a room's enhanced object sprites from its objects.json manifest. */
async function loadEnhancedObjects(jmeno: string): Promise<EnhancedObject[]> {
  const res = await fetch(`/enhanced/${jmeno}/objects.json`);
  // The dev server serves index.html (200) for a missing manifest, so verify it
  // is actually JSON before parsing.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
  const manifest = (await res.json()) as { objects?: ObjManifestEntry[] };
  const entries = manifest.objects ?? [];
  // One entry at a time was a per-object round trip: with the AI loads parallelised
  // this waterfall became the thing the first frame waits on (2.2s at a 150ms RTT
  // against 1.2s for the whole AI set). The sprites are independent, so fetch them
  // all at once and let the browser schedule.
  const loaded = await Promise.all(
    entries.map(async (e): Promise<EnhancedObject | null> => {
      if (typeof e.item !== 'number' || !Array.isArray(e.frames)) return null;
      const frames = await Promise.all(
        e.frames.map(async (f) =>
          withLoadSlot(async () => {
            const r = await fetch(`/enhanced/${jmeno}/obj/${f}`);
            if (!isPngResponse(r)) return null;
            const d = await decodePngResponse(r);
            return { w: d.w, h: d.h, rgba: d.rgba };
          }),
        ),
      );
      const valid = frames.filter((f): f is { w: number; h: number; rgba: Uint8Array } => f !== null);
      return valid.length > 0 ? { item: e.item, frames: valid } : null;
    }),
  );
  return loaded.filter((o): o is EnhancedObject => o !== null);
}

/** Load the hi-res panel art once (see panelAi.ts); null ⇒ keep the faithful path. */
async function ensureAiPanel(): Promise<void> {
  aiPanel = await loadAiPanel('/');
  if (aiPanel) panelSig = null;   // force a repaint at the new resolution
}

/**
 * Load the hi-res world-map art once, on first use in the `ai` tier.
 *
 * Deliberately lazy, unlike the eager call this replaced: that one ran at boot in EVERY
 * tier, so a player on `classic` (the default) still downloaded 2.54 MB of *_ai art and
 * retained ~43 MB of decoded bitmaps plus two 2560×1920 canvases, concurrently with the
 * intro's own media. It self-cancels to null on any missing/undecodable asset, so the
 * `ai` level cleanly falls back to the faithful CPU composite.
 */
let aiMapTried = false;
async function ensureAiWorldMap(): Promise<void> {
  if (!worldMap) return;
  aiWorldMap = await loadAiWorldMap('/data/', worldMap);
  mapSig = null; // force a repaint so the map switches to the AI art once ready
}

/** Load the hi-res credits art once (see creditsAi.ts). */
async function ensureAiCredits(): Promise<void> {
  aiCredits = await loadAiCredits('/');
  // The pointer handlers live on #screen, which this path hides (display:none) while
  // its own overlay is up — a hidden element gets no pointer events, so "click anywhere
  // to dismiss" silently stopped working in the ai tier while the keyboard still did.
  // Bind on the overlay itself; listeners survive detach/re-attach, so bind once here.
  aiCredits?.el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || mapOverlay !== 'credits') return;
    e.preventDefault();
    closeMapOverlay();
  });
}

/**
 * Load (and cache) the AI-upscaled art for a room (public/enhanced-ai/<JMENO>/), for the
 * `ai` graphics level. A missing set caches null so the room falls back to the enhanced
 * render. Applies to `num` iff it is still the current room when the load resolves.
 */
async function ensureAiRoom(num: number): Promise<void> {
  const jmeno = ROOMS[num - 1]?.jmeno;
  if (!jmeno) {
    clearAiPending(num);
    return;
  }
  let pending = aiRoomCache.get(jmeno);
  if (pending === undefined) {
    pending = loadAiRoom('/', jmeno);
    // Registered BEFORE the first await so a concurrent caller joins this load rather
    // than starting its own. Don't cache a rejection — loadAiRoom resolves null on
    // failure, but a throw would otherwise poison the room for the session.
    pending.catch(() => aiRoomCache.delete(jmeno));
    aiRoomCache.set(jmeno, pending);
  }
  try {
    const loaded = await pending;
    if (curNum === num) { aiRoom = loaded; aiRoomNum = num; }
  } finally {
    // In a finally: a room whose AI art is missing or fails to decode must release
    // the hold too (it falls back to the enhanced render), or it would never paint.
    clearAiPending(num);
  }
  // AFTER the hold is released, and not awaited: evictAiRooms awaits an older room's
  // (possibly still in-flight) load before disposing it, so with AI_ROOM_CACHE_MAX = 3
  // awaiting it here made room D's first frame wait on room A's download finishing.
  // Nothing visible depends on the eviction.
  void evictAiRooms(jmeno).catch(() => { /* a room we could not dispose is not fatal */ });
}

/** Release the `ai` tier's art hold for `num`, and present the frame it was holding. */
function clearAiPending(num: number): void {
  if (aiPendingNum !== num) return;
  aiPending = false;
  aiPendingNum = 0;
  forceRoomRedraw = true;
  wake();
}

/**
 * Whether the current frame should render through the hi-res AI room compositor:
 * the ai level is on and the room's AI art loaded.
 *
 * The compositor now covers everything the faithful path draws from index
 * read-back except the ZX render: the spec=1 mirror (drawMirror), the spec=3/4
 * elevator double rope (drawRope), the gspec=5 bonus fish swap and the gspec=2
 * darkness fill + lit-item filter. gspec=3/4 (the KAJUTA1 screen shove) needs
 * nothing here at all — the shove is a CSS transform on the canvas, applied
 * outside the compositor — and gspec=9 is only a win condition.
 *
 * Still excluded: gspec=42, the ZX-Spectrum band render (its per-scanline bands
 * are an index effect, and the low-fi look is the point), any frame with an active
 * fishing hook, which the faithful path draws on top from the palette, any frame
 * with a CPU-only frame effect running (frameEffectsActive), any frame with a
 * sprite cheat active, and any frame whose subtitle must be baked in because no
 * subtitle font loaded. LODE's falling wreck used to be here too; AiRoom.syncWreck
 * now replays its destructive swaps into a mutable ×S background, so the room no
 * longer drops to native resolution mid-fall.
 */
function aiRoomRenderActive(r: Room): boolean {
  if (graphics !== 'ai' || aiRoom === null || aiRoomNum !== curNum) return false;
  // The rest of the rule lives in roomAi.ts so there is ONE definition tests can import
  // — the hand-copied duplicate in test/roomAi.test.ts had already drifted out of date.
  return aiRoomGateAllows({
    gspec: r.gspec,
    hookStates: hooks.snapshot.map((h) => h.stav),
    frameEffects: frameEffectsActive(),
    spriteCheatsActive: spriteCheats.length > 0,
    // Mirrors useVecSubs (drawRoom): in this tier enhancedArtActive() is always true, so
    // the vector overlay is available iff a subtitle font loaded.
    bakedSubsNeeded: (subs?.active ?? false) && !subFontReady,
  });
}

// Enhanced fish sprites are shared across all rooms, so they load once.
let fishSprites: FishSprites | null = null;
async function loadFishSprites(): Promise<void> {
  try {
    const res = await fetch('/enhanced/_fish/manifest.json');
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
    const m = (await res.json()) as Record<'small' | 'big', Record<'left' | 'right', string[]>>;
    const build = async (size: 'small' | 'big', facing: 'left' | 'right') => {
      const map = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
      await Promise.all(
        (m[size]?.[facing] ?? []).map(async (f) => {
          const r = await fetch(`/enhanced/_fish/${size}/${facing}/${f}`);
          if (!isPngResponse(r)) return;
          const d = await decodePngResponse(r);
          map.set(f, { w: d.w, h: d.h, rgba: d.rgba });
        }),
      );
      return map;
    };
    fishSprites = {
      small: { left: await build('small', 'left'), right: await build('small', 'right') },
      big: { left: await build('big', 'left'), right: await build('big', 'right') },
    };
    applySpriteCheats(); // a sprite cheat typed before the art landed still applies
  } catch {
    fishSprites = null;
  }
}
void loadFishSprites();
const talkIdx = { little: 0, big: 0 };
const audio = new AudioEngine();
applyVolumeSettings(); // restore persisted volume levels before any sound plays
const prevKostra = { little: false, big: false };
// posl_mluv (URoom.pas:264): current talking mouth frame per fish (-1 = not talking,
// else 0..2 indexing hl_mluvi / tl_mluvi_na). Voice-priorities: little=mluvi_mala=1,
// big=mluvi_velka=2 (URoom.pas:435-436).
const poslMluv: { little: number; big: number } = { little: -1, big: -1 };
const MLUVI_PRIOR = { little: 1, big: 2 } as const;
let activeScript: { def: RoomScript; s: Script } | null = null;
let chatter: ChatterState | null = null; // StdKecej ambient-chatter timer for the current room
let deathState: DeathState | null = null; // StdSmrt death-commentary state for the current room
let roomDepth = 0; // the current room's Hloubka (Depth), for death-line selection
/** A no-op room script for rooms without ported Programky (the dialog scheduler still runs). */
const NOOP_SCRIPT: RoomScript = { name: '', init: () => {}, prog: () => {} };
let pokus = 1; // attempt number, incremented on death-restart
let cutscene: KufrDemo | null = null;
let cutsceneSubs: SubtitleSystem | null = null;
let cutsceneAssets: { bmp: Uint8Array; pck: Uint8Array; script: string } | null = null;
let count = 0;
// The shared step-engine drives all deterministic move/tick/win logic (created per
// room build in buildRoom). Its fields (phase, animFrame, active, exiting, swim,
// corkExit, winCountdown, srecord, …) are the authoritative game state that the
// renderer, panel and input read — the same engine the headless solutions harness runs.
let engine: StepEngine | null = null;
let alpha = 0; // sub-tick interpolation fraction (0..1) for smooth rendering
let linesSpoken = 0; // debug: total dialogue lines fired
let lastLine: { name: string; count: number } | null = null;
// showmode (KUFRIK automatic demonstration, URoom.pas:19932/26971): the recorded
// help.cap input stream auto-plays — the fish move themselves and the tutorial
// subtitles appear. One recorded action is consumed per logic tick; player input is
// blocked (except restart/exit, which end it). `showmodeLoading` covers the async
// fetch of help.cap; `showmodeHelptext` is the tutorial-subtitle counter (helptext).
let showmode: { actions: CapAction[]; idx: number } | null = null;
let showmodeLoading = false;
let showmodeHelptext = 0;
// Guards a recorded restart RUN (the ~12 consecutive akce_restart entries the demo's
// death-restart produces) so the room is rebuilt only once per run.
let showmodeRestarted = false;
// The demo's own save slot (akce_save/akce_load, URoom.pas:24480). The demonstration
// saves a checkpoint (help7: "we can load a saved position with F3") and reloads it
// after each death — kept in memory so it never touches the player's real save.
let showmodeSave: { rec: string; snapshot: ScriptSnapshot | null } | null = null;
// Fast-forward load animation (TRoom.Load loadmode, URoom.pas:24102): a load replays
// the saved move record over several ticks at LoadSpeed moves/tick (a visible rewind-
// and-replay), rather than teleporting. Drives both player F3 and the demo's reload.
let loadmode: {
  moves: { which: 'little' | 'big'; dir: number }[];
  idx: number;
  speed: number;
  snapshot: ScriptSnapshot | null;
} | null = null;
// Debug replay trace (opt-in via __ff.showmodeTraceOn).
let showmodeTraceOn = false;
const showmodeTrace: Array<Record<string, number | boolean | string>> = [];
// Map "Replay" playback (daReplay, UMain.pas:1023): the room's best solution is
// re-played move-by-move as a real swim animation (one move per idle tick), then
// the normal win path returns to the map. Distinct from loadmode (teleport-fast
// F3 load) and showmode (the KUFRIK demo's recorded-action format).
let replaymode: { moves: { which: 'little' | 'big'; dir: number }[]; idx: number } | null = null;
// KAJUTA1 gspec=3/4 "screen-shove" easter egg: the big fish pushing a wall slides the
// whole view (the original moves the OS window Left±5; the port shifts the canvas). In
// display px, reset per room, clamped so the gag stays on-screen.
let screenShoveX = 0;
/** Hacky (URoom.pas:23749): the "xfisher" easter-egg fishing hooks (kills a fish). */
const hooks = new HookSystem({
  killByHook(which: 'little' | 'big') {
    if (!room) return;
    room.alive[which] = false; // zije := false
    room.kostra[which] = false; // NOT a skeleton — the fish is yanked away
    room.clearAllDirs();
    if (room.padani() && engine) {
      // gstav := stav_ma_padat: whatever the fish held now falls.
      engine.phase = 'fall';
      engine.animFrame = 0;
    }
  },
});
const blink = { little: 0, big: 0 };
// gspec=2 darkness flicker (KresliRybu, URoom.pas:25747): each tick a fish has a
// ~6% chance to wink out (random(100)<6). Kept tick-stable like `blink`.
const darkFlicker = { little: false, big: false };

const KEYS: Record<string, { which: 'little' | 'big'; dir: number }> = {
  KeyI: { which: 'little', dir: Dir.up },
  KeyK: { which: 'little', dir: Dir.down },
  KeyJ: { which: 'little', dir: Dir.left },
  KeyL: { which: 'little', dir: Dir.right },
  KeyW: { which: 'big', dir: Dir.up },
  KeyS: { which: 'big', dir: Dir.down },
  KeyA: { which: 'big', dir: Dir.left },
  KeyD: { which: 'big', dir: Dir.right },
};

/** The minigame's key map (Ttr.pas:458: 37/100 left, 39/102 right, 12/40/98/101
 *  rotate, 32/45/96 slam). Down rotates; there is no soft drop. */
const TETRIS_KEYS: Record<string, TetrisKey> = {
  ArrowLeft: 'left',
  Numpad4: 'left',
  ArrowRight: 'right',
  Numpad6: 'right',
  ArrowDown: 'rotate',
  Numpad2: 'rotate',
  Numpad5: 'rotate',
  Space: 'drop',
  Insert: 'drop',
  Numpad0: 'drop',
};

/** Arrow keys move the *active* fish (ZaznamenejPrikazKlavesou #37..#40, kdo:=sys). */
const ARROWS: Record<string, number> = {
  ArrowLeft: Dir.left,
  ArrowUp: Dir.up,
  ArrowRight: Dir.right,
  ArrowDown: Dir.down,
};

/** stav_kuk trigger: the newly-active fish peeks at the player after a switch/select,
 *  unless we're replaying the demo (showmode) or fast-loading — the original suppresses
 *  it during `capturemode or showmode` (URoom.pas:24459/24712). */
function peekAtPlayer(which: 'little' | 'big'): void {
  if (!engine || inShowmode() || loadmode) return;
  engine.startKuk(which);
}

/** akce_switch (URoom.pas:24456): make the other fish active, only if it is alive. */
function swapActive(): void {
  if (!room || !engine || screen !== 'room') return;
  const other = engine.active === 'little' ? 'big' : 'little';
  if (!room.alive[other]) return;
  engine.active = other;
  engine.swim = null;
  peekAtPlayer(other);
  setInfo();
}

/** akce_set (URoom.pas:24708): select a fish as active, if it is alive. */
function selectFish(which: 'little' | 'big'): void {
  if (!room || !engine || screen !== 'room' || !room.alive[which]) return;
  if (fishBusy(which)) return; // DalsiPrikaz: akce_set (kdo=mala/velka) dropped while that fish busy
  engine.active = which;
  engine.swim = null;
  peekAtPlayer(which);
  setInfo();
}

const ffrUrl = (num: number): string => `/data/Graphic/${String(num).padStart(3, '0')}.ffr`;

function setInfo(): void {
  const d = ffr ? ROOMS[Number(select.value) - 1] : undefined;
  const base = d && ffr ? `${d.jmeno} — ${d.en} — ${ffr.width}x${ffr.height}, ${ffr.itemCount} items` : '';
  const roomNum = Number(select.value);
  const best = scores.get(roomNum);
  info.textContent = room?.won
    ? `${base}   ✓ SOLVED in ${lengthOfRecord(engine?.srecord ?? '')} moves${best !== undefined ? ` (best ${best})` : ''} — returning to the map…`
    : room?.anyFishDead
      ? `${base}   ✗ crushed — restarting…`
      : `${base}  · active: ${engine?.active ?? 'little'} · moves: ${lengthOfRecord(engine?.srecord ?? '')} · ⌫ restart · F2 save${saveExists() ? ' · F3 load' : ''} · subs: ${settings.subtitles.toUpperCase()} (G)`;
}

/** Apply a vector-subtitle font candidate by index (wraps) and persist it. */
function applySubFont(i: number): void {
  const n = SUB_FONT_CANDIDATES.length;
  subFontIdx = ((i % n) + n) % n;
  const c = SUB_FONT_CANDIDATES[subFontIdx]!;
  subFontFamily = c.family;
  subFontWeight = c.weight;
  localStorage.setItem('ff.subfont', c.name);
  setInfo();
}

/**
 * Font previewer: advance to the next (or previous) candidate and drop a sample
 * subtitle so the new face is immediately visible. Vector subtitles only render
 * in enhanced mode, so the preview line shows there; a Czech pangram exercises
 * the diacritics the real subtitles use.
 */
function previewSubFont(next = true): void {
  applySubFont(subFontIdx + (next ? 1 : -1));
  // Preview into whichever subtitle system is on screen: the cutscene's while the
  // briefcase demo plays (so the sample is visible and doesn't leak a stray line
  // into the room's queue), the room's otherwise.
  const sys = cutscene ? cutsceneSubs : subs;
  sys?.newSubtitle('Příliš žluťoučký kůň úpěl ďábelské ódy. 0123', 'A', count);
}

function buildRoom(carryPole = false): void {
  if (!ffr) return;
  clearHeldKey(); // a room change/restart drops any held movement key
  // roompole persists across a RESTART (TRoom.Restart doesn't clear it) but is zeroed
  // on a room CHANGE (cleared in TRoom.Init, URoom.pas:1432). Capture it before the new
  // Script replaces the old one so restart-latch dialogue (ZAVAL/GRAL/bludiste/koste/…)
  // survives the attempt, matching the original.
  const savedPole = carryPole && activeScript ? [...activeScript.s.roompole] : null;
  // A RESTART silences every effect/voice/loop but keeps the room's own -999 music
  // (TRoom.Restart → KillExcept(-999), URoom.pas:1600). Only the restart path needs
  // this: a room CHANGE already killed all audio when leaving the previous room. This
  // is what makes VES fall silent on restart until the head strikes up the band again.
  if (carryPole) audio.killVoices();
  room = new Room(ffr);
  loadmode = null; // cancel any in-flight load fast-forward on a room build
  // NOTE: `showmode` is deliberately NOT cleared here. A death-restart during the
  // KUFRIK demonstration (both fish die — the demo shows "what you shouldn't do")
  // must keep the demo running, exactly as the original: DalsiPrikaz auto-restarts
  // on CountDown=0 without clearing showmode (URoom.pas:26911-26920). The room-change
  // and player-restart paths call endShowmode() explicitly instead.
  hooks.clear(); // nhacku := 0 (URoom.pas:1502)
  // ultraviolence (URoom.pas:1503): once the code is typed on the map, every room
  // opens with a hook already descending.
  if (ultraviolence) hooks.add(room);
  // The room-scoped cheats die with the room, exactly as in the original — a fresh
  // TRoom.Create reloads the sprites and resets silentfilm/interlacedfaze
  // (URoom.pas:1430-1431). The new Room already carries pristine sprites and water.
  // The room-scoped cheats survive a RESTART but die on a room CHANGE — exactly
  // like roompole above, because TRoom.Init clears them in the very same block
  // (URoom.pas:1430-1433), while TRoom.Restart leaves them alone.
  if (!carryPole) {
    spriteCheats = [];
    oldWater = null;
    endSilentFilm(); // TRoom.Done also restores the volumes on the way out
    interlacedFaze = INTERLACED_OFF;
    roomCheats.reset();
  }
  // Re-apply whatever survived (a restart), onto the freshly built Room.
  applySpriteCheats();
  if (oldWater) {
    room.wamp = 10;
    room.wspd = 4;
    room.wper = 6;
  }
  screenShoveX = 0; // reset the KAJUTA1 screen-shove offset
  count = 0;
  const wall = room.bitmaps[room.wallItem.bmp];
  subs = font && wall ? new SubtitleSystem(font, ffr.palette, ffr.width, wall.w, wall.h) : null;
  if (subs) subs.silentFilm = silentFilm; // a restart keeps silent-film mode running
  talkIdx.little = 0;
  talkIdx.big = 0;
  poslMluv.little = -1;
  poslMluv.big = -1;
  prevKostra.little = false;
  prevKostra.big = false;
  // Room script (Programky/InitProgramky), if this room has been ported. A Script
  // always exists (even for unported rooms) so the dialog scheduler + ambient
  // idle chatter (StdKecej) run in every room.
  const name = ROOMS[Number(select.value) - 1]?.jmeno ?? '';
  const def = roomScript(name);
  // The room's own looping-music descriptor (MusName/MusCycle) — used both to set
  // s.musName and to re-cue the music when a room calls musiccyc(MusName, -999).
  const roomMusic = musicForCHud(ROOMS[Number(select.value) - 1]?.cHud ?? -1);
  if (room) {
    const s = new Script(
      room,
      scriptTalk,
      (prior) => audio.playing(prior),
      {
        snd: (name, prior) => audio.snd(name, prior, false, EFFECT_VOL),
        sndcyc: (name, prior) => audio.snd(name, prior, true, EFFECT_VOL),
        sndvol: (name, prior, vol) => audio.snd(name, prior, false, Math.max(0, Math.min(1, vol / 64))),
        ksnd: (prior) => audio.killVoice(prior),
        music: (name, prior) => audio.musicSnd(name, prior, `/data/Music/${name}.wav`),
        musiccyc: (name, prior) => {
          // prior -999 = the room-music channel: re-cue the room's own track
          // (MusicCycle(MusName,-999,MusCycle)) rather than a separate effect source.
          if (prior === MUSIC_PRIOR) {
            if (roomMusic) {
              void audio.playMusic(roomMusic.name, `/data/Music/${roomMusic.name}.wav`, roomMusic.loopSample);
            }
          } else {
            audio.musicSnd(name, prior, `/data/Music/${name}.wav`, 0.45, true);
          }
        },
        talkNow: (name, prior) => scriptTalk(name, prior),
        voicesReady: () => roomVoicesSettled,
      },
      (prior) => audio.talking(prior),
    );
    s.pokus = pokus;
    s.musicVolume = musicLevel();
    if (savedPole) for (let i = 0; i < s.roompole.length; i++) s.roompole[i] = savedPole[i] ?? 0;
    s.musName = roomMusic?.name ?? '';
    s.onKufrDemo = () => void startCutscene();
    s.onShowmode = () => startShowmode();
    // The shared step-engine: all move/tick/win logic runs here, with side effects
    // (sound, the KAJUTA1 wall-shove, win bookkeeping, map return) injected as hooks.
    engine = new StepEngine(room, s, def ?? NOOP_SCRIPT, {
      random: (n) => Math.floor(Math.random() * n),
      onLanding: (kind) =>
        audio.playRandom(kind === 1 ? ['sp-zuch1', 'sp-zuch2'] : ['sp-ocel1', 'sp-ocel2'], EFFECT_VOL),
      // Exit cheer (jo-m/jo-v): play it as a proper voice line on the exiting fish's
      // mluvi channel — tracked (so the win auto-return can wait for `talking()` to end),
      // lip-synced, and subtitled — matching the original's talk(...,mluvi_mala/velka)
      // (URoom.pas:24393-24410). Without a fish, fall back to a plain effect play.
      playSound: (name, which) => (which ? void scriptTalk(name, MLUVI_PRIOR[which]) : audio.play(name)),
      onBlockedMove: (which, dir) => wallShove(which, dir),
      onWin: (countdown) => onWinBookkeeping(countdown),
      onReturnToMap: () => returnFromRoom(),
    });
    s.onWin = () => engine!.triggerWin(); // SCORE etc.: puzzle-solve win
    def?.init(s);
    // Snapshot each item's static spec (post-init) so the enhanced art source can
    // tell a statically-mirrored item (spec=10 set in init → FFNG art pre-mirrored)
    // from one whose spec toggles to 10 at runtime (FFNG art base, needs mirroring).
    for (let j = 1; j <= room.itemCount; j++) {
      const it = room.items[j];
      if (it) it.initSpec = it.spec;
    }
    // Keep an in-flight KUFRIK demonstration alive across a death-restart (the new
    // Script reset s.showmode to false; the persistent replay state survived).
    if (showmode) s.showmode = true;
    activeScript = { def: def ?? NOOP_SCRIPT, s };
  } else {
    activeScript = null;
    engine = null;
  }
  // Settle gravity at load; if anything falls, animate it (phase 'fall') so the room
  // script can observe the fall (e.g. KUFRIK's briefcase dropping in).
  if (engine) {
    if (room.padani()) engine.phase = 'fall';
    else {
      room.clearAllDirs();
      engine.phase = 'idle';
    }
  }
  chatter = activeScript ? newChatter(activeScript.s, 1000 / LOGIC_MS) : null;
  deathState = newDeathState();
  roomDepth = depthOfRoom(Number(select.value));
  setInfo();
}

/** dialogy's talk hook: show the subtitle + play the voice, return its length in game ticks. */
function scriptTalk(name: string, prior: number): number {
  // A best-solution replay plays silently, like the original's loadmode replay
  // (loadtype=nej): Programky/Zvuky_okoli are skipped so no scripted dialogue or
  // voices sound (UMain.pas:1027, URoom.pas:24937). The dialog scheduler still runs
  // (so the sim stays identical) but the line is neither shown, voiced, nor counted.
  if (inReplay()) {
    const dur = audio.duration(name);
    return dur > 0 ? Math.max(1, Math.round((dur - TALKING_MEZ_SEC) / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
  }
  const entry =
    fftEntries.find((e) => e.name === name) ??
    chatFft.find((e) => e.name === name) ??
    deathFft.find((e) => e.name === name);
  if (entry && subs && subsOn()) {
    const t = subLang() === 'cz' ? entry.cz : entry.en;
    // globtit (Talk, URoom.pas:654): substitute a '@' placeholder with the room's
    // current globtit fragment (LODE uses it to inject the announced "A5" coordinate).
    const text =
      t.text.includes('@') && activeScript ? t.text.replace('@', activeScript.s.globtit) : t.text;
    if (text) subs.newSubtitle(text, t.color, count);
  }
  audio.play(name, 1, prior, 'voice');
  lastLine = { name, count }; // debug: track dialogue line firing
  linesSpoken++;
  const dur = audio.duration(name);
  // Talking() lead (RSound mez): count the line as "sounding" until ~0.4535s before
  // the sample truly ends, so the mouth stops (and the queue advances) a beat early
  // rather than flapping through the sample's trailing tail (matches the original).
  return dur > 0 ? Math.max(1, Math.round((dur - TALKING_MEZ_SEC) / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
}

/** Launch the briefcase story cutscene (InitKufrDemo), loading its assets once. */
async function startCutscene(): Promise<void> {
  if (cutscene || !font) return;
  // The demo is narration over pictures, and every caption's length comes from its
  // voice sample (cutsceneCaption -> audio.duration). Starting it before the room's
  // voice package has landed would run the whole story at the flat DEFAULT_LINE_TICKS
  // fallback — silent, and several times too fast to read.
  await roomVoicesReady;
  if (cutscene || !font || screen !== 'room') return;
  clearHeldKey(); // the briefcase cutscene takes over
  if (!cutsceneAssets) {
    const [bmp, pck, scr] = await Promise.all([
      fetch('/data/Intro/kufr256.BMP').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/demo.pck').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/script.txt').then((r) => r.text()),
    ]);
    cutsceneAssets = { bmp: new Uint8Array(bmp), pck: new Uint8Array(pck), script: scr };
  }
  const demo = new KufrDemo(cutsceneAssets.bmp, cutsceneAssets.pck, cutsceneAssets.script);
  cutsceneSubs = new SubtitleSystem(font, demo.palette, Math.floor(demo.width / 15), demo.width, demo.height);
  subs?.clear(); // ZrusTitulky (InitKufrDemo): clear the room's on-screen subtitle
  // Music (InitKufrDemo, URoom.pas:2867): start the looping 'kufrik' track with the
  // demo. The original loops at cycle 78660*2 *bytes*; playMusic wants the loop
  // point in *samples* (bytes/2 for 16-bit audio), i.e. 78660. It persists after
  // the demo — DoneKufrDemo never stops it — so it keeps playing in the room.
  void audio.playMusic('kufrik', '/data/Music/kufrik.wav', 78660);
  cutscene = demo;
}

/**
 * Start the KUFRIK automatic demonstration (showmode, URoom.pas:19923). The room's
 * prog fires this once both fish reach the demo spot: help.cap (a recorded input
 * stream) is fetched and then replayed one action per tick, auto-driving the fish
 * and the tutorial subtitles. The big fish is turned to face left first
 * (natoceni[velka]:=smer_vlevo). s.showmode is set immediately so KUFRIK's normal
 * dialogue and the re-trigger both stop while help.cap loads asynchronously.
 */
function startShowmode(): void {
  if (showmode || showmodeLoading || !room) return;
  clearHeldKey(); // the demo takes over — drop any held movement key
  showmodeLoading = true;
  showmodeHelptext = 0;
  showmodeRestarted = false;
  showmodeSave = null;
  if (activeScript) activeScript.s.showmode = true;
  room.facingRight.big = false; // natoceni[velka] := smer_vlevo
  if (engine) engine.swim = null;
  void (async () => {
    try {
      const res = await fetch('/data/Intro/help.cap');
      if (!res.ok) {
        endShowmode();
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      // The demo may have been cancelled (room change/restart) while fetching.
      if (!showmodeLoading) return;
      showmode = { actions: parseHelpCap(buf), idx: 0 };
    } catch {
      endShowmode();
    } finally {
      showmodeLoading = false;
    }
  })();
}

/** End the demonstration (EOF, or the recording's/player's restart/exit). */
function endShowmode(): void {
  showmode = null;
  showmodeLoading = false;
  showmodeRestarted = false;
  showmodeSave = null;
  loadmode = null;
  replaymode = null; // a room change / exit also ends a best-solution replay
  if (engine) engine.swim = null;
  if (activeScript) activeScript.s.showmode = false;
}

/** True while the KUFRIK demo is playing or its recording is still loading. */
function inShowmode(): boolean {
  return showmode !== null || showmodeLoading;
}

/** True while a map "Replay" (best-solution playback) is running — blocks player input. */
function inReplay(): boolean {
  return replaymode !== null;
}

/**
 * Play back one move of the room's best solution per idle tick (daReplay, the
 * animated LoadSpeed:=1 replay, URoom.pas:1932). Each move drives the real swim
 * animation via tryStep; on the last move the normal win → winCountdown → showMap
 * path returns to the map. A death aborts back to the map.
 */
function advanceReplay(): void {
  if (!replaymode || !room || !engine) return;
  if (room.anyFishDead) {
    // The best solution shouldn't kill a fish, but abort safely to the map if it does.
    replaymode = null;
    showMap();
    return;
  }
  if (replaymode.idx >= replaymode.moves.length) {
    replaymode = null; // ran dry without a win (defensive) — hand control back
    return;
  }
  const m = replaymode.moves[replaymode.idx++]!;
  engine.active = m.which;
  tryStep(m.which, m.dir);
  hracNespi();
}

/**
 * Consume one recorded action per tick (DalsiPrikaz replay, URoom.pas:26971). At
 * end-of-file the demo ends and control returns to the player.
 */
function advanceShowmode(): void {
  if (!showmode || !room) return;
  if (showmode.idx >= showmode.actions.length) {
    endShowmode();
    return;
  }
  const at = showmode.idx;
  const a = showmode.actions[showmode.idx++]!;
  applyCapAction(a);
  hracNespi(); // DalsiPrikaz calls hrac_nespi after each replayed action (URoom.pas:26985)
  // Debug trace (enabled via __ff.showmodeTraceOn): one row per consumed action, with
  // the resulting fish cells / phase / alive, so a headless run can be replayed and
  // diffed against the recording to pinpoint where the demo diverges.
  if (showmodeTraceOn && room) {
    const l = room.items[room.littleIdx];
    const b = room.items[room.bigIdx];
    showmodeTrace.push({
      i: at,
      kdo: a.kdo,
      akce: a.akce,
      x: a.x,
      y: a.y,
      ht: showmodeHelptext,
      lx: l?.x ?? -1,
      ly: l?.y ?? -1,
      bx: b?.x ?? -1,
      by: b?.y ?? -1,
      aliveL: room.alive.little,
      aliveB: room.alive.big,
      act: engine?.active ?? 'little',
      phase: engine?.phase ?? 'idle',
    });
    if (showmodeTrace.length > 4000) showmodeTrace.shift();
  }
}

/**
 * Dispatch one recorded action (URoom.pas:24438-24501), consumed on an idle step.
 *
 * The recording encodes the demo's deliberate death-restart as a run of `akce_restart`
 * (kdo=0) entries — the engine's countdown auto-restart (countdown:=70 on both fish
 * dead, then akce_restart at 0; URoom.pas:24337/26911). We drive the restart straight
 * from the recording: on the first restart entry of a run we rebuild the room (fish
 * back to spawn, showmode preserved), which also re-syncs the fish to the recorded
 * positions and corrects any accumulated path drift. The rest of the run is a no-op.
 *
 * A system-issued directional move applies to the active fish (24440). `go` walks one
 * cell toward the recorded target (najdi_smer, re-issued each idle step by the
 * recording); `helptext` advances the tutorial subtitle. Recorded save/load/help/
 * natvrdo are ignored during replay.
 */
function applyCapAction(a: CapAction): void {
  if (!room || !engine) return;
  // Recorded restart run: rebuild the room once (the demo's death-restart).
  if (a.akce === AKCE.restart) {
    if (!showmodeRestarted) {
      showmodeRestarted = true;
      buildRoom(true); // showmode + replay position are preserved across the rebuild
    }
    return;
  }
  showmodeRestarted = false; // a non-restart action ends the restart run
  // Recorded save / load (akce_save=20, akce_load=10, URoom.pas:24480): the demo saves
  // a checkpoint and reloads it after each death (help7). Only the system-issued copy
  // acts; the stale kdo=0 duplicates fall through to the no-op return below.
  if (a.kdo === KDO.sys && a.akce === AKCE.save) {
    if (room.alive.little && room.alive.big) {
      showmodeSave = { rec: engine.srecord, snapshot: activeScript?.s.snapshot() ?? null };
    }
    return;
  }
  if (a.kdo === KDO.sys && a.akce === AKCE.load) {
    if (showmodeSave) restore(showmodeSave.rec, showmodeSave.snapshot, true, true); // preserve showmode, animated
    return;
  }
  let kdo = a.kdo;
  if (kdo === KDO.none) return;
  if (kdo === KDO.sys && a.akce >= AKCE.up && a.akce <= AKCE.right) {
    kdo = engine.active === 'little' ? KDO.little : KDO.big; // sys move -> active fish
  }
  const which: 'little' | 'big' | null =
    kdo === KDO.little ? 'little' : kdo === KDO.big ? 'big' : null;
  switch (a.akce) {
    case AKCE.up:
    case AKCE.down:
    case AKCE.left:
    case AKCE.right:
      if (which) {
        engine.active = which;
        tryStep(which, a.akce); // Dir values equal akce 1-4
      }
      break;
    case AKCE.set: // akce_set: select the fish
      if (which) selectFish(which);
      break;
    case AKCE.switch: // akce_switch (no stav_kuk animation during showmode)
      swapActive();
      break;
    case AKCE.go: // akce_go: step one cell toward the recorded target (najdi_smer)
      if (which) {
        engine.active = which;
        const dir = room.findDir(which, a.x, a.y);
        if (dir !== Dir.no) tryStep(which, dir);
      }
      break;
    case AKCE.helptext:
      showHelpText();
      break;
    case AKCE.exit:
      endShowmode();
      break;
    default:
      break; // load/save/help/natvrdo: ignored
  }
}

/**
 * Tutorial subtitle (akce_helptext, URoom.pas:24495): show the next help line.
 * A fixed set of indices are spoken by the big fish (addv), the rest by the small
 * fish (addm). help1..help23 live in KUFRIK's caption bank.
 */
function showHelpText(): void {
  showmodeHelptext++;
  const n = showmodeHelptext;
  const bigVoiced = n === 2 || n === 4 || n === 7 || n === 8 || n === 11 || n === 14 || n === 20 || n === 22;
  if (!activeScript) return;
  if (bigVoiced) activeScript.s.addv(0, 'help' + n);
  else activeScript.s.addm(0, 'help' + n);
}

/**
 * Skip the briefcase demo (zrus_kufr, URoom.pas:2965): end it early and stop the
 * KD narration (KSnd(-1)). The 'kufrik' music keeps playing — only the demo ends.
 */
function skipCutscene(): void {
  if (!cutscene) return;
  cutscene = null;
  cutsceneSubs = null;
  disposeAiKufr(); // release the upscaled frames (~37 MB at x4) on an early skip
  audio.killVoices(); // KSnd(-1): drop the narration; music (playMusic) is untouched
}

/** A KD-* narration caption during the cutscene; returns its length in game ticks. */
function cutsceneCaption(name: string): number {
  const sound = `KD-${name}`;
  const entry = fftEntries.find((e) => e.name === sound);
  if (entry && cutsceneSubs && subsOn()) {
    const t = subLang() === 'cz' ? entry.cz : entry.en;
    if (t.text) cutsceneSubs.newSubtitle(t.text, t.color, count);
  }
  audio.play(sound, 1, -1, 'voice');
  const dur = audio.duration(sound);
  return dur > 0 ? Math.max(1, Math.round(dur / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
}

/**
 * Paint the cutscene's KD-* captions on the vector overlay.
 *
 * Shared by the faithful and the AI cutscene paths: the captions are their own DOM
 * layer, so they are identical in both and must not be duplicated per path.
 */
function updateCutsceneSubOverlay(cssW: number, cssH: number, cs: number, dpr: number): void {
  if (!cutsceneSubs?.active) return;
  syncSubOverlaySized(cssW, cssH);
  // The cutscene paints on every rAF (it has no dirty check), so without this
  // gate the captions were re-shaped ~60x a second to produce the same image.
  const sig = subOverlaySignature('cut', cutsceneSubs, cs * dpr);
  if (!subOverlayGate || sig !== subOverlaySig) {
    subCtx.setTransform(1, 0, 0, 1, 0, 0);
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
    subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
    cutsceneSubs.drawVector(subCtx, count, subFontFamily, subFontWeight, alpha);
    subOverlayPaints++;
    subOverlayPainted = true;
    subOverlaySig = sig;
  }
  subCanvas.style.transform = '';
}

/**
 * The AI-upscaled briefcase cutscene: the static suitcase/TV canvas plus one upscaled
 * image per DECODED animation frame (see tools/studio/stage-kufr.ts).
 *
 * The deltas in demo.pck cannot be upscaled — they are per-pixel palette writes — so the
 * frames are materialised offline. The script still drives playback: this only swaps the
 * PIXEL SOURCE, so the audio-dependent timeline, the KD-* narration, the captions and
 * the Escape skip are all untouched.
 */
interface AiKufr {
  base: ImageBitmap;
  scale: number;
  region: { x: number; y: number; w: number; h: number };
  order: string[];
}
let aiKufr: AiKufr | null = null;
let aiKufrTried = false;
/** Decoded frames, bounded — all 284 at ×4 would be ~37 MB resident. */
const aiKufrFrames = new Map<string, ImageBitmap>();
const AI_KUFR_CACHE_MAX = 24;
const aiKufrLoading = new Set<string>();
let aiKufrRangeWarned = false;

async function ensureAiKufr(): Promise<void> {
  if (aiKufrTried) return;
  aiKufrTried = true;
  try {
    const res = await fetch('/enhanced-ai/_kufr/ai.json');
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
    const man = (await res.json()) as { scale: number; region: AiKufr['region']; order: string[] };
    const bres = await fetch('/enhanced-ai/_kufr/base.webp');
    if (!bres.ok || !(bres.headers.get('content-type') ?? '').startsWith('image/')) return;
    aiKufr = {
      base: await createImageBitmap(await bres.blob()),
      scale: Number(man.scale) || AI_ROOM_SCALE,
      region: man.region,
      order: man.order ?? [],
    };
  } catch (e) {
    console.warn('AI briefcase cutscene unavailable:', e);
  }
}

/** Fetch a cutscene frame (and prefetch the next few, since playback is linear). */
function loadAiKufrFrame(name: string): void {
  if (!name || aiKufrFrames.has(name) || aiKufrLoading.has(name)) return;
  aiKufrLoading.add(name);
  void (async () => {
    try {
      const res = await fetch(`/enhanced-ai/_kufr/frames/${name}`);
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return;
      const bmp = await createImageBitmap(await res.blob());
      aiKufrFrames.set(name, bmp);
      while (aiKufrFrames.size > AI_KUFR_CACHE_MAX) {
        const oldest = aiKufrFrames.keys().next().value as string | undefined;
        if (oldest === undefined || oldest === name) break;
        aiKufrFrames.get(oldest)?.close();
        aiKufrFrames.delete(oldest);
      }
    } catch {
      /* this frame stays on the faithful path */
    } finally {
      aiKufrLoading.delete(name);
    }
  })();
}

/** Release the cutscene's decoded art (~37 MB of frames at ×4). */
function disposeAiKufr(): void {
  aiKufrRangeWarned = false;
  for (const b of aiKufrFrames.values()) b.close();
  aiKufrFrames.clear();
  aiKufr?.base.close();
  aiKufr = null;
  aiKufrTried = false;
}

function drawCutscene(): void {
  if (!cutscene) return;
  mapSig = null; // cutscene paints #screen — invalidate the map cache
  const w = cutscene.width;
  const h = cutscene.height;
  const cs = contentScaleFor(w, h); // scaled + centered in the stage like the room it plays over (KUFRIK)
  const cssW = w * cs;
  const cssH = h * cs;
  const dpr = window.devicePixelRatio || 1;
  // Enhanced: render the KD-* captions in the bundled Mulish font on the vector
  // overlay (like room subtitles). Classic: keep the faithful baked bitmap font
  // composited into the 256-colour frame.
  const useVec = enhancedArtActive() && cutsceneSubs !== null && subFontReady;
  // The hi-res path draws bitmaps, so it cannot composite BAKED captions into the
  // indexed frame. When the vector overlay is unavailable (no subtitle font) it stands
  // down entirely rather than drop the narration text — same rule as the room gate.
  if (graphics === 'ai' && !aiKufrTried) void ensureAiKufr();
  const aiFrameIdx = Math.max(0, cutscene.framesShown - 1);
  const aiFrameName = aiKufr ? aiKufr.order[aiFrameIdx] ?? '' : '';
  // Running past the end means the shipped sequence and the decoder disagree. The
  // consequence is a silent mid-cutscene drop back to the faithful renderer, which is
  // exactly how the framesDrawn/framesShown mix-up hid, so say it once.
  if (aiKufr && !aiFrameName && !aiKufrRangeWarned) {
    aiKufrRangeWarned = true;
    console.warn(`AI cutscene: frame ${aiFrameIdx} is past the shipped sequence (${aiKufr.order.length}); falling back`);
  }
  if (aiKufr && aiFrameName) {
    loadAiKufrFrame(aiFrameName);
    for (let i = 1; i <= 4; i++) loadAiKufrFrame(aiKufr.order[cutscene.framesShown - 1 + i] ?? '');
  }
  const aiBmp = graphics === 'ai' && useVec && aiKufr ? aiKufrFrames.get(aiFrameName) ?? null : null;
  if (aiBmp && aiKufr) {
    const S = aiKufr.scale;
    glCanvas.style.display = 'none';
    if (canvas.width !== w * S || canvas.height !== h * S) { canvas.width = w * S; canvas.height = h * S; }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.transform = '';
    const wantSmooth = scalingFilterFor(w * S, cssW);
    if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(aiKufr.base, 0, 0);
    ctx.drawImage(aiBmp, aiKufr.region.x * S, aiKufr.region.y * S);
    updateCutsceneSubOverlay(cssW, cssH, cs, dpr);
    perfPaint++;
    return;
  }
  if (canvas.style.imageRendering) canvas.style.imageRendering = '';
  const frame = new IndexedScreen(w, h);
  frame.px.set(cutscene.pixels);
  if (!useVec) cutsceneSubs?.draw(frame, count); // baked bitmap captions
  // Enhanced upgrade: bilinear-upscale the 256-colour frame on the GPU so it isn't
  // blocky on hi-DPI displays. Classic stays crisp (faithful) via the 2D path.
  const smoothGpu = enhancedArtActive() && renderer === 'webgl' && !glFailed;
  // #screen is the layout anchor of the wrap even when the GL canvas covers it, so
  // it must carry the cutscene's CSS box (native backing, SCALE-sized on screen —
  // the same box the KUFRIK room used, so entering/leaving the cutscene doesn't
  // shift the layout). Its backing also backs the 2D fallback blit below.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.transform = '';
  let presented = false;
  if (smoothGpu) {
    const comp = glCompositor();
    if (comp) {
      try {
        comp.renderIndexed(frame.px, w, h, cutscene.palette);
        // Back the GL canvas at the on-screen device resolution so the shader's
        // LINEAR upscale (not CSS scaling) does the smoothing; present + show it.
        const bw = Math.round(cssW * dpr);
        const bh = Math.round(cssH * dpr);
        if (glCanvas.width !== bw || glCanvas.height !== bh) {
          glCanvas.width = bw;
          glCanvas.height = bh;
        }
        glCanvas.style.width = `${cssW}px`;
        glCanvas.style.height = `${cssH}px`;
        glCanvas.style.transform = '';
        comp.present(bw, bh, true);
        glCanvas.style.display = 'block';
        presented = true;
      } catch {
        glFailed = true; // fall through to the CPU blit for this frame
      }
    }
  }
  if (!presented) {
    glCanvas.style.display = 'none';
    const rgba = frame.toRgba(cutscene.palette);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }
  // Mulish captions on the vector overlay (enhanced). Same coordinate convention
  // as room subtitles: the overlay spans the on-screen box and its context is
  // scaled by SCALE*dpr so drawVector positions in native (720×555) game pixels.
  if (useVec && cutsceneSubs!.active) {
    updateCutsceneSubOverlay(cssW, cssH, cs, dpr);
  } else if (subOverlayPainted) {
    clearSubOverlay();
  }
}

async function loadRoom(num: number): Promise<void> {
  endShowmode(); // a room change ends any KUFRIK demonstration
  forceRoomRedraw = true; // repaint the first frame of the new room
  roomLoading = true; // hide the stale previous room until the new one is built
  // Boot loads room 7 before the map/intro takes over, and its audio was always
  // discarded by the killAll() that follows. Deferring the audio (below) would let it
  // start AFTER the menu music instead, so skip it outright for the boot load.
  const bootLoad = !booted;
  try {
    const nnn = String(num).padStart(3, '0');
    // Only the two assets the room cannot be BUILT without are on this path. The
    // .ffs voice package and the room music used to ride along here; see below.
    const [ffrRes, fftRes] = await Promise.all([
      fetch(ffrUrl(num)),
      fetch(`/data/Title/${nnn}.fft`),
    ]);
    if (!ffrRes.ok) throw new Error(`failed to load room ${num}: ${ffrRes.status}`);
    ffr = parseFfr(new Uint8Array(await ffrRes.arrayBuffer()));
    // WIN "Favorites" palette gag (URoom.pas:1312-1355): swap the pink placeholder colours
    // for the Windows system theme, so the fake windows look like a real desktop.
    if (ROOMS[num - 1]?.jmeno === 'WIN') {
      ffr = { ...ffr, palette: applyWinDesktopPalette(ffr.palette) };
    }
    const fftBytes = fftRes.ok ? new Uint8Array(await fftRes.arrayBuffer()) : new Uint8Array(4);
    fftEntries = fftRes.ok ? parseFft(fftBytes) : [];
    // The outgoing room's samples must not be audible under the new room while its
    // own package is still in flight (see loadRoomVoices) — a lookup that misses now
    // falls back to the global packages, i.e. silence for a room-specific line.
    audio.clearRoom();
    // The boot room fetches no voices at all, so its queue must not be held.
    armRoomVoices(bootLoad);
    pokus = 1; // fresh attempt on entering a room
    buildRoom();
    // Enhanced background art for this room (async; draw() holds the previous
    // frame until it lands, so the room never flashes classic first).
    curNum = num;
    enhancedArt = null;
    enhancedObjects = [];
    enhancedPending = enhancedArtActive();
    aiRoom = null;
    // Symmetric with enhancedPending: hold the frame until the AI art the `ai` tier
    // will actually present has landed, so the room is never shown in enhanced art
    // first and then visibly upgraded underneath the player.
    aiPending = graphics === 'ai';
    aiPendingNum = aiPending ? num : 0;
    // What the room is WAITING FOR must be the same thing roomArtPending() holds the
    // frame for — otherwise the two disagree. In `classic` nothing is awaited: the
    // enhanced art still loads (a later tier switch wants it cached) but the room does
    // not hold for it, so audio must not either. Gating audio on the raw
    // ensureEnhancedArt promise left a classic room playable and SILENT for the ~1.7 MB
    // of truecolor art that tier never displays.
    const enhanced = ensureEnhancedArt(num);
    const art = enhancedArtActive()
      ? Promise.all([enhanced, graphics === 'ai' ? ensureAiRoom(num) : Promise.resolve()])
      : Promise.resolve();
    // Audio is the bulk of a room entry's bytes and none of it is needed to DRAW the
    // room: 4.30 MB of .ffs voices plus a 5.75 MB music track for PRVNI, against
    // ~2.14 MB of room-specific core+art bytes. On a capped link they simply crowd the
    // art out, so both wait for it — a low-priority hint was measured and is not enough
    // (KOSTE's first frame: 35.5s with the hint, 27.4s with the wait).
    //
    // The cost is a short window after the room appears in which a room-specific line
    // is silent (subtitles still show; audio.clearRoom() keeps it silent rather than
    // wrong). That is a much better trade than the black stage it replaces, and it
    // closes as soon as the package lands.
    const afterArt = (): void => {
      if (bootLoad) return;
      loadRoomVoices(num, nnn, fftBytes);
      startRoomMusic(num);
    };
    // Both arms: nothing in `art` rejects today, but if a future edit made it throw,
    // a fulfilment-only handler would leave the room permanently silent AND strand the
    // loading overlay over a playable game.
    void art.then(afterArt, afterArt);
  } finally {
    // Always drop the guard, even if a fetch/parse threw: on error we fall back to
    // the pre-existing behaviour (the previous room stays shown) rather than leaving
    // the stage wedged black with no recovery. On success it runs once the room is
    // built, so the next frame paints the new room.
    roomLoading = false;
    roomLoadSeq++;
    forceRoomRedraw = true;
    wake();
  }
}

/**
 * Fetch the room's voice package (.ffs).
 *
 * Fire-and-forget and guarded on `curNum`: the player can be in a different room by
 * the time it lands, and applying a stale package would give the new room the old
 * room's voices. Until it arrives, `audio.clearRoom()` has left only the global
 * packages, so a line that beats it is silent rather than wrong.
 *
 * Keyed on the PROMISE, like aiRoomCache: now that this download outlives the room
 * load that started it, re-entering the same room quickly used to put two fetches of
 * the same file in flight at once — and two concurrent writes of one (up to 9.37 MB)
 * cache entry fail with net::ERR_CACHE_WRITE_FAILURE. The entry is dropped once the
 * fetch settles, so nothing retains these buffers between entries.
 */
const voiceLoads = new Map<string, Promise<ArrayBuffer | null>>();
/**
 * False from room entry until the room's .ffs has SETTLED — arrived, or failed/absent.
 * Gates the dialogue queue (see SoundFns.voicesReady) so an opening conversation is not
 * consumed silently while the package is still downloading. "Settled" rather than
 * "loaded" on purpose: a room with no voice package, or a failed fetch, must let the
 * queue run rather than stall it forever.
 */
let roomVoicesSettled = true;
/** Resolves when `roomVoicesSettled` next becomes true — for callers that can await. */
let roomVoicesReady: Promise<void> = Promise.resolve();
let markVoicesSettled: () => void = () => {};

/** Begin a room's "voices not here yet" window (see roomVoicesSettled). */
function armRoomVoices(settled: boolean): void {
  roomVoicesSettled = settled;
  if (settled) {
    roomVoicesReady = Promise.resolve();
    return;
  }
  roomVoicesReady = new Promise<void>((resolve) => { markVoicesSettled = resolve; });
}

function loadRoomVoices(num: number, nnn: string, fftBytes: Uint8Array): void {
  if (curNum !== num || screen !== 'room') return;
  let pending = voiceLoads.get(nnn);
  if (pending === undefined) {
    pending = fetch(`/data/Sound/${nnn}.ffs`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null);
    voiceLoads.set(nnn, pending);
    void pending.then(() => voiceLoads.delete(nnn));
  }
  void pending.then((buf) => {
    if (curNum !== num) return;
    if (buf) audio.setRoom(fftBytes, new Uint8Array(buf));
    roomVoicesSettled = true;
    markVoicesSettled();
    wake(); // the dialogue queue was held on this; let it run on the next frame
  });
}

/** Room music (MusicCycle, URoom.pas:1568): loop the room's track, or silence it. */
function startRoomMusic(num: number): void {
  if (curNum !== num || screen !== 'room') return;
  const music = musicForCHud(ROOMS[num - 1]?.cHud ?? -1);
  if (music) void audio.playMusic(music.name, `/data/Music/${music.name}.wav`, music.loopSample);
  else audio.stopMusic();
}

/** Make a fish "talk": show the next subtitle of its colour code (M/V) and play its voice. */
function talk(which: 'little' | 'big'): void {
  wake();
  if (!subs) return;
  const code = which === 'little' ? 'M' : 'V';
  const l = subLang();
  const lines = fftEntries.filter((e) => (l === 'cz' ? e.cz : e.en).color === code && (l === 'cz' ? e.cz : e.en).text);
  if (lines.length === 0) return;
  const entry = lines[talkIdx[which] % lines.length]!;
  talkIdx[which]++;
  const t = l === 'cz' ? entry.cz : entry.en;
  if (subsOn()) subs.newSubtitle(t.text, t.color, count);
  audio.play(entry.name, 1, MLUVI_PRIOR[which], 'voice'); // voice at the fish's mluvi priority (drives lip-sync)
}

const idle = (): boolean =>
  room !== null && engine !== null && engine.phase === 'idle' && !room.anyFishDead && !room.won;

/**
 * gstav in [stav_nic, stav_klid] (URoom.pas:24432): the original only dequeues a
 * command — including save and load — while the room is at rest, so neither can
 * land mid-animation. Looser than `idle()`, which also excludes a dead fish and a
 * won room; this is only the animation gate.
 */
const atRest = (): boolean => engine !== null && engine.phase === 'idle';

/** DalsiPrikaz busy gate (URoom.pas:27002-27016): a fish command is dropped while that
 *  fish is busy (mid-dialogue, turned to face the player). */
function fishBusy(which: 'little' | 'big'): boolean {
  return room !== null && room.busy[which] > 0;
}

/** Turn-first-then-move; horizontal turns animate (stav_otocka), moves slide. */
function tryStep(which: 'little' | 'big', dir: number): 'moving' | 'turning' | 'blocked' | 'busy' {
  wake(); // resume 60fps if the idle-loop throttle had us sleeping (also covers __ff.press)
  return engine ? engine.press(which, dir) : 'blocked';
}

// Engine-level held-key auto-repeat (KeyRoom, URoom.pas:26788/26941 + Uovl.pas:990/1006):
// a held movement key is re-issued every rest tick, so holding a direction moves the fish
// continuously with no OS typematic delay. Only ONE key is tracked at a time (a second
// movement key while one is held is ignored, like FormKeyDown's `if KeyRoom in [1,2] then
// exit`), and only movement keys repeat (action keys stay one-shot). `heldState` mirrors
// KeyRoom: 0 idle, 1 pressed, 2 held (repeating), 3 released.
let heldKey: string | null = null;
let heldSys = false; // arrow keys are kdo:=sys → move whichever fish is active at dispatch
let heldWhich: 'little' | 'big' = 'little';
let heldDir: number = Dir.no;
let heldState = 0; // KeyRoom: 0 idle, 1 pressed, 2 held, 3 released

function clearHeldKey(): void {
  heldKey = null;
  heldState = 0;
  heldDir = Dir.no;
}

/** FormKeyDown (Uovl.pas:990): record a held movement key. OS auto-repeat and any second
 *  key are absorbed while one is already held, so the engine (not the OS) drives repeat. */
function beginHeldMove(code: string, sys: boolean, which: 'little' | 'big', dir: number): void {
  if (heldState === 1 || heldState === 2) return; // a key is already held
  if (engine) engine.swim = null; // a key press cancels any click-to-swim (most-recent input wins)
  heldKey = code;
  heldSys = sys;
  heldWhich = which;
  heldDir = dir;
  heldState = 1;
}

/** DalsiPrikaz (URoom.pas:26941): dispatch the held key on a rest tick and advance its
 *  KeyRoom state (1→2 held, 3→0 released). The move is busy-gated exactly like a fresh
 *  press; the state still advances if the move is dropped, so it retries next tick. */
function dispatchHeldMove(): void {
  if (heldState === 0 || !engine || !room) return;
  const which = heldSys ? engine.active : heldWhich;
  const release = heldState === 3;
  heldState = release ? 0 : 2;
  if (release) heldKey = null;
  if (fishBusy(which)) return; // dropped while the fish is talking (kdo:=0)
  hracNespi();
  engine.swim = null;
  engine.active = which;
  tryStep(which, heldDir);
  setInfo();
}

/**
 * KAJUTA1 screen-shove (URoom.pas:24727-24761): a blocked big-fish left/right push
 * against a wall, while gspec is 3 or 4, slides the view and arms gspec:=4. Wired as
 * the engine's onBlockedMove hook so a rejected push still shoves the screen.
 */
function wallShove(which: 'little' | 'big', dir: number): void {
  if (
    !room ||
    which !== 'big' ||
    (dir !== Dir.left && dir !== Dir.right) ||
    (room.gspec !== 3 && room.gspec !== 4)
  ) {
    return;
  }
  const big = room.items[room.bigIdx]!;
  const wall =
    dir === Dir.left
      ? room.cellOccupant(big.x - 1, big.y) === ITEM_WALL ||
        room.cellOccupant(big.x - 1, big.y + 1) === ITEM_WALL
      : room.cellOccupant(big.x + 4, big.y) === ITEM_WALL ||
        room.cellOccupant(big.x + 4, big.y + 1) === ITEM_WALL;
  if (wall) {
    room.gspec = 4;
    // screenShoveX is stored in NATIVE px (scaled by contentScale at apply time),
    // so the shove tracks the current display scale. Was ±5*SCALE CSS / clamp ±40 CSS.
    const delta = dir === Dir.left ? -5 : 5;
    screenShoveX = Math.max(-20, Math.min(20, screenShoveX + delta));
  }
}

/**
 * Apply one recorded move to `room` instantly (no animation), via the shared engine.
 * Used to re-simulate for undo/load. Returns false if the move was blocked.
 */
function applyMoveInstant(which: 'little' | 'big', dir: number): boolean {
  return engine ? engine.applyMoveInstant(which, dir) : false;
}

/**
 * Rebuild the room and replay a move record (load / undo). When `animated` (the
 * player F3 and the demo's reload), the replay is fast-forwarded over several ticks
 * at LoadSpeed moves/tick (TRoom.Load loadmode, URoom.pas:24102) so the fish visibly
 * rewind to spawn and race back to the saved position; otherwise it is applied
 * instantly (used by deterministic tests).
 */
function restore(
  rec: string,
  snapshot: ScriptSnapshot | null = null,
  preserveShowmode = false,
  animated = false,
): void {
  if (!preserveShowmode) endShowmode(); // loading a saved game ends any KUFRIK demonstration
  loadmode = null;
  // Rebuild with carryPole, i.e. the RESTART flavour: TRoom.Load runs InitItems +
  // InitProgramky (URoom.pas:1905-1948), never TRoom.Init, so loading a save must
  // not clear the room-scoped cheats (or roompole) the way a room change does.
  buildRoom(true); // fresh room (resets srecord); may leave pending fall dirs
  if (!room || !engine) return;
  room.clearAllDirs();
  room.fallToRest(); // settle the initial gravity instantly
  room.clearAllDirs();
  engine.phase = 'idle';
  engine.swim = null;
  engine.exiting = null;
  engine.animFrame = 0;
  engine.srecord = ''; // rebuilt by the replayed moves
  const moves = movesOf(rec);
  if (animated) {
    // LoadSpeed := size div 150, clamped 5..50 (URoom.pas:1927). `size` is the save
    // byte count; the record length is our proxy.
    const speed = Math.max(5, Math.min(50, Math.floor(rec.length / 150)));
    loadmode = { moves, idx: 0, speed, snapshot };
    setInfo();
    return;
  }
  for (const m of moves) {
    if (room.anyFishDead || room.won) break;
    applyMoveInstant(m.which, m.dir);
  }
  // Restore the script's "already said"/progress Vars so loading doesn't re-fire
  // dialogue the fish have already spoken (the original re-derives these during a
  // suppressed load replay; buildRoom reset them, so re-apply the saved snapshot).
  if (snapshot && activeScript) activeScript.s.applySnapshot(snapshot);
  setInfo();
}

/**
 * Advance a fast-forward load (loadmode): apply up to `speed` recorded moves this
 * tick; on completion re-apply the saved script snapshot and settle. Mirrors the
 * per-Timer1Timer `while kolo<LoadSpeed` replay in URoom.pas:24135.
 */
function advanceLoadmode(): void {
  if (!loadmode || !room || !engine) return;
  let applied = 0;
  while (applied < loadmode.speed && loadmode.idx < loadmode.moves.length) {
    if (room.anyFishDead || room.won) {
      loadmode.idx = loadmode.moves.length;
      break;
    }
    const m = loadmode.moves[loadmode.idx++]!;
    applyMoveInstant(m.which, m.dir);
    applied++;
  }
  if (loadmode.idx >= loadmode.moves.length) {
    // LoadDone (URoom.pas:1789): re-apply progress Vars, settle, resume play.
    if (loadmode.snapshot && activeScript) activeScript.s.applySnapshot(loadmode.snapshot);
    room.clearAllDirs();
    room.fallToRest();
    room.clearAllDirs();
    engine.phase = 'idle';
    loadmode = null;
    setInfo();
  }
}

/**
 * Restart the room (TRoom.Restart, URoom.pas:1577): the original's Restart action.
 * Discards the whole move record, resets every object to its start, and counts a
 * fresh attempt (pokus++). This is NOT a single-move undo — the 1998 Delphi game
 * had none; the tutorial's "1st-m-backspace" line teaches Backspace = start over.
 */
function restartRoom(): void {
  wake();
  if (!room || screen !== 'room' || cutscene) return;
  endShowmode(); // a player restart aborts the KUFRIK demonstration (unlike a death-restart)
  pokus++;
  buildRoom(true);
  setInfo();
}

const saveKey = (): string => `ff.save.${select.value}`;

/**
 * CanSave (URoom.pas:26900-26906) for the current room, or false with no room
 * loaded. The rule itself lives on `Room` — see `Room.canSave`.
 */
function canSave(): boolean {
  return !!room && room.canSave;
}

/** Save the current move record + script state to localStorage. */
function saveGame(): void {
  if (!canSave()) return; // DalsiPrikaz: `if not CanSave then kdo:=0` (URoom.pas:27010)
  try {
    const snapshot = activeScript?.s.snapshot() ?? null;
    localStorage.setItem(saveKey(), JSON.stringify({ rec: engine?.srecord ?? '', vars: snapshot }));
    setInfo();
  } catch {
    /* storage unavailable */
  }
}

/** Load and re-simulate the saved move record for this room, restoring script state. */
function loadGame(): void {
  if (!saveExists()) return; // CanLoad (URoom.pas:27012) — nothing to load
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(saveKey());
  } catch {
    /* storage unavailable */
  }
  if (raw === null) return;
  let rec = raw;
  let snapshot: ScriptSnapshot | null = null;
  try {
    const parsed = JSON.parse(raw) as { rec?: string; vars?: ScriptSnapshot | null };
    if (parsed && typeof parsed === 'object' && typeof parsed.rec === 'string') {
      rec = parsed.rec;
      snapshot = parsed.vars ?? null;
    }
  } catch {
    /* legacy plain-string save (just the move record) */
  }
  restore(rec, snapshot, false, true); // player load: fast-forward animated replay (TRoom.Load)
}

/** True if a save exists for the current room. */
function saveExists(): boolean {
  try {
    return localStorage.getItem(saveKey()) !== null;
  } catch {
    return false;
  }
}


/** Win bookkeeping (the engine's onWin hook): mark solved, record score, refresh the
 *  HUD. The engine itself starts the auto-return countdown. */
function onWinBookkeeping(_countdown: number): void {
  const roomNum = Number(select.value);
  if (!solved.has(roomNum)) {
    solved.add(roomNum); // progression: mark this room solved
    saveSolved();
  }
  recordScore(roomNum, lengthOfRecord(engine?.srecord ?? '')); // RoomVysl := LengthOfRecord
  // Keep the best solution's full move record (the original's `nej` slot) for the
  // map info panel's Replay; recordBest's <= guard means it stores whenever this
  // solve ties/beats the (just-updated) best count.
  const rec = engine?.srecord ?? '';
  recordBest(roomNum, rec, lengthOfRecord(rec));
  setInfo();
}

/**
 * AktualizujPanel (Uovl.pas:304): the per-element colour state of the control
 * panel. Active fish = yellow, available = orange, busy/dead/unavailable = grey,
 * the held button = lit. `pressedDir` lights a pressed D-pad arrow.
 */
function panelState(): PanelState {
  const bigDead = !room || !room.alive.big || room.busy.big !== 0;
  const littleDead = !room || !room.alive.little || room.busy.little !== 0;
  const bothAlive = !!room && room.alive.big && room.alive.little;
  const p = panelPressed;
  let pressedDir = 0;
  if (p >= 1 && p <= 4) pressedDir = p; // little up/down/left/right
  else if (p >= 6 && p <= 9) pressedDir = p - 1; // big -> 5..8
  return {
    velka: bigDead ? SEDY : engine?.active === 'big' ? ZLUTY : ORANZOVY,
    mala: littleDead ? SEDY : engine?.active === 'little' ? ZLUTY : ORANZOVY,
    space: p === 11 ? SVITICI : bothAlive ? ORANZOVY : SEDY,
    save: p === 12 ? SVITICI : canSave() ? ORANZOVY : SEDY,
    load: p === 13 ? SVITICI : saveExists() ? ORANZOVY : SEDY,
    abort: p === 14 ? SVITICI : ORANZOVY,
    restart: p === 15 ? SVITICI : ORANZOVY,
    pressedDir,
  };
}

/** The live options-panel state for rendering (KresliOptions, Uovl.pas:461). */
function optionsState(): OptionsState {
  return {
    volume: { ...settings.volume },
    subtitles: settings.subtitles,
    helpActive: helpOpen,
    scrollFrame: ostav === O_SC_UP || ostav === O_SC_DOWN ? scroll : -1,
  };
}

/**
 * Advance the options scroll animation one frame (the original panel Timer,
 * Uovl.pas:499-512): o_sc_up runs scroll scmin->scmax then settles on o_options;
 * o_sc_down runs scmax->scmin then settles on o_normal.
 */
function advancePanelScroll(): void {
  if (ostav === O_SC_UP) {
    if (scroll >= SCMAX) ostav = O_OPTIONS;
    else scroll++;
  } else if (ostav === O_SC_DOWN) {
    if (scroll <= SCMIN) ostav = O_NORMAL;
    else scroll--;
  }
}

/** Drive the scroll animation off wall-clock time (independent of game logic). */
function tickPanelScroll(dtMs: number): void {
  if (ostav !== O_SC_UP && ostav !== O_SC_DOWN) {
    scrollAcc = 0;
    return;
  }
  scrollAcc += dtMs;
  if (scrollAcc < PANEL_SCROLL_MS) return;
  // Advance at most ONE frame per rendered frame and DROP the rest of the backlog —
  // the same rule the game logic uses (see the MAX_STEPS_PER_FRAME guard in loop()).
  //
  // This used to `while`-loop, which fast-forwarded the whole 10-frame animation
  // inside a single long frame: opening the options right after entering a room, while
  // the tier's art was still decoding, burned the entire roll-down in one tick and the
  // panel appeared to snap open with no animation at all. (Closing it, and every later
  // open, looked fine because nothing was loading by then.) A dropped backlog just
  // makes the animation take marginally longer under load, which is invisible; a
  // batched one skips it entirely.
  scrollAcc = 0;
  advancePanelScroll();
}

/**
 * Toggle the options sub-panel (the corner button oblroh, or a right-click on the
 * panel; Uovl.pas:636-639,709-712): normal -> scroll up -> options -> scroll down.
 */
function togglePanelOptions(): void {
  if (ostav === O_NORMAL) ostav = O_SC_UP;
  else if (ostav === O_OPTIONS) ostav = O_SC_DOWN;
}

/**
 * Open the help screens (akce_help / ToggleHelp, Uovl.pas:719,252): load the pages
 * for the current subtitle language (tit_def when subtitles are off, as the original
 * uses tit_def) and show the overlay from the first page.
 */
function openHelp(): void {
  // On the map the Options panel floats as a fixed, centred overlay (zIndex 50) that
  // would otherwise cover the full-screen help pages — close it first so Help isn't
  // hidden behind it (in-room the panel sits beside the play area, so no overlap).
  if (mapOverlay === 'options') closeMapOverlay();
  helpOpen = true;
  helpScreens.page = 0;
  void helpScreens.load(subLang());
}

/** Close the help overlay (any key, Help.pas:FormKeyDown). */
function closeHelp(): void {
  helpOpen = false;
}

/** Draw the current help page full-screen on the main canvas (Help.pas:TabControl1Change). */
function drawHelp(): void {
  const pages = helpScreens.pages(subLang());
  const pg = pages[helpScreens.page];
  if (!pg) return; // still loading
  mapSig = null; // help paints #screen — invalidate the map cache
  if (canvas.width !== pg.w || canvas.height !== pg.h) {
    canvas.width = pg.w;
    canvas.height = pg.h;
    canvas.style.width = `${pg.w}px`;
    canvas.style.height = `${pg.h}px`;
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pg.rgba), pg.w, pg.h), 0, 0);
}

/** Composite and blit the control panel next to the play area (or as a map overlay). */
function drawPanel(): void {
  if (!panel) return;
  const asMapOverlay = screen === 'map' && mapOverlay === 'options';
  const visible = screen === 'room' || asMapOverlay;
  panelCanvas.style.display = visible ? '' : 'none';
  // Float the panel over the map when opened from the Options corner; otherwise
  // it sits statically beside the play area (its normal in-room position).
  if (asMapOverlay) {
    panelCanvas.style.position = 'fixed';
    panelCanvas.style.left = '50%';
    panelCanvas.style.top = '50%';
    panelCanvas.style.transform = 'translate(-50%, -50%)';
    panelCanvas.style.zIndex = '50';
  } else if (panelCanvas.style.position === 'fixed') {
    panelCanvas.style.position = '';
    panelCanvas.style.left = '';
    panelCanvas.style.top = '';
    panelCanvas.style.transform = '';
    panelCanvas.style.zIndex = '';
  }
  if (!visible) return;
  // Composing the panel (155×395) + palette→RGBA + putImageData is pure per-frame
  // waste while nothing on it changes (idle in a room). Compute a signature from the
  // state FIRST and bail before the (allocating) compose+blit when it's unchanged.
  if (graphics === 'ai' && !aiPanelTried) { aiPanelTried = true; void ensureAiPanel(); }
  // The AI panel composites at ×scale into a bigger backing store; the CSS size below
  // is unchanged, so this is purely a resolution increase. Falls back the moment the
  // art is missing or the tier is switched away.
  const ai = graphics === 'ai' ? aiPanel : null;
  const wantW = ai ? ai.width : PANEL_W;
  const wantH = ai ? ai.height : PANEL_H;
  if (panelCanvas.width !== wantW || panelCanvas.height !== wantH) {
    panelCanvas.width = wantW;
    panelCanvas.height = wantH;
    panelSig = null; // resize cleared the backing store — force a repaint
  }
  let sig: string;
  let paint: () => void;
  if (ostav === O_NORMAL) {
    const st = panelState();
    sig = `n|${st.velka}|${st.mala}|${st.space}|${st.save}|${st.load}|${st.abort}|${st.restart}|${st.pressedDir}`;
    paint = ai
      ? () => ai.drawPanel(panelCtx, st)
      : () => panelCtx.putImageData(new ImageData(new Uint8ClampedArray(panelToRgba(composePanel(panel!.images, st), panel!.palette)), PANEL_W, PANEL_H), 0, 0);
  } else {
    const st = optionsState();
    sig = `o|${st.volume.effect}|${st.volume.voice}|${st.volume.music}|${st.subtitles}|${st.helpActive ? 1 : 0}|${st.scrollFrame}`;
    paint = ai
      ? () => ai.drawOptions(panelCtx, st)
      : () => panelCtx.putImageData(new ImageData(new Uint8ClampedArray(panelToRgba(composeOptions(panel!.images, panel!.cudl, st), panel!.palette)), PANEL_W, PANEL_H), 0, 0);
  }
  // The signature must include which renderer produced the pixels, or switching tiers
  // with an otherwise-identical panel state would leave the old resolution on screen.
  sig = `${ai ? 'a' : 'f'}|${sig}`;
  if (sig !== panelSig) {
    panelSig = sig;
    paint();
  }
  // Fixed panel size at the stage scale — constant across all rooms (no longer
  // tracks the room height, so it stops resizing room-to-room). Only touch the DOM
  // when it actually changes (a resize), so idle frames do no style work.
  const pw = `${Math.round(stage.panelW)}px`;
  const ph = `${Math.round(stage.panelH)}px`;
  if (panelCanvas.style.width !== pw) panelCanvas.style.width = pw;
  if (panelCanvas.style.height !== ph) panelCanvas.style.height = ph;
  // The ai panel composites at ×4 into a 620×1580 store shown at ~145px wide, so
  // without this it is point-sampled and loses the detail it was upscaled for.
  const pFilter = scalingFilterFor(panelCanvas.width, Math.round(stage.panelW));
  if (panelCanvas.style.imageRendering !== pFilter) panelCanvas.style.imageRendering = pFilter;
}

/**
 * Ensure the level name-plaque data (Desky) is loaded for the current subtitle
 * language (typdesek<>tit_def reload, UMain.pas:1437): popdesk<n>.dat + desky<n>.dat
 * where n = 1 (cz) / 2 (en). The language is the shared subtitle language (subLang),
 * so the room-name plaques always match the subtitles/help.
 */
async function ensureDeskyData(): Promise<void> {
  const lang = subLang();
  if (deskyLang === lang && deskyData) return;
  const n = lang === 'cz' ? '1' : '2';
  try {
    const [popdesk, atlas] = await Promise.all([
      fetch(`/data/Menu/popdesk${n}.dat`).then((r) => r.arrayBuffer()),
      fetch(`/data/Menu/desky${n}.dat`).then((r) => r.arrayBuffer()),
    ]);
    deskyData = parseDesky(new Uint8Array(popdesk), new Uint8Array(atlas));
    deskyLang = lang;
  } catch {
    /* plaques optional */
  }
}

/** Open the record info panel for a solved/cheated room (daInfo, UMain.pas:1008). */
function openMapInfo(roomNum: number): void {
  mapInfoRoom = roomNum;
  mapInfoHover = null;
  mapInfoFaze = 0; // InfoFaze := 0 — restart the odometer roll
  mapInfoOpenAt = performance.now();
  mapSig = null; // force a repaint (the panel is new)
  void ensureDeskyData(); // in case the language changed since boot
  wake();
}

/** Close the record info panel (daCancel, UMain.pas:1018). */
function closeMapInfo(): void {
  if (mapInfoRoom === null) return;
  mapInfoRoom = null;
  mapInfoHover = null;
  mapSig = null;
  wake();
}

/** Render the world-map screen to the main canvas. */
function drawMap(): void {
  if (!worldMap) return;
  // Advance the reachable-node pulse ~every 140ms (kPul cadence, UMain.pas timer).
  const pulse = Math.floor(performance.now() / 140);
  // The reveal (Depth, UMain.pas): from -3, +1 per ~60ms, tracing the map in from
  // the start; once it passes the deepest room the whole enabled map is shown.
  const depth = Math.floor((performance.now() - mapRevealStart) / 60) - 3;
  const cs = contentScaleFor(MAP_W, MAP_H);
  // The `ai` graphics level draws the map from AI-upscaled art re-composited at 4x,
  // so the backing store is 4x larger (still CSS-scaled to the same display box).
  if (graphics === 'ai' && !aiMapTried) { aiMapTried = true; void ensureAiWorldMap(); }
  const useAi = graphics === 'ai' && aiWorldMap !== null;
  const cw = useAi ? AI_MAP_W : MAP_W;
  const ch = useAi ? AI_MAP_H : MAP_H;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    mapSig = null; // backing store was cleared by the resize — force a repaint
  }
  const cssW = `${MAP_W * cs}px`;
  const cssH = `${MAP_H * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // #screen is shared with the room, which sets its own filter — set ours explicitly
  // rather than inheriting whatever the last room left behind (an AI room left 'auto',
  // which blurred a FALLBACK map; a fresh boot straight to the map left 'pixelated',
  // which aliased the AI one).
  const mFilter = scalingFilterFor(cw, Math.round(MAP_W * cs));
  if (canvas.style.imageRendering !== mFilter) canvas.style.imageRendering = mFilter;
  // The 640×480 palette conversion + node compositing is the map's whole cost, and
  // it only changes when its inputs do: the pulse frame (6-phase, ~140ms), the
  // reveal depth (until it passes maxDepth, then frozen), the hover corner, and the
  // solved/cheated sets (which only ever grow, so their size is a sufficient key).
  // The record info panel adds its own inputs: the open room, hovered button, and
  // the odometer roll frame (capped once settled so the sig stops churning), plus
  // the hovered room node (its name plaque). The AI flag is in the key so toggling
  // the graphics level repaints.
  const infoFazeKey = Math.min(mapInfoFaze, INFO_SETTLE_FAZE);
  const sig =
    `${useAi ? 'ai' : 'n'}|${pulse % 6}|${Math.min(depth, worldMap.maxDepth + 1)}|${mapHoverCorner ?? ''}|${solved.size}|${cheated.size}|${cheated.size ? 1 : 0}` +
    `|${mapInfoRoom ?? ''}|${mapInfoHover ?? ''}|${infoFazeKey}|${mapHoverRoom ?? ''}`;
  // The minigame is modal over the map too (UMain.pas:1764), and animates, so its
  // frame counter joins the cache key.
  const sigT = tetris ? `|ttr${tetrisTick}` : '';
  if (sig + sigT === mapSig) return; // nothing visibly changed — skip the redraw entirely
  mapSig = sig + sigT;
  perfPaint++; // an actual map paint (past the cache check)
  const panelOpen = mapInfoRoom !== null;
  // While the record panel is open the base map renders fully unlit (Delphi zeroes
  // RTable when InfoMode>0, UMain.pas:1446), hiding the lit paths + node artwork so
  // only the name plaque and panel stand out. Nodes (balls) are skipped too.
  if (useAi) {
    // Hi-res AI base + nodes, then the record panel / name plaque overlaid at native
    // resolution and nearest-neighbour-scaled up (keeps digits + names crisp).
    aiWorldMap!.draw(ctx, {
      solved,
      pulse,
      depth,
      cheated,
      hoverCorner: mapHoverCorner,
      drawNodes: !panelOpen,
      litRegions: !panelOpen,
    });
    // Record-panel *artwork* (krokoměr bg + hovered icon + disabled-Replay grey) is
    // drawn straight onto the hi-res ctx from the AI-upscaled bitmaps; the odometer
    // digits + name plaque still ride the crisp NN overlay below so text stays sharp.
    if (panelOpen && infoPanelAssets && mapInfoRoom !== null) {
      const replayEnabled = bestRecord(mapInfoRoom) !== undefined;
      drawInfoPanelArtAi(ctx, AI_MAP_SCALE, aiWorldMap!.krokomer, aiWorldMap!.ikonky, mapInfoHover, replayEnabled);
    }
    // Name plaque from the upscaled art, drawn straight on the hi-res ctx. Falls back
    // to the native overlay below whenever its art is missing or still loading.
    const plaqueRoom = mapInfoRoom ?? mapHoverRoom;
    const plaque = plaqueRoom !== null ? aiPlaqueFor(plaqueRoom) : null;
    if (plaque) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(plaque.bmp, plaque.x * AI_MAP_SCALE, plaque.y * AI_MAP_SCALE);
    }
    const overlay = new Uint8ClampedArray(MAP_W * MAP_H * 4); // transparent; only drawn cells become opaque
    if (drawMapOverlays(overlay, true, plaque !== null)) {
      if (!mapOverlayCanvas) {
        mapOverlayCanvas = document.createElement('canvas');
        mapOverlayCanvas.width = MAP_W;
        mapOverlayCanvas.height = MAP_H;
        mapOverlayCtx = mapOverlayCanvas.getContext('2d');
      }
      mapOverlayCtx!.putImageData(new ImageData(overlay, MAP_W, MAP_H), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mapOverlayCanvas, 0, 0, cw, ch);
    }
    return;
  }
  const rgba = worldMap.render(solved, pulse, depth, cheated, mapHoverCorner, !panelOpen, !panelOpen);
  drawMapOverlays(rgba);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), MAP_W, MAP_H), 0, 0);
}

/**
 * Composite the record panel + name plaque onto a map-sized RGBA buffer (the faithful
 * path passes the base map; the AI path passes a transparent buffer to overlay). The
 * name plaque (KresliDesku, UMain.pas:1484) is drawn for the open panel's room or the
 * hovered room node; the record panel (krokoměr) is drawn when a room panel is open.
 * `aiDigitsOnly` (the AI path) draws only the panel's odometer digits, not its bg/icon
 * artwork — that is drawn straight on the hi-res ctx from the AI bitmaps instead.
 * Returns whether anything was drawn.
 */
/**
 * AI-upscaled world-map name plaques (_desky).
 *
 * KresliDesku blits the plaque OPAQUELY, and the rectangle carries a slice of the map
 * background baked in with the lettering. Drawn at native resolution over the ×4 AI map
 * that pastes a 640×480-resolution patch into an upscaled picture — a visibly pixelated
 * band around the name. So the plaque gets upscaled like everything else, with the SAME
 * model as the map (enforced by test/aiShippedArt.test.ts) so the patch matches.
 */
let aiDeskyGeom: Record<string, { room: number; x: number; y: number; w: number; h: number }> | null = null;
let aiDeskyTried = false;
/** Decoded plaques, bounded: 140 of them at ×4 would be ~30 MB held for hovering. */
const aiDeskyCache = new Map<string, ImageBitmap>();
const AI_DESKY_CACHE_MAX = 12;

async function ensureAiDeskyGeom(): Promise<void> {
  if (aiDeskyTried) return;
  aiDeskyTried = true;
  try {
    const res = await fetch('/enhanced-ai/_desky/plaques.json');
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return;
    aiDeskyGeom = ((await res.json()) as { plaques: typeof aiDeskyGeom }).plaques ?? null;
    mapSig = null; // repaint now that plaques can be drawn hi-res
  } catch (e) {
    console.warn('AI name plaques unavailable:', e);
  }
}

/** The upscaled plaque for `room` in the current subtitle language, if decoded. */
function aiPlaqueFor(room: number): { bmp: ImageBitmap; x: number; y: number } | null {
  if (graphics !== 'ai') return null;
  if (!aiDeskyGeom) { void ensureAiDeskyGeom(); return null; }
  const key = `${deskyLang ?? subLang()}${String(room).padStart(2, '0')}.png`;
  const g = aiDeskyGeom[key];
  if (!g) return null;
  const bmp = aiDeskyCache.get(key);
  if (!bmp) { void loadAiPlaque(key); return null; }
  return { bmp, x: g.x + DESKA_X_OFFSET, y: g.y + DESKA_Y_OFFSET };
}

const aiPlaqueLoading = new Set<string>();
async function loadAiPlaque(key: string): Promise<void> {
  if (aiPlaqueLoading.has(key)) return;
  aiPlaqueLoading.add(key);
  try {
    const res = await fetch(`/enhanced-ai/_desky/${key.replace(/\.png$/, '.webp')}`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return;
    const bmp = await createImageBitmap(await res.blob());
    aiDeskyCache.set(key, bmp);
    while (aiDeskyCache.size > AI_DESKY_CACHE_MAX) {
      const oldest = aiDeskyCache.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === key) break;
      aiDeskyCache.get(oldest)?.close();
      aiDeskyCache.delete(oldest);
    }
    mapSig = null; // the plaque can now be drawn hi-res
    wake();
  } catch {
    /* leave the native plaque in place */
  } finally {
    aiPlaqueLoading.delete(key);
  }
}

function drawMapOverlays(rgba: Uint8ClampedArray, aiDigitsOnly = false, skipPlaque = false): boolean {
  if (!worldMap) return false;
  let drew = false;
  const plaqueRoom = mapInfoRoom ?? mapHoverRoom;
  if (plaqueRoom !== null && deskyData && !skipPlaque) {
    const deska = deskyData.byRoom.get(plaqueRoom);
    if (deska) {
      blitDeska(rgba, MAP_W, MAP_H, deska, deskyData.atlas, worldMap.palette);
      drew = true;
    }
  }
  if (mapInfoRoom !== null && infoPanelAssets) {
    const count = scores.get(mapInfoRoom) ?? null; // best (nej) count; null = cheat-only
    if (aiDigitsOnly) {
      drawInfoDigits(rgba, MAP_W, MAP_H, infoPanelAssets.cisla, count, mapInfoFaze);
    } else {
      const replayEnabled = bestRecord(mapInfoRoom) !== undefined;
      drawInfoPanel(rgba, MAP_W, MAP_H, infoPanelAssets, count, mapInfoHover, mapInfoFaze, replayEnabled);
    }
    drew = true;
  }
  // The Tetris minigame overlays the map when the cheat opens it. It goes through
  // this shared overlay buffer so BOTH map paths get it — the AI path scales the
  // buffer up like the plaque/digits rather than needing its own hi-res blit.
  if (tetris && tetrisArt) {
    blitTetris(rgba, MAP_W, MAP_H);
    drew = true;
  }
  return drew;
}

/** The menu/map music (SpustHudbu, UMain.pas:217): menu.wav, looped at sample 419772. */
function startMenuMusic(): void {
  // Swallow load/decode failures here: menu music is non-critical, and during boot
  // an unhandled rejection would otherwise trip the boot-fatal handler.
  audio.playMusic('menu', '/data/Music/menu.wav', 419772).catch(() => {});
}

/**
 * Show the world map, tearing down the room's audio faithfully (Jedeme end
 * KillSnd + zrus_dialogy + ZrusTitulky, UMain.pas): stop the room music and all
 * voices, clear the dialogue queue and subtitles, then start the menu music.
 */
function showMap(): void {
  stopRoomClock(); // bank this visit's play time before the room goes away
  endSilentFilm(); // TRoom.Done (URoom.pas:1513): leaving the room un-mutes the game
  screen = 'map';
  select.value = 'map'; // keep the dev-bar Room picker in sync with the screen
  clearHeldKey(); // drop any held movement key when leaving the room
  endShowmode(); // leaving the room ends any KUFRIK demonstration
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  mapRevealStart = performance.now(); // restart the reveal animation (Depth := -3)
  audio.killAll(); // KillSnd: stop room music + every voice/effect
  activeScript?.s.clearDialog(); // zrus_dialogy: drop the pending speech queue
  subs?.clear(); // ZrusTitulky: clear any on-screen subtitle
  poslMluv.little = -1;
  poslMluv.big = -1;
  startMenuMusic();
  setInfo();
}

/** ZAVER ("At Home", room 71): the endgame finale cutscene, auto-launched on completion. */
const ZAVER_ROOM = 71;
/**
 * The story page ZAVER ends on: 009.$dv, the medals and the congratulation letter from
 * ŠÉF. It is the ninth page, and the only one no leg win can reach — legs 1..8 map to
 * 001..008, and branches 0 and 9 have no depth-15 room at all.
 */
const ZAVER_LEG = 9;

/**
 * chybi=0 (USoutez.pas:729): every registered room (1..70) is genuinely solved. Cheat-
 * solved rooms live in a separate `cheated` set and do NOT count — the original only
 * treats a room as finished when it holds a real best-solution record (savy[nej].dat<>0).
 */
function allRegisteredSolved(): boolean {
  return REGISTERED_ROOMS.every((r) => solved.has(r));
}

/**
 * Return to the world map after a room is won. Winning the last room of a leg (a
 * depth-15 room, one per branch 1..8) first shows that leg's story "case file" page
 * (zobraz_obrazek, UMain.pas:958/991/1030); every other room returns straight to the
 * map. Cheat-solves bypass this (they call showMap directly), matching the intent
 * that only a genuine finish reveals the page.
 *
 * The ZAVER finale auto-launches only when this win is of a *leg-final* room (depth 15)
 * AND it completes the game — pustitzaver := (hloubka=15) and (chybi=0), USoutez.pas:729
 * → av:=9 daRun, UMain.pas:948. So it always chains out of that final leg's story page;
 * winning an ordinary (non-leg-final) room when everything is already solved just returns
 * to the map. SCORE (room 72) is deliberately never auto-launched — it stays a hidden secret.
 */
function returnFromRoom(): void {
  const roomNum = Number(select.value);
  // pustitzaver: hloubka=15 and chybi=0 — the finale fires only when a genuine win of a
  // *registered leg-final* room (depth 15) leaves no registered room unsolved. A non-leg-
  // final win (even with everything solved) must NOT launch it; nor can the ZAVER win
  // itself (room 71, unregistered, depth −1) re-trigger the finale.
  const finale =
    REGISTERED_ROOMS.includes(roomNum) && depthOfRoom(roomNum) === 15 && allRegisteredSolved();
  if (solved.has(roomNum) && depthOfRoom(roomNum) === 15) {
    const leg = branchOfRoom(roomNum);
    if (leg >= 1 && leg <= 8) {
      // Show the leg page first; if the game is now finished, chain into ZAVER on dismiss.
      void showLegImage(leg, finale ? { room: ZAVER_ROOM } : undefined);
      return;
    }
  }
  if (finale) {
    void enterRoom(ZAVER_ROOM);
    return;
  }
  // ZAVER has just ended: close the game on its story page (009.$dv), then the map.
  //
  // DELIBERATE DEVIATION from the original, which shows this page when the room is
  // LAUNCHED — UMain.pas's daRealyRun runs `if Hloubka[av,am]=16 then zobraz_obrazek(av)`
  // immediately after Spust(), alongside the score screen. The page is a congratulation
  // on finishing the game, so it reads as an ending rather than a title card.
  //
  // It is unreachable in the port otherwise: computeHloubka only covers the nine
  // REGISTERED branches, so room 71 has depth −1 and the original's Hloubka=16 branch
  // can never fire. (The score screen that accompanies it upstream is not ported.)
  if (roomNum === ZAVER_ROOM) {
    void showLegImage(ZAVER_LEG); // no `pending` ⇒ dismisses to the map
    return;
  }
  showMap();
}

/**
 * zobraz_obrazek (UMain.pas:831): show a leg's full-screen story page over a frozen
 * map, with the rybky11 theme. The page is a plain 640×480 8-bit BMP (Menu/00N.$dv);
 * a click or key dismisses it (zrus_obrazek) back to the map. Falls back to the map
 * if the image can't be loaded.
 */
async function showLegImage(leg: number, pending?: { room: number; replay?: string }): Promise<void> {
  let bmp: Bmp;
  try {
    const buf = await fetch(`/data/Menu/00${leg}.$dv`).then((r) => r.arrayBuffer());
    bmp = parseBmp(new Uint8Array(buf));
  } catch {
    // Image unavailable: skip straight to the pending launch, or back to the map.
    if (pending) void enterRoom(pending.room, pending.replay);
    else showMap();
    return;
  }
  legImagePending = pending ?? null;
  legImage = { w: bmp.w, h: bmp.h, rgba: bmpToRgba(bmp) };
  legImageNum = leg;
  legImageDrawn = false;
  screen = 'legimage';
  // Swap in the upscaled page when it is available; the native one shows meanwhile.
  legImageAi?.close();
  legImageAi = null;
  void ensureLegImageAi(leg);
  clearHeldKey();
  endShowmode();
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  activeScript?.s.clearDialog(); // zrus_dialogy: drop any pending speech
  subs?.clear(); // ZrusTitulky: clear any on-screen subtitle
  audio.killAll(); // Killsnd
  void audio.playMusic('rybky11', '/data/Music/rybky11.wav', 0); // Music('rybky11')
  wake();
}

/**
 * zrus_obrazek (UMain.pas:847): dismiss the leg story page. If it was shown on re-entry
 * (Run/Replay of a solved room, daClickAndRun UMain.pas:966), continue into that room;
 * otherwise (the after-win case) return to the map.
 */
function dismissLegImage(): void {
  legImage = null;
  legImageNum = -1;
  legImageAi?.close();   // a 2560x1920 page is ~20MB decoded; don't hold it after dismissal
  legImageAi = null;
  const pending = legImagePending;
  legImagePending = null;
  if (pending) void enterRoom(pending.room, pending.replay);
  else showMap();
}

/** Blit the current leg story page full-screen, sized like the map (fit-mode aware). */
function drawLegImage(): void {
  if (!legImage) return;
  const { w, h, rgba } = legImage;
  const cs = contentScaleFor(w, h);
  // The CSS box always follows the NATIVE page size; only the BACKING STORE grows when
  // the upscaled page is in use. Deriving the box from the backing store instead is the
  // mistake that mis-sized the subtitle overlay (see roomGeometry).
  const backW = legImageAi ? legImageAi.width : w;
  const backH = legImageAi ? legImageAi.height : h;
  if (canvas.width !== backW || canvas.height !== backH) {
    canvas.width = backW;
    canvas.height = backH;
    legImageDrawn = false; // the resize cleared the backing store
  }
  const cssW = `${w * cs}px`;
  const cssH = `${h * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // The ×4 page is displayed smaller than it is, where the stylesheet's global
  // pixelated rule would point-sample the detail away (same rule as the AI room).
  const wantSmooth = legImageAi ? scalingFilterFor(backW, w * cs) : '';
  if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
  if (legImageDrawn) return; // static page — blit once, then let the loop idle
  legImageDrawn = true;
  if (legImageAi) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, backW, backH);
    ctx.drawImage(legImageAi, 0, 0);
  } else {
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }
  perfPaint++;
}

/**
 * Load the AI-upscaled story page for `leg`, when the `ai` tier is selected.
 *
 * Resolves to nothing on any failure, leaving the original page in place — the same
 * fallback contract as the rest of the tier. `legImageNum` is re-checked after the
 * await so a page dismissed (or replaced) mid-load cannot install itself late.
 */
async function ensureLegImageAi(leg: number): Promise<void> {
  if (graphics !== 'ai') return;
  try {
    const res = await fetch(`/enhanced-ai/_story/leg${leg}.webp`);
    if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return;
    const bmp = await createImageBitmap(await res.blob());
    if (legImageNum !== leg || screen !== 'legimage') { bmp.close(); return; }
    legImageAi?.close();
    legImageAi = bmp;
    legImageDrawn = false; // repaint at the new resolution
    wake();
  } catch (e) {
    console.warn(`AI story page unavailable for leg ${leg}:`, e);
  }
}

/**
 * Play the intro movie sequence over the stage, then return to the map (the
 * original's daLogo/daIntro chain, UMain.pas:1064-1112). `gated` shows the
 * "click to start" splash first (first-run auto-play). The game audio is torn
 * down before playback (KillSnd/FinishSound) — the movie carries its own sound.
 * Each `resolver` is called at the moment its movie starts, so the source tracks
 * the graphics level chosen right then (e.g. AI-upscaled picked on the splash).
 */
function playIntroMovies(resolvers: Array<() => string>, gated: boolean, onFinish: () => void): void {
  if (intro.playing) return;
  screen = 'intro';
  audio.killAll();
  intro.start(resolvers, onFinish, gated);
}

/** The first-run intro (logo → intro), after which the flag flips so it won't auto-play again. */
function playFirstRunIntro(): void {
  playIntroMovies([logoMovie, introMovie], true, () => {
    settings.introSeen = true;
    saveSettings(settings);
    showMap();
  });
}

/** Replay just the intro movie from the map's top-left corner (daIntro plays FilmAvi only). */
function replayIntro(): void {
  playIntroMovies([introMovie], false, () => showMap());
}

/**
 * Handle a click on one of the map's corner "buttons" (UMain.pas daIntro/
 * daCredits/daOptions dispatch, 1064-1135). Exit is intentionally unwired — a
 * browser tab can't quit — so its corner is inert.
 */
function dispatchMapCorner(action: MapAction | null): void {
  switch (action) {
    case 'intro':
      replayIntro();
      break;
    case 'options':
      openMapOptions();
      break;
    case 'credits':
      void openCredits();
      break;
    case 'exit':
    case null:
      break; // Exit: no-op on the web; empty corner otherwise
  }
}

/** Open the Options panel over the map (daOptions modal Ovl, UMain.pas:1120-1135). */
function openMapOptions(): void {
  mapOverlay = 'options';
  ostav = O_OPTIONS; // open straight to the options face (no in-room scroll)
  scroll = SCMAX;
}

/** Close whichever menu overlay is open over the map, back to the plain map. */
function closeMapOverlay(): void {
  hideAiCredits();   // the credits overlay replaces the canvas — always restore it
  mapOverlay = 'none';
  ostav = O_NORMAL;
  panelDragBus = null;
  panelPressed = 0;
  creditMode = -1;
}

/**
 * Open the scrolling credits over the map (daCredits → InitCredits, UMain.pas:
 * 1114-1119,761). Lazily loads CredStat1 (static frame) + CredMov (scroll strip)
 * once; the roll then advances off wall-clock and auto-closes at the end.
 */
async function openCredits(): Promise<void> {
  if (mapOverlay !== 'none') return;
  if (!credits) {
    const bmp = async (f: string): Promise<Bmp> => {
      const r = await fetch(`/data/Menu/${f}`);
      if (!r.ok) throw new Error(`${f}: ${r.status}`);
      return parseBmp(new Uint8Array(await r.arrayBuffer()));
    };
    try {
      // CredMov_port is the shipped strip with the web-port card prepended
      // (tools/build-credits-port.py). It is a drop-in in the same palette, and since
      // the strip's height defines `delka`, the roll extends to cover it by itself.
      // Falls back to the untouched original when the port variant isn't built.
      const mov = await bmp('CredMov_port.BMP').catch(() => bmp('CredMov.BMP'));
      credits = new Credits(await bmp('CredStat1.BMP'), mov);
    } catch {
      return; // credits assets missing — leave the map as-is
    }
  }
  mapOverlay = 'credits';
  creditMode = 0;
  creditsStart = performance.now();
}

/** Render the scrolling credits full-screen on the main canvas (PaintBox1Paint, UMain.pas:1420). */
function drawCredits(): void {
  if (!credits) return;
  mapSig = null; // credits paint #screen — invalidate the map cache
  // Advance the scroll off wall-clock (CreditMode += CreditSpeed every 100ms);
  // auto-close once it has settled and held (UMain.pas:867-869).
  // The original advances in whole CREDIT_SPEED steps once per CREDIT_TICK_MS, which is
  // a 4px jump at 10Hz. `creditMode` keeps that stepped value because it drives game
  // logic (the auto-close) and is exposed for tests; `creditScroll` is the same ramp
  // left CONTINUOUS, so the AI renderer — which positions a bitmap rather than indexing
  // pixels — can roll smoothly. Same speed, same total duration, just not quantised.
  const creditElapsed = (performance.now() - creditsStart) / CREDIT_TICK_MS;
  creditMode = Math.floor(creditElapsed) * CREDIT_SPEED;
  const creditScroll = creditElapsed * CREDIT_SPEED;
  if (creditMode > credits.closeAt) {
    closeMapOverlay();
    return;
  }
  if (graphics === 'ai' && !aiCreditsTried) { aiCreditsTried = true; void ensureAiCredits(); }
  const ai = graphics === 'ai' ? aiCredits : null;
  // Display size follows the SAME fit rule as the map and the story pages
  // (contentScaleFor on the NATIVE size). It used to be pinned at 640x480 CSS px, so
  // the credits stayed a small window in the middle of a large viewport while every
  // other screen filled it.
  const cs = contentScaleFor(credits.w, credits.h);
  const dispW = Math.round(credits.w * cs);
  const dispH = Math.round(credits.h * cs);

  if (ai) {
    // GPU path: two stacked <img> layers replace the canvas, and the roll is a CSS
    // transform the compositor animates. Per frame this is one style write — the
    // canvas version cost ~2.4ms of JS for the same picture (see creditsAi.ts).
    // #screen lives inside `wrap` (centred in the stage box); mount the overlay there
    // so it inherits the same centring and letterboxing the canvas gets.
    if (!ai.el.isConnected) wrap.appendChild(ai.el);
    if (creditsLayoutW !== dispW || creditsLayoutH !== dispH) {
      creditsLayoutW = dispW;
      creditsLayoutH = dispH;
      ai.layout(dispW, dispH);
    }
    canvas.style.display = 'none';
    ai.show();
    ai.setScroll(creditScroll);
    return;
  }

  hideAiCredits();
  if (canvas.width !== credits.w || canvas.height !== credits.h) {
    canvas.width = credits.w;
    canvas.height = credits.h;
  }
  const cssW = `${dispW}px`;
  const cssH = `${dispH}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  const rgba = credits.render(creditMode);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), credits.w, credits.h), 0, 0);
}

/** Enter a room from the map (or the dev dropdown); KillSnd first (Spust, UMain.pas:248).
 *  `replay` is the best-solution move record to play back animated (map "Replay"). */
function enterRoom(num: number, replay?: string): Promise<void> {
  wake();
  stopRoomClock(); // bank the outgoing room's time before the switch
  screen = 'room';
  beginRoomLoadingUi(num); // delayed; a cached entry lands before it ever shows
  startRoomClock(num); // TRoom.Start: casstartu := Date+Time
  mapHoverCorner = null; // drop any map corner hover on leaving the map
  mapHoverRoom = null;
  canvas.style.cursor = 'default';
  audio.killAll(); // stop the menu music + anything before the room starts its own
  select.value = String(num);
  const p = loadRoom(num);
  if (replay) {
    const moves = movesOf(replay);
    void p.then(() => {
      // Arm the best-solution playback once the fresh room is built (loadRoom resets
      // srecord); it then advances one move per idle tick in step().
      if (moves.length) replaymode = { moves, idx: 0 };
    });
  }
  return p;
}

/** Dispatch a control-panel button (ZaznamenejPrikazMysi, Uovl.pas:630).
 *  `panelX` is the click's panel x-coordinate, used by the volume sliders (PomObl). */
function panelAction(region: number, panelX = 0): void {
  switch (region) {
    case 1:
    case 2:
    case 3:
    case 4: // little fish up/down/left/right (region == Dir value)
      if (idle() && engine && !fishBusy('little')) {
        hracNespi();
        engine.swim = null;
        engine.active = 'little';
        tryStep('little', region);
      }
      break;
    case 5:
      selectFish('little'); // akce_set
      break;
    case 6:
    case 7:
    case 8:
    case 9: // big fish up/down/left/right (Dir = region - 5)
      if (idle() && engine && !fishBusy('big')) {
        hracNespi();
        engine.swim = null;
        engine.active = 'big';
        tryStep('big', region - 5);
      }
      break;
    case 10:
      selectFish('big'); // akce_set
      break;
    case 11: // swap the active fish (akce_switch — only if the other is alive)
      swapActive();
      break;
    case 12:
      if (atRest()) saveGame();
      break;
    case 13:
      if (atRest()) loadGame();
      break;
    case 14: // exit to the world map
      showMap();
      break;
    case 15: // restart the room (Restart, URoom.pas:1577): fresh attempt
      restartRoom();
      break;
    case 16: // toggle the options sub-panel (oblroh)
      togglePanelOptions();
      break;
    case 17: // sound-effects volume slider (oblsnd)
      setVolume('effect', sliderIndex(panelX));
      break;
    case 18: // voices volume slider (obltalk)
      setVolume('voice', sliderIndex(panelX));
      break;
    case 19: // music volume slider (oblmusic)
      setVolume('music', sliderIndex(panelX));
      break;
    case 20: // subtitles: Czech (obltitcz)
      setSubtitleMode('cz');
      break;
    case 21: // subtitles: English (obltiteng)
      setSubtitleMode('en');
      break;
    case 22: // subtitles: off (obltitno)
      setSubtitleMode('off');
      break;
    case 23: // help screens (oblhelp / akce_help)
      openHelp();
      break;
  }
  setInfo();
}


/**
 * posl_mluv update (URoom.pas:25734-25743): while a fish's voice is sounding,
 * cycle its mouth frame (0..2) randomly every other tick; -1 when silent.
 */
function updateLipSync(): void {
  if (!room) return;
  for (const which of ['little', 'big'] as const) {
    const alive = which === 'little' ? room.alive.little : room.alive.big;
    const talking = alive && (audio.talking(MLUVI_PRIOR[which]) || audio.talking(3));
    if (talking) {
      if (poslMluv[which] === -1) poslMluv[which] = Math.floor(Math.random() * 3);
      else if (count % 2 === 1) {
        poslMluv[which] =
          Math.random() < 0.5 ? (poslMluv[which] + 1) % 3 : (poslMluv[which] + 2) % 3;
      }
    } else {
      poslMluv[which] = -1;
    }
  }
}

/** Head frame (URoom.pas:25756-25760): talking mouth > pushing > blink > default face. */
function headFor(which: 'little' | 'big', tlaci: boolean): number {
  if (poslMluv[which] !== -1) return HL_MLUVI[poslMluv[which]]!;
  if (tlaci) return HL_TLACI;
  // xicht (URoom.pas:25759-25760): a room-set face wins over the idle blink; only
  // a neutral face (xicht=0) shows the occasional blink.
  const face = room ? room.xicht[which] : 0;
  if (face !== 0) return face;
  if (blink[which] > 0) return HL_MRK;
  return 0;
}

/** KresliRybu frame selection (URoom.pas:25658-25760), per fish. */
function fishFrameFor(which: 'little' | 'big'): FishFrame {
  const phase = engine?.phase ?? 'idle';
  const activeAnimFish = engine?.activeAnimFish ?? 'little';
  const animFrame = engine?.animFrame ?? 0;
  const exiting = engine?.exiting ?? null;
  // gspec=2 darkness (URoom.pas:25746-25748): overrides every other body state —
  // the fish is a dark silhouette (tl_tma) that winks out while turning or on a
  // ~6% per-tick flicker. No head overlay (BMh stays nil).
  if (room?.gspec === 2) {
    const turning = phase === 'turn' && activeAnimFish === which;
    return { bodyFrame: darkBodyFrame(turning || darkFlicker[which]), headFrame: 0 };
  }
  const moving = phase === 'move' && activeAnimFish === which && room !== null;
  if (moving) {
    const dir = room!.items[which === 'little' ? room!.littleIdx : room!.bigIdx]!.dir;
    const tagr = count % 6; // tl_plav cycles per game tick during the swim
    const bodyFrame =
      dir === Dir.up ? TL_NAHORU[tagr]! : dir === Dir.down ? TL_DOLU[tagr]! : TL_PLAV[tagr]!;
    return { bodyFrame, headFrame: headFor(which, room!.tlaceno) };
  }
  if (phase === 'turn' && activeAnimFish === which) {
    const tf = Math.min(Math.floor(animFrame / (TURN_FRAMES / 3)), 2);
    return { bodyFrame: TL_OTOCKA[tf]!, headFrame: 0 }; // otocka: no head
  }
  if (phase === 'kuk' && activeAnimFish === which) {
    // stav_kuk (URoom.pas:25693-25698): the peek-at-player pose — body turned to face
    // the user (tl_otocka[1]) with the head hidden (otocka).
    return { bodyFrame: TL_OTOCKA[0]!, headFrame: 0 };
  }
  if (phase === 'exit' && exiting?.which === which) {
    const tagr = count % 6;
    const bodyFrame =
      exiting.dir === Dir.up ? TL_NAHORU[tagr]! : exiting.dir === Dir.down ? TL_DOLU[tagr]! : TL_PLAV[tagr]!;
    return { bodyFrame, headFrame: 0 };
  }
  // Resting: a `busy` fish is turned to its partner (tl_mluvi_na body, head baked in);
  // otherwise idle body + a talking/blink/default head overlay (URoom.pas:25750-25760).
  const busy = room ? (which === 'little' ? room.busy.little : room.busy.big) === 1 : false;
  if (busy) {
    const bodyFrame = poslMluv[which] !== -1 ? TL_MLUVI_NA[poslMluv[which]]! : TL_OTOCKA[0]!;
    return { bodyFrame, headFrame: 0 };
  }
  const fazer = Math.floor(count / 8) % 3; // gentle idle cycle
  return { bodyFrame: TL_ZAKLAD[fazer]!, headFrame: headFor(which, false) };
}


/**
 * The classic art source (room palette → RGBA LUT) for the current room, rebuilt
 * only when the room changes so the compositor's hot path doesn't reallocate the
 * 256-entry table every frame.
 */
let classicArt: ClassicArtSource | null = null;
let classicArtRoom: Room | null = null;
function classicArtFor(r: Room): ClassicArtSource {
  if (classicArtRoom !== r || classicArt === null) {
    classicArt = new ClassicArtSource(r.palette);
    classicArtRoom = r;
  }
  return classicArt;
}

/**
 * A WebGL compositor built on demand from the stacked #screen-gl canvas, at most once
 * per context: `reset()` (context loss / re-enable) lets the next call rebuild it.
 * Yields null — meaning "use the CPU path" — when WebGL2 is unavailable or construction
 * fails, which is a normal outcome, not an error.
 *
 * There are two of these (the faithful compositor and the `ai` tier's) and they share
 * one canvas and one context: `getContext('webgl2')` returns the context the other one
 * already created. Only the class differs, so only the class is passed in.
 */
function lazyCompositor<T>(what: string, build: (gl: WebGL2RenderingContext) => T) {
  let comp: T | null = null;
  let tried = false;
  return {
    get(): T | null {
      if (tried) return comp;
      tried = true;
      if (!webgl2Available()) return null;
      const gl = glCanvas.getContext('webgl2');
      if (!gl) return null;
      try {
        comp = build(gl);
      } catch (e) {
        console.warn(`[ff] the ${what} WebGL compositor failed to build; staying on the CPU path`, e);
        comp = null;
      }
      return comp;
    },
    /** Drop the built compositor so the next `get()` rebuilds it. */
    reset(): void {
      comp = null;
      tried = false;
    },
    /** Allow a rebuild only if nothing is live — a cpu→webgl toggle must not leak one. */
    allowRebuild(): void {
      if (!comp) tried = false;
    },
  };
}

const roomGl = lazyCompositor('room', (gl) => new GlScreen(gl));
const aiGl = lazyCompositor('ai tier', (gl) => new GlAiScreen(gl));
const glCompositor = (): GlScreen | null => roomGl.get();
const glAiCompositor = (): GlAiScreen | null => aiGl.get();

// WebGL context loss (GPU reset, driver reclaim, tab backgrounding) does NOT
// throw — it fires an event and makes subsequent GL calls silently no-op, which
// would otherwise leave a blank canvas. Handle it as the real per-frame fallback
// net: disable the GPU backend for now (→ the dispatch takes the CPU path and
// hides #screen-gl automatically) and drop the dead compositor so it is rebuilt
// on the next explicit enable. preventDefault() lets the browser restore the
// context; on restore we allow a fresh GlScreen to be created.
glCanvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  glFailed = true;
  glAiFailed = true;
  roomGl.reset();
  aiGl.reset();
  console.warn('[ff] WebGL context lost; falling back to the CPU compositor. Press R to retry WebGL.');
  setInfo();
});
glCanvas.addEventListener('webglcontextrestored', () => {
  // Allow a rebuild, but stay on CPU until the user re-enables WebGL (R), so a
  // flapping context can never thrash the render path.
  roomGl.reset();
  aiGl.reset();
});

/**
 * Clear the WebGL disabled-for-session state so both GPU backends can run again.
 * Rebuilds a compositor only if none is live (i.e. after a context loss); a normal
 * cpu→webgl toggle keeps the existing ones rather than leaking them.
 */
function enableWebgl(): void {
  glFailed = false;
  glAiFailed = false;
  roomGl.allowRebuild();
  aiGl.allowRebuild();
}

/**
 * The enhanced art source for the current room + currently-loaded FFNG art,
 * rebuilt only when the room or its decoded art/objects/fish change (so the
 * per-frame hot path doesn't reallocate the palette LUT). Used for every room in
 * enhanced mode — the source itself falls back to classic per element where no
 * truecolor art exists.
 */
let enhArt: EnhancedArtSource | null = null;
let enhKey: [Room | null, EnhancedArt | null, EnhancedObject[], FishSprites | null] = [null, null, [], null];
function enhancedArtFor(r: Room): EnhancedArtSource {
  const fish = cheatFishSprites ?? fishSprites; // xundead/xmorph reshape these
  if (
    enhArt === null ||
    enhKey[0] !== r ||
    enhKey[1] !== enhancedArt ||
    enhKey[2] !== enhancedObjects ||
    enhKey[3] !== fish
  ) {
    enhArt = new EnhancedArtSource(r.palette, enhancedArt, enhancedObjects, fish);
    enhKey = [r, enhancedArt, enhancedObjects, fish];
  }
  return enhArt;
}


/**
 * WebGL draw path: composite the room on the GPU via the shared renderInto
 * (GlScreen) — either art source (classic palette or enhanced FFNG truecolor) —
 * and present to #screen-gl. Returns false to request the CPU fallback if a GL
 * call throws (the backend is then disabled for the session) or, defensively, if
 * the compositor ever flags a frame `unsupported`. Never throws.
 */
function drawGpu(
  geom: RoomGeometry,
  art: ArtSource,
  opts: RenderOptions,
  useVecSubs: boolean,
): boolean {
  const gl = glCompositor();
  if (!gl || !room) return false;
  try {
    gl.begin(geom.nativeW, geom.nativeH, room.palette);
    renderRoomInto(gl, room, art, opts);
    if (gl.unsupported) return false; // defensive: an un-ported primitive → CPU this frame
    if (!useVecSubs) subs?.draw(gl, opts.count ?? 0); // baked subtitles via GPU setIndex
    presentToGlCanvas(gl, geom);
    return true;
  } catch (e) {
    glFailed = true;
    console.warn('[ff] WebGL renderer failed; falling back to the CPU compositor for this session', e);
    return false;
  }
}

/**
 * WebGL draw path for the `ai` tier: composite the room's ×S frame on the GPU via the
 * shared room walk (AiRoom.drawInto → GlAiScreen) and present it to #screen-gl.
 * Returns false to request the canvas-2D fallback — when the compositor could not be
 * built, when the GPU cannot hold this room's ×S buffer, when a primitive could not run,
 * or when a GL call throws (which disables this backend for the session). Never throws.
 */
function drawAiGpu(geom: RoomGeometry, r: Room, f: AiRoomFrame): boolean {
  const comp = glAiCompositor();
  if (!comp || !aiRoom) return false;
  try {
    comp.track(aiRoom); // so evicting the room frees its ~50 MB of textures with it
    // Not a formality: a ×4 room needs up to 3120px, WebGL2 only guarantees 2048, and an
    // oversized allocation is reported as a GL error rather than thrown — so without
    // this the frame would be "successfully" presented blank.
    if (!comp.begin(geom.backingW, geom.backingH)) return false;
    aiRoom.drawInto(comp, r, f);
    if (comp.unsupported) return false;
    presentToGlCanvas(comp, geom);
    return true;
  } catch (e) {
    glAiFailed = true;
    console.warn('[ff] the AI tier WebGL compositor failed; falling back to canvas-2D for this session', e);
    return false;
  }
}

/**
 * Size #screen-gl to the room's CSS box at device resolution and present into it.
 *
 * The room's box comes from roomGeometry — the GL canvas is an overlay stacked on
 * #screen, so it must match that box exactly rather than recompute it. Shared by both
 * GPU paths: the compositors differ entirely, the presentation does not.
 */
function presentToGlCanvas(comp: { present(w: number, h: number): void }, geom: RoomGeometry): void {
  const dpr = window.devicePixelRatio || 1;
  const { cssW, cssH } = geom;
  const bw = Math.round(cssW * dpr);
  const bh = Math.round(cssH * dpr);
  if (glCanvas.width !== bw || glCanvas.height !== bh) {
    glCanvas.width = bw;
    glCanvas.height = bh;
  }
  glCanvas.style.width = `${cssW}px`;
  glCanvas.style.height = `${cssH}px`;
  comp.present(bw, bh);
}

/**
 * Per-channel diff (ignoring alpha) between two same-size RGBA frames, plus WHERE they
 * disagree worst and what each side holds there.
 *
 * The aggregate alone says a parity probe failed but not where to look, and in a
 * 2400x2100 buffer "0.004% of the pixels are wrong" is a needle in a haystack — so a
 * failing room names its own suspect pixel. `w` (the frame width) turns the index into
 * coordinates; pass 0 when the caller has no use for them.
 *
 * Both are computed in ONE pass. A second sweep is another ~20 MB of pixel traffic per
 * room at this tier's frame sizes, times 72 rooms, on a machine already running the
 * whole probe suite in parallel — and the UI gate's value is that it stays fast enough
 * to run on every change.
 */
function glChannelDiff(
  cpu: Uint8Array,
  gpu: Uint8Array,
  w = 0,
): {
  max: number;
  rmse: number;
  overPct: number;
  worstAt: [number, number];
  worstCpu: number[];
  worstGpu: number[];
} {
  let max = 0;
  let sumsq = 0;
  let over = 0;
  let px = 0;
  let at = 0;
  const n = gpu.length;
  for (let i = 0; i < n; i += 4) {
    let pixMax = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(gpu[i + c]! - cpu[i + c]!);
      if (d > pixMax) pixMax = d;
      sumsq += d * d;
      if (d > 2) over++;
      px++;
    }
    if (pixMax > max) { max = pixMax; at = i; }
  }
  const idx = at / 4;
  return {
    max,
    rmse: Math.sqrt(sumsq / px),
    overPct: (over / px) * 100,
    worstAt: w > 0 ? [idx % w, Math.floor(idx / w)] : [idx, 0],
    worstCpu: [cpu[at]!, cpu[at + 1]!, cpu[at + 2]!, cpu[at + 3]!],
    worstGpu: [gpu[at]!, gpu[at + 1]!, gpu[at + 2]!, gpu[at + 3]!],
  };
}

/**
 * Test-only GPU-vs-CPU parity probe: render the current room through both the
 * CPU (`renderRoomRgba`) and the GPU (`renderRoomInto` → GlScreen) with the given
 * art source and compare (max/rmse channel diff, % of channels differing > 2).
 * For the ZX room (gspec=42) the band width + colour cycle are `Math.random`-
 * driven per frame, so the comparison seeds `Math.random` to a constant and
 * snapshots/restores the room's zx state around the two renders — both passes see
 * identical inputs, giving a byte-exact check while the LIVE render stays random.
 */
function glParityCompare(art: ArtSource): Record<string, unknown> | null {
  if (!room) return null;
  const comp = glCompositor();
  if (!comp) return { webgl: false };
  const opts = { count };
  const isZx = room.gspec === 42;
  const realRandom = Math.random;
  // For the ZX room the band width + colour cycle are Math.random-driven and
  // blitZX advances room.zx, so (a) seed Math.random to a constant and (b)
  // snapshot room.zx — rewound between the CPU and GPU passes so both see
  // identical input, and fully restored in `finally` so this probe leaves the
  // live loading-band animation exactly where it found it (no side effects).
  let zxSnap: { pruh: number; count: number; cur: number; colors: number[] | null } | null = null;
  if (isZx) {
    Math.random = () => 0.5;
    const zx = room.zx;
    zxSnap = { pruh: zx.pruh, count: zx.count, cur: zx.cur, colors: zx.colors };
  }
  try {
    const cpu = renderRoomRgba(room, art, opts);
    if (zxSnap) Object.assign(room.zx, zxSnap); // rewind zx so the GPU pass sees identical state
    comp.begin(cpu.width, cpu.height, room.palette);
    renderRoomInto(comp, room, art, opts);
    if (comp.unsupported) return { webgl: true, unsupported: true };
    const gpu = comp.readback();
    if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
    return { webgl: true, w: gpu.w, h: gpu.h, ...glChannelDiff(cpu.rgba, gpu.rgba) };
  } finally {
    if (isZx) {
      Math.random = realRandom;
      if (zxSnap) Object.assign(room.zx, zxSnap); // restore live animation state
    }
  }
}

function draw(): void {
  if (!room) return;
  mapSig = null; // this frame paints #screen with the room — invalidate the map cache
  // While this room's art is still loading, hold the previous frame rather than
  // painting a tier the player did not ask for — the classic look before enhanced
  // lands, or the enhanced look before the AI upscale does. Cleared as soon as the
  // art resolves (or is known missing), so a room with no masters still falls back.
  if (roomArtPending()) return;
  const phase = engine?.phase ?? 'idle';
  const animFrame = engine?.animFrame ?? 0;
  const exitFrames = engine?.exitFrames ?? 8;
  const corkExit = engine?.corkExit ?? null;
  // Interpolate within the current logic tick for smooth motion at the render rate.
  const sub = animFrame + alpha;
  let slide = 0;
  if (phase === 'move') slide = sub / (engine?.cellFrames ?? MOVE_FRAMES); // jizda speed-up (locked per cell)
  else if (phase === 'fall') slide = sub / FALL_FRAMES;
  else if (phase === 'exit') slide = (sub / exitFrames) * EXIT_CELLS; // slide the fish off-screen
  else if (phase === 'cork' && corkExit)
    // gspec=9 exit-slide (KresliMistnost, URoom.pas:26267): the pushed item moves
    // 5px per frame for its faziVen = 3*a frames, i.e. exactly its own width/height
    // (a cells at fsize=15) — NOT the fixed EXIT_CELLS a fish swims out by. LODE's
    // buh2 is 6 cells wide, so the old constant left it a cell short before it popped.
    slide = sub / 3;
  const fishAnim = { little: fishFrameFor('little'), big: fishFrameFor('big') };
  // Smoothness instrumentation: record the active fish's interpolated on-screen position
  // each rendered frame, so a harness can measure per-frame motion (stalls / jumps).
  if (smoothLog) {
    const af = engine?.activeAnimFish ?? 'little';
    const fit = room.items[af === 'little' ? room.littleIdx : room.bigIdx];
    if (fit) {
      const dxs = fit.dir === Dir.left ? -1 : fit.dir === Dir.right ? 1 : 0;
      const dys = fit.dir === Dir.up ? -1 : fit.dir === Dir.down ? 1 : 0;
      smoothLog.push({
        t: performance.now(),
        n: count,
        a: alpha,
        cf: engine?.cellFrames ?? MOVE_FRAMES,
        x: (fit.x + slide * dxs) * FSIZE,
        y: (fit.y + slide * dys) * FSIZE,
        ph: phase,
      });
      if (smoothLog.length > 4000) smoothLog.shift();
    }
  }
  // Subtitles: in enhanced mode with the vector font ready, render them on the
  // high-res overlay (crisp, above the pixel frame) instead of baking them into
  // the frame. Otherwise (classic, or font not yet loaded) bake them in.
  const useVecSubs = enhancedArtActive() && subs !== null && subFontReady;
  // Native/fallback path (the AI room compositor above bypasses it entirely):
  // one compositor, one pass. The art source is the ONLY switch between the
  // classic (palette) and enhanced (FFNG truecolor) looks; the enhanced source
  // itself falls back to classic per element where no truecolor art exists
  // (darkness/ZX/bonus, the mirror glass, skeletons, un-mapped frames).
  const art = enhancedArtActive() ? enhancedArtFor(room) : classicArtFor(room);
  const opts = { count, slide, fishAnim, hooks: hooks.snapshot };
  const geom = roomGeometry(room);
  const { nativeW: sw, nativeH: sh, scale: cs, cssW, cssH } = geom;
  // TrepatRoom (URoom.pas:24955): a chatter line can shake the room — jitter the
  // active canvas left/right by 10px on alternating multiples of 3 ticks.
  const trepat = activeScript?.s.trepat ?? 0;
  const shakeX = trepat !== 0 && count % 3 === 0 ? (count % 6 === 0 ? -10 : 10) : 0;
  const off = activeScript?.s.screenOffset;
  // shake/shove/script-offset are native game px, scaled by the current display scale.
  const ox = (shakeX + screenShoveX + (off?.x ?? 0)) * cs;
  const oy = (off?.y ?? 0) * cs;
  const xform = ox || oy ? `translate(${ox}px, ${oy}px)` : '';

  // Backend dispatch. The hi-res AI room compositor (ai level, art loaded, and not
  // a ZX / active-hook / frame-effect frame — see aiRoomRenderActive) takes precedence.
  // It composites the SAME room walk (AiRoom.drawInto) into a ×S buffer on either
  // backend: GlAiScreen on the GPU, presented to #screen-gl, or canvas-2D into the
  // ×S-scaled #screen canvas which the browser then scales down to the room's CSS box.
  // Otherwise the renderInto compositor runs on the GPU (GlScreen) or CPU (RgbaScreen).
  // Any GL error falls back to the CPU path for that frame (and disables WebGL for the
  // session).
  const aiActive = aiRoomRenderActive(room);
  if (aiActive) {
    // roomGeometry already resolved the ×S backing store for this frame — deriving it a
    // second time here is how the two drifted apart before.
    const aw = geom.backingW;
    const ah = geom.backingH;
    // `alpha` rides along so the GPU compositor can sample the water wave at the
    // display rate rather than at the 12.5 Hz logic tick (see AiTarget.background). It
    // is the same sub-tick fraction `slide` above is derived from, and it is read-only:
    // no game state, timing or logic depends on it here.
    const aiFrameState: AiRoomFrame = { count, alpha, slide, fishAnim };
    const aiGpu = renderer === 'webgl' && !glAiFailed && drawAiGpu(geom, room, aiFrameState);
    lastRoomBackend = aiGpu ? 'webgl' : 'cpu';
    // On the GPU path #screen is only the flow anchor: it still carries the room's CSS
    // box (everything stacked over the room is positioned against it) but keeps a NATIVE
    // backing store, because allocating the ×S one for a canvas nothing paints into
    // would cost ~20 MB for nothing. On the canvas-2D path it IS the ×S composite, and
    // is then displayed smaller than it is (e.g. 3060px in a 1139px box) — which the
    // stylesheet's global `pixelated` rule would point-sample, throwing the AI detail
    // away, hence scalingFilterFor.
    const bw = aiGpu ? geom.nativeW : aw;
    const bh = aiGpu ? geom.nativeH : ah;
    const wantSmooth = aiGpu ? '' : scalingFilterFor(aw, cssW);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
    if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
    if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
    glCanvas.style.display = aiGpu ? 'block' : 'none';
    if (aiGpu) glCanvas.style.transform = xform;
    else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, aw, ah);
      aiRoom!.draw(ctx, room, aiFrameState);
    }
    canvas.style.transform = xform; // on the GPU path this keeps the anchor under the overlays
  } else {
  // Back on a native-resolution tier: restore the stylesheet's crisp scaling
  // (the AI branch switches this to smooth minification).
  if (canvas.style.imageRendering) canvas.style.imageRendering = '';
  // The frame effects (megabomb flash, silent film, interlaced, the Tetris overlay)
  // are applied by the CPU compositor only, so they force that path — same reason
  // aiRoomRenderActive() bails on them.
  const wantGpu = renderer === 'webgl' && !glFailed && !frameEffectsActive();
  const gpuOk = wantGpu && drawGpu(geom, art, opts, useVecSubs);
  lastRoomBackend = gpuOk ? 'webgl' : 'cpu'; // the backend that ACTUALLY painted this frame (for the HUD)
  // #screen (the 2D canvas) is the flow anchor for the wrap that also holds the
  // absolutely-positioned #screen-gl + #subs overlays and sits left of #panel, so
  // it must ALWAYS carry the room's CSS box — even in WebGL mode where we don't
  // draw into it. Otherwise it stays at the default 300×150, the wrap collapses,
  // the GL canvas overflows over the panel and #info crosses the frame.
  // (backingW/H is the native size here: only the AI branch above upscales.)
  if (canvas.width !== geom.backingW || canvas.height !== geom.backingH) {
    canvas.width = geom.backingW;
    canvas.height = geom.backingH;
  }
  // Keep the CSS box in sync every frame so it also tracks resize / fit-mode change
  // (the display scale can change while the room — and thus sw/sh — stays the same).
  if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
  if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
  if (gpuOk) {
    glCanvas.style.display = 'block';
    glCanvas.style.transform = xform;
    canvas.style.transform = xform; // keep the (hidden) anchor aligned under the overlays
  } else {
    // CPU path (default + fallback): render RGBA and blit into the 2D canvas.
    glCanvas.style.display = 'none';
    const screen = renderRoomRgba(room, art, opts);
    applyFrameEffects(screen, useVecSubs);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(screen.rgba), sw, sh), 0, 0);
    canvas.style.transform = xform;
  }
  }
  // Enhanced subtitle overlay (drawn in native game coords via a scaled context).
  // Only touch the (large) overlay while a subtitle is actually on screen; once it
  // clears we wipe it a single time, so idle frames do no overlay work at all.
  updateRoomSubOverlay(useVecSubs, cs, xform);
}

/**
 * Repaint the room's vector subtitle overlay if — and only if — its image would
 * differ from what is already on it (see subOverlaySignature). Split out of draw()
 * because the overlay is an independent layer: while a line waves in, the loop keeps
 * this running at the sub-tick animation rate WITHOUT repainting the room behind it.
 * `xform` is left alone when the caller has no fresh one (the room did not repaint,
 * so the shake it encodes cannot have changed either).
 */
function updateRoomSubOverlay(useVecSubs: boolean, cs: number, xform?: string): void {
  if (useVecSubs && subs?.active) {
    syncSubOverlay();
    const dpr = window.devicePixelRatio || 1;
    const sig = subOverlaySignature('room', subs, cs * dpr);
    if (!subOverlayGate || sig !== subOverlaySig) {
      subCtx.setTransform(1, 0, 0, 1, 0, 0);
      subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
      subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
      subs.drawVector(subCtx, count, subFontFamily, subFontWeight, alpha);
      subOverlayPaints++;
      subOverlayPainted = true;
      subOverlaySig = sig;
    }
    if (xform !== undefined) subCanvas.style.transform = xform; // shake/shove with the room
  } else if (subOverlayPainted) {
    clearSubOverlay();
  }
}

function tickBlink(): void {
  for (const w of ['little', 'big'] as const) {
    if (blink[w] > 0) blink[w]--;
    else if (Math.random() < 0.08) blink[w] = 1; // occasional ~1-tick (~140ms) blink
    darkFlicker[w] = Math.random() < 0.06; // gspec=2 per-tick wink-out (random(100)<6)
  }
}

/**
 * hrac_nespi (Uovl.pas:235): activity happened — the player moved, or the KUFRIK
 * demo replayed an action. Reset the fish idle timers AND the ambient-chatter idle
 * clock (casposlzmeny), so StdKecej only fires after ~60-120s of genuine inactivity.
 * This is why the original never chatters during the demo: every replayed action
 * resets the clock (DalsiPrikaz calls hrac_nespi, URoom.pas:26985).
 */
function hracNespi(): void {
  room?.hracNespi();
  if (chatter) chatter.last = count; // casposlzmeny := now
}

/**
 * One game-logic step. Mirrors TRoom.Timer1Timer (URoom.pas:23986): it runs at
 * the fixed LOGIC_MS timestep, not per render frame. Returns true if it rebuilt
 * the room (death restart), so the catch-up loop discards leftover accumulation.
 */
function step(): boolean {
  if (screen !== 'room') return false; // the map/intro screens have no game clock
  count++;
  // Briefcase cutscene takes over while it plays.
  if (cutscene) {
    cutsceneSubs?.tick(count);
    cutscene.tick(cutsceneCaption, () => audio.playing(-1));
    // Keep the idle-chatter timer synced to `now` while the demo plays, so the
    // fish don't immediately "call" you the moment it ends (the demo isn't idle
    // time). The room idle timers are already frozen here (the script block that
    // increments them is skipped by the early return below).
    if (chatter) chatter.last = count;
    if (cutscene.done) {
      cutscene = null;
      cutsceneSubs = null;
      disposeAiKufr(); // the cutscene plays once; don't hold its frames afterwards
    }
    return false;
  }
  tickBlink();
  tickFrameEffects();
  subs?.tick(count);
  // Death cry when a fish is first crushed (sp-smrt1/2, URoom.pas:26767/26773).
  if (room) {
    for (const w of ['little', 'big'] as const) {
      if (room.kostra[w] && !prevKostra[w]) {
        audio.play(w === 'big' ? 'sp-smrt2' : 'sp-smrt1', EFFECT_VOL);
        prevKostra[w] = true;
      }
    }
  }
  if (!room || !engine) return false;
  // Fast-forward load animation (loadmode): replay the saved record at LoadSpeed
  // moves/tick while it plays, skipping normal gameplay + the showmode replay (the
  // original's DalsiPrikaz exits early during a load, URoom.pas:26930).
  if (loadmode) {
    advanceLoadmode();
    return false;
  }
  // After a win, hold on the solved room while the cheer plays, then auto-return
  // to the map (countdown:=30, URoom.pas:24341/24349). Enhancement over the original's
  // fixed timer (which would cut a long line): when the countdown lapses, if the exit
  // line is still being said — the fish's voice still sounding or its subtitle still
  // on screen — hold at 1 until it finishes, so the map transition never truncates it.
  if (engine.winCountdown > 0) {
    const stillSpeaking =
      audio.talking(MLUVI_PRIOR.little) ||
      audio.talking(MLUVI_PRIOR.big) ||
      (subsOn() && (subs?.active ?? false));
    if (engine.winCountdown === 1 && stillSpeaking) return false; // hold — line still playing
    engine.winCountdown--;
    if (engine.winCountdown === 0) {
      returnFromRoom();
      return true;
    }
    return false;
  }
  // Zvuky_okoli (URoom.pas:23736): ambient bubbles — 5%/tick if none are sounding
  // on the bubble channel (priority 1000). Skipped during a best-solution replay
  // (loadtype=nej gates Zvuky_okoli, URoom.pas:24937) so the playback stays silent.
  if (!inReplay()) {
    const bubble = maybeBubble((n) => Math.floor(Math.random() * n), audio.playing(1000));
    if (bubble) audio.play(bubble, EFFECT_VOL, 1000);
  }
  // Death: skeletons erode; if the active fish died, control passes to the
  // survivor (URoom.pas:26998). Auto-restart only when *both* fish are out of play
  // and it is not a win (URoom.pas:24337) — a lone survivor keeps playing until the
  // player restarts, which is what lets the death commentary (StdSmrt) be heard.
  if (room.anyFishDead) {
    const eroded = room.tickRozpad();
    const other = engine.active === 'little' ? 'big' : 'little';
    if (!room.alive[engine.active] && room.alive[other]) engine.active = other;
    if (!room.alive.little && !room.alive.big && !room.won && eroded && !showmode) {
      pokus++; // another attempt
      buildRoom(true);
      return true;
    }
    // A fully-eroded skeleton leaves the grid; anything it was holding up now
    // falls (stav_ma_padat, URoom.pas:24421-24430). This runs during showmode too so
    // the demo's deliberate deaths look right (e.g. the thrown bottle drops once the
    // crushed fish disintegrates); the replay simply pauses while things fall (its
    // branch is gated on phase==='idle') and resumes when the room settles.
    if (room.clearErodedSkeletons() && engine.phase === 'idle') {
      if (room.padani()) {
        engine.phase = 'fall';
        engine.animFrame = 0;
      } else {
        room.clearAllDirs();
      }
    }
  }
  // Run the room script (Programky) each unresolved tick. During the win hold,
  // StepEngine still advances VyresLode so an in-flight wreck finishes falling.
  if (activeScript) {
    const wasWon = room.won;
    engine.runScript(count, casHry()); // idle timers + scalar sync + prog + tickShodLod
    if (!wasWon) {
      // StdSmrt: death commentary (the survivor comments ~8 ticks after a partner dies).
      // Gated on StdHlaskySmrti (URoom.pas:24942) — rooms like TRUP/VLADOVA disable it.
      // Suppressed during the KUFRIK demonstration and during a best-solution replay
      // (the original's silent loadmode replay speaks nothing): the recorded help
      // subtitles are the demo's own narration of the deliberate death.
      if (deathState && activeScript.s.stdHlaskySmrti && !showmode && !inReplay()) {
        stdSmrt(activeScript.s, deathState, count, roomDepth, {
          aliveLittle: room.alive.little,
          aliveBig: room.alive.big,
          venkuLittle: room.venku.little,
          venkuBig: room.venku.big,
        });
      }
      // StdKecej: ambient idle chatter, gated on no active dialogue + both fish alive.
      // No showmode special-case: the demo keeps quiet on its own because every replayed
      // action calls hracNespi (resets casposlzmeny), exactly like the original. A replay
      // is silent (original loadmode replay runs no Programky/chatter).
      if (chatter && room.alive.little && room.alive.big && !inReplay()) {
        const depth15 = roomDepth === 15;
        tickChatter(activeScript.s, chatter, count, 1000 / LOGIC_MS, activeScript.s.isDialog(), depth15);
      }
      activeScript.s.dialogy(count);
    }
  }
  updateLipSync(); // cycle talking-mouth frames from live voice playback
  // Hacky (URoom.pas:24950): the xfisher fishing hooks. A hook can catch+kill a fish
  // (killByHook sets alive=false/kostra=false and drops what it held). If the active
  // fish is hooked, control passes to the survivor; when both fish are out of play
  // (and no hook is still dragging one up), the room restarts — mirroring the crush
  // path but keyed on `alive` since a hooked fish leaves no skeleton to erode.
  if (hooks.count > 0) {
    hooks.tick(room, (n) => Math.floor(Math.random() * n));
    const other = engine.active === 'little' ? 'big' : 'little';
    if (!room.alive[engine.active] && room.alive[other]) engine.active = other;
    if (
      !room.alive.little &&
      !room.alive.big &&
      !room.won &&
      !room.kostra.little &&
      !room.kostra.big &&
      !hooks.busy &&
      engine.phase === 'idle'
    ) {
      pokus++;
      buildRoom(true);
      return true;
    }
  }
  // The shared step-engine drives the whole phase machine (gspec=9 cork setup, move/
  // fall/turn/exit/cork animation with its exit cheer + triggerWin, and the pending
  // auto-swim / ZELVA possession step) — the same path the headless harness runs.
  engine.advance();
  // Engine-level held-key repeat (DalsiPrikaz, URoom.pas:26941): re-issue the held
  // movement key on a rest tick. Run AFTER advance() so a cell that just completed
  // immediately starts the next one on the SAME tick — no stationary gap between cells
  // (holding flows continuously) — while jizda still accumulates (advance saw phase=move
  // this tick before completing). Gated to the same rest conditions the original
  // dispatches under (stav_klid, not possessed/finale/demo/dead/won).
  if (
    engine.phase === 'idle' &&
    !room.won &&
    !room.anyFishDead &&
    !showmode &&
    !replaymode &&
    activeScript?.s.natvrdo !== 1 &&
    !activeScript?.s.zavermode
  ) {
    dispatchHeldMove();
  }
  // KUFRIK automatic demonstration: with no swim/possession pending, the recorded
  // help.cap stream is consumed one action per idle step (DalsiPrikaz in stav_klid,
  // URoom.pas:24438). It keeps advancing while both fish are DEAD (the demo's
  // deliberate death countdown), so it checks phase directly rather than idle().
  if (engine.phase === 'idle' && !room.won && showmode) advanceShowmode();
  // Map "Replay": play back the best solution one move per idle tick (daReplay).
  if (engine.phase === 'idle' && !room.won && replaymode) advanceReplay();
  return false;
}

let lastTime = 0;
let acc = 0;
// Render-on-dirty bookkeeping: the last room frame's render signature, plus a
// one-shot force flag for transitions that don't change the signature (room entry,
// resize, fit-mode change, pointer interaction).
let lastRoomSig = '';
let forceRoomRedraw = true;
// True while a newly-entered room's assets are still being fetched (loadRoom is
// async, unlike the original's synchronous load). The `room`/`ffr` globals still
// hold the *previous* room until buildRoom() swaps them, so painting the room
// screen during this window would flash the old room (notably the boot room
// UTES, loaded at startup) until the new one lands. The draw loop clears the
// stage to black instead while this is set (see the room-draw branch).
let roomLoading = false;
// Monotonic count of COMPLETED room loads — the tests' only race-free way to tell
// "the room I asked for has finished loading" apart from "the room I asked for was
// already the current one". Debug-only (exposed as __ff.roomLoads).
let roomLoadSeq = 0;
// Idle-loop throttle (perf): when the room is fully idle (saver on, nothing
// animating), stop the 60fps rAF spin and wake via a timer at the logic rate so
// the loop's own per-frame overhead (JS + browser scheduling) stops too. Input
// wakes it back to 60fps instantly. Only rooms are throttled; other screens
// (map/intro/credits/cutscene) keep rAF. IDLE_LOOP_MS = the 80ms game tick, so a
// throttled wake still does exactly one logic step + one paint (12.5fps).
const IDLE_LOOP_MS = LOGIC_MS;
// The ZX "Emulator" room (gspec=42) animates its loading bands once per paint (the
// scroll advances in blitZX), so its animation speed IS the paint rate. The 1998
// original ran at 12.5fps; 60fps is 5x too fast and pins the CPU, while the pure
// logic rate (12.5fps) looks choppy. The port uses a ~30fps compromise: when idle in
// a ZX room the loop wakes at this rate and force-repaints, so the bands scroll at
// ~2.4x the original — smoother than 12.5fps, far cheaper than 60fps.
const ZX_ANIM_MS = 33; // ~30fps
/**
 * Idle wake period for the `ai` tier's smooth water, on the GPU path only.
 *
 * Its OWN constant rather than a borrow of ZX_ANIM_MS above: the two happen to be
 * neighbouring numbers but they answer different questions, and tying them together means
 * a future tweak to the ZX bands silently re-prices the water in 70 rooms.
 *
 * The value is a measured trade, not a guess. Idle in room 3 — the one room with no
 * chatter script, so the only one whose idle cost can actually be measured — renderer CPU
 * against the wake rate:
 *
 *     12.5/s (no water animation)  0.72 %   <- `main` is 0.66 %
 *     20/s   (this)                0.93 %
 *     30/s                         1.23 %   <- was ~1.9x main, and made the GPU path
 *                                              more expensive than canvas-2D, which it
 *                                              had never been
 *
 * The wave the player is watching is slow — `1/wspd` rad/tick is ~0.4 Hz for the 60 rooms
 * that share wspd=5 — so 20/s is ~50 samples per cycle of the swell and comfortably above
 * the ripple carrier (~0.8 Hz). The extra 10/s bought smoothness nothing was asking for.
 *
 * Idle only, and only when a fish is not moving: `roomAnimating()` already holds the loop
 * at the full paint rate while anything is in motion, so this never affects play.
 */
// `let`, not `const`, for the same reason RIPPLE is mutable: this is a perf/smoothness
// trade that has to be JUDGED on screen, and tools/ripple-lab.html sets it live so the
// two ends can be compared without a rebuild. Nothing in the game writes to it.
let waterAnimMs = 50; // 20fps
let rafId = 0;

/**
 * Does an IDLE frame still need repainting because the `ai` tier's water is animating
 * between logic ticks?
 *
 * The GPU compositor evaluates the wobble at `count + alpha`, so its phase now advances
 * with the PAINT rate rather than the 12.5 Hz tick. Both idle gates above it are blind
 * to that: `loopThrottleOk` drops a settled room to an 80 ms timer, and the render-on-dirty
 * signature contains `count` and nothing sub-tick. Left alone, the smooth wobble would be
 * visible only while a fish happens to be moving (which already holds the loop at 60 fps
 * via roomAnimating) and would snap back to lurching the moment the room settled — a
 * worse artefact than the one it fixes.
 *
 * So an idle wobbling AI-GPU room wakes on its own schedule, `WATER_ANIM_MS`, plus a
 * forced repaint — the same shape as the ZX room's treatment, for the same reason, but
 * priced separately (see `waterAnimMs` for the measured CPU trade). The loop stays
 * THROTTLED (the timer path, not rAF), so the idle-FPS saver's contract is intact; only
 * the delay changes.
 *
 * canvas-2D is excluded on purpose: it keeps the faithful tick-rate wobble, so it has
 * nothing to animate and must keep its current idle cost, which is the higher of the two.
 */
let lastWaterPaint = 0;

/**
 * Should THIS frame be repainted just because the water moved?
 *
 * `aiWaterAnimating` says the water is animating; this adds the rate limit, and the two
 * are separate because they answer different questions — one picks the idle WAKE rate,
 * the other decides whether an already-awake frame owes the room a repaint.
 *
 * The limit is the point. When the loop is at the full paint rate for some OTHER reason —
 * a vector subtitle waving in is the common one — an unlimited `waterAnim` would repaint
 * the ×S composite on every one of those 60 frames, which is double what the effect was
 * ever specified to need (ZX_ANIM_MS, ~30fps) and is exactly the cost the render-on-dirty
 * comment below exists to avoid. Measured on tools/test-aisubs.mjs, which guards it: the
 * ai tier's subtitle rate against enhanced was 0.91 before any of this, 0.77-0.81 with an
 * unlimited water repaint, and 0.60 once ripples made each composite dearer — through a
 * gate set at 0.70. Capped here it is back at parity, and the water is unaffected because
 * 30fps was always the target.
 */
function waterOwesRepaint(now: number): boolean {
  return aiWaterAnimating() && now - lastWaterPaint >= waterAnimMs - PAINT_EPSILON_MS;
}

function aiWaterAnimating(): boolean {
  return (
    screen === 'room' &&
    room !== null &&
    room.wamp !== 0 &&
    lastRoomBackend === 'webgl' &&
    // NOTE: the water deliberately keeps animating while a vector subtitle waves in.
    // An earlier revision suppressed it there, because with the water repainting on
    // EVERY frame it cost the subtitle a third of its rate. But that was the unrestricted
    // repaint's fault, not the water's: once `waterOwesRepaint` caps it at waterAnimMs,
    // suppression buys almost nothing and is plainly visible — the wobble (and every
    // other room animation) drops to the 12.5Hz tick rate for ~1.5s each time anyone
    // speaks, which reads as a stutter triggered by the text. Measured interleaved on an
    // idle machine, tools/test-aisubs.mjs: suppressed 0.95, running 0.90, gate 0.70. Five
    // points of a metric with that much headroom is not worth a visible hitch in 70 rooms.
    aiRoomRenderActive(room)
  );
}
/**
 * Paint-rate cap. requestAnimationFrame fires at the DISPLAY refresh — 120Hz+ on
 * current Macs — but this game steps its logic at 12.5Hz (LOGIC_MS) and interpolates,
 * so painting above 60 costs GPU/battery for no visible gain. The AI tier makes that
 * worse: it composites 4x-resolution rooms every paint.
 *
 * PHASE-LOCKED, not free-running. The obvious form — skip while `now - lastPaint <
 * PAINT_MIN_MS`, then set `lastPaint = now` — re-phases the gate to each painted frame,
 * so it only yields 60fps when the refresh rate is an exact multiple of 60. Everything
 * else aliases badly: 144Hz gave 48fps, 75Hz gave 37.5, 90Hz gave 45, 165Hz gave 55.
 * (A margin under 1000/60 hides this at 120Hz, which is why it went unnoticed.)
 *
 * Instead we keep a `nextPaint` deadline advanced by exactly PAINT_MIN_MS, so the
 * accumulated remainder carries into the next interval and the long-run average is the
 * cap regardless of refresh rate. When we fall far behind (a stall, or a backgrounded
 * tab) the deadline snaps forward to `now` rather than bursting to catch up.
 */
const MAX_PAINT_FPS = 60;
const PAINT_MIN_MS = 1000 / MAX_PAINT_FPS;
/** Rounding/jitter slack: a refresh landing a hair early still counts for this period. */
const PAINT_EPSILON_MS = 1;
let nextPaint = 0;
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
// Perf HUD counters (dev mode): rAF ticks vs actual screen paints, sampled ~2×/sec.
let perfRaf = 0;
let perfPaint = 0;
let perfLast = 0;
// Monotonic loop-iteration counter. `perfRaf` above is reset every HUD interval and only
// runs with the dev pane open, so a probe cannot use it to measure the idle WAKE RATE —
// which is exactly what the ai-water animation gate below changes.
let loopTicks = 0;
// …and how often the ROOM was actually repainted, which is a different number: the loop
// can wake without redrawing (render-on-dirty). This is the one that costs — a ×S
// composite and a present — and the one the player sees as the water moving, so it is
// what a perf or smoothness probe actually wants to measure.
let roomPaints = 0;
let lastRoomBackend: 'cpu' | 'webgl' = 'cpu'; // which backend actually painted the last room frame
function updatePerfHud(now: number): void {
  perfRaf++;
  if (!perfHud || !document.body.classList.contains('dev')) {
    perfLast = now;
    perfRaf = 0;
    perfPaint = 0;
    return;
  }
  if (perfLast === 0) perfLast = now;
  const elapsed = now - perfLast;
  if (elapsed >= 500) {
    const paintFps = Math.round((perfPaint * 1000) / elapsed);
    const rafFps = Math.round((perfRaf * 1000) / elapsed);
    const where = screen === 'room' ? 'room' : screen === 'map' ? 'map' : screen;
    // Show the SET renderer and, when it's WebGL, whether it actually engaged this
    // frame — and WHY not, if it didn't. Those are two different situations and
    // collapsing them hides a real fault: a GL failure has disabled the backend for the
    // session (fallback), whereas a frame effect / ZX room / active hook / wreck /
    // sprite cheat is a frame the CPU compositor legitimately owns and the next frame
    // may well be back on the GPU.
    let backend = renderer.toUpperCase();
    if (renderer === 'webgl' && screen === 'room' && lastRoomBackend === 'cpu') {
      // Either backend being disabled counts as a fallback: which one owns this frame
      // depends on the tier, and the distinction the reader needs is "disabled for the
      // session" vs "this frame only".
      backend = glFailed || glAiFailed ? 'WEBGL→cpu(fallback)' : 'WEBGL→cpu(this frame)';
    }
    perfHud.textContent =
      `paint ${paintFps} fps   rAF ${rafFps} fps\n` +
      `saver ${renderOnDirty ? 'ON' : 'off'} (P)   ${backend} (R)   [${where}]`;
    perfLast = now;
    perfRaf = 0;
    perfPaint = 0;
  }
}
// Smoothness harness: null = off; an array = recording per-frame fish positions.
// `n`+`a` are the GAME-TIME coordinate of the sample (count + alpha, the exact
// value the interpolated position below is a function of) and `cf` the speed tier
// in force, so a harness can express motion in px per game tick — independent of
// how many rAF frames the machine managed to deliver.
let smoothLog: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string }[] | null = null;

/**
 * True when the room's frame changes BETWEEN logic ticks and so needs the full
 * (capped, see MAX_PAINT_FPS) paint rate — i.e. interpolated fish motion. Wobble,
 * blink, heads, subtitles and darkness advance on the 12.5fps logic tick and are
 * caught by the `count` change in the render signature, so they animate correctly at
 * the throttled rate — matching the original's 12.5fps render. The ZX "loading" bands
 * are the exception: they advance per PAINT, so the loop wakes them separately via
 * zxAnim / ZX_ANIM_MS rather than through this predicate.
 */
function roomAnimating(): boolean {
  if (engine && engine.phase !== 'idle') return true; // fish sliding/falling/turning/exiting/cork
  return false;
}

/**
 * Whether the loop may drop to the throttled (timer) wake rate. Two idle cases
 * qualify (both need the saver on, no cutscene/intro, no smoothness recording):
 *  - a steady ROOM: nothing animating, no held key / KUFRIK demo / load fast-forward,
 *    the panel in its normal (non-scrolling) state, no room-art hold; or
 *  - a settled MAP: no overlay (credits/options), and the reveal animation finished
 *    (only the ~7fps node pulse is left, which the throttled 12.5fps wake captures).
 * Anything else keeps 60fps. Input (incl. map hover) wakes it via wake().
 */
function loopThrottleOk(): boolean {
  if (!renderOnDirty || cutscene || intro.playing || smoothLog !== null) return false;
  // The leg story page is a static full-screen image; once blitted it can idle at the
  // throttled wake rate (a click/key wakes it via wake() to dismiss).
  if (screen === 'legimage') return legImageDrawn;
  if (screen === 'room') {
    return (
      !forceRoomRedraw &&
      !roomAnimating() &&
      // A vector subtitle waving in / scrolling animates BETWEEN logic ticks, so it
      // needs the full rAF rate for the ~1.5s it takes to settle (it only repaints
      // the overlay, not the room). A settled line does not, and neither does the
      // classic bitmap path, which is baked into the frame at the tick rate.
      //
      // Gated on enhancedArtActive() — every tier that USES the vector overlay (see
      // useVecSubs in drawRoom), not the literal 'enhanced' tier. Checking
      // `graphics === 'enhanced'` left the ai tier idle-throttled at 12.5fps for the
      // whole line: measured rAF 12fps in ai against 121fps in enhanced, which is
      // exactly the juddering-subtitle report.
      !(enhancedArtActive() && subFontReady && subs?.vectorAnimating(count)) &&
      heldState === 0 &&
      !inShowmode() &&
      !loadmode &&
      ostav === O_NORMAL &&
      !roomArtPending()
    );
  }
  if (screen === 'map' && worldMap && mapOverlay === 'none') {
    // Keep 60fps while the record-panel odometer is still rolling (so its wall-clock
    // faze advance is sampled smoothly); once settled it can idle-throttle again.
    if (mapInfoRoom !== null && mapInfoFaze < INFO_SETTLE_FAZE) return false;
    // Keep 60fps until the map-reveal animation has fully traced in (UMain Depth).
    const depth = Math.floor((performance.now() - mapRevealStart) / 60) - 3;
    return depth > worldMap.maxDepth;
  }
  return false;
}

/** Schedule the next loop iteration: rAF (capped to MAX_PAINT_FPS) normally, a timer when idle. */
function scheduleNext(): void {
  if (loopThrottleOk()) {
    // A ZX room keeps animating its bands, so it wakes at ~30fps; any other idle
    // room/map wakes at the 12.5fps logic rate.
    const delay = screen === 'room' && room?.gspec === 42
      ? ZX_ANIM_MS
      : aiWaterAnimating() ? waterAnimMs : IDLE_LOOP_MS;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      loop(performance.now());
    }, delay);
  } else {
    rafId = requestAnimationFrame(loop);
  }
}

/**
 * Return to the full paint rate immediately. Called from input handlers so a
 * keypress/click never waits out a throttled timer (movement stays smooth from its
 * first frame). No-op if we're already on rAF.
 */
function wake(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = 0;
    lastTime = 0; // avoid a large dt from the idle gap
    nextPaint = 0; // ...and don't let the cap swallow the first frame after idling
    rafId = requestAnimationFrame(loop);
  }
}

/** The render loop: steps the game at a fixed timestep, then draws (capped, see
 *  MAX_PAINT_FPS) once per RAF. */
function loop(now: number): void {
  loopTicks++;
  // Skip this refresh entirely when it would exceed the paint cap. lastTime is left
  // alone so the skipped interval still accumulates into `acc` — the simulation sees
  // real elapsed time either way, so capping paint cannot change game speed.
  if (shouldSkipPaint(now, nextPaint, PAINT_EPSILON_MS)) {
    perfRaf++;            // still a real refresh — the HUD's rAF number must show it,
    rafId = requestAnimationFrame(loop);   // otherwise it just mirrors the paint rate
    return;
  }
  nextPaint = advancePaintDeadline(now, nextPaint, PAINT_MIN_MS);
  if (lastTime === 0) lastTime = now;
  const dt = now - lastTime;
  acc += dt;
  lastTime = now;
  tickPanelScroll(dt); // advance the options open/close animation (independent of game logic)
  // Drop a backlog (slow/backgrounded frame) instead of fast-forwarding: like
  // Jedeme, we run at most one step per frame and never batch-catch-up, so under
  // load the game just slows down.
  if (acc > LOGIC_MS * (MAX_STEPS_PER_FRAME + 1)) acc = LOGIC_MS;
  let steps = 0;
  // While the anti-flash hold is active (draw() is holding the previous frame until
  // this room's art loads), pause the simulation too, so the
  // room's scripts/gravity/subtitle timers/audio don't advance under a frame that
  // was never shown — keeping logic in sync with the first visible frame (as classic
  // mode inherently is). acc keeps accumulating but the backlog guard above drops it,
  // so there's no fast-forward catch-up when the hold releases.
  // roomArtPending() rather than `graphics === 'enhanced'`: every tier that draws
  // truecolor art needs the identical hold while that art is still loading, and the
  // ai tier additionally waits for its upscale (see roomArtPending).
  const holding = screen !== 'map' && !cutscene && roomArtPending();
  // The minigame is modal in the original, so the room's timer does not run while
  // it is open (Tetris.ShowModal, URoom.pas:24565). It keeps its own 55ms clock.
  tickTetris(dt);
  const frozen = tetrisModal();
  while (!holding && !frozen && acc >= LOGIC_MS && steps < MAX_STEPS_PER_FRAME) {
    acc -= LOGIC_MS;
    steps++;
    if (step()) {
      acc = 0; // room rebuilt: discard partial-tick interpolation
      break;
    }
  }
  alpha = Math.min(acc / LOGIC_MS, 1); // clamp so a slow frame can't overshoot a cell
  // The WebGL room overlay (#screen-gl) is only ever shown by the room draw()
  // path or the (enhanced) cutscene. Hide it for every other screen
  // (map/menu/intro/credits/help), which repaint the 2D #screen underneath —
  // otherwise the last GPU-rendered frame stays visible on top of them (a
  // WebGL-only bug; the CPU path has no overlay so it never showed this). The
  // room-draw condition below mirrors the `else draw()` branch, so enhanced's
  // "hold previous frame" (screen==='room' while art loads) is untouched. The
  // cutscene is left out of the hide list because drawCutscene() manages the GL
  // canvas itself (it may present a smooth-upscaled frame there).
  if (helpOpen || screen !== 'room' || roomLoading) glCanvas.style.display = 'none';
  if (helpOpen) {
    clearSubOverlay();
    drawHelp();
    perfPaint++;
  } else if (screen === 'intro') {
    clearSubOverlay(); // the <video> overlay covers the stage; nothing to draw
  } else if (screen === 'legimage') {
    clearSubOverlay();
    drawLegImage(); // the leg-completion story page (counts its own one-shot blit)
  } else if (screen === 'map') {
    clearSubOverlay();
    // Advance the record-panel odometer on wall-clock time (one faze per Timer1
    // tick, INFO_FAZE_MS) rather than per paint, so its ~2.7s roll is independent
    // of the frame rate. drawMap() only repaints when the faze (part of its sig)
    // changes, so this is cheap once settled.
    if (mapInfoRoom !== null && mapInfoFaze < INFO_SETTLE_FAZE) {
      mapInfoFaze = Math.min(Math.floor((now - mapInfoOpenAt) / INFO_FAZE_MS), INFO_SETTLE_FAZE);
    }
    if (mapOverlay === 'credits') {
      drawCredits();
      perfPaint++;
    } else drawMap(); // counts its own paint (it skips when cached)
  } else if (cutscene) {
    drawCutscene(); // manages the GL canvas + subtitle overlay itself
    perfPaint++;
  } else if (roomLoading) {
    // A newly-entered room's assets are still loading (loadRoom is async). Don't
    // paint the previous room's stale frame held in `room`/`ffr` (e.g. the boot
    // room UTES) — clear the stage to black until buildRoom() swaps in the real
    // room and clears roomLoading. The GL overlay is hidden above, so no stale
    // GPU frame shows through either; the page background is black, so on a fast
    // (cached) load this is imperceptible.
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    clearSubOverlay();
    perfPaint++;
  } else {
    // signature captures everything that changes on a logic tick (count → wobble/
    // anim/subtitles) plus the render-mode inputs; roomAnimating() forces 60fps
    // while motion is interpolating. forceRoomRedraw covers signature-invisible
    // transitions (room entry, resize, fit change, pointer). The ZX room repaints
    // every wake (its bands scroll per paint), the loop having chosen a ~30fps wake
    // rate for it. When skipped, the last painted frame persists on the canvas.
    const zxAnim = room?.gspec === 42;
    // Same shape as zxAnim: content that changes per PAINT, which `sig` cannot see —
    // but rate-limited, see waterOwesRepaint.
    const waterAnim = waterOwesRepaint(now);
    const sig = `${count}|${roomArtPending() ? 1 : 0}|${graphics}|${renderer}|${glFailed ? 1 : 0}${glAiFailed ? 1 : 0}`;
    // The AI compositor repaints a ×S backing store (1740×1620 for a 435×405 room).
    // On CANVAS-2D, doing that on every refresh when nothing changed is work the
    // browser cannot absorb: measured 35fps idle and 20fps with a subtitle on screen,
    // against 62fps in the enhanced tier — and the cost is in compositing, not JS (the
    // frame callback itself is 0.1ms in both). Its content only changes on a logic tick
    // or while motion interpolates, both of which are covered below, so that path
    // honours render-on-dirty even when the saver is off.
    //
    // On the GPU that constraint does not apply, and the reason is worth being precise
    // about, because the raw compositing cost is NOT where the difference is: on macOS
    // the browser already GPU-accelerates canvas-2D, and the marginal cost of one ×S
    // frame measures 0.26-0.51 ms there against 0.26-0.39 ms on GlAiScreen
    // (tools/bench-ai-room.mjs) — near parity. What the GPU path removes is the OTHER
    // half: the canvas-2D path hands the browser a ×S canvas to rescale into the room's
    // box on every presented frame, which is the cost the note above measured as frame
    // rate, while GlAiScreen presents straight into that box.
    //
    // So the restriction is tied to the backend that needs it rather than to the tier.
    // Note the saver is ON by default, so this only gives the GPU path back the user's
    // own choice when they have turned it off — it does not make the tier busier for
    // anyone who has not asked for that.
    const aiFrame = room !== null && aiRoomRenderActive(room);
    const dirtyOnly = renderOnDirty || (aiFrame && lastRoomBackend === 'cpu');
    if (!dirtyOnly || forceRoomRedraw || roomAnimating() || zxAnim || waterAnim || sig !== lastRoomSig) {
      draw();
      lastWaterPaint = now; // any room paint satisfies the water for this interval
      roomPaints++;
      perfPaint++;
      lastRoomSig = sig;
      // Clear the one-shot force, but keep repainting while a cheat effect is live:
      // the grain, the interlaced collapse and the minigame all animate on their own,
      // and `sig` cannot see them, so render-on-dirty would otherwise freeze them.
      forceRoomRedraw = frameEffectsActive();
    } else if (enhancedArtActive() && subFontReady && subs?.active) {
      // The room is unchanged, but a subtitle may still be waving in or scrolling.
      // The overlay is its own layer, so animate it on its own — at the sub-tick
      // rate — without paying for a room repaint underneath.
      //
      // Gated on enhancedArtActive(), i.e. exactly the tiers that USE the vector
      // overlay (see useVecSubs in drawRoom), not on the literal 'enhanced' tier.
      // Checking `graphics === 'enhanced'` excluded the `ai` tier, whose subtitles
      // then only advanced when the room itself repainted — measured at 22 overlay
      // repaints/sec against enhanced's 40.7, which reads as juddering text.
      updateRoomSubOverlay(true, roomGeometry(room!).scale);
    }
  }
  drawPanel();
  // After every draw branch: the overlay is a view of "is this room still loading",
  // and hiding it here means the frame underneath has already been painted this tick.
  syncRoomLoadingUi(now);
  updatePerfHud(now);
  scheduleNext();
}

window.addEventListener('keydown', (e) => {
  wake(); // return to 60fps immediately if the idle-loop throttle had us sleeping
  // While the intro movie plays, swallow input; any key skips the current movie
  // (the original's mouse-down MediaPlayer1.Stop, UMain.pas:1603). Two exceptions:
  // a bare modifier keydown must NOT skip (otherwise arming Ctrl+Alt+D during the
  // intro fires three skips — Ctrl, Alt, D — and blows through the whole sequence),
  // and Ctrl+Alt+D itself toggles the dev pane in place so it can be armed before
  // the game proper without abandoning the movies.
  if (intro.playing) {
    if (e.key === 'Control' || e.key === 'Alt' || e.key === 'Shift' || e.key === 'Meta') return;
    if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
      e.preventDefault();
      setDevEnabled(!devEnabled);
      return;
    }
    e.preventDefault();
    intro.skip();
    return;
  }
  // Any key dismisses the scrolling credits (UMain.pas FormKeyDown → DoneCredits).
  if (mapOverlay === 'credits') {
    e.preventDefault();
    closeMapOverlay();
    return;
  }
  // Any key dismisses the leg-completion story page (zrus_obrazek).
  if (screen === 'legimage') {
    e.preventDefault();
    dismissLegImage();
    return;
  }
  // While the help screens are open, arrows page through them and any other key
  // closes the viewer (Help.pas:Image1Click / FormKeyDown).
  if (helpOpen) {
    e.preventDefault();
    const count = helpScreens.pages(subLang()).length;
    if (e.code === 'ArrowRight') helpScreens.next(count);
    else if (e.code === 'ArrowLeft') helpScreens.prev(count);
    else closeHelp();
    return;
  }
  // While the briefcase demo plays, swallow input; Escape skips it (zrus_kufr).
  // The render/graphics/font toggles are let through so you can switch the
  // backend or art source live (the cutscene frame reads them every tick).
  if (cutscene) {
    if (e.code === 'Escape') {
      e.preventDefault();
      skipCutscene();
      return;
    }
    if (e.code !== 'KeyR' && e.code !== 'KeyE' && e.code !== 'KeyF') return;
  }
  // While the Tetris minigame is open it owns the keyboard, as its modal window
  // does (FormKeyDown, Ttr.pas:458). Escape closes it (modalresult := mrCancel).
  // Note that Down ROTATES the piece here — the original has no soft drop; Space
  // slams the piece down instead.
  if (tetrisModal()) {
    e.preventDefault();
    if (e.code === 'Escape') {
      closeTetris();
      return;
    }
    const k = tetris ? TETRIS_KEYS[e.code] : undefined;
    if (k && tetris) {
      tetris.key(k);
      forceRoomRedraw = true;
    }
    return;
  }
  // Typed cheat codes (ZaznamenejPrikazKlavesou, Uovl.pas:744; the map screen keeps
  // its own buffer, UMain.pas:1750). `X` arms the machine; while a code is part-typed
  // the letters are swallowed, and the first letter that cannot continue any code
  // parks it and falls through to the normal handler below.
  {
    // The original feeds EVERY key through the buffer, so an arrow, Space or
    // Backspace breaks the prefix and parks the machine before doing its normal
    // job (Uovl.pas:748-769). Only letters can extend a code, so anything else is
    // fed as a cancelling key and then handled normally below.
    const entry = screen === 'map' ? mapCheats : roomCheats;
    const letter = e.key.length === 1 && /[a-z]/i.test(e.key);
    const r = letter ? entry.press(e.key) : entry.cancel();
    if (r.cheat) {
      if (screen === 'map') applyMapCheat(r.cheat);
      else applyRoomCheat(r.cheat);
      return;
    }
    if (r.swallowed) return;
  }
  // Ctrl+Alt+D: enable/disable the developer pane (persisted). This is the ONLY
  // way in/out of dev mode; while enabled it shows the tuning chrome + perf HUD and
  // arms the one-key dev toggles (E/R/P/F/G) below. Kept deliberately obscure so
  // players never trip it — the game is played chrome-free.
  if (e.ctrlKey && e.altKey && e.code === 'KeyD') {
    e.preventDefault();
    setDevEnabled(!devEnabled);
    return;
  }
  // The single-key dev toggles are armed ONLY while the dev pane is enabled, and only
  // for a BARE keypress. Without the modifier guard these collide with the browser's
  // own shortcuts: Cmd/Ctrl+R (reload) toggled the renderer and persisted it, so the
  // backend flipped CPU/WebGL on every reload — and reloading from the toolbar button,
  // which fires no keydown, did not. Cmd+P (print) silently disabled the idle-FPS
  // saver, Cmd+E changed the graphics tier, Cmd+F the subtitle font, Cmd+G the
  // subtitle language. All of those are persisted, so a single accidental shortcut
  // changed how the game rendered from then on.
  //
  // Ctrl+Alt+D above is deliberately checked BEFORE this and is unaffected: it is the
  // one dev key that is meant to carry modifiers.
  if (devEnabled && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (e.code === 'KeyG') {
      // Cycle subtitles Czech -> English -> off (obltitcz/eng/no).
      setSubtitleMode(settings.subtitles === 'cz' ? 'en' : settings.subtitles === 'en' ? 'off' : 'cz');
      return;
    }
    if (e.code === 'KeyP') {
      // Toggle the idle-FPS saver (render-on-dirty). Also the dev-bar checkbox.
      setRenderOnDirty(!renderOnDirty);
      return;
    }
    if (e.code === 'KeyE') {
      // Cycle the graphics level classic → enhanced → ai → classic (also the
      // dev-bar Graphics combobox). setGraphics persists + syncs the select.
      const i = GRAPHICS_LEVELS.indexOf(graphics);
      setGraphics(GRAPHICS_LEVELS[(i + 1) % GRAPHICS_LEVELS.length]!);
      return;
    }
    if (e.code === 'KeyR') {
      // Toggle the render backend CPU <-> WebGL (also on the dev-bar Renderer select).
      setRenderer(renderer === 'webgl' ? 'cpu' : 'webgl');
      return;
    }
    if (e.code === 'KeyF') {
      // Cycle the vector-subtitle font (Shift+F for previous) and show a sample line.
      previewSubFont(!e.shiftKey);
      return;
    }
    if (e.code === 'KeyW' && e.shiftKey) {
      // Genuinely win the current room (also the dev-bar "Win room" button). Uses the
      // real win path, so an end-of-leg room reveals its story page. Spot-check aid.
      // Shift-gated so it never collides with a typed cheat string (e.g. xwemaketherules).
      devWinRoom();
      return;
    }
  }
  // Backspace restarts the room (TRoom.Restart) — the original's Restart action,
  // which the tutorial fish teach ("1st-m-backspace"). It is NOT a single-move undo.
  if (e.code === 'Backspace') {
    e.preventDefault();
    restartRoom();
    return;
  }
  if (e.code === 'F2') {
    e.preventDefault();
    if (atRest()) saveGame();
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    if (atRest()) loadGame();
    return;
  }

  if (e.code === 'Escape') {
    e.preventDefault();
    if (screen === 'map') {
      if (mapInfoRoom !== null) closeMapInfo(); // close the record panel first (daCancel)
      else if (mapOverlay !== 'none') closeMapOverlay(); // close an open menu overlay
      else if (room) enterRoom(Number(select.value));
    } else showMap();
    return;
  }
  if (screen === 'map') return; // no fish keys on the map
  if (activeScript?.s.natvrdo === 1) return; // possessed by ZELVA: input is ignored
  if (activeScript?.s.zavermode) return; // ZAVER finale cutscene: only restart/exit above work
  if (inShowmode()) return; // KUFRIK demonstration: fish keys blocked (Backspace/Escape end it above)
  if (inReplay()) return; // map "Replay" playback: player fish keys are blocked
  if (loadmode) return; // fast-forward load in progress: ignore fish keys (Backspace above aborts it)
  if (e.code === 'Space') {
    e.preventDefault();
    swapActive(); // akce_switch
    return;
  }
  if (e.code === 'Digit1' || e.code === 'Digit2') {
    e.preventDefault();
    selectFish(e.code === 'Digit1' ? 'little' : 'big'); // akce_set
    return;
  }
  const arrow = ARROWS[e.code];
  if (arrow !== undefined) {
    // Arrow keys move the active fish (kdo:=sys); the engine repeats it while held.
    e.preventDefault();
    beginHeldMove(e.code, true, engine?.active ?? 'little', arrow);
    return;
  }
  const map = KEYS[e.code];
  if (!map) return;
  e.preventDefault();
  beginHeldMove(e.code, false, map.which, map.dir); // kdo:=mala/velka
});

window.addEventListener('keyup', (e) => {
  wake();
  // FormKeyUp (Uovl.pas:1006): 1→3 (guarantee one dispatch for a tap), otherwise →0.
  if (e.code !== heldKey) return;
  if (heldState === 1) heldState = 3;
  else clearHeldKey();
});

// Losing focus (alt-tab / clicking another window) or hiding the tab means the OS
// stops auto-repeat and never delivers the keyup for a held movement key. Drop it
// ourselves, exactly as a keyup would — otherwise heldState stays "held", the fish
// keeps swimming, and (because loopThrottleOk requires heldState===0) the render
// loop never drops to the idle timer and spins at the full display refresh (120fps
// on a ProMotion panel) until the next room change/restart clears it.
window.addEventListener('blur', () => clearHeldKey());
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearHeldKey();
});

function cellFromEvent(e: MouseEvent): { cx: number; cy: number } {
  const rect = canvas.getBoundingClientRect();
  // Convert to NATIVE game pixels, not backing-store pixels. FSIZE below is a native
  // cell size, so the two must agree — and they stopped agreeing in the ai tier, whose
  // backing store is ×scale: scaling by canvas.width put every click four times too far
  // right and down, which broke mouse control of the fish entirely in that tier.
  const g = room ? roomGeometry(room) : null;
  const nativeW = g ? g.nativeW : canvas.width;
  const nativeH = g ? g.nativeH : canvas.height;
  const px = (e.clientX - rect.left) * (nativeW / rect.width);
  const py = (e.clientY - rect.top) * (nativeH / rect.height);
  return { cx: Math.floor(px / FSIZE), cy: Math.floor(py / FSIZE) };
}

function clickCell(cx: number, cy: number): void {
  wake();
  if (!idle() || !room || !engine) return;
  if (activeScript?.s.natvrdo === 1 || activeScript?.s.zavermode) return; // input locked
  if (inShowmode()) return; // KUFRIK demonstration: clicks are ignored while it plays
  if (loadmode) return; // fast-forward load in progress
  const occ = room.cellOccupant(cx, cy);
  if (occ === room.littleIdx) {
    if (room.alive.little && !fishBusy('little')) {
      engine.active = 'little'; // akce_set: select (no talk — the original select is silent)
      engine.swim = null;
      peekAtPlayer('little');
    }
  } else if (occ === room.bigIdx) {
    if (room.alive.big && !fishBusy('big')) {
      engine.active = 'big';
      engine.swim = null;
      peekAtPlayer('big');
    }
  } else if (occ === ITEM_WATER) {
    engine.swim = { which: engine.active, tx: cx, ty: cy }; // akce_go
  }
  setInfo();
}

/** ZaznamenejPrikazRoom (mbRight): the direction from the active fish to a cell. */
function dirToward(which: 'little' | 'big', cx: number, cy: number): number {
  if (!room) return Dir.no;
  const it = room.items[which === 'little' ? room.littleIdx : room.bigIdx];
  if (!it) return Dir.no;
  const dx = which === 'little' ? 3 : 4; // fish footprints (little 3x1, big 4x2)
  const dy = which === 'little' ? 1 : 2;
  if (cx < it.x) return Dir.left;
  if (cx >= it.x + dx) return Dir.right;
  if (cy < it.y) return Dir.up;
  if (cy >= it.y + dy) return Dir.down;
  return Dir.no;
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault()); // allow right-drive

canvas.addEventListener('mousedown', (e) => {
  wake();
  // The Tetris minigame is modal (ShowModal), so it owns the pointer as well as the
  // keyboard: without this, a click behind the board still moved a fish, opened a
  // room from the map, or dismissed an overlay.
  if (tetrisModal()) {
    e.preventDefault();
    return;
  }
  // While the help screens are open, a click advances to the next page (Image1Click);
  // a right-click closes the viewer.
  if (helpOpen) {
    e.preventDefault();
    if (e.button === 2) closeHelp();
    else helpScreens.next(helpScreens.pages(subLang()).length);
    return;
  }
  // A click skips the briefcase demo (zrus_kufr).
  if (cutscene) {
    e.preventDefault();
    skipCutscene();
    return;
  }
  // A click dismisses the leg-completion story page (PaintBox1MouseDown → zrus_obrazek,
  // UMain.pas:1589) and returns to the map.
  if (screen === 'legimage') {
    e.preventDefault();
    dismissLegImage();
    return;
  }
  if (screen === 'room') forceRoomRedraw = true; // repaint promptly on any in-room click
  if (screen === 'room' && activeScript?.s.natvrdo === 1) {
    e.preventDefault(); // possessed by ZELVA: input is ignored
    return;
  }
  if (screen === 'room' && inShowmode()) {
    e.preventDefault(); // KUFRIK demonstration: mouse input ignored while it plays
    return;
  }
  if (screen === 'room' && inReplay()) {
    e.preventDefault(); // map "Replay" playback: mouse input ignored while it plays
    return;
  }
  if (screen === 'room' && loadmode) {
    e.preventDefault(); // fast-forward load in progress
    return;
  }
  // Right button (in a room): step the active fish toward the click (mbRight).
  if (e.button === 2) {
    e.preventDefault();
    if (screen !== 'room' || !room || room.won || !idle() || !engine) return;
    if (fishBusy(engine.active)) return; // sys dir_* dropped while the active fish is busy
    const { cx, cy } = cellFromEvent(e);
    const dir = dirToward(engine.active, cx, cy);
    if (dir !== Dir.no) {
      hracNespi();
      engine.swim = null;
      tryStep(engine.active, dir);
      setInfo();
    }
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  // World map: a corner "button" (intro/credits/options) or a room node.
  if (screen === 'map') {
    if (!worldMap) return;
    // A click anywhere during the credits roll dismisses it (UMain.pas:1595).
    if (mapOverlay === 'credits') {
      closeMapOverlay();
      return;
    }
    // The Options panel is modal: while it's open, map clicks are inert (its own
    // canvas handles the sliders/buttons).
    if (mapOverlay === 'options') return;
    const rect = canvas.getBoundingClientRect();
    const mx = Math.floor((e.clientX - rect.left) * (MAP_W / rect.width));
    const my = Math.floor((e.clientY - rect.top) * (MAP_H / rect.height));
    clickMapAt(mx, my);
    return;
  }
  hracNespi();
  if (room?.won) {
    returnFromRoom(); // a solved room returns to the map (last-in-leg → story page first)
    return;
  }
  const { cx, cy } = cellFromEvent(e);
  clickCell(cx, cy);
});

/**
 * Route a left-click at map coordinate (mx,my): the record panel's buttons when it
 * is open, else a solved/cheated room node → open the panel (daInfo), an unsolved
 * room → launch it (daRun), or a corner menu button (UMain.pas PaintBox1MouseDown).
 */
function clickMapAt(mx: number, my: number): void {
  if (!worldMap) return;
  // Record info panel open (InfoMode>0): its Run/Replay/Cancel buttons take the
  // click; anywhere else closes it (daCancel, UMain.pas:1612/1626).
  if (mapInfoRoom !== null) {
    const room = mapInfoRoom;
    const btn = hitInfoButton(mx, my);
    if (btn === 'run') {
      closeMapInfo();
      // Delphi: Run on a solved depth-15 room shows the leg story page first, then
      // launches once dismissed (daClickAndRun, UMain.pas:958→966).
      const leg = solved.has(room) && depthOfRoom(room) === 15 ? branchOfRoom(room) : 0;
      if (leg >= 1 && leg <= 8) void showLegImage(leg, { room });
      else void enterRoom(room); // daRealyRun: play the room
    } else if (btn === 'replay') {
      const rec = bestRecord(room);
      if (rec !== undefined) {
        closeMapInfo();
        // Same story-page-first deferral for Replay (daReplay, UMain.pas:1030).
        const leg = solved.has(room) && depthOfRoom(room) === 15 ? branchOfRoom(room) : 0;
        if (leg >= 1 && leg <= 8) void showLegImage(leg, { room, replay: rec });
        else void enterRoom(room, rec); // daReplay: animate the best solution
      }
      // no stored record → Replay is disabled; ignore the click (panel stays open)
    } else {
      closeMapInfo(); // Cancel button, or a click off the panel
    }
    return;
  }
  const room = worldMap.hitTest(mx, my, solved, cheated);
  if (room) {
    // A genuinely solved (or cheated) room opens the record panel instead of
    // launching immediately (daInfo, UMain.pas:1611); unsolved rooms launch.
    if (solved.has(room) || cheated.has(room)) openMapInfo(room);
    else void enterRoom(room);
    return;
  }
  dispatchMapCorner(worldMap.cornerAction(mx, my));
}


/** Canvas client coords -> map image space (640x480), accounting for CSS scale. */
function mapCoords(e: MouseEvent): { mx: number; my: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    mx: Math.floor((e.clientX - rect.left) * (MAP_W / rect.width)),
    my: Math.floor((e.clientY - rect.top) * (MAP_H / rect.height)),
  };
}

// World-map hover (UMain.pas PaintBox1MouseMove:1636): light the corner button
// under the cursor and show a pointer over clickable spots (corners + room nodes).
// The Exit corner is unwired on the web, so it neither lights nor points.
canvas.addEventListener('mousemove', (e) => {
  if (screen !== 'map' || !worldMap || mapOverlay !== 'none') {
    if (mapHoverCorner) mapHoverCorner = null;
    return;
  }
  wake(); // map hover changes the corner highlight — resume 60fps to repaint promptly
  const { mx, my } = mapCoords(e);
  // Record panel open: hover the Run/Replay/Cancel buttons (dAkce, UMain.pas:1626).
  if (mapInfoRoom !== null) {
    const btn = hitInfoButton(mx, my);
    if (btn !== mapInfoHover) {
      mapInfoHover = btn;
      mapSig = null; // the highlighted icon changed — repaint
    }
    canvas.style.cursor = btn ? 'pointer' : 'default';
    return;
  }
  const corner = worldMap.cornerAction(mx, my);
  mapHoverCorner = corner === 'exit' ? null : corner;
  // Track the hovered room node for its name plaque (KresliDesku on dAkce=daRun).
  const overRoomNum = worldMap.hitTest(mx, my, solved, cheated);
  if (overRoomNum !== (mapHoverRoom ?? 0)) {
    mapHoverRoom = overRoomNum || null;
    mapSig = null; // the plaque changed — repaint
  }
  canvas.style.cursor = mapHoverCorner || overRoomNum ? 'pointer' : 'default';
});

canvas.addEventListener('mouseleave', () => {
  wake();
  mapHoverCorner = null;
  if (mapHoverRoom !== null) {
    mapHoverRoom = null;
    mapSig = null;
  }
  canvas.style.cursor = 'default';
});

/** Panel-canvas coords -> panel image space (155x395), accounting for CSS scale. */
function panelCoords(e: MouseEvent): { x: number; y: number } {
  const rect = panelCanvas.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - rect.left) * (PANEL_W / rect.width)),
    y: Math.floor((e.clientY - rect.top) * (PANEL_H / rect.height)),
  };
}

panelCanvas.addEventListener('contextmenu', (e) => e.preventDefault()); // right-click toggles options

panelCanvas.addEventListener('mousedown', (e) => {
  wake();
  if (!panel) return;
  if (tetrisModal()) {
    e.preventDefault(); // modal minigame: the control panel is inert behind it
    return;
  }
  if (inReplay()) {
    e.preventDefault(); // map "Replay" playback: the control panel is inert
    return;
  }
  // Right-click anywhere on the panel toggles the options sub-panel (Uovl.pas:633-639),
  // or closes the Options overlay when it was opened over the map.
  if (e.button === 2) {
    e.preventDefault();
    if (mapOverlay === 'options') closeMapOverlay();
    else togglePanelOptions();
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  const { x, y } = panelCoords(e);
  const region = panelHitTest(x, y, ostav === O_OPTIONS);
  // On the map, the options corner button (region 16) closes the overlay rather
  // than scrolling back to the (nonexistent) in-room panel.
  if (mapOverlay === 'options' && region === 16) {
    closeMapOverlay();
    return;
  }
  if (region) {
    panelPressed = region; // lit-button feedback until release
    // A press on a volume slider begins a drag (updates live as the mouse moves).
    if (region >= 17 && region <= 19) {
      panelDragBus = region === 17 ? 'effect' : region === 18 ? 'voice' : 'music';
    }
    panelAction(region, x);
  }
});

// Slider drag: while a volume slider is held, track the handle to the mouse x.
panelCanvas.addEventListener('mousemove', (e) => {
  if (!panelDragBus || !panel) return;
  e.preventDefault();
  const { x } = panelCoords(e);
  setVolume(panelDragBus, sliderIndex(x));
});

window.addEventListener('mouseup', () => {
  panelPressed = 0;
  panelDragBus = null;
});

function populateRooms(): void {
  const mapOpt = document.createElement('option');
  mapOpt.value = 'map';
  mapOpt.textContent = '🗺  World map';
  select.appendChild(mapOpt);
  for (const r of ROOMS) {
    const opt = document.createElement('option');
    opt.value = String(r.num);
    opt.textContent = `${String(r.num).padStart(2, '0')} — ${r.jmeno} (${r.en})`;
    select.appendChild(opt);
  }
  select.addEventListener('change', () => {
    wake();
    if (select.value === 'map') showMap();
    else enterRoom(Number(select.value));
  });
}

populateRooms();
select.value = 'map'; // the game opens on the world map, so start the picker there

// Public-release layout: the visible fit-mode control (localStorage-persisted via
// settings) + responsive stage scaling on resize / fullscreen.
if (fitSelect) {
  fitSelect.value = settings.fitMode;
  fitSelect.addEventListener('change', () => {
    const v = fitSelect.value;
    settings.fitMode = isFitMode(v) ? v : 'medium';
    saveSettings(settings);
    forceRoomRedraw = true; // the fit scale changes the room canvas size — repaint
    wake();
  });
}
// Dev-bar renderer (CPU/WebGL) + idle-FPS-saver toggles. These mirror the state
// driven by the hidden R hotkey; syncDevControls() keeps their displayed value
// current after a hotkey toggle.
if (rendererSelect) {
  rendererSelect.value = renderer;
  rendererSelect.addEventListener('change', () => setRenderer(rendererSelect.value === 'cpu' ? 'cpu' : 'webgl'));
}
// Dev-bar graphics-level combobox. Mirrors the E hotkey (setGraphics keeps the
// select value in sync when E cycles), and is the primary point-and-click switch.
if (graphicsSelect) {
  graphicsSelect.value = graphics;
  graphicsSelect.addEventListener('change', () => {
    const v = graphicsSelect.value;
    setGraphics(v === 'classic' || v === 'ai' ? v : 'enhanced');
  });
}
if (idleDirtyToggle) {
  idleDirtyToggle.checked = renderOnDirty;
  idleDirtyToggle.addEventListener('change', () => setRenderOnDirty(idleDirtyToggle.checked));
}
if (winRoomBtn) {
  winRoomBtn.addEventListener('click', () => {
    devWinRoom();
    winRoomBtn.blur(); // drop button focus so a Space/Enter dismiss doesn't re-click it
  });
}
// Apply the persisted dev-pane state on boot (Ctrl+Alt+D toggles it thereafter).
document.body.classList.toggle('dev', devEnabled);
relayout();
window.addEventListener('resize', relayout);
document.addEventListener('fullscreenchange', relayout);
// devicePixelRatio can change without a resize event (moving the window to a
// monitor of different density). Re-arm a matchMedia watch on each change so
// 'native' re-snaps to whole physical pixels and stays crisp.
if (typeof window.matchMedia === 'function') {
  const watchDpr = (): void => {
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        relayout();
        watchDpr();
      },
      { once: true },
    );
  };
  watchDpr();
}

font = await FontData.load('/data/Intro');
setLoadingMsg('Loading fonts…');
// Enhanced subtitle font (FreeSans Bold, the FFNG subtitle face). Optional: if it
// fails to load, enhanced mode silently falls back to the baked bitmap subtitles.
// Enhanced subtitle fonts — all bundled + OFL/GPL so they render identically on
// every platform. Mulish/Manrope/Jost are variable (weight axis 100-900);
// FFSubtitle is the original FreeSans Bold. If loading fails, enhanced mode
// silently falls back to the baked bitmap subtitles.
{
  const faces: ReadonlyArray<[string, string, string]> = [
    ['FFSubtitle', '/enhanced/subtitle.ttf', '700'],
    ['Mulish', '/fonts/Mulish.ttf', '100 900'],
    ['Manrope', '/fonts/Manrope.ttf', '100 900'],
    ['Jost', '/fonts/Jost.ttf', '100 900'],
  ];
  let anyLoaded = false;
  await Promise.all(
    faces.map(async ([family, url, weight]) => {
      try {
        const face = new FontFace(family, `url(${url})`, { weight });
        await face.load();
        document.fonts.add(face);
        anyLoaded = true;
      } catch {
        /* this face is unavailable; others / bitmap fallback still work */
      }
    }),
  );
  subFontReady = anyLoaded;
}
// Control-panel overlay graphic (TOvl / panel.ffp).
setLoadingMsg('Loading graphics…');
try {
  const pf = await fetch('/data/Menu/panel.ffp').then((r) => r.arrayBuffer());
  panel = parseFfp(new Uint8Array(pf));
} catch {
  /* panel optional */
}
// World map assets (mapa-0/mapa-1/maska + node sprites n0..n4).
try {
  const files = ['mapa-0.BMP', 'mapa-1.BMP', 'maska.BMP', 'n0.BMP', 'n1.BMP', 'n2.BMP', 'n3.BMP', 'n4.BMP'];
  const bmps = await Promise.all(
    files.map((f) => fetch(`/data/Menu/${f}`).then((r) => r.arrayBuffer()).then((b) => parseBmp(new Uint8Array(b)))),
  );
  worldMap = new WorldMap(bmps[0]!, bmps[1]!, bmps[2]!, bmps.slice(3));
  // The AI-upscaled map (Phase B) is NOT loaded here: it is fetched lazily on the first
  // map draw in the `ai` tier (ensureAiWorldMap), so other tiers pay nothing for it.
} catch {
  /* map optional */
}
// World-map record info panel assets (krokoměr background, button icons, digit
// glyphs) + the level name-plaque data for the current language (UMain.pas:341).
try {
  const [krokomer, ikonky, cisla] = await Promise.all(
    ['krokomer.BMP', 'ikonky.BMP', 'cisla.BMP'].map((f) =>
      fetch(`/data/Menu/${f}`).then((r) => r.arrayBuffer()).then((b) => parseBmp(new Uint8Array(b))),
    ),
  );
  infoPanelAssets = { krokomer: krokomer!, ikonky: ikonky!, cisla: cisla! };
} catch {
  /* info panel optional */
}
await ensureDeskyData();

setLoadingMsg('Loading sound…');
try {
  const [gfft, gffs] = await Promise.all([
    fetch('/data/Title/x00.fft').then((r) => r.arrayBuffer()),
    fetch('/data/Sound/x00.ffs').then((r) => r.arrayBuffer()),
  ]);
  audio.loadGlobal(new Uint8Array(gfft), new Uint8Array(gffs));
} catch {
  /* effects optional */
}
// Global ambient-chatter package (x03: the "ob-*" idle lines the fish say when
// left alone — StdKecej / vyber_hlasku). Subtitles into chatFft, voices into audio.
try {
  const [cfft, cffs] = await Promise.all([
    fetch('/data/Title/x03.fft').then((r) => r.arrayBuffer()),
    fetch('/data/Sound/x03.ffs').then((r) => r.arrayBuffer()),
  ]);
  const cfftBytes = new Uint8Array(cfft);
  chatFft = parseFft(cfftBytes);
  audio.loadGlobal(cfftBytes, new Uint8Array(cffs));
} catch {
  /* chatter optional */
}
// Global death-commentary package (x02: the "smrt-*" lines the survivor says when
// its partner dies — StdSmrt). Subtitles into deathFft, voices into audio.
try {
  const [dfft, dffs] = await Promise.all([
    fetch('/data/Title/x02.fft').then((r) => r.arrayBuffer()),
    fetch('/data/Sound/x02.ffs').then((r) => r.arrayBuffer()),
  ]);
  const dfftBytes = new Uint8Array(dfft);
  deathFft = parseFft(dfftBytes);
  audio.loadGlobal(dfftBytes, new Uint8Array(dffs));
} catch {
  /* death lines optional */
}
setLoadingMsg('Loading the world…');
await loadRoom(7);
// Critical assets: without the control panel or the world map the game is
// unplayable, so a missing/broken deploy of these is a fatal error (rather than
// the silent graceful-degradation the optional audio packages get).
if (!panel || !worldMap) {
  showFatal('Some core game files are missing. Please try again, or check the installation.');
  throw new Error('missing critical assets: ' + (!panel ? 'panel ' : '') + (!worldMap ? 'worldMap' : ''));
}
// Boot: on first run, auto-play the intro (logo → intro) before the map, then
// flip the persisted flag so later runs go straight to the map (the original's
// START→NO first-run gate, UMain.pas:677-682). The intro is always replayable
// from the map's top-left corner.
if (settings.introSeen) {
  screen = 'map'; // the game opens on the world map
  mapRevealStart = performance.now(); // animate the map in from the start
  startMenuMusic(); // menu music (silent until the first user gesture unlocks audio)
} else {
  playFirstRunIntro();
}
setInfo();
// Boot complete — hide the loading overlay, stop treating errors as fatal, and
// (if applicable) surface the software-renderer note.
booted = true;
console.info(`Fish Fillets 4ever v${__APP_VERSION__} (${__BUILD_HASH__} · ${__BUILD_DATE__})`);
initAnalytics(); // web analytics (platform layer): no-op in dev / without a token
if (loadingEl) loadingEl.hidden = true;
maybeShowWebglNote();
requestAnimationFrame(loop);

// Browsers gate audio behind a user gesture: on the first interaction, resume the
// context and (re)start the menu music if we're on the map.
const unlockAudio = (): void => {
  audio.resume();
  if (screen === 'map') startMenuMusic();
};
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

// Debug hook for headless verification.
(window as unknown as { __ff: unknown }).__ff = {
  state: () => {
    if (!room) return null;
    const l = room.items[room.littleIdx];
    const b = room.items[room.bigIdx];
    return {
      dead: room.anyFishDead,
      alive: { ...room.alive },
      won: room.won,
      venku: room.venku,
      active: engine?.active ?? 'little',
      phase: engine?.phase ?? 'idle',
      swimming: engine?.swim != null,
      little: l ? { x: l.x, y: l.y, facingRight: room.facingRight.little } : null,
      big: b ? { x: b.x, y: b.y, facingRight: room.facingRight.big } : null,
      littleFrame: fishFrameFor('little'),
    };
  },
  press: (which: 'little' | 'big', dir: number) => {
    if (!idle() || !engine) return;
    engine.swim = null;
    engine.active = which;
    tryStep(which, dir);
  },
  click: (cx: number, cy: number) => clickCell(cx, cy),
  talk: (which: 'little' | 'big') => talk(which),
  count: () => count,
  fsize: () => FSIZE,
  /**
   * The room's resolved geometry (see roomGeometry): native/css/backing sizes plus the
   * AI upscale.
   *
   * `upscale` is the sound way to ask "is the AI compositor drawing this frame?".
   * `#screen.width` is not: on the canvas-2D path #screen IS the ×S composite, but on
   * the GPU path the composite lives in GlAiScreen's FBO and #screen stays at native
   * size — so a probe reading the canvas only ever tests one backend, and since `webgl`
   * is the default, the wrong one.
   */
  roomGeom: () => (room ? roomGeometry(room) : null),
  phase: () => engine?.phase ?? 'idle',
  moveFrames: () => engine?.moveFrames() ?? MOVE_FRAMES, // current ticks/cell (jizda speed-up)
  jizda: () => engine?.jizda ?? 0,
  record: () => engine?.srecord ?? '',
  moves: () => lengthOfRecord(engine?.srecord ?? ''),
  restart: () => restartRoom(),
  smoothOn: () => {
    smoothLog = [];
  },
  smoothLog: () => (smoothLog ? smoothLog.slice() : []),
  save: () => saveGame(),
  load: () => loadGame(),
  hasSave: () => saveExists(),
  /** CanSave (URoom.pas:26900): whether the current position may be saved at all. */
  canSave: () => canSave(),
  /** The panel's per-element colour state (for asserting the greyed save button). */
  panelState: () => panelState(),
  posHash: () => {
    if (!room) return '';
    // A stable snapshot of every item's position + fish facing/exit, for
    // determinism checks (undo/load must reproduce it exactly).
    const parts = room.items.map((it) => `${it.x},${it.y}`);
    parts.push(`fL:${room.facingRight.little ? 1 : 0}`, `fB:${room.facingRight.big ? 1 : 0}`);
    parts.push(`vL:${room.venku.little ? 1 : 0}`, `vB:${room.venku.big ? 1 : 0}`);
    return parts.join('|');
  },
  mouths: () => ({ ...poslMluv }),
  heads: () => ({ little: fishFrameFor('little').headFrame, big: fishFrameFor('big').headFrame }),
  music: () => audio.currentMusic,
  graphics: () => graphics,
  setGraphics: (m: GraphicsLevel) => setGraphics(m),
  // The movie URL that would be played for the active graphics level right now
  // (reflects the `ai` upscale once its HEAD probe has resolved). Debug/test only.
  logoMovieUrl: () => logoMovie(),
  introMovieUrl: () => introMovie(),
  renderer: () => renderer,
  setRenderer: (m: 'cpu' | 'webgl') => {
    renderer = m;
    if (renderer === 'webgl') enableWebgl();
    localStorage.setItem('ff.renderer', renderer);
  },
  subFont: () => ({ idx: subFontIdx, ...SUB_FONT_CANDIDATES[subFontIdx]! }),
  subFontList: () => SUB_FONT_CANDIDATES.map((c) => c.name),
  setSubFont: (i: number) => applySubFont(i),
  cycleSubFont: (next = true) => previewSubFont(next),
  // True when the last frame was actually presented by the WebGL backend.
  //
  // In a room this reports the backend that PAINTED, not the one the canvas stacking
  // suggests. That distinction is the whole point: the `ai` tier used to paint on
  // canvas-2D while `renderer` still read `webgl`, and a display-only check said the
  // GPU was engaged. Off the room screen (map, cutscene) the visible canvas is still
  // the honest signal.
  glActive: () =>
    renderer === 'webgl' &&
    !glFailed &&
    // While the room is loading or the help overlay is up, loop() hides #screen-gl and
    // nothing paints the room at all, so `lastRoomBackend` is stale — the visible-canvas
    // test is the honest one there, exactly as it is off the room screen.
    (screen === 'room' && !roomLoading && !helpOpen
      ? lastRoomBackend === 'webgl'
      : glCanvas.style.display !== 'none'),
  // Loop-throttle diagnostics (perf): whether the render loop may drop to the idle
  // timer rate right now, and the room-side conditions that force the full-rate rAF
  // spin when any is true (see loopThrottleOk). Used by the perf regression test.
  throttleInfo: () => ({
    throttleOk: loopThrottleOk(),
    onTimer: idleTimer !== 0,
    // Why an idle room may still be waking faster than the 12.5 Hz logic tick: the ai
    // tier's water is sampled per paint on the GPU (see aiWaterAnimating).
    waterAnim: aiWaterAnimating(),
    loops: loopTicks,
    roomPaints,
    heldState,
    phase: engine?.phase ?? 'idle',
    enhancedPending,
    aiPending,
    roomArtPending: roomArtPending(),
    ostav,
    forceRoomRedraw,
  }),
  /** Dev/perf hook: mirror of the dev bar's idle-saver checkbox (P). */
  setRenderOnDirty: (v: boolean) => setRenderOnDirty(v),
  enhancedLoaded: () => enhancedArt !== null,
  enhancedActive: () =>
    enhancedArtActive() &&
    enhancedArt !== null &&
    room !== null &&
    !classicOnlyBackground(room.gspec) &&
    enhancedArt.w === (ffr?.width ?? 0) * FSIZE,
  playingPrior: (prior: number) => audio.playing(prior),
  voicePlaying: () => audio.playing(1) || audio.playing(2) || audio.playing(3),
  panelHit: (x: number, y: number) => panelHitTest(x, y, ostav === O_OPTIONS),
  panelAction: (region: number, panelX = 0) => panelAction(region, panelX),
  hasPanel: () => panel !== null,
  // Options sub-panel state (for UI probes): the scroll state + persisted settings.
  panelOstav: () => ostav,
  panelScroll: () => scroll,
  toggleOptions: () => togglePanelOptions(),
  optionsOpen: () => ostav === O_OPTIONS,
  volumes: () => ({ ...settings.volume }),
  /** music_volume as the room scripts see it (0..64), i.e. Volumes[slider index]. */
  scriptMusicVolume: () => activeScript?.s.musicVolume ?? null,
  subtitleMode: () => settings.subtitles,
  titDef: () => settings.titDef,
  // Help overlay (for UI probes): open/close + page state.
  helpOpen: () => helpOpen,
  openHelp: () => openHelp(),
  closeHelp: () => closeHelp(),
  helpPage: () => helpScreens.page,
  helpPageCount: () => helpScreens.pages(subLang()).length,
  hasMap: () => worldMap !== null,
  screen: () => screen,
  // Debug: true while a room's assets are still loading (loadRoom). Until this
  // clears, the PREVIOUS room is still the live one — `screen() === 'room'` alone
  // does NOT mean the room you asked for is up, because enterRoom() flips the
  // screen synchronously but loads asynchronously.
  roomLoading: () => roomLoading,
  // Debug: true while the room is still waiting for the art tier it will PRESENT —
  // the counterpart of roomLoading() for the visual side (see roomArtPending).
  roomArtPending: () => roomArtPending(),
  // Debug: is the post-boot room-loading overlay on screen right now?
  loadingVisible: () => loadingEl?.hidden === false,
  // Debug: the current room's AI art has finished loading / is actually painting
  // this frame. Two different questions — the art can be loaded while the frame is
  // withheld by the aiRoomRenderActive gate (hooks, ZX, frame effects…).
  aiRoomLoaded: () => aiRoom !== null && aiRoomNum === curNum,
  aiRoomActive: () => room !== null && aiRoomRenderActive(room),
  // Debug: the room number that is actually built and running (curNum) — not the
  // one currently being loaded.
  roomNum: () => curNum,
  // Debug: how many room loads have COMPLETED (see roomLoadSeq).
  roomLoads: () => roomLoadSeq,
  // Debug: the signature of the most recently PAINTED room frame
  // (`count|roomArtPending|graphics|renderer|glFailed`, see the room-draw branch
  // of loop()). Lets a test tell "a frame has been drawn in this graphics mode"
  // apart from "the art happens to have animated", which a frame-hash comparison
  // cannot distinguish in a room whose art animates every tick.
  paintedRoomSig: () => lastRoomSig,
  /** ZAVER finale cutscene active (zavermode) — for the completion-trigger UI test. */
  zaverMode: () => activeScript?.s.zavermode ?? false,
  // Leg-completion story page (obrazek): the shown leg number (1..8), or null when none.
  legImage: () => (legImage ? legImageNum : null),
  /** Debug: show a leg story page directly (probes cannot easily win a leg-final room). */
  showLegImage: (leg: number) => { void showLegImage(leg); },
  /** Debug: is the upscaled story page in use for the page on screen? */
  legImageAiActive: () => legImageAi !== null,
  /** Debug: how many cutscene frames are being served from the upscaled set. */
  kufrAi: () => (aiKufr ? { frames: aiKufrFrames.size, order: aiKufr.order.length, scale: aiKufr.scale } : null),
  showMap: () => showMap(),
  enterRoom: (n: number) => enterRoom(n),
  enterRoomAwait: (n: number) => enterRoom(n),
  mapHit: (x: number, y: number) => worldMap?.hitTest(x, y, solved, cheated) ?? 0,
  // World-map record info panel + best-solution replay (for UI probes).
  mapInfoRoom: () => mapInfoRoom,
  mapInfoHover: () => mapInfoHover,
  mapInfoFaze: () => mapInfoFaze,
  deskyLang: () => deskyLang, // language of the currently loaded room-name plaques
  openMapInfo: (n: number) => openMapInfo(n),
  closeMapInfo: () => closeMapInfo(),
  /** Click at map (x,y): routes exactly like a real left-click (panel button / open panel / launch). */
  clickMap: (x: number, y: number) => clickMapAt(x, y),
  replayActive: () => inReplay(),
  replayIndex: () => replaymode?.idx ?? -1,
  bestRecord: (n: number) => bestRecord(n) ?? null,
  bestRecords: () => Object.fromEntries(bestRecords),
  markBest: (n: number, rec: string) => {
    bestRecords.set(n, rec);
    scores.set(n, lengthOfRecord(rec));
    saveBestRecords();
    saveScores();
  },
  // Intro movie + map-corner menu overlays (for UI probes).
  introPlaying: () => intro.playing,
  introSeen: () => settings.introSeen,
  setIntroSeen: (v: boolean) => {
    settings.introSeen = v;
    saveSettings(settings);
  },
  skipIntro: () => intro.skip(),
  replayIntro: () => replayIntro(),
  mapCorner: (x: number, y: number) => worldMap?.cornerAction(x, y) ?? null,
  mapHover: () => mapHoverCorner,
  setMapHover: (a: MapAction | null) => {
    mapHoverCorner = a;
  },
  clickMapCorner: (x: number, y: number) => dispatchMapCorner(worldMap?.cornerAction(x, y) ?? null),
  mapOverlay: () => mapOverlay,
  openMapOptions: () => openMapOptions(),
  openCredits: () => openCredits(),
  creditMode: () => creditMode,
  // Debug/test only: jump the roll to a scroll offset by back-dating its start.
  creditSeek: (posun: number) => { creditsStart = performance.now() - (posun / CREDIT_SPEED) * CREDIT_TICK_MS; },
  creditLength: () => (credits ? credits.delka : 0),
  closeMapOverlay: () => closeMapOverlay(),
  solvedRooms: () => [...solved],
  scores: () => Object.fromEntries(scores),
  cheatedRooms: () => [...cheated],
  markSolved: (n: number) => {
    solved.add(n);
    saveSolved();
  },
  cheat: () => cheatSolveRoom(),
  lines: () => linesSpoken,
  lastLine: () => lastLine,
  subsActive: () => subs?.active ?? false,
  /** True while a subtitle is still waving in or scrolling (perf probes/benchmarks). */
  subsAnimating: () => subs?.vectorAnimating(count) ?? false,
  /** Perf probe: cumulative count of vector-overlay re-renders (see subOverlayPaints). */
  subPaints: () => subOverlayPaints,
  /** Perf A/B: turn the overlay repaint gate off to reproduce the pre-fix cost. */
  setSubsGate: (v: boolean) => {
    subOverlayGate = v;
    subOverlaySig = '';
  },
  /**
   * Parity probe: repaint the vector overlay for an arbitrary logic tick, bypassing
   * the repaint gate, and report the geometry the reference implementation needs to
   * reproduce it (game-pixel screen size, the overlay backing size and its scale).
   */
  subsPaintAt: (at: number, frac = 0) => {
    if (!subs?.active || !room) return null;
    const { scale: cs } = roomGeometry(room);
    const dpr = window.devicePixelRatio || 1;
    syncSubOverlay();
    subCtx.setTransform(1, 0, 0, 1, 0, 0);
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
    subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
    subs.drawVector(subCtx, at, subFontFamily, subFontWeight, frac);
    subOverlayPainted = true;
    subOverlaySig = ''; // painted behind the gate's back — force the next real repaint
    return {
      w: subCanvas.width,
      h: subCanvas.height,
      scale: cs * dpr,
      screenW: subs.vectorScreen.w,
      screenH: subs.vectorScreen.h,
      family: subFontFamily,
      weight: subFontWeight,
      substeps: SUB_SUBSTEPS,
      lines: subs.debugLines(),
    };
  },
  /** Test hook: inject a subtitle directly (deterministic, no room dialogue needed). */
  pushSubtitle: (text: string, code: string) => subs?.newSubtitle(text, code, count),
  /** Test hooks for the win auto-return hold: read the countdown / clear subtitles. */
  winCountdown: () => engine?.winCountdown ?? 0,
  clearSubtitles: () => subs?.clear(),
  audioHas: (name: string) => audio.has(name),  playSound: (name: string) => audio.play(name),
  // Debug: the room's .ffs voice package now loads AFTER the room's art (it is the
  // bulk of an entry's bytes and nothing visual needs it), so a probe that asserts on
  // a room-specific SOUND must wait for this rather than for the room itself.
  roomAudioReady: () => audio.roomLoaded,
  script: () => (activeScript ? { pokus: activeScript.s.pokus, dialog: activeScript.s.isDialog() } : null),
  itemState: (i: number) => {
    const it = room?.items[i];
    return it ? { x: it.x, y: it.y, afaze: it.afaze, dir: it.dir, spec: it.spec, kind: it.kind } : null;
  },
  gspec: () => room?.gspec ?? 0,
  vytlacit: () => room?.vytlacit ?? 0,
  /** LODE test hooks: start/read the destructive falling-wreck animation. */
  dropShip: (phase = 0) => {
    activeScript?.s.shodLod(phase);
    forceRoomRedraw = true;
    wake();
  },
  wreckState: () =>
    activeScript
      ? {
          phase: activeScript.s.padalod,
          x: activeScript.s.lodniX,
          y: activeScript.s.lodniY,
          swaps: room?.wreckSwaps.length ?? 0,
          changed: room?.wreckSwaps.reduce((n, swap) => n + swap.pixels.length, 0) ?? 0,
        }
      : null,
  /** The `ai` tier's ×S wreck replay: swaps applied, cache revision, background hash. */
  aiWreckDigest: () => (aiRoom && aiRoomNum === curNum ? aiRoom.wreckDigest() : null),
  /**
   * The ENHANCED tier's replay of the same wreck history, as a native-px damage box.
   * Renders the background first so the source actually replays it, then reports what it
   * changed — the independent footprint `aiWreckDigest().damage` is compared against.
   */
  enhWreckDamage: () => {
    if (!room) return null;
    const art = enhancedArtFor(room);
    renderRoomBackgroundRgba(room, art, { count: 0 });
    return art.wreckDamageRect();
  },
  /** Stable fixed-count frame hash used by browser tests to prove a visible delta. */
  roomFrameHash: (mode: GraphicsLevel = graphics) => {
    if (!room) return null;
    const art = mode === 'classic' ? classicArtFor(room) : enhancedArtFor(room);
    const frame = renderRoomRgba(room, art, { count: 0 });
    let hash = 2166136261;
    for (const byte of frame.rgba) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  },
  /**
   * The same frame, but put through the cheat post-processing the real paint path
   * applies (`applyFrameEffects`) — the ONLY way to observe the silent-film tint,
   * the grain and the intertitle card as pixels. `roomFrameHash` above renders the
   * room directly and structurally cannot see them.
   *
   * `grain` selects whether the (deliberately random) film grain is included; leave
   * it off to get a hash that is stable between calls.
   */
  roomEffectFrameHash: (mode: GraphicsLevel = graphics, grain = false) => {
    if (!room) return null;
    const art = mode === 'classic' ? classicArtFor(room) : enhancedArtFor(room);
    const frame = renderRoomRgba(room, art, { count: 0 });
    // Snapshot the one-shot state applyFrameEffects consumes, so merely ASKING for
    // the hash cannot swallow a megabomb flash the player is owed.
    const flash = megabombFlash;
    const force = forceRoomRedraw;
    applyFrameEffects(frame, true, grain);
    megabombFlash = flash;
    forceRoomRedraw = force;
    let hash = 2166136261;
    for (const byte of frame.rgba) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  },
  /**
   * Same, but of the BACKGROUND layer only (wall + wobbled bg, no fish/items/effects).
   * LODE's falling wreck is the only thing that mutates that layer mid-room, so this
   * isolates its visible delta from ambient fish/item animation — and, being masked by
   * the wall, it ignores swaps recorded where nothing can actually show.
   */
  roomBgFrameHash: (mode: GraphicsLevel = graphics) => {
    if (!room) return null;
    const art = mode === 'classic' ? classicArtFor(room) : enhancedArtFor(room);
    const frame = renderRoomBackgroundRgba(room, art, { count: 0 });
    let hash = 2166136261;
    for (const byte of frame.rgba) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  },
  /** Hacky (xfisher): spawn a fishing hook; read the hook count/states. */
  spawnHook: () => {
    if (room) hooks.add(room);
  },
  hookCount: () => hooks.count,
  /** Type a cheat code as the player would (the leading X arms the machine). */
  typeCheat: (code: string) => {
    const entry = screen === 'map' ? mapCheats : roomCheats;
    for (const ch of code) {
      const r = entry.press(ch);
      if (r.cheat) {
        if (screen === 'map') applyMapCheat(r.cheat);
        else applyRoomCheat(r.cheat);
      }
    }
  },
  ultraviolence: () => ultraviolence,
  /** xsilent / xinterlaced state (silentfilm, cassilenttit, interlacedfaze). */
  silentFilm: () => ({
    on: silentFilm,
    time: subs?.silentTime ?? 0,
    lines: (subs?.silentLines ?? []).map((l) => l.s),
  }),
  interlacedFaze: () => interlacedFaze,
  /** The Tetris minigame: null when closed, else its live state. */
  tetris: () =>
    tetris
      ? {
          score: tetris.score,
          rychlost: tetris.rychlost,
          gameover: tetris.gameover,
          umisteni: tetris.umisteni,
          hiscore: [...tetris.hiscore],
          druh: tetris.pada.druh,
          x: tetris.pada.x,
          y: tetris.pada.y,
          smer: tetris.pada.smer,
          rychle: tetris.pada.rychle,
          // The minigame's own clocks: `tick` counts 55ms ticks actually run and
          // `blikani` is the game-over hiscore blink phase (0..17). A probe needs
          // them to assert the blink runs on this clock rather than on the paint
          // rate — without them it can only sleep and hope the machine kept up.
          tick: tetrisTick,
          blikani: tetris.blikani,
          filled: tetris.pole.reduce(
            (n, col) => n + col.reduce((m, c) => m + (c.volno ? 0 : 1), 0),
            0,
          ),
        }
      : null,
  tetrisTick: () => (tetris ? tetris.tick() : undefined),
  /** Hash of the minigame's 150x300 board as it is actually composed and coloured
   *  — the only way a probe can tell the board is really being painted. */
  tetrisBoardHash: () => {
    if (!tetris || !tetrisArt) return null;
    const rgba = tetrisRgba(renderTetris(tetris, tetrisArt), tetrisArt);
    let hash = 2166136261;
    for (const byte of rgba) hash = Math.imul(hash ^ byte, 16777619);
    return { hash: hash >>> 0, w: tetrisArt.hole.w, h: tetrisArt.hole.h };
  },
  tetrisKey: (k: TetrisKey) => tetris?.key(k),
  closeTetris: () => closeTetris(),
  /** Which backend actually painted the last room frame ('cpu' | 'webgl'). */
  roomBackend: () => lastRoomBackend,
  /** cas_hry in days, plus the raw per-room banked milliseconds behind it. */
  casHry: () => casHry(),
  playTime: () => Object.fromEntries(playTime),
  water: () => (room ? { wamp: room.wamp, wper: room.wper, wspd: room.wspd } : null),
  /** The ENHANCED (truecolor) fish body sprite actually in use, for the sprite
   *  cheats — a separate art path from the FFR frames below. */
  enhancedFishSprite: (which: 'little' | 'big') => {
    const set = (cheatFishSprites ?? fishSprites)?.[which === 'little' ? 'small' : 'big'].left;
    const bm = set?.get('body_rest_00.png');
    if (!bm) return null;
    let hash = 2166136261;
    for (const byte of bm.rgba) hash = Math.imul(hash ^ byte, 16777619);
    return { w: bm.w, h: bm.h, hash: hash >>> 0 };
  },
  fishSpriteSize: (which: 'little' | 'big') => {
    const bm = room?.bodies[which === 'little' ? 'small' : 'big'][1] ?? null;
    if (!bm) return null;
    let hash = 2166136261;
    for (const byte of bm.pixels) hash = Math.imul(hash ^ byte, 16777619);
    return { w: bm.w, h: bm.h, hash: hash >>> 0 };
  },
  hookStates: () => hooks.snapshot.map((h) => ({ stav: h.stav, cil: h.cil, x: h.x, y: h.y })),
  /** Debug: teleport an item (used to test gspec=9 push-out rooms). */
  moveItem: (i: number, x: number, y: number) => {
    const it = room?.items[i];
    if (it) {
      it.x = x;
      it.y = y;
    }
  },
  chatterInfo: () => (chatter ? { interval: chatter.interval, last: chatter.last } : null),
  // Test probe: render the current room's background-only on the GPU and compare
  // it to the CPU background — the isolated first-failure signal for the FP32-sin
  // wobble (full-room parity is in glRoomParity).
  glBgParity: () => {
    if (!room) return null;
    const comp = glCompositor();
    if (!comp) return { webgl: false };
    comp.renderBackgroundOnly(room, room.palette, count);
    const gpu = comp.readback();
    const cpu = renderRoomBackgroundRgba(room, classicArtFor(room), { count });
    if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
    return { webgl: true, w: gpu.w, h: gpu.h, ...glChannelDiff(cpu.rgba, gpu.rgba) };
  },
  // Test probe: render the WHOLE current room (background + items + fish) on the
  // GPU via the shared compositor (renderRoomInto → GlScreen) and compare to the
  // CPU frame, byte-for-byte. Classic art source, resting pose (count only).
  glRoomParity: () => (room ? glParityCompare(classicArtFor(room)) : null),
  /**
   * Perf probe: MARGINAL milliseconds per ×S AI frame on each backend.
   *
   * Two things make the naive version of this measurement lie.
   *
   * First, the render loop caps paints at MAX_PAINT_FPS, so a frame-rate reading on a
   * machine that holds the cap reports the cap, not the cost — which is exactly how a
   * compositing regression hides. So this renders back-to-back frames instead.
   *
   * Second, both backends only QUEUE work: WebGL until something forces a sync, and
   * canvas-2D until something forces rasterisation. Draining once at the end and
   * dividing by N therefore folds a FIXED drain cost into the per-frame number, and the
   * answer changes with N — measured 3.7 ms/frame at N=30 against 0.33 ms/frame at
   * N=60 for identical work. So time N frames and 2N frames, both drained, and report
   * the difference over N: the fixed cost appears in both and cancels.
   *
   * The CPU side deliberately alternates `count`, because the canvas-2D target caches
   * the background composite per logic tick — repeating one tick would measure the
   * cache rather than the compositor.
   */
  aiRenderBench: (frames = 30) => {
    if (!room || !aiRoom || aiRoomNum !== curNum) return null;
    const comp = glAiCompositor();
    const geom = roomGeometry(room);
    const w = geom.nativeW * aiRoom.scale;
    const h = geom.nativeH * aiRoom.scale;
    const frame = (n: number): AiRoomFrame => ({
      count: count + n,
      slide: (n % 4) / 4,
      fishAnim: {
        little: { bodyFrame: TL_PLAV[1]!, headFrame: HL_MRK },
        big: { bodyFrame: TL_NAHORU[1]!, headFrame: HL_TLACI },
      },
    });
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const c2 = cv.getContext('2d', { willReadFrequently: true });
    if (!c2) return null;
    // Its own target, reused across the runs: the background composite cache is part of
    // the canvas-2D path's real cost profile so it must persist, but binding the room's
    // live target to this scratch canvas would leave the room holding it (plus its
    // full-size cache clone) long after the probe returned.
    const cpuTarget = new Canvas2dAiTarget(c2);
    const cpuRun = (n: number): number => {
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        c2.setTransform(1, 0, 0, 1, 0, 0);
        c2.clearRect(0, 0, w, h);
        aiRoom!.drawInto(cpuTarget, room!, frame(i));
      }
      c2.getImageData(0, 0, 1, 1); // drain the 2D command queue
      return performance.now() - t;
    };
    const gpuRun = (n: number): number => {
      const t = performance.now();
      for (let i = 0; i < n; i++) {
        comp!.begin(w, h);
        aiRoom!.drawInto(comp!, room!, frame(i));
      }
      comp!.finish();
      return performance.now() - t;
    };
    cpuRun(4); // warm caches on both sides before either clock starts
    const cpuMs = (cpuRun(2 * frames) - cpuRun(frames)) / frames;
    let gpuMs = null;
    if (comp) {
      comp.track(aiRoom);
      gpuRun(4); // warm: the first call allocates the FBO and uploads the art
      gpuMs = (gpuRun(2 * frames) - gpuRun(frames)) / frames;
    }
    return { w, h, frames, cpuMs, gpuMs };
  },
  /**
   * Test probe: is the AI tier's PRESENT pass geometrically right?
   *
   * `aiGlParity` compares the offscreen ×S composite and stops there, so a wrong
   * viewport, Y flip or filter footprint in `present()` leaves it byte-exact while the
   * on-screen image is wrong — the one pass the player actually sees is the one nothing
   * covered.
   *
   * It cannot be a pixel comparison: the GPU box-downsamples at the real ratio and the
   * canvas-2D path leans on the browser's own minification filter, so the two legitimately
   * differ (measured mean ~6/255). What IS filter-independent is ALIGNMENT. Present the
   * frame, read it back, build the same frame through the canvas-2D path scaled to the
   * same size, and score the mean absolute difference for the identity against a
   * y-flipped, x-flipped and ±1px-shifted version of itself. If `present()` is right the
   * identity must win every one of those; if it flips or shifts, it cannot. `spread` is
   * the reference's own variance, so a blank frame (which would tie everywhere) is
   * distinguishable from an aligned one.
   */
  aiPresentCheck: () => {
    if (!room || !aiRoom || aiRoomNum !== curNum) return null;
    const comp = glAiCompositor();
    if (!comp) return { webgl: false };
    const geom = roomGeometry(room);
    const w = geom.nativeW * aiRoom.scale;
    const h = geom.nativeH * aiRoom.scale;
    // Present at a real minification (the shipping case), small enough to score quickly.
    const pw = Math.max(2, Math.round(geom.nativeW));
    const ph = Math.max(2, Math.round(geom.nativeH));
    const rest = { bodyFrame: TL_ZAKLAD[0]!, headFrame: 0 };
    const f: AiRoomFrame = { count, slide: 0, fishAnim: { little: rest, big: rest } };
    comp.track(aiRoom);
    if (!comp.begin(w, h)) return { webgl: true, unsupported: true };
    aiRoom.drawInto(comp, room, f);
    const gpu = comp.presentReadback(pw, ph);

    // Reference: the canvas-2D composite, scaled to the presented size by the browser.
    const big = document.createElement('canvas');
    big.width = w;
    big.height = h;
    const bg = big.getContext('2d', { willReadFrequently: true });
    if (!bg) return { webgl: true, noCanvas: true };
    bg.clearRect(0, 0, w, h);
    aiRoom.drawInto(new Canvas2dAiTarget(bg), room, f);
    const small = document.createElement('canvas');
    small.width = pw;
    small.height = ph;
    const sg = small.getContext('2d', { willReadFrequently: true });
    if (!sg) return { webgl: true, noCanvas: true };
    sg.imageSmoothingEnabled = true;
    sg.drawImage(big, 0, 0, pw, ph);
    const ref = sg.getImageData(0, 0, pw, ph).data;

    const score = (dx: number, dy: number, flipY: boolean, flipX: boolean): number => {
      let sum = 0;
      let n = 0;
      for (let y = 0; y < ph; y++) {
        const ry = flipY ? ph - 1 - y : y + dy;
        if (ry < 0 || ry >= ph) continue;
        for (let x = 0; x < pw; x++) {
          const rx = flipX ? pw - 1 - x : x + dx;
          if (rx < 0 || rx >= pw) continue;
          const a = (y * pw + x) * 4;
          const b = (ry * pw + rx) * 4;
          sum += Math.abs(gpu[a]! - ref[b]!) + Math.abs(gpu[a + 1]! - ref[b + 1]!) + Math.abs(gpu[a + 2]! - ref[b + 2]!);
          n += 3;
        }
      }
      return n === 0 ? Number.POSITIVE_INFINITY : sum / n;
    };
    let mean = 0;
    for (let i = 0; i < ref.length; i += 4) mean += ref[i]!;
    mean /= ref.length / 4;
    let spread = 0;
    for (let i = 0; i < ref.length; i += 4) spread += Math.abs(ref[i]! - mean);
    spread /= ref.length / 4;
    return {
      webgl: true,
      w: pw,
      h: ph,
      spread,
      identity: score(0, 0, false, false),
      flipY: score(0, 0, true, false),
      flipX: score(0, 0, false, true),
      shiftX: score(1, 0, false, false),
      shiftY: score(0, 1, false, false),
    };
  },
  /**
   * Test probe: the `ai` tier's CPU↔GPU parity. Renders the current room's ×S frame
   * through BOTH AiTargets — canvas-2D into an offscreen canvas, and GlAiScreen into
   * its FBO — from the identical room walk and frame state, and diffs them.
   *
   * Non-resting fish (an explicit swim body + head overlay) and a half-step slide are
   * used deliberately: a resting pose exercises neither the head overlay nor the item
   * slide offset, which is most of what a z-order or coordinate bug would move.
   *
   * Unlike the classic/enhanced probes this is NOT byte-exact, and the reason is
   * structural rather than a tolerance chosen to make it pass: the classic oracle
   * (RgbaScreen) is pure JS with defined rounding, whereas this oracle is the browser's
   * own canvas-2D `drawImage`, which blends in PREMULTIPLIED space with rounding no
   * specification pins down. Two roundings of the same blend differ by ±1 per channel
   * on anti-aliased sprite edges. See tools/test-gl-room-ai.mjs for the gate.
   */
  /**
   * Test probe: is the `ai` tier's water actually sampled at ×S — and is it the RIGHT
   * curve?
   *
   * Renders the BACKGROUND LAYER ONLY on the GPU (no sprites, so nothing else can mask
   * or explain a difference) and measures it three ways. Each answers a question the
   * CPU↔GPU parity probe structurally cannot, because that probe now compares two
   * backends that are deliberately allowed to differ here.
   *
   * 1. `oracleMax` — vs an INDEPENDENT JS reimplementation of BG_FS (the continuous
   *    curve from `smoothWobbleShift`, linearly interpolated between source columns,
   *    then the wall composited over it), built from the SOURCE art rather than from
   *    the other AI backend. This is the pin: a rule broken identically on both AI
   *    targets — the failure mode recorded on `dissolveKeeps` — shows up here.
   * 2. `bandedMax` — vs the FAITHFUL banded expectation. This one must be LARGE: it is
   *    the negative control that catches a silent regression to the quantized shader,
   *    which check 1 alone would happily accept if the oracle regressed with it.
   * 3. `exactRows` / `bandsVarying` — measured on the pixels, with no reference image at
   *    all. A banded integer shift makes every output row an EXACT integer translation
   *    of its source row, so the L1 residual at the best integer shift is 0 for 100 % of
   *    rows, and the estimated shift is CONSTANT across all `scale` rows of a native
   *    band. A fractional per-scaled-row shift breaks both. So `exactRows` must fall well
   *    below 1 and `bandsVarying` must rise well above 0 — a screenshot cannot see either.
   *
   * Rows are scored only across the widest run of FULLY TRANSPARENT wall columns, where
   * the composite is the background unaltered; a row whose run is too short is skipped.
   */
  /**
   * Capture aid: the wall-over-wobbled-background layer at ×S, as a PNG data URL.
   *
   * Deterministic — the tick and sub-tick fraction are arguments, not whatever the live
   * loop happens to be on — so the two backends can be captured at the SAME instant and
   * put side by side. That is the whole point: since canvas-2D keeps the faithful 1998
   * sampling and the GPU samples at ×S, `{ cpu: true }` and `{ cpu: false }` at one
   * `count` are exactly the before/after pair for this change.
   *
   * Crops rather than returning the whole ×S frame by default: room 3's is 2400×2100,
   * and the band seams are only legible at 1:1 anyway.
   */
  aiBgCapture: (opts: { x?: number; y?: number; w?: number; h?: number; at?: number; alpha?: number; cpu?: boolean } = {}) => {
    if (!room || !aiRoom || aiRoomNum !== curNum) return null;
    const S = aiRoom.scale;
    const geom = roomGeometry(room);
    const W = geom.nativeW * S;
    const H = geom.nativeH * S;
    const x = Math.max(0, Math.min(W - 1, opts.x ?? 0));
    const y = Math.max(0, Math.min(H - 1, opts.y ?? 0));
    const w = Math.max(1, Math.min(W - x, opts.w ?? W));
    const h = Math.max(1, Math.min(H - y, opts.h ?? H));
    const at = opts.at ?? count;
    const alpha = opts.alpha ?? 0;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const og = out.getContext('2d');
    if (!og) return null;
    og.imageSmoothingEnabled = false;
    if (opts.cpu) {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      if (!c2) return null;
      c2.clearRect(0, 0, W, H);
      aiRoom.drawBackgroundInto(new Canvas2dAiTarget(c2), room, at, alpha);
      og.drawImage(cv, x, y, w, h, 0, 0, w, h);
    } else {
      const comp = glAiCompositor();
      if (!comp) return null;
      comp.track(aiRoom);
      if (!comp.begin(W, H)) return null;
      aiRoom.drawBackgroundInto(comp, room, at, alpha);
      const px = comp.readback();
      if (px.w !== W || px.h !== H) return null;
      const img = og.createImageData(w, h);
      for (let r = 0; r < h; r++) {
        const src = ((y + r) * W + x) * 4;
        img.data.set(px.rgba.subarray(src, src + w * 4), r * w * 4);
      }
      og.putImageData(img, 0, 0);
    }
    return out.toDataURL('image/png');
  },
  /**
   * The live ripple tuning (src/render/aiTarget.ts). Returned by reference so a capture
   * or tuning probe can sweep the look without a rebuild; the game never writes to it.
   */
  rippleTuning: () => RIPPLE,
  /** Idle water wake period in ms (see waterAnimMs) — the perf/smoothness trade, live. */
  waterAnimMs: (ms?: number) => {
    if (ms !== undefined) {
      waterAnimMs = Math.max(16, Math.min(80, ms));
      forceRoomRedraw = true;
      wake();
    }
    return waterAnimMs;
  },
  /**
   * Live ripple state for the tuning lab (tools/ripple-lab.html): what is on screen now,
   * and how long until the next train. `startTrainNow` shifts the birth schedule so one
   * begins immediately, rather than making the tuner wait out `periodTicks`.
   */
  rippleState: () => {
    if (!room) return null;
    const w: AiWobble = {
      wamp: room.wamp, wper: room.wper, wspd: room.wspd, count, time: count + alpha,
    };
    const clock = w.time + RIPPLE.offsetTicks;
    const active = activeRipples(w, roomGeometry(room).nativeH);
    return {
      wamp: room.wamp,
      wobbles: room.wamp !== 0,
      active: active.length,
      // Gaps are jittered, so "when is the next one" has to be asked of the schedule
      // rather than derived from the period.
      nextInTicks: +(nextRippleBirth(clock, RIPPLE) - clock).toFixed(1),
      inTrain: active.length > 0,
    };
  },
  startTrainNow: () => {
    if (!room) return;
    const clock = count + alpha + RIPPLE.offsetTicks;
    RIPPLE.offsetTicks += nextRippleBirth(clock, RIPPLE) - clock;
    forceRoomRedraw = true;
  },
  aiWobbleCheck: (opts: { alpha?: number; minRun?: number } = {}) => {
    if (!room || !aiRoom || aiRoomNum !== curNum) return null;
    const comp = glAiCompositor();
    if (!comp) return { webgl: false };
    const art = aiRoom.backgroundArt(room);
    if (!art) return { webgl: true, noArt: true };
    const S = aiRoom.scale;
    const geom = roomGeometry(room);
    const W = geom.nativeW * S;
    const H = geom.nativeH * S;
    const alpha = opts.alpha ?? 0;
    const minRun = opts.minRun ?? 160;

    comp.track(aiRoom);
    if (!comp.begin(W, H)) return { webgl: true, unsupported: true };
    aiRoom.drawBackgroundInto(comp, room, count, alpha);
    const gpu = comp.readback();
    if (gpu.w !== W || gpu.h !== H) return { webgl: true, dimMismatch: true };

    const grab = (img: { width: number; height: number }): Uint8ClampedArray | null => {
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const g = cv.getContext('2d', { willReadFrequently: true });
      if (!g) return null;
      g.clearRect(0, 0, W, H);
      g.drawImage(img as CanvasImageSource, 0, 0);
      return g.getImageData(0, 0, W, H).data;
    };
    const bgPx = grab(art.bg);
    const wallPx = grab(art.wall);
    if (!bgPx || !wallPx) return { webgl: true, noCanvas: true };

    const wobbles = room.wamp !== 0;
    const w: AiWobble = {
      wamp: room.wamp, wper: room.wper, wspd: room.wspd, count, time: count + alpha,
    };
    const phase = wobblePhase(w);
    const ripples = activeRipples(w, geom.nativeH);
    const banded = wobbles ? faithfulWobbleShifts(w, geom.nativeH) : null;

    let oracleMax = 0;
    let bandedMax = 0;
    let rippleDelta = 0;
    let sq = 0;
    let n = 0;
    const estimates = new Int32Array(H).fill(0x7fffffff);
    let scored = 0;
    let exact = 0;

    for (let y = 0; y < H; y++) {
      const sh = wobbles ? smoothWobbleShift(y, S, w, phase, ripples) : 0;
      const f = Math.floor(sh);
      const frac = sh - f;
      // Same instant with the ripple term removed: how much the trains actually moved
      // the picture. If the shader ignored uRip this collapses to the oracle's own floor.
      const shNoRip = wobbles ? smoothWobbleShift(y, S, w, phase) : 0;
      const fN = Math.floor(shNoRip);
      const fracN = shNoRip - fN;
      const kBand = banded ? banded[Math.min(geom.nativeH - 1, Math.floor(y / S))]! * S : 0;
      const rowOff = y * W * 4;
      // Longest fully-transparent wall run on this row (where composite === background).
      let bestLen = 0, bestStart = -1, runStart = -1;
      for (let x = 0; x <= W; x++) {
        const clear = x < W && wallPx[rowOff + x * 4 + 3] === 0;
        if (clear) { if (runStart < 0) runStart = x; }
        else if (runStart >= 0) {
          if (x - runStart > bestLen) { bestLen = x - runStart; bestStart = runStart; }
          runStart = -1;
        }
      }
      for (let x = 0; x < W; x++) {
        const o = rowOff + x * 4;
        const wa = wallPx[o + 3]! / 255;
        // BG_FS, restated in FP64: bilerp the background, then wall over it.
        const c0 = Math.min(Math.max(x + f, 0), W - 1);
        const c1 = Math.min(Math.max(x + f + 1, 0), W - 1);
        const cb = Math.min(Math.max(x + kBand, 0), W - 1);
        for (let ch = 0; ch < 3; ch++) {
          const a = bgPx[rowOff + c0 * 4 + ch]!;
          const b = bgPx[rowOff + c1 * 4 + ch]!;
          const bg = wobbles ? a + (b - a) * frac : a;
          const want = wallPx[o + ch]! * wa + bg * (1 - wa);
          const got = gpu.rgba[o + ch]!;
          const d = Math.abs(want - got);
          if (d > oracleMax) oracleMax = d;
          sq += d * d;
          n++;
          const wantB = wallPx[o + ch]! * wa + bgPx[rowOff + cb * 4 + ch]! * (1 - wa);
          const dB = Math.abs(wantB - got);
          if (dB > bandedMax) bandedMax = dB;
          const n0 = Math.min(Math.max(x + fN, 0), W - 1);
          const n1 = Math.min(Math.max(x + fN + 1, 0), W - 1);
          const na = bgPx[rowOff + n0 * 4 + ch]!;
          const nb = bgPx[rowOff + n1 * 4 + ch]!;
          const wantN = wallPx[o + ch]! * wa + (wobbles ? na + (nb - na) * fracN : na) * (1 - wa);
          const dN = Math.abs(wantN - got);
          if (dN > rippleDelta) rippleDelta = dN;
        }
      }
      // Best INTEGER shift of this row against its own source row, and its residual.
      if (bestLen >= minRun) {
        const span = Math.min(bestLen, 800);
        const lim = Math.ceil((room.wamp / 2) * S) + 2;
        let bestD = 0, bestErr = Infinity;
        for (let d = -lim; d <= lim; d++) {
          let err = 0;
          for (let x = bestStart; x < bestStart + span; x += 2) {
            const src = Math.min(Math.max(x + d, 0), W - 1);
            err += Math.abs(gpu.rgba[rowOff + x * 4 + 1]! - bgPx[rowOff + src * 4 + 1]!);
            if (err >= bestErr) break;
          }
          if (err < bestErr) { bestErr = err; bestD = d; }
        }
        estimates[y] = bestD;
        scored++;
        if (bestErr === 0) exact++;
      }
    }

    // Does the estimated shift vary WITHIN a native band? (Banded ⇒ never.)
    let bands = 0, varying = 0;
    for (let i = 0; i * S + S <= H; i++) {
      let ok = true;
      let vary = false;
      const first = estimates[i * S]!;
      for (let r = 0; r < S; r++) {
        const e = estimates[i * S + r]!;
        if (e === 0x7fffffff) { ok = false; break; }
        if (e !== first) vary = true;
      }
      if (!ok) continue;
      bands++;
      if (vary) varying++;
    }

    return {
      webgl: true,
      w: W, h: H, scale: S, wobbles, alpha,
      wamp: room.wamp, wper: room.wper, wspd: room.wspd,
      ripples: ripples.length,
      oracleMax,
      oracleRmse: Math.sqrt(sq / Math.max(1, n)),
      bandedMax,
      rippleDelta,
      scoredRows: scored,
      exactRows: scored ? exact / scored : 1,
      bands,
      bandsVarying: bands ? varying / bands : 0,
    };
  },
  aiGlParity: (opts: { stillWater?: boolean } = {}) => {
    if (!room || !aiRoom || aiRoomNum !== curNum) return null;
    const comp = glAiCompositor();
    if (!comp) return { webgl: false };
    const geom = roomGeometry(room);
    const w = geom.nativeW * aiRoom.scale;
    const h = geom.nativeH * aiRoom.scale;
    const f: AiRoomFrame = {
      count,
      slide: 0.5,
      fishAnim: {
        little: { bodyFrame: TL_PLAV[1]!, headFrame: HL_MRK },
        big: { bodyFrame: TL_NAHORU[1]!, headFrame: HL_TLACI },
      },
    };
    // STILL WATER. The two backends deliberately sample the wobble differently now (the
    // GPU per fragment at ×S, canvas-2D at 1998's quantization), so a wobbling room can
    // no longer be byte-compared — in 70 of 72 rooms. Rather than widen the tolerance and
    // lose the net for EVERYTHING ELSE, the comparison is made with the wave switched
    // off: `wamp = 0` puts both backends on the identical `texelFetch(x)` path, and every
    // other primitive — wall alpha compositing, items, fish, mirror, rope, wreck,
    // dissolve, the classic-sprite fallback — is then held to exactly the gate it was
    // held to before. Rooms 46 and 66 already have `wamp === 0`, so they run this probe
    // untouched and act as the control that the override itself is not what produces the
    // match. Restored in `finally`: a probe must not leave the room's water switched off.
    const savedWamp = room.wamp;
    if (opts.stillWater) room.wamp = 0;
    try {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = h;
      const c2 = cv.getContext('2d', { willReadFrequently: true });
      if (!c2) return { webgl: true, noCanvas: true };
      c2.setTransform(1, 0, 0, 1, 0, 0);
      c2.clearRect(0, 0, w, h);
      aiRoom.drawInto(new Canvas2dAiTarget(c2), room, f); // scratch target: see aiRenderBench
      const cpu = new Uint8Array(c2.getImageData(0, 0, w, h).data.buffer.slice(0));
      comp.track(aiRoom);
      comp.begin(w, h);
      aiRoom.drawInto(comp, room, f);
      const gpu = comp.readback();
      if (gpu.w !== w || gpu.h !== h) return { webgl: true, dimMismatch: true };
      return { webgl: true, w, h, stillWater: opts.stillWater === true, ...glChannelDiff(cpu, gpu.rgba, w) };
    } finally {
      room.wamp = savedWamp;
    }
  },
  // Test probe: same, through the ENHANCED (FFNG truecolor) art source.
  // `enh` reports whether the FFNG masters were actually engaged for this room.
  glEnhParity: () => {
    if (!room) return null;
    const r = glParityCompare(enhancedArtFor(room));
    if (r && typeof r === 'object' && 'webgl' in r && r.webgl) (r as Record<string, unknown>).enh = enhancedArt !== null;
    return r;
  },
  // Live-state parity probe (classic art): compares the GPU vs CPU frame with
  // NON-resting content — an explicit swim body + head overlay (exercises the
  // FISH_FS head/body split), the current fishing hooks (setIndex line/glyph +
  // caught-fish composite), a dead fish's disintegrating skeleton (DISINT_FS
  // randpole dither, when a fish has been killed), and baked classic subtitles
  // (setIndex text) drawn into BOTH targets. These paths are untouched by the
  // resting-pose glRoomParity. Byte-exact expected (max=0). The test drives the
  // scenario (spawnHook / killFish / pushSubtitle) before calling this.
  glLiveParity: () => {
    if (!room) return null;
    const comp = glCompositor();
    if (!comp) return { webgl: false };
    const art = classicArtFor(room);
    const opts = {
      count,
      slide: 0.5,
      fishAnim: {
        little: { bodyFrame: TL_PLAV[1]!, headFrame: HL_MRK },
        big: { bodyFrame: TL_NAHORU[1]!, headFrame: HL_TLACI },
      },
      hooks: hooks.snapshot,
    };
    const cpu = renderRoomRgba(room, art, opts);
    subs?.draw(cpu, count); // baked classic subtitles (setIndex on the CPU target)
    comp.begin(cpu.width, cpu.height, room.palette);
    renderRoomInto(comp, room, art, opts);
    subs?.draw(comp, count); // baked classic subtitles (setIndex on the GPU target)
    if (comp.unsupported) return { webgl: true, unsupported: true };
    const gpu = comp.readback();
    if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
    return { webgl: true, w: gpu.w, h: gpu.h, ...glChannelDiff(cpu.rgba, gpu.rgba) };
  },
  // Cutscene GPU parity probe: render the current briefcase-demo frame through the
  // GPU indexed path (GlScreen.renderIndexed → offscreen FBO) and compare to a CPU
  // IndexedScreen.toRgba of the same palette-indexed pixels. The FBO is sampled
  // NEAREST from a palette LUT, so it is byte-exact (max=0); the LINEAR present
  // upscale is cosmetic and NOT part of this comparison (readback reads the FBO,
  // not the presented canvas). Requires an active cutscene.
  glCutsceneParity: () => {
    if (!cutscene) return null;
    const comp = glCompositor();
    if (!comp) return { webgl: false };
    const w = cutscene.width;
    const h = cutscene.height;
    comp.renderIndexed(cutscene.pixels, w, h, cutscene.palette);
    const gpu = comp.readback();
    const frame = new IndexedScreen(w, h);
    frame.px.set(cutscene.pixels);
    const cpu = frame.toRgba(cutscene.palette);
    if (gpu.w !== w || gpu.h !== h) return { webgl: true, dimMismatch: true };
    return { webgl: true, w, h, ...glChannelDiff(cpu, gpu.rgba) };
  },
  // Present-filter probe (guards a LINEAR-filter leak the parity suite can't catch,
  // since it reads the FBO not the canvas). Renders a 2px black→white step, then
  // presents it upscaled to 16px three times and reads the CANVAS back each time:
  // crisp (NEAREST, no intermediate greys) → smooth (LINEAR, intermediate greys) →
  // crisp again (asserts the smooth present didn't leave the filter LINEAR).
  glPresentFilterProbe: () => {
    const comp = glCompositor();
    if (!comp) return { webgl: false };
    const pal = [
      { r: 0, g: 0, b: 0 },
      { r: 255, g: 255, b: 255 },
    ];
    const W = 16;
    comp.renderIndexed(new Uint8Array([0, 1]), 2, 1, pal);
    const intermediates = (smooth: boolean): number => {
      const buf = comp.presentReadback(W, 1, smooth);
      let n = 0;
      for (let x = 0; x < W; x++) {
        const r = buf[x * 4]!;
        if (r > 20 && r < 235) n++; // a value between the two step colours ⇒ interpolation
      }
      return n;
    };
    const crisp1 = intermediates(false);
    const smooth = intermediates(true);
    const crisp2 = intermediates(false);
    return { webgl: true, crisp1, smooth, crisp2 };
  },
  subFontReady: () => subFontReady,
  // the current art source (classic/enhanced). Isolates the compositing+present
  // cost from the rAF vsync cap, so it reveals real headroom (both backends sit
  // at 60fps under vsync when there's slack). WebGL is timed with a gl.finish()
  // per frame so real GPU execution — not just async command submission — counts.
  benchRender: (mode: 'cpu' | 'webgl', frames = 120, warmup = 20) => {
    if (!room) return null;
    const art = enhancedArtActive() ? enhancedArtFor(room) : classicArtFor(room);
    const { nativeW: sw, nativeH: sh, scale: benchCs } = roomGeometry(room);
    const opts = { count };
    const samples: number[] = [];
    // The ZX room's blitZX advances room.zx every render; snapshot it so the
    // benchmark (warmup + frames iterations) leaves the live animation untouched.
    const zxSnap = room.gspec === 42 ? { ...room.zx } : null;
    if (mode === 'webgl') {
      const comp = glCompositor();
      if (!comp) return { mode, webgl: false };
      const dpr = window.devicePixelRatio || 1;
      const bw = Math.round(sw * benchCs * dpr);
      const bh = Math.round(sh * benchCs * dpr);
      const one = (): void => {
        comp.begin(sw, sh, room!.palette);
        renderRoomInto(comp, room!, art, opts);
        comp.present(bw, bh);
        comp.finish(); // flush GPU so the timing includes execution, not just submission
      };
      for (let i = 0; i < warmup; i++) one();
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        one();
        samples.push(performance.now() - t0);
      }
    } else {
      const one = (): void => {
        const s = renderRoomRgba(room!, art, opts);
        ctx.putImageData(new ImageData(new Uint8ClampedArray(s.rgba), sw, sh), 0, 0);
      };
      for (let i = 0; i < warmup; i++) one();
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        one();
        samples.push(performance.now() - t0);
      }
    }
    samples.sort((a, b) => a - b);
    if (zxSnap) Object.assign(room.zx, zxSnap); // restore ZX animation state
    const sum = samples.reduce((a, b) => a + b, 0);
    const median = samples[Math.floor(samples.length / 2)]!;
    const p95 = samples[Math.floor(samples.length * 0.95)]!;
    const mean = sum / samples.length;
    return {
      mode,
      webgl: true,
      w: sw,
      h: sh,
      frames,
      min: samples[0]!,
      median,
      mean,
      p95,
      fps: 1000 / mean,
    };
  },
  /**
   * Perf probe for the enhanced subtitle overlay: times the exact work draw()
   * does per frame for the vector subtitles (full-overlay clear + scaled
   * drawVector), isolated from the room render and the rAF vsync cap. `at` pins
   * the tick so the wave state can't drift mid-measurement; pass a rising count
   * to model the animating case. Each iteration ends with a 1x1 readback so the
   * 2D commands are actually rasterized inside the timed window instead of being
   * batched away.
   */
  benchSubs: (frames = 120, warmup = 20, at = count, advance = false) => {
    if (!subs?.active || !room) return null;
    const { scale: cs } = roomGeometry(room);
    syncSubOverlay();
    const dpr = window.devicePixelRatio || 1;
    let tick = at;
    const run = (draw: boolean, flush: boolean): number[] => {
      const one = (): void => {
        subCtx.setTransform(1, 0, 0, 1, 0, 0);
        subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
        if (draw) {
          subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
          subs!.drawVector(subCtx, advance ? tick++ : at, subFontFamily, subFontWeight);
        }
        if (flush) {
          subCtx.setTransform(1, 0, 0, 1, 0, 0);
          subCtx.getImageData(0, 0, 1, 1); // force rasterization inside the timed window
        }
      };
      for (let i = 0; i < warmup; i++) one();
      const s: number[] = [];
      for (let i = 0; i < frames; i++) {
        const t0 = performance.now();
        one();
        s.push(performance.now() - t0);
      }
      return s.sort((a, b) => a - b);
    };
    const stat = (s: number[]): { min: number; median: number; mean: number; p95: number } => ({
      min: s[0]!,
      median: s[Math.floor(s.length / 2)]!,
      mean: s.reduce((a, b) => a + b, 0) / s.length,
      p95: s[Math.floor(s.length * 0.95)]!,
    });
    const full = stat(run(true, true));
    const clearOnly = stat(run(false, true));
    const noFlush = stat(run(true, false));
    subOverlayPainted = true;
    subOverlaySig = ''; // the probe painted behind the gate's back — force a repaint
    return {
      frames,
      chars: subs.lineChars,
      lines: subs.lineCount,
      overlay: `${subCanvas.width}x${subCanvas.height}`,
      ...full,
      clearOnly,
      noFlush,
    };
  },
  chatCount: () => chatFft.length,
  deathBank: () => deathFft.length,
  roomDepth: () => roomDepth,
  killFish: (which: 'little' | 'big') => {
    room?.killFish(which);
  },
  /** Send a fish out of the room (stav_ven end): zije:=false, venku:=true. */
  exitFish: (which: 'little' | 'big') => {
    room?.exitFish(which);
  },
  setTrepat: (v: number) => {
    if (activeScript) activeScript.s.trepat = v;
  },
  canvasTransform: () => canvas.style.transform,
  // Force the ambient-chatter timer due, so the next tick fires a StdKecej line.
  makeChatterDue: () => {
    if (chatter) chatter.last = count - chatter.interval - 1;
  },
  startCutscene: () => void startCutscene(),
  cutsceneDone: () => cutscene?.done ?? null,
  cutsceneActive: () => cutscene !== null,
  skipCutscene: () => skipCutscene(),
  setLang: (l: SubtitleMode) => {
    setSubtitleMode(l);
  },
  // Force a fish to swim out (demonstrates the stav_ven exit animation + win).
  forceExit: (which: 'little' | 'big', dir: number = Dir.left) => {
    if (!room || !engine || engine.phase !== 'idle' || room.won) return;
    const idx = which === 'little' ? room.littleIdx : room.bigIdx;
    engine.exiting = { which, dir };
    engine.exitFrames = exitFramesFor(which, dir);
    room.items[idx]!.dir = dir;
    if (dir === Dir.left) room.facingRight[which] = false;
    else if (dir === Dir.right) room.facingRight[which] = true;
    engine.phase = 'exit';
    engine.animFrame = 0;
  },
  // Dev-only "Win room" (dev-bar button / Shift+W hotkey): genuinely win via the real path.
  winRoom: () => devWinRoom(),
  // ZELVA telepathic possession (natvrdo): force the turtle to seize a fish and
  // drive it to (tx,ty); read the flag and the fish's current cell.
  natvrdo: () => activeScript?.s.natvrdo ?? 0,
  screenShove: () => screenShoveX,
  screenOffset: () => (activeScript ? { ...activeScript.s.screenOffset } : { x: 0, y: 0 }),
  roompole: (i: number) => activeScript?.s.roompole[i] ?? 0,
  // KAJUTA1 screen-shove testing: arm gspec, and push the big fish a step (returns the
  // step result + resulting gspec/shove) so a probe can drive a wall-push deterministically.
  setGspec: (n: number) => {
    if (room) room.gspec = n;
  },
  bigPush: (dir: number) => {
    const r = tryStep('big', dir);
    return { result: r, gspec: room?.gspec ?? 0, shove: screenShoveX };
  },
  possess: (tvrdaryba: number, tx: number, ty: number) => {
    if (activeScript) {
      activeScript.s.tvrdaryba = tvrdaryba;
      activeScript.s.tvrdex = tx;
      activeScript.s.tvrdey = ty;
      activeScript.s.natvrdo = 1;
    }
  },
  fishCell: (which: 'little' | 'big') => {
    if (!room) return null;
    const it = room.items[which === 'little' ? room.littleIdx : room.bigIdx];
    return it ? { x: it.x, y: it.y } : null;
  },
  // BUG-001 busy-input-gate testing: read/stage a fish's `busy` flag so a probe can
  // verify that input is dropped (fish stays put, keeps facing the player) while it talks.
  busy: (which: 'little' | 'big') => (room ? room.busy[which] : 0),
  setBusy: (which: 'little' | 'big', val: number) => {
    if (room) room.busy[which] = val;
  },
  // Debug: place a fish at a cell (used to stage the KUFRIK demo spot before forcing
  // showmode, since the recording's waypoints assume the fish start there).
  setFishCell: (which: 'little' | 'big', x: number, y: number) => {
    if (!room) return;
    const it = room.items[which === 'little' ? room.littleIdx : room.bigIdx];
    if (it) {
      it.x = x;
      it.y = y;
    }
  },
  // KUFRIK automatic demonstration (showmode / help.cap replay): force-start it and
  // read its live state so a probe can verify the fish auto-move + tutorial subtitles.
  forceShowmode: () => startShowmode(),
  // Debug replay trace: toggle recording, read the rows, and clear.
  showmodeTraceOn: (on: boolean) => {
    showmodeTraceOn = on;
    if (!on) showmodeTrace.length = 0;
  },
  showmodeTrace: () => showmodeTrace.slice(),
  // Debug: true while a fast-forward load animation is replaying (loadmode).
  loading: () => loadmode !== null,
  soundLog: () => audio.soundLog.slice(),
  clearSoundLog: () => {
    audio.soundLog.length = 0;
  },
  // Debug: inspect pathfinding from a fish to a target cell.
  probePath: (which: 'little' | 'big', x: number, y: number) => {
    if (!room) return null;
    const idx = which === 'little' ? room.littleIdx : room.bigIdx;
    const it = room.items[idx];
    return {
      dir: room.findDir(which, x, y),
      targetCell: room.cellOccupant(x, y),
      width: room.width,
      height: room.height,
      fish: it ? { x: it.x, y: it.y } : null,
    };
  },
  showmodeState: () => ({
    active: showmode !== null,
    loading: showmodeLoading,
    idx: showmode?.idx ?? -1,
    total: showmode?.actions.length ?? 0,
    helptext: showmodeHelptext,
    flag: activeScript?.s.showmode ?? false,
    activeFish: engine?.active ?? 'little',
  }),
};
