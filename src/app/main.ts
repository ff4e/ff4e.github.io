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
import { parseFfr, type FfrRoom } from '../data/ffr.js';
import { applyWinDesktopPalette } from '../data/winPalette.js';
import { parseFft, indexFft, type FftEntry } from '../data/fft.js';
import { Room, ITEM_WATER, ITEM_WALL } from '../core/room.js';
import { HookSystem } from '../core/hooks.js';
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
import { ClassicArtSource } from '../render/classicArtSource.js';
import type { ArtSource } from '../render/artSource.js';
import { GlScreen, webgl2Available } from '../render/glScreen.js';
import { FontData } from '../render/font.js';
import { SubtitleSystem } from '../render/subtitles.js';
import { HelpScreens } from '../render/help.js';
import { IndexedScreen } from '../render/framebuffer.js';
import {
  EnhancedArtSource,
  type EnhancedArt,
  type EnhancedObject,
  type FishSprites,
} from '../render/enhancedArtSource.js';
import { parseBmp, bmpToRgba, type Bmp } from '../data/bmp.js';
import { WorldMap, MAP_W, MAP_H, MapAction } from '../render/worldMap.js';
import {
  hitInfoButton,
  drawInfoPanel,
  INFO_SETTLE_FAZE,
  INFO_FAZE_MS,
  type InfoButton,
  type InfoPanelAssets,
} from '../render/mapInfo.js';
import { parseDesky, blitDeska, type DeskyData } from '../data/desky.js';
import { IntroPlayer } from './intro.js';
import { Credits, CREDIT_SPEED, CREDIT_TICK_MS } from '../render/credits.js';
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

/** Display px per native px for content of size w×h, per the current fit mode. */
function contentScaleFor(w: number, h: number): number {
  // Pass devicePixelRatio so 'native' can snap to whole PHYSICAL pixels (crisp at
  // any browser zoom / display scaling); the other modes ignore it.
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  return fitScale(w, h, stage.scale, settings.fitMode, dpr);
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
const panelCanvas = document.getElementById('panel') as HTMLCanvasElement;
const panelCtx = panelCanvas.getContext('2d')!;
const select = document.getElementById('room') as HTMLSelectElement;
const fitSelect = document.getElementById('fitmode') as HTMLSelectElement | null;
const rendererSelect = document.getElementById('renderer') as HTMLSelectElement | null;
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

/** Update the loading overlay's status line (no-op once boot has finished). */
function setLoadingMsg(msg: string): void {
  if (loadingMsg && !booted) loadingMsg.textContent = msg;
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

function syncSubOverlay(): void {
  const cs = contentScaleFor(canvas.width, canvas.height);
  syncSubOverlaySized(canvas.width * cs, canvas.height * cs);
}

/** Clear the subtitle overlay (used off the room screen). */
function clearSubOverlay(): void {
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
let screen: 'map' | 'room' | 'intro' | 'legimage' = 'room'; // which screen is showing
// Leg-completion story image (obrazek, UMain.pas:831 zobraz_obrazek): the full-screen
// "case file" page shown over a frozen map when the last room of a leg (depth 15) is
// won. `legImage` holds the decoded page (null = none); `legImageNum` is the leg (1..8)
// for the __ff hook; `legImageDrawn` gates the one-shot blit while it idles on screen.
let legImage: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;
let legImageNum = -1;
let legImageDrawn = false;
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
let cheatBuf = ''; // rolling buffer of typed keys, for cheat-string detection

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
const gameStart = Date.now(); // session start, for ZAVER's cas_hry playtime narration

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
 * xwemaketherules (URoom.pas:24666): the original's "solve this room" cheat. Marks
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
 *  Unlike cheatSolveRoom (xwemaketherules), which jumps straight to the map and marks the
 *  room "cheated", this drives the real win path — engine.triggerWin -> onWin bookkeeping
 *  (marks the room solved) -> the auto-return countdown -> returnFromRoom — so an
 *  end-of-leg room reveals its story page exactly as a real solve would. Meant purely as a
 *  spot-check aid for the win/story-page flow; armed only while the dev pane is enabled. */
function devWinRoom(): void {
  if (!devEnabled || screen !== 'room' || !engine || !room || engine.phase !== 'idle' || room.won) return;
  engine.triggerWin();
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
/** True while subtitles should be shown (titles <> tit_no). */
function subsOn(): boolean {
  return settings.subtitles !== 'off';
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
  saveSettings(settings);
}
/** Push all persisted volume levels into the audio buses (NastavZvuk, on boot). */
function applyVolumeSettings(): void {
  for (const bus of ['effect', 'voice', 'music'] as const) {
    audio.setBusGain(bus, busMultiplier(bus, settings.volume[bus]));
  }
}

// Enhanced (truecolor) graphics: render eligible rooms through the single
// compositor with the FFNG fillets-ng-data masters as the art source (background
// + object/fish sprites); index-effect rooms (mirror/darkness/ZX/bonus) stay
// classic (see src/render/enhancedArtSource.ts). Persisted; defaults to enhanced. Toggle with E.
let graphics: 'classic' | 'enhanced' =
  (localStorage.getItem('ff.graphics') as 'classic' | 'enhanced' | null) ?? 'enhanced';
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
// Set once if the GPU backend throws, disabling it for the session (the CPU
// compositor takes over) so a driver/context failure can never wedge rendering.
let glFailed = false;
let enhancedArt: EnhancedArt | null = null; // decoded art for the current room (null = classic)
let enhancedObjects: EnhancedObject[] = []; // decoded truecolor object sprites for the current room
let curNum = 0; // current room number, for enhanced-art lookup
// True from entering a room (in enhanced mode) until its truecolor art has
// resolved. While true, draw() holds the previous frame instead of painting the
// classic look, so a room never flashes classic before popping to enhanced.
let enhancedPending = false;
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
  const out: EnhancedObject[] = [];
  for (const e of entries) {
    if (typeof e.item !== 'number' || !Array.isArray(e.frames)) continue;
    const frames = await Promise.all(
      e.frames.map(async (f) => {
        const r = await fetch(`/enhanced/${jmeno}/obj/${f}`);
        if (!isPngResponse(r)) return null;
        const d = await decodePngResponse(r);
        return { w: d.w, h: d.h, rgba: d.rgba };
      }),
    );
    const valid = frames.filter((f): f is { w: number; h: number; rgba: Uint8Array } => f !== null);
    if (valid.length > 0) out.push({ item: e.item, frames: valid });
  }
  return out;
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
  screenShoveX = 0; // reset the KAJUTA1 screen-shove offset
  count = 0;
  const wall = room.bitmaps[room.wallItem.bmp];
  subs = font && wall ? new SubtitleSystem(font, ffr.palette, ffr.width, wall.w, wall.h) : null;
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
      },
      (prior) => audio.talking(prior),
    );
    s.pokus = pokus;
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
  const useVec = graphics === 'enhanced' && cutsceneSubs !== null && subFontReady;
  const frame = new IndexedScreen(w, h);
  frame.px.set(cutscene.pixels);
  if (!useVec) cutsceneSubs?.draw(frame, count); // baked bitmap captions
  // Enhanced upgrade: bilinear-upscale the 256-colour frame on the GPU so it isn't
  // blocky on hi-DPI displays. Classic stays crisp (faithful) via the 2D path.
  const smoothGpu = graphics === 'enhanced' && renderer === 'webgl' && !glFailed;
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
    syncSubOverlaySized(cssW, cssH);
    subCtx.setTransform(1, 0, 0, 1, 0, 0);
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
    subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
    cutsceneSubs!.drawVector(subCtx, count, subFontFamily, subFontWeight);
    subOverlayPainted = true;
    subCanvas.style.transform = '';
  } else if (subOverlayPainted) {
    clearSubOverlay();
  }
}

async function loadRoom(num: number): Promise<void> {
  endShowmode(); // a room change ends any KUFRIK demonstration
  forceRoomRedraw = true; // repaint the first frame of the new room
  roomLoading = true; // hide the stale previous room until the new one is built
  try {
    const nnn = String(num).padStart(3, '0');
    const [ffrRes, fftRes, ffsRes] = await Promise.all([
      fetch(ffrUrl(num)),
      fetch(`/data/Title/${nnn}.fft`),
      fetch(`/data/Sound/${nnn}.ffs`),
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
    if (fftRes.ok && ffsRes.ok) audio.setRoom(fftBytes, new Uint8Array(await ffsRes.arrayBuffer()));
    pokus = 1; // fresh attempt on entering a room
    buildRoom();
    // Enhanced background art for this room (async; draw() holds the previous
    // frame until it lands, so the room never flashes classic first).
    curNum = num;
    enhancedArt = null;
    enhancedObjects = [];
    enhancedPending = graphics === 'enhanced';
    void ensureEnhancedArt(num);
    // Room music (MusicCycle, URoom.pas:1568): loop the room's track, or silence it.
    const music = musicForCHud(ROOMS[num - 1]?.cHud ?? -1);
    if (music) void audio.playMusic(music.name, `/data/Music/${music.name}.wav`, music.loopSample);
    else audio.stopMusic();
  } finally {
    // Always drop the guard, even if a fetch/parse threw: on error we fall back to
    // the pre-existing behaviour (the previous room stays shown) rather than leaving
    // the stage wedged black with no recovery. On success it runs once the room is
    // built, so the next frame paints the new room.
    roomLoading = false;
    forceRoomRedraw = true;
    wake();
  }
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
  buildRoom(); // fresh room (resets srecord); may leave pending fall dirs
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

/** Save the current move record + script state to localStorage. */
function saveGame(): void {
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
    save: p === 12 ? SVITICI : ORANZOVY, // a record always exists to save
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
  while (scrollAcc >= PANEL_SCROLL_MS) {
    scrollAcc -= PANEL_SCROLL_MS;
    advancePanelScroll();
  }
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
  if (panelCanvas.width !== PANEL_W) {
    panelCanvas.width = PANEL_W;
    panelCanvas.height = PANEL_H;
    panelSig = null; // resize cleared the backing store — force a repaint
  }
  let sig: string;
  let compose: () => Uint8Array;
  if (ostav === O_NORMAL) {
    const st = panelState();
    sig = `n|${st.velka}|${st.mala}|${st.space}|${st.save}|${st.load}|${st.abort}|${st.restart}|${st.pressedDir}`;
    compose = () => composePanel(panel!.images, st);
  } else {
    const st = optionsState();
    sig = `o|${st.volume.effect}|${st.volume.voice}|${st.volume.music}|${st.subtitles}|${st.helpActive ? 1 : 0}|${st.scrollFrame}`;
    compose = () => composeOptions(panel!.images, panel!.cudl, st);
  }
  if (sig !== panelSig) {
    panelSig = sig;
    const rgba = panelToRgba(compose(), panel.palette);
    panelCtx.putImageData(new ImageData(new Uint8ClampedArray(rgba), PANEL_W, PANEL_H), 0, 0);
  }
  // Fixed panel size at the stage scale — constant across all rooms (no longer
  // tracks the room height, so it stops resizing room-to-room). Only touch the DOM
  // when it actually changes (a resize), so idle frames do no style work.
  const pw = `${Math.round(stage.panelW)}px`;
  const ph = `${Math.round(stage.panelH)}px`;
  if (panelCanvas.style.width !== pw) panelCanvas.style.width = pw;
  if (panelCanvas.style.height !== ph) panelCanvas.style.height = ph;
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
  if (canvas.width !== MAP_W || canvas.height !== MAP_H) {
    canvas.width = MAP_W;
    canvas.height = MAP_H;
    mapSig = null; // backing store was cleared by the resize — force a repaint
  }
  const cssW = `${MAP_W * cs}px`;
  const cssH = `${MAP_H * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // The 640×480 palette conversion + node compositing is the map's whole cost, and
  // it only changes when its inputs do: the pulse frame (6-phase, ~140ms), the
  // reveal depth (until it passes maxDepth, then frozen), the hover corner, and the
  // solved/cheated sets (which only ever grow, so their size is a sufficient key).
  // The record info panel adds its own inputs: the open room, hovered button, and
  // the odometer roll frame (capped once settled so the sig stops churning), plus
  // the hovered room node (its name plaque).
  const infoFazeKey = Math.min(mapInfoFaze, INFO_SETTLE_FAZE);
  const sig =
    `${pulse % 6}|${Math.min(depth, worldMap.maxDepth + 1)}|${mapHoverCorner ?? ''}|${solved.size}|${cheated.size}|${cheated.size ? 1 : 0}` +
    `|${mapInfoRoom ?? ''}|${mapInfoHover ?? ''}|${infoFazeKey}|${mapHoverRoom ?? ''}`;
  if (sig === mapSig) return; // nothing visibly changed — skip the redraw entirely
  mapSig = sig;
  perfPaint++; // an actual map paint (past the cache check)
  const panelOpen = mapInfoRoom !== null;
  // While the record panel is open the base map renders fully unlit (Delphi zeroes
  // RTable when InfoMode>0, UMain.pas:1446), hiding the lit paths + node artwork so
  // only the name plaque and panel stand out. Nodes (balls) are skipped too.
  const rgba = worldMap.render(solved, pulse, depth, cheated, mapHoverCorner, !panelOpen, !panelOpen);
  // Name plaque (KresliDesku, UMain.pas:1484): drawn for the panel's room while it
  // is open, or the hovered room node otherwise.
  const plaqueRoom = mapInfoRoom ?? mapHoverRoom;
  if (plaqueRoom !== null && deskyData) {
    const deska = deskyData.byRoom.get(plaqueRoom);
    if (deska) blitDeska(rgba, MAP_W, MAP_H, deska, deskyData.atlas, worldMap.palette);
  }
  // The record panel (krokoměr) over the map, with the best move count + buttons.
  if (panelOpen && infoPanelAssets) {
    const count = scores.get(mapInfoRoom!) ?? null; // best (nej) count; null = cheat-only
    const replayEnabled = bestRecord(mapInfoRoom!) !== undefined;
    drawInfoPanel(rgba, MAP_W, MAP_H, infoPanelAssets, count, mapInfoHover, mapInfoFaze, replayEnabled);
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), MAP_W, MAP_H), 0, 0);
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
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    legImageDrawn = false; // the resize cleared the backing store
  }
  const cssW = `${w * cs}px`;
  const cssH = `${h * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  if (legImageDrawn) return; // static page — blit once, then let the loop idle
  legImageDrawn = true;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  perfPaint++;
}

/**
 * Play the intro movie sequence over the stage, then return to the map (the
 * original's daLogo/daIntro chain, UMain.pas:1064-1112). `gated` shows the
 * "click to start" splash first (first-run auto-play). The game audio is torn
 * down before playback (KillSnd/FinishSound) — the movie carries its own sound.
 */
function playIntroMovies(urls: string[], gated: boolean, onFinish: () => void): void {
  if (intro.playing) return;
  screen = 'intro';
  audio.killAll();
  intro.start(urls, onFinish, gated);
}

/** The first-run intro (logo → intro), after which the flag flips so it won't auto-play again. */
function playFirstRunIntro(): void {
  playIntroMovies([LOGO_MOVIE, INTRO_MOVIE], true, () => {
    settings.introSeen = true;
    saveSettings(settings);
    showMap();
  });
}

/** Replay just the intro movie from the map's top-left corner (daIntro plays FilmAvi only). */
function replayIntro(): void {
  playIntroMovies([INTRO_MOVIE], false, () => showMap());
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
    try {
      const [stat, mov] = await Promise.all(
        ['CredStat1.BMP', 'CredMov.BMP'].map((f) =>
          fetch(`/data/Menu/${f}`)
            .then((r) => r.arrayBuffer())
            .then((b) => parseBmp(new Uint8Array(b))),
        ),
      );
      credits = new Credits(stat!, mov!);
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
  creditMode = Math.floor((performance.now() - creditsStart) / CREDIT_TICK_MS) * CREDIT_SPEED;
  if (creditMode > credits.closeAt) {
    closeMapOverlay();
    return;
  }
  const rgba = credits.render(creditMode);
  if (canvas.width !== credits.w || canvas.height !== credits.h) {
    canvas.width = credits.w;
    canvas.height = credits.h;
    canvas.style.width = `${credits.w}px`;
    canvas.style.height = `${credits.h}px`;
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), credits.w, credits.h), 0, 0);
}

/** Enter a room from the map (or the dev dropdown); KillSnd first (Spust, UMain.pas:248).
 *  `replay` is the best-solution move record to play back animated (map "Replay"). */
function enterRoom(num: number, replay?: string): Promise<void> {
  wake();
  screen = 'room';
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
      saveGame();
      break;
    case 13:
      loadGame();
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

// P3 WebGL compositor. Bound lazily to the stacked #screen-gl canvas; the CPU
// Canvas2D path stays the default and the fallback. Returns null (→ CPU) if
// WebGL2 is unavailable or context/compositor construction fails.
let glComp: GlScreen | null = null;
let glCompTried = false;
function glCompositor(): GlScreen | null {
  if (glCompTried) return glComp;
  glCompTried = true;
  if (!webgl2Available()) return null;
  const gl = glCanvas.getContext('webgl2');
  if (!gl) return null;
  try {
    glComp = new GlScreen(gl);
  } catch {
    glComp = null;
  }
  return glComp;
}

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
  glComp = null;
  glCompTried = false;
  console.warn('[ff] WebGL context lost; falling back to the CPU compositor. Press R to retry WebGL.');
  setInfo();
});
glCanvas.addEventListener('webglcontextrestored', () => {
  // Allow a rebuild, but stay on CPU until the user re-enables WebGL (R), so a
  // flapping context can never thrash the render path.
  glComp = null;
  glCompTried = false;
});

/**
 * Clear the WebGL disabled-for-session state so the GPU backend can run again.
 * Rebuilds the compositor only if none is live (i.e. after a context loss);
 * a normal cpu→webgl toggle keeps the existing GlScreen rather than leaking it.
 */
function enableWebgl(): void {
  glFailed = false;
  if (!glComp) glCompTried = false;
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
  if (
    enhArt === null ||
    enhKey[0] !== r ||
    enhKey[1] !== enhancedArt ||
    enhKey[2] !== enhancedObjects ||
    enhKey[3] !== fishSprites
  ) {
    enhArt = new EnhancedArtSource(r.palette, enhancedArt, enhancedObjects, fishSprites);
    enhKey = [r, enhancedArt, enhancedObjects, fishSprites];
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
  sw: number,
  sh: number,
  art: ArtSource,
  opts: RenderOptions,
  useVecSubs: boolean,
): boolean {
  const gl = glCompositor();
  if (!gl || !room) return false;
  try {
    gl.begin(sw, sh, room.palette);
    renderRoomInto(gl, room, art, opts);
    if (gl.unsupported) return false; // defensive: an un-ported primitive → CPU this frame
    if (!useVecSubs) subs?.draw(gl, opts.count ?? 0); // baked subtitles via GPU setIndex
    const dpr = window.devicePixelRatio || 1;
    const cs = contentScaleFor(sw, sh);
    const cssW = sw * cs;
    const cssH = sh * cs;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (glCanvas.width !== bw || glCanvas.height !== bh) {
      glCanvas.width = bw;
      glCanvas.height = bh;
    }
    glCanvas.style.width = `${cssW}px`;
    glCanvas.style.height = `${cssH}px`;
    gl.present(bw, bh);
    return true;
  } catch (e) {
    glFailed = true;
    console.warn('[ff] WebGL renderer failed; falling back to the CPU compositor for this session', e);
    return false;
  }
}

/** Per-channel diff (ignoring alpha) between two same-size RGBA frames. */
function glChannelDiff(cpu: Uint8Array, gpu: Uint8Array): { max: number; rmse: number; overPct: number } {
  let max = 0;
  let sumsq = 0;
  let over = 0;
  let px = 0;
  const n = gpu.length;
  for (let i = 0; i < n; i++) {
    if (i % 4 === 3) continue; // alpha
    const d = Math.abs(gpu[i]! - cpu[i]!);
    if (d > max) max = d;
    sumsq += d * d;
    if (d > 2) over++;
    px++;
  }
  return { max, rmse: Math.sqrt(sumsq / px), overPct: (over / px) * 100 };
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
  // Enhanced mode: while this room's truecolor art is still loading, hold the
  // previous frame rather than painting the classic look (which would flash
  // before popping to enhanced). Cleared as soon as the art resolves (or is
  // known missing), so rooms without masters still fall back to classic.
  if (graphics === 'enhanced' && enhancedPending) return;
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
  else if (phase === 'cork' && corkExit) slide = (sub / corkExit.total) * EXIT_CELLS; // slide the pushed item off
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
  const useVecSubs = graphics === 'enhanced' && subs !== null && subFontReady;
  // One compositor, one pass. The art source is the ONLY switch between the
  // classic (palette) and enhanced (FFNG truecolor) looks; the enhanced source
  // itself falls back to classic per element where no truecolor art exists
  // (darkness/ZX/bonus, the mirror glass, skeletons, un-mapped frames).
  const art = graphics === 'enhanced' ? enhancedArtFor(room) : classicArtFor(room);
  const opts = { count, slide, fishAnim, hooks: hooks.snapshot };
  const { w: sw, h: sh } = roomScreenSize(room);
  const cs = contentScaleFor(sw, sh);
  const cssW = sw * cs;
  const cssH = sh * cs;
  // TrepatRoom (URoom.pas:24955): a chatter line can shake the room — jitter the
  // active canvas left/right by 10px on alternating multiples of 3 ticks.
  const trepat = activeScript?.s.trepat ?? 0;
  const shakeX = trepat !== 0 && count % 3 === 0 ? (count % 6 === 0 ? -10 : 10) : 0;
  const off = activeScript?.s.screenOffset;
  // shake/shove/script-offset are native game px, scaled by the current display scale.
  const ox = (shakeX + screenShoveX + (off?.x ?? 0)) * cs;
  const oy = (off?.y ?? 0) * cs;
  const xform = ox || oy ? `translate(${ox}px, ${oy}px)` : '';

  // Backend dispatch: same renderInto compositor, CPU (RgbaScreen) or GPU
  // (GlScreen) — both composite either art source, every room on the GPU. Any GL
  // error falls back to the CPU path for that frame (and disables WebGL for the
  // session).
  const wantGpu = renderer === 'webgl' && !glFailed;
  const gpuOk = wantGpu && drawGpu(sw, sh, art, opts, useVecSubs);
  lastRoomBackend = gpuOk ? 'webgl' : 'cpu'; // the backend that ACTUALLY painted this frame (for the HUD)
  // #screen (the 2D canvas) is the flow anchor for the wrap that also holds the
  // absolutely-positioned #screen-gl + #subs overlays and sits left of #panel, so
  // it must ALWAYS carry the room's CSS box — even in WebGL mode where we don't
  // draw into it. Otherwise it stays at the default 300×150, the wrap collapses,
  // the GL canvas overflows over the panel and #info crosses the frame.
  if (canvas.width !== sw || canvas.height !== sh) {
    canvas.width = sw;
    canvas.height = sh;
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
    if (!useVecSubs) subs?.draw(screen, count); // baked subtitles (palette-coloured, on top)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(screen.rgba), sw, sh), 0, 0);
    canvas.style.transform = xform;
  }
  // Enhanced subtitle overlay (drawn in native game coords via a scaled context).
  // Only touch the (large) overlay while a subtitle is actually on screen; once it
  // clears we wipe it a single time, so idle frames do no overlay work at all.
  if (useVecSubs && subs!.active) {
    syncSubOverlay();
    const dpr = window.devicePixelRatio || 1;
    subCtx.setTransform(1, 0, 0, 1, 0, 0);
    subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
    subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
    subs!.drawVector(subCtx, count, subFontFamily, subFontWeight);
    subOverlayPainted = true;
    subCanvas.style.transform = xform; // shake/shove with the room
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
    }
    return false;
  }
  tickBlink();
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
  // Run the room script (Programky) each tick while the room is unresolved, then the
  // host's cosmetic StdSmrt / chatter / dialogy on top of it.
  if (activeScript && !room.won) {
    // cas_hry: elapsed session time in days (Delphi Now units) for ZAVER's finale
    // hour-count narration. Session-scoped; cross-session accumulation is deferred.
    const casHry = (Date.now() - gameStart) / 86_400_000;
    engine.runScript(count, casHry); // idle timers + scalar sync + prog + tickShodLod
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
let rafId = 0;
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
// Perf HUD counters (dev mode): rAF ticks vs actual screen paints, sampled ~2×/sec.
let perfRaf = 0;
let perfPaint = 0;
let perfLast = 0;
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
    // frame (a silent CPU fallback after a GL failure reads "WEBGL→cpu").
    let backend = renderer.toUpperCase();
    if (renderer === 'webgl' && screen === 'room' && lastRoomBackend === 'cpu') backend = 'WEBGL→cpu(fallback)';
    perfHud.textContent =
      `paint ${paintFps} fps   rAF ${rafFps} fps\n` +
      `saver ${renderOnDirty ? 'ON' : 'off'} (P)   ${backend} (R)   [${where}]`;
    perfLast = now;
    perfRaf = 0;
    perfPaint = 0;
  }
}
// Smoothness harness: null = off; an array = recording per-frame fish positions.
let smoothLog: { t: number; x: number; y: number; ph: string }[] | null = null;

/**
 * True when the room's frame changes BETWEEN logic ticks and so needs a 60fps
 * repaint — i.e. interpolated fish motion. Everything else (wobble, blink, heads,
 * subtitles, darkness, and the ZX "loading" bands) advances on the 12.5fps logic
 * tick and is caught by the `count` change in the render signature, so it animates
 * correctly at the throttled rate — matching the original's 12.5fps render.
 */
function roomAnimating(): boolean {
  if (engine && engine.phase !== 'idle') return true; // fish sliding/falling/turning/exiting/cork
  return false;
}

/**
 * Whether the loop may drop to the throttled (timer) wake rate. Two idle cases
 * qualify (both need the saver on, no cutscene/intro, no smoothness recording):
 *  - a steady ROOM: nothing animating, no held key / KUFRIK demo / load fast-forward,
 *    the panel in its normal (non-scrolling) state, no enhanced-art hold; or
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
      heldState === 0 &&
      !inShowmode() &&
      !loadmode &&
      ostav === O_NORMAL &&
      !enhancedPending
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

/** Schedule the next loop iteration: 60fps rAF normally, a timer when idle. */
function scheduleNext(): void {
  if (loopThrottleOk()) {
    // A ZX room keeps animating its bands, so it wakes at ~30fps; any other idle
    // room/map wakes at the 12.5fps logic rate.
    const delay = screen === 'room' && room?.gspec === 42 ? ZX_ANIM_MS : IDLE_LOOP_MS;
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      loop(performance.now());
    }, delay);
  } else {
    rafId = requestAnimationFrame(loop);
  }
}

/**
 * Return to 60fps immediately. Called from input handlers so a keypress/click never
 * waits out a throttled timer (movement stays smooth from its first frame). No-op if
 * we're already on rAF.
 */
function wake(): void {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = 0;
    lastTime = 0; // avoid a large dt from the idle gap
    rafId = requestAnimationFrame(loop);
  }
}

/** The render loop: steps the game at a fixed timestep, then draws once per RAF. */
function loop(now: number): void {
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
  // While the enhanced anti-flash hold is active (draw() is holding the previous
  // frame until this room's truecolor art loads), pause the simulation too, so the
  // room's scripts/gravity/subtitle timers/audio don't advance under a frame that
  // was never shown — keeping logic in sync with the first visible frame (as classic
  // mode inherently is). acc keeps accumulating but the backlog guard above drops it,
  // so there's no fast-forward catch-up when the hold releases.
  const holding = screen !== 'map' && !cutscene && graphics === 'enhanced' && enhancedPending;
  while (!holding && acc >= LOGIC_MS && steps < MAX_STEPS_PER_FRAME) {
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
    const sig = `${count}|${enhancedPending ? 1 : 0}|${graphics}|${renderer}|${glFailed ? 1 : 0}`;
    if (!renderOnDirty || forceRoomRedraw || roomAnimating() || zxAnim || sig !== lastRoomSig) {
      draw();
      perfPaint++;
      lastRoomSig = sig;
      forceRoomRedraw = false;
    }
  }
  drawPanel();
  updatePerfHud(now);
  scheduleNext();
}

window.addEventListener('keydown', (e) => {
  wake(); // return to 60fps immediately if the idle-loop throttle had us sleeping
  // While the intro movie plays, swallow input; any key skips the current movie
  // (the original's mouse-down MediaPlayer1.Stop, UMain.pas:1603).
  if (intro.playing) {
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
  // Cheat-string detector (URoom.pas: xwemaketherules solves the current room).
  if (e.key.length === 1 && /[a-z]/i.test(e.key)) {
    cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-20);
    if (cheatBuf.endsWith('xwemaketherules')) {
      cheatBuf = '';
      cheatSolveRoom();
      return;
    }
    // xfisher (URoom.pas:24597): drop a fishing hook into the current room.
    if (cheatBuf.endsWith('xfisher')) {
      cheatBuf = '';
      if (screen === 'room' && room) hooks.add(room);
      return;
    }
    // xscore (easter egg): open the hidden SCORE bonus room (room 72). It is kept
    // off the map and out of the finale, so this typed code is the only way in.
    if (cheatBuf.endsWith('xscore')) {
      cheatBuf = '';
      void enterRoom(72);
      return;
    }
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
  // The single-key dev toggles are armed ONLY while the dev pane is enabled.
  if (devEnabled) {
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
      // Toggle classic <-> enhanced (truecolor) graphics; persist + ensure art.
      graphics = graphics === 'enhanced' ? 'classic' : 'enhanced';
      localStorage.setItem('ff.graphics', graphics);
      if (graphics === 'enhanced' && curNum) void ensureEnhancedArt(curNum);
      setInfo();
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
    saveGame();
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    loadGame();
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
  const px = (e.clientX - rect.left) * (canvas.width / rect.width);
  const py = (e.clientY - rect.top) * (canvas.height / rect.height);
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
  setGraphics: (m: 'classic' | 'enhanced') => {
    graphics = m;
    localStorage.setItem('ff.graphics', graphics);
    if (graphics === 'enhanced' && curNum) void ensureEnhancedArt(curNum);
  },
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
  // True when the last frame was actually presented by the WebGL backend (i.e.
  // renderer=webgl, not fallen back to CPU and the GL canvas is the visible one).
  glActive: () => renderer === 'webgl' && !glFailed && glCanvas.style.display !== 'none',
  // Loop-throttle diagnostics (perf): whether the render loop may drop to the idle
  // timer rate right now, and the room-side conditions that force the full-rate rAF
  // spin when any is true (see loopThrottleOk). Used by the perf regression test.
  throttleInfo: () => ({
    throttleOk: loopThrottleOk(),
    onTimer: idleTimer !== 0,
    heldState,
    phase: engine?.phase ?? 'idle',
    enhancedPending,
    ostav,
    forceRoomRedraw,
  }),
  enhancedLoaded: () => enhancedArt !== null,
  enhancedActive: () =>
    graphics === 'enhanced' &&
    enhancedArt !== null &&
    room !== null &&
    room.gspec === 0 &&
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
  /** ZAVER finale cutscene active (zavermode) — for the completion-trigger UI test. */
  zaverMode: () => activeScript?.s.zavermode ?? false,
  // Leg-completion story page (obrazek): the shown leg number (1..8), or null when none.
  legImage: () => (legImage ? legImageNum : null),
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
  creditMode: () => creditMode,
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
  /** Test hook: inject a subtitle directly (deterministic, no room dialogue needed). */
  pushSubtitle: (text: string, code: string) => subs?.newSubtitle(text, code, count),
  /** Test hooks for the win auto-return hold: read the countdown / clear subtitles. */
  winCountdown: () => engine?.winCountdown ?? 0,
  clearSubtitles: () => subs?.clear(),
  audioHas: (name: string) => audio.has(name),  playSound: (name: string) => audio.play(name),
  script: () => (activeScript ? { pokus: activeScript.s.pokus, dialog: activeScript.s.isDialog() } : null),
  itemState: (i: number) => {
    const it = room?.items[i];
    return it ? { x: it.x, y: it.y, afaze: it.afaze, dir: it.dir, spec: it.spec, kind: it.kind } : null;
  },
  gspec: () => room?.gspec ?? 0,
  vytlacit: () => room?.vytlacit ?? 0,
  /** Hacky (xfisher): spawn a fishing hook; read the hook count/states. */
  spawnHook: () => {
    if (room) hooks.add(room);
  },
  hookCount: () => hooks.count,
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
    const art = graphics === 'enhanced' ? enhancedArtFor(room) : classicArtFor(room);
    const { w: sw, h: sh } = roomScreenSize(room);
    const opts = { count };
    const samples: number[] = [];
    // The ZX room's blitZX advances room.zx every render; snapshot it so the
    // benchmark (warmup + frames iterations) leaves the live animation untouched.
    const zxSnap = room.gspec === 42 ? { ...room.zx } : null;
    if (mode === 'webgl') {
      const comp = glCompositor();
      if (!comp) return { mode, webgl: false };
      const dpr = window.devicePixelRatio || 1;
      const cs = contentScaleFor(sw, sh);
      const bw = Math.round(sw * cs * dpr);
      const bh = Math.round(sh * cs * dpr);
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
  chatCount: () => chatFft.length,
  deathBank: () => deathFft.length,
  roomDepth: () => roomDepth,
  killFish: (which: 'little' | 'big') => {
    room?.killFish(which);
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
