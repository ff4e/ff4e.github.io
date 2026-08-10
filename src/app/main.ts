//#region File docblock | The `URoom.pas` tick state machine this file reproduces, and the keyboard scheme.
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
//#region Imports | The only part safe to skim.
import { parseFfr, type FfrRoom, type FfrBitmap } from '../data/ffr.js';
import { applyWinDesktopPalette } from '../data/winPalette.js';
import { parseFft, type FftEntry } from '../data/fft.js';
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
import { loadAiRoom, aiRoomGateAllows, aiWaterVisible, AiRoom, AI_ROOM_SCALE } from '../render/roomAi.js';
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
import { initFeedback, type FeedbackUi } from './feedback.js';
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
  type GraphicsLevel,
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
import { movesOf, lengthOfRecord, stepsOf, type RecordStep } from '../core/record.js';
import { roomScript } from '../rooms/index.js';
import { KufrDemo, type AiKufr } from '../intro/kufrDemo.js';
import { parseHelpCap, AKCE, KDO, type CapAction } from '../intro/helpCap.js';
import { ROOMS, roomByNumber } from '../data/roomTable.js';
import {
  computeStageLayout,
  contentScale as fitScale,
  isFitMode,
  type StageLayout,
  type FitMode,
  type RoomGeometry,
} from './layout.js';
import { isUnsupportedDevice, showUnsupportedNotice } from './deviceGate.js';
import {
  buildStage,
  canvas,
  ctx,
  fatalEl,
  feedbar,
  fitSelect,
  glCanvas,
  graphicsSelect,
  idleDirtyToggle,
  info,
  loadingEl,
  loadingMsg,
  panelCanvas,
  panelCol,
  panelCtx,
  perfHud,
  rendererSelect,
  select,
  stageBox,
  stageRow,
  subCanvas,
  subCtx,
  winRoomBtn,
  wrap,
} from './dom.js';
import { openSaveStore } from './persist.js';
import { debugHooks } from './debugHooks.js';
import {
  classicArtFor,
  drawAiGpu,
  drawGpu,
  enableWebgl,
  enhancedArtFor,
  glAiCompositor,
  glAiFailed,
  glChannelDiff,
  glCompositor,
  glFailed,
  glParityCompare,
  initGlPlumbing,
  markGlFailed,
} from './glPlumbing.js';
import {
  aiCredits,
  aiPanel,
  aiPending,
  aiRoom,
  aiRoomNum,
  aiRoomRenderActive,
  aiWorldMap,
  beginMapArt,
  beginRoomArt,
  curNum,
  decodePngResponse,
  enhancedArt,
  enhancedObjects,
  enhancedPending,
  ensureAiCredits,
  ensureAiPanel,
  ensureAiRoom,
  ensureEnhancedArt,
  initArt,
  isPngResponse,
  mapArtHolding,
  mapArtPending,
  mapPresented,
  retargetArtForTier,
  roomArtPending,
  setMapPresented,
} from './art.js';
import {
  applyFrameEffects,
  applyMapCheat,
  applyRoomCheat,
  applySpriteCheats,
  blitTetris,
  cheatFishSprites,
  cheatSolveRoom,
  closeTetris,
  endSilentFilm,
  devWinRoom,
  frameEffectsActive,
  initCheats,
  interlacedFaze,
  mapCheats,
  megabombFlash,
  oldWater,
  resetRoomScopedCheats,
  roomCheats,
  setMegabombFlash,
  silentFilm,
  spriteCheats,
  tetris,
  tetrisArt,
  tetrisModal,
  tetrisTick,
  tickFrameEffects,
  tickTetris,
  ultraviolence,
} from './cheats.js';
import {
  beginMapLaunch,
  blitParchment,
  blitParchmentAi,
  canLaunchFromMap,
  initRoomLaunch,
  loadParchment,
  mapLaunching,
  markParchmentPainted,
  parchmentReady,
  tickMapLaunch,
} from './roomLaunch.js';
//#region Device gate, stage layout & constants | anchors: isUnsupportedDevice, computeStageLayout, roomGeometry, LOGIC_MS | Phones are refused first, before any art is fetched. Then how the stage is scaled to the viewport, and the 80 ms game tick.

// Phones are refused here, before a single byte of game ART is fetched. (The engine
// bundle itself has already been downloaded — this statement is inside it — so the claim
// is about the ~600 MB of art, not about every byte.) The game has no touch scheme (see
// deviceGate.ts), and the block is absolute — there is deliberately no override, so this
// must come before every other side effect in the module.
//
// The never-settling await is what stops the rest of this file: it is a top-level-await
// module, so there is no function to return from, and throwing would surface a scary
// console error (and trip the probes' pageerror capture) for what is a normal,
// intentional refusal.
if (typeof window !== 'undefined' && isUnsupportedDevice(window)) {
  showUnsupportedNotice(document);
  await new Promise<never>(() => {});
}

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

//#region Stage assembly & subtitle overlay state | anchors: buildStage, subFontIdx, subOverlaySig | Calls into `dom.ts` to nest the canvases, then the vector-subtitle bookkeeping.
buildStage(); // the stage box + the GL/subtitle overlays (see dom.ts: not done at import time)
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
let booted = false; // true once boot succeeds — before that, any error is fatal

/** Update the loading overlay's status line. */
//#region Loading overlay & fatal errors | anchors: setLoadingMsg, beginRoomLoadingUi, syncLoadingUi, showFatal, relayout | The boot/room-load overlay, its 200 ms anti-flash delay, and the fatal-error screen. | Hot
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
const LOADING_DELAY_MS = 200;
/** When the current room entry started, or 0 when no entry is in progress. */
let roomLoadingSince = 0;
/** When the map's overlay becomes visible, or 0 while the map is not waiting. */
let mapLoadingDueAt = 0;

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
 *
 * Serves BOTH holds — the room's art tier and the `ai` tier's world map — off their
 * own live-state predicates. There is one overlay, so it gets one owner: two syncs
 * writing `hidden` would fight over it on any frame where both had an opinion.
 *
 * The map's whole overlay state is DERIVED here, where the room's is pushed from
 * beginRoomLoadingUi(). That is not an inconsistency but the same principle applied
 * to a one-shot: a room entry re-runs its begin() every time, while the map's art
 * loads at most once per session, so a pushed arm could not re-arm anything when the
 * player leaves the `ai` tier (or the map screen) mid-load and comes back. Derived,
 * every return to the wait re-arms — and re-labels — for free. Note the room's begin()
 * can overwrite the message while the map's load is still in flight, which is exactly
 * the case a pushed map label would have got wrong.
 */
function syncLoadingUi(now: number): void {
  if (!booted || !loadingEl) return;
  const roomWaiting = screen === 'room' && (roomLoading || roomArtPending());
  const mapWaiting = mapArtHolding();
  if (!roomWaiting) roomLoadingSince = 0;
  if (!mapWaiting) mapLoadingDueAt = 0;
  else if (mapLoadingDueAt === 0) {
    // Delay the spinner only over a map that is ALREADY ON SCREEN — a switch into the
    // tier, where the player is looking at a perfectly good map and an instant (local)
    // load must not flash anything at them. When the map is not up yet the stage holds
    // black, or the room/intro we just left, so waiting 200ms to say so would only
    // present something the player is not being taken to.
    mapLoadingDueAt = now + (mapPresented ? LOADING_DELAY_MS : 0);
    setLoadingMsg('Loading the world map…');
    // The boot splash's title and attribution belong to boot — so keep them in the one
    // case where this IS boot still running: the overlay never came down between boot
    // and the map's first frame. Every other arm is a spinner being (re)shown mid-game,
    // where the splash would read as a restart, exactly as a room entry's does.
    if (loadingEl.hidden) loadingEl.classList.add('inroom');
  }
  const show =
    (roomWaiting && roomLoadingSince !== 0 && now - roomLoadingSince >= LOADING_DELAY_MS) ||
    (mapWaiting && now >= mapLoadingDueAt);
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
//#region Intro movies & subtitle overlay | anchors: IntroPlayer, probeAiMovies, syncSubOverlay, clearSubOverlay | Logo/intro `.mp4` playback and the vector-subtitle layer above the game canvas.
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
let aiSubScale = 0.5;

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
function applySubScale(ctx: CanvasRenderingContext2D, sys: SubtitleSystem): void {
  const s = graphics === 'ai' ? aiSubScale : 1;
  if (s === 1) return;
  const { w, h } = sys.vectorScreen;
  ctx.translate(w / 2, h);
  ctx.scale(s, s);
  ctx.translate(-w / 2, -h);
}

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
  // `graphics` is in the key because the ai tier draws the overlay smaller
  // (`aiSubScale`); without it, switching tier could serve the previous tier's cached
  // overlay, which is exactly the class of bug this gate exists around.
  return `${who}|${graphics}|${subFontFamily}|${subFontWeight}|${subCanvas.width}x${subCanvas.height}|${scale}|${sys.vectorSignature(count, alpha)}`;
}

/** Clear the subtitle overlay (used off the room screen). */
function clearSubOverlay(): void {
  subOverlaySig = ''; // whatever the overlay held is gone: never match a stale key
  if (!subOverlayPainted) return; // already clear — skip the (large) clearRect
  subCtx.setTransform(1, 0, 0, 1, 0, 0);
  subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
  subOverlayPainted = false;
}

//#region Screen & overlay state | anchors: ostav, screen, mapOverlay, mapInfoRoom, worldMap, legImage | The mutable globals for panel/options/credits/map-info/help/leg-image. Read this before touching any screen.
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
// The feedback form (src/app/feedback.ts). Wired at the end of boot; until then, and
// if its markup is missing, it simply reports itself closed.
let feedback: FeedbackUi | null = null;
const helpScreens = new HelpScreens(); // the control-help pages (Help.pas), lazily loaded
let worldMap: WorldMap | null = null; // the branch-map screen
// AI-upscaled world-map compositor (Phase B), lazily loaded when the map assets
// load; used ONLY under the `ai` graphics level and only when every AI asset is
// present (else the map falls back to the faithful CPU composite). The overlay
// canvas draws the record panel + name plaques at native res, nearest-neighbour-
// scaled over the hi-res map so digits/text stay crisp.
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

// Persisted progress: solved/cheated rooms, best move counts, best-solution records
// and per-room play time. Opened HERE, not at import time — see persist.ts for why the
// module refuses to load save data at module scope.
//#region Save store + cheats wiring | anchors: openSaveStore, initCheats | Opens `persist.ts` and hands `cheats.ts` its view of the game, after the gate.
const {
  solved,
  cheated,
  scores,
  playTime,
  bestRecords,
  saveSolved,
  saveCheated,
  recordScore,
  recordBest,
  bestRecord,
  casHry,
  startRoomClock,
  stopRoomClock,
  forceBest,
} = openSaveStore();

/**
 * xwemaketherulez (URoom.pas:24666): the original's "solve this room" cheat. Marks
 * the current room completed-via-cheat, records it in the progression, and returns
 * to the map (konec:=1). Handy for testing.
 */
// The cheats — typed codes, sprite/film effects, the Tetris minigame — live in
// cheats.ts. Wired HERE, where that code used to sit. Every member is a getter, so
// nothing below is read in its temporal dead zone; see cheats.ts for why the seam
// runs this way round.
initCheats({
  get screen() {
    return screen;
  },
  get devEnabled() {
    return devEnabled;
  },
  get engine() {
    return engine;
  },
  get room() {
    return room;
  },
  get ffr() {
    return ffr;
  },
  get subs() {
    return subs;
  },
  get activeScript() {
    return activeScript;
  },
  get fishSprites() {
    return fishSprites;
  },
  get count() {
    return count;
  },
  get audio() {
    return audio;
  },
  get hooks() {
    return hooks;
  },
  get EFFECT_VOL() {
    return EFFECT_VOL;
  },
  get MLUVI_PRIOR() {
    return MLUVI_PRIOR;
  },
  get solved() {
    return solved;
  },
  get cheated() {
    return cheated;
  },
  get scores() {
    return scores;
  },
  get saveCheated() {
    return saveCheated;
  },
  get showMap() {
    return showMap;
  },
  get enterRoom() {
    return enterRoom;
  },
  get wake() {
    return wake;
  },
  get clearHeldKey() {
    return clearHeldKey;
  },
  get syncScriptMusicVolume() {
    return syncScriptMusicVolume;
  },
  get applyVolumeSettings() {
    return applyVolumeSettings;
  },
  get forceRoomRedraw() {
    return forceRoomRedraw;
  },
  set forceRoomRedraw(v: boolean) {
    forceRoomRedraw = v;
  },
});
//#region Room state & settings | anchors: ffr, room, subs, settings, subsOn, setSubtitleMode, applyVolumeSettings | The current room's parsed data plus subtitle/volume settings.
let ffr: FfrRoom | null = null;
let room: Room | null = null;
let font: FontData | null = null;
let subs: SubtitleSystem | null = null;
/**
 * The current room's FFT, in file order. Only the order-sensitive uses need this:
 * every by-name lookup goes through `audio.entry()`, which already indexes every
 * loaded package and so needs no per-package copy here.
 */
let fftEntries: FftEntry[] = [];
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
//#region Graphics tier, renderer, dev flags | anchors: setGraphics, setRenderer, setRenderOnDirty, setDevEnabled | Tier selection, CPU vs WebGL, render-on-dirty, the dev pane.
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
  retargetArtForTier();
  if (graphicsSelect) graphicsSelect.value = graphics;
  forceRoomRedraw = true;
  mapSig = null; // repaint the map so switching to/from the AI level shows immediately
  wake();
  setInfo();
}

// Art loading for the enhanced and `ai` tiers lives in art.ts. Wired HERE, where that
// code used to sit. It reads the game through these getters; the three setters are the
// repaint invalidations it fires when an async load lands.
//#region Art wiring | anchors: initArt | Hands `art.ts` its view of the game. The art loading itself is in that module.
initArt({
  get closeMapOverlay() {
    return closeMapOverlay;
  },
  get enhancedArtActive() {
    return enhancedArtActive;
  },
  get forceRoomRedraw() {
    return forceRoomRedraw;
  },
  set forceRoomRedraw(v: boolean) {
    forceRoomRedraw = v;
  },
  get graphics() {
    return graphics;
  },
  get hooks() {
    return hooks;
  },
  get mapOverlay() {
    return mapOverlay;
  },
  get mapSig() {
    return mapSig;
  },
  set mapSig(v: string | null) {
    mapSig = v;
  },
  get panelSig() {
    return panelSig;
  },
  set panelSig(v: string | null) {
    panelSig = v;
  },
  get screen() {
    return screen;
  },
  get subFontReady() {
    return subFontReady;
  },
  get subs() {
    return subs;
  },
  get wake() {
    return wake;
  },
  get worldMap() {
    return worldMap;
  },
});

// The room-entry parchment and the map launch it belongs to (roomLaunch.ts). Wired HERE,
// where that code used to sit. It is the one module given a WRITABLE `screen`, because a
// launch ending IS a screen transition — see its docblock for the rest of the seam.
//#region Room launch wiring | anchors: initRoomLaunch | Hands `roomLaunch.ts` its view of the game. The parchment and the daRun state machine are in that module.
initRoomLaunch({
  get aiWorldMap() {
    return aiWorldMap;
  },
  get forceRoomRedraw() {
    return forceRoomRedraw;
  },
  set forceRoomRedraw(v: boolean) {
    forceRoomRedraw = v;
  },
  get inShowmode() {
    return inShowmode;
  },
  get mapArtHolding() {
    return mapArtHolding;
  },
  get mapOverlay() {
    return mapOverlay;
  },
  get mapPresented() {
    return mapPresented;
  },
  get mapSig() {
    return mapSig;
  },
  set mapSig(v: string | null) {
    mapSig = v;
  },
  get roomArtPending() {
    return roomArtPending;
  },
  get roomLoading() {
    return roomLoading;
  },
  get screen() {
    return screen;
  },
  set screen(v: 'map' | 'room' | 'intro' | 'legimage') {
    screen = v;
  },
  get setRoomPicker() {
    return setRoomPicker;
  },
  get startRoom() {
    return startRoom;
  },
  get wake() {
    return wake;
  },
});
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
//#region Engine, audio & mode state | anchors: audio, engine, activeScript, chatter, cutscene, showmode, hooks, KEYS | The mutable core: step engine, script, dialogue, the three playback modes, and the key tables.
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
  steps: RecordStep[];
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

//#region Room construction | anchors: buildRoom, setInfo, applySubFont, scriptTalk | Turns parsed FFR data into a live `Room` + `StepEngine`, and refreshes the info line. Room *loading*, audio, movement and drawing are elsewhere.
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
  if (!carryPole) resetRoomScopedCheats();
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
  // The room's FFT arrives before its FFS, so it is consulted directly: during that
  // window audio has no room package yet but the subtitle is already known.
  const entry = fftEntries.find((e) => e.name === name) ?? audio.entry(name);
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
//#region Cutscene, showmode, replay | anchors: startCutscene, startShowmode, advanceShowmode, applyCapAction, ensureAiKufr, drawCutscene | The KUFRIK demo, the `.cap` demonstration player, record replay, and the cutscene compositor.
async function startCutscene(): Promise<void> {
  if (cutscene || !font) return;
  // The room this launch belongs to. Every await below is a window in which the
  // player can leave (or restart into another room), and what lands afterwards must
  // not be installed over whatever they went to — the same rule the room-change hold
  // enforces for the script clock.
  //
  // Three conditions, because none alone is enough: `screen` misses a room→room change
  // (it stays 'room'); `roomLoadSeq` only counts loads that COMPLETED, so it misses the
  // window where the next room's assets are still in flight; and `roomLoading` alone
  // misses a change that has already finished.
  const seq = roomLoadSeq;
  const stale = (): boolean =>
    cutscene !== null || !font || screen !== 'room' || roomLoading || roomLoadSeq !== seq;
  // The demo is narration over pictures, and every caption's length comes from its
  // voice sample (cutsceneCaption -> audio.duration). Starting it before the room's
  // voice package has landed would run the whole story at the flat DEFAULT_LINE_TICKS
  // fallback — silent, and several times too fast to read.
  await roomVoicesReady;
  if (stale()) return;
  clearHeldKey(); // the briefcase cutscene takes over
  if (!cutsceneAssets) {
    const [bmp, pck, scr] = await Promise.all([
      fetch('/data/Intro/kufr256.BMP').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/demo.pck').then((r) => r.arrayBuffer()),
      fetch('/data/Intro/script.txt').then((r) => r.text()),
    ]);
    cutsceneAssets = { bmp: new Uint8Array(bmp), pck: new Uint8Array(pck), script: scr };
    // 5.3 MB of story assets (demo.pck alone is 4.9 MB), fetched once per session: the
    // first launch is easily long enough to leave the room in. Without this the demo's
    // looping 'kufrik' music started AFTER showMap()'s KillSnd (and the cutscene
    // installed itself over the world map), because nothing in DoneKufrDemo ever stops
    // that track — it only restores music_volume (URoom.pas:2914).
    if (stale()) return;
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
    applySubScale(subCtx, cutsceneSubs);
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
        markGlFailed(); // fall through to the CPU blit for this frame
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

//#region Room load & audio wiring | anchors: loadRoom, fetchSoundPkg, loadSoundPkg, loadRoomVoices, startRoomMusic, talk | Fetch FFR/FFS/FFT for a room, arm its voices, start its music. | Hot
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
    // Point the art layer at this room: clear the previous room's decoded art and arm
    // the two "hold the frame until it lands" flags (see beginRoomArt).
    beginRoomArt(num);
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
 * Fetch one sound package: its .fft index and its .ffs bodies. Null if either is
 * missing — every package is optional, and losing one costs its lines, never the game.
 */
async function fetchSoundPkg(
  fftUrl: string,
  ffsUrl: string,
  deferred = false,
): Promise<{ fft: Uint8Array; ffs: Uint8Array } | null> {
  // A `deferred` package holds chatter, never anything the player is waiting on, so it
  // asks the browser to schedule it behind everything else: x01 alone is 0.74 MB, and
  // it must not compete with the room art or the next room's voices. `priority` is an
  // optional RequestInit field — browsers that lack it ignore it.
  const init = deferred ? ({ priority: 'low' } as RequestInit) : undefined;
  try {
    const [fft, ffs] = await Promise.all([
      fetch(fftUrl, init).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(fftUrl)))),
      fetch(ffsUrl, init).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(ffsUrl)))),
    ]);
    return { fft: new Uint8Array(fft), ffs: new Uint8Array(ffs) };
  } catch {
    return null;
  }
}

/**
 * Fetch a package and keep it for the whole session (x00/x02/x03, x01, restored). The
 * audio engine then holds the only parsed copy: an FFT record carries both the sample
 * and its subtitle, so nothing else needs to index it to render a line.
 */
async function loadSoundPkg(
  id: string,
  fftUrl: string,
  ffsUrl: string,
  deferred = false,
): Promise<boolean> {
  const pkg = await fetchSoundPkg(fftUrl, ffsUrl, deferred);
  if (!pkg) return false;
  audio.loadGlobal(id, pkg.fft, pkg.ffs);
  return true;
}

/**
 * x01: the eight "you are at the edge of the level" remarks (`cil-m/v-hlaska0..3`)
 * that StdKrajniHlaska speaks. `initsounds` (URoom.pas:1018-1021) loads it on top of
 * the room package, and only in a depth-15 room — the last room of a leg — releasing
 * it again with KillMem(3) when the room closes (:1583).
 *
 * So it is fetched on first entry to a leg-final room, and then KEPT rather than
 * reloaded per room. Keeping it is not a deviation: the eight rooms whose scripts call
 * stdKrajniHlaska are EXACTLY the eight depth-15 rooms (pinned by a test), so no other
 * room can ask for a `cil-*` name and the wider scope is unobservable — whereas
 * re-fetching 0.74 MB on every leg-final entry is not.
 *
 * Until this landed the port never fetched x01 at all, so all eight names resolved to
 * nothing and the border remark was silent, subtitles included, in every leg-final room.
 */
let borderLinesLoading = false;
function loadBorderLines(num: number): void {
  if (borderLinesLoading || depthOfRoom(num) !== 15) return;
  borderLinesLoading = true;
  void loadSoundPkg('x01', '/data/Title/x01.fft', '/data/Sound/x01.ffs', true).then((ok) => {
    if (ok) return;
    borderLinesLoading = false; // let the next leg-final room try again
    console.warn('[audio] x01 unavailable — the leg-final border remarks stay silent');
  });
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

/**
 * Is `num` the room the player is being taken to?
 *
 * Guards the two things a room load starts once its assets have landed — its voice
 * package and its music — against being installed over a room the player has since
 * left. `curNum` alone is not enough: they leave for the map (or a story page) and
 * `curNum` still names the room they came from.
 *
 * The screen test is not literally `screen === 'room'` because a launch off the world
 * map holds the map on screen for the whole load (see beginMapLaunch) — the same window
 * in which this resolves. Delphi starts the room's music inside the blocking Spust,
 * with the map still painted, so being on the map here means the entry is in progress,
 * not abandoned.
 */
function enteringRoom(num: number): boolean {
  if (curNum !== num) return false;
  return screen === 'room' || mapLaunching() === num;
}

function loadRoomVoices(num: number, nnn: string, fftBytes: Uint8Array): void {
  if (!enteringRoom(num)) return;
  loadBorderLines(num);
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
    if (buf) audio.setRoom(nnn, fftBytes, new Uint8Array(buf));
    roomVoicesSettled = true;
    markVoicesSettled();
    wake(); // the dialogue queue was held on this; let it run on the next frame
  });
}

/** Room music (MusicCycle, URoom.pas:1568): loop the room's track, or silence it. */
function startRoomMusic(num: number): void {
  if (!enteringRoom(num)) return;
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

/**
 * Is the room in a state to accept a command? `roomLoading` is part of that: while a
 * room change is in flight, `room`/`engine` still point at the room the player LEFT
 * (loadRoom only swaps them after its await), so a command dispatched here would drive
 * a room that is about to be discarded. The original cannot reach that state at all —
 * `Spust` disables the timer before it replaces `Room` (UMain.pas:247-249) — and the
 * simulation is already held for the same window in `loop()`. Gating here as well is
 * what makes the outgoing room unreachable by construction rather than by the accident
 * that no input path happens to emit a sound.
 */
const idle = (): boolean =>
  room !== null &&
  engine !== null &&
  !roomLoading &&
  engine.phase === 'idle' &&
  !room.anyFishDead &&
  !room.won;

/**
 * gstav in [stav_nic, stav_klid] (URoom.pas:24432): the original only dequeues a
 * command — including save and load — while the room is at rest, so neither can
 * land mid-animation. Looser than `idle()`, which also excludes a dead fish and a
 * won room; this is only the animation gate — plus the same room-swap exclusion, so a
 * save cannot bank the OUTGOING room's state under the room number being entered.
 */
const atRest = (): boolean => engine !== null && !roomLoading && engine.phase === 'idle';

/** DalsiPrikaz busy gate (URoom.pas:27002-27016): a fish command is dropped while that
 *  fish is busy (mid-dialogue, turned to face the player). */
function fishBusy(which: 'little' | 'big'): boolean {
  return room !== null && room.busy[which] > 0;
}

/** Turn-first-then-move; horizontal turns animate (stav_otocka), moves slide. */
//#region Movement, replay & restart | anchors: tryStep, beginHeldMove, dispatchHeldMove, wallShove, applyRecordStep, restore, advanceLoadmode, restartRoom | The `KeyRoom` held-key state machine and how a keypress becomes a game step — plus replaying a saved record (`loadmode`) and restarting a room.
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
 * Apply one recorded step of a move-only re-simulation (load / undo). A move is
 * re-run through the physics; a push-out is re-applied from its record marker,
 * because prog() — which marks the item spec=9 — does not run on this path
 * (the 'q' case of the original's replay dispatch, URoom.pas:24184).
 */
function applyRecordStep(st: RecordStep): void {
  if (st.kind === 'pushOut') room?.removePushedOut(st.idx);
  else applyMoveInstant(st.which, st.dir);
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
  const steps = stepsOf(rec);
  if (animated) {
    // LoadSpeed := size div 150, clamped 5..50 (URoom.pas:1927). `size` is the save
    // byte count; the record length is our proxy.
    const speed = Math.max(5, Math.min(50, Math.floor(rec.length / 150)));
    loadmode = { steps, idx: 0, speed, snapshot };
    setInfo();
    return;
  }
  for (const st of steps) {
    if (room.anyFishDead || room.won) break;
    applyRecordStep(st);
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
  while (applied < loadmode.speed && loadmode.idx < loadmode.steps.length) {
    if (room.anyFishDead || room.won) {
      loadmode.idx = loadmode.steps.length;
      break;
    }
    applyRecordStep(loadmode.steps[loadmode.idx++]!);
    applied++;
  }
  if (loadmode.idx >= loadmode.steps.length) {
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

//#region Save/load game | anchors: saveGame, loadGame, saveExists, canSave, onWinBookkeeping | In-room save slots and what happens on a win.
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
//#region Control panel | anchors: panelState, optionsState, tickPanelScroll, togglePanelOptions, openHelp, drawPanel | The side panel: its buttons, the options scroll animation, the help overlay.
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
  // Hide the COLUMN, not just the canvas inside it. `display: none` takes an element
  // out of the flex row entirely, and with it the row's gap; hiding only the canvas
  // would leave a zero-width column still claiming that gap, so the map sat half a gap
  // off-centre and then jumped right the moment Options floated the column out of the
  // flow. (That is exactly what happened when the column was introduced — the canvas
  // used to be the flex item itself, and hiding it removed the gap for free.)
  panelCol.style.display = visible ? '' : 'none';
  // The feedback strip belongs to the Options face and hangs under it (index.html).
  // It is shown only while those options are actually on screen, so nothing modern is
  // in view while the game is being played — and it is absolutely positioned, so it
  // never changes the panel column's size and cannot move the game when it appears.
  // Written through a guard like every other DOM touch in this function: drawPanel runs
  // per frame, and an unconditional assignment here would be the one line in it that
  // does style work on an idle room.
  const wantBar = !(visible && ostav === O_OPTIONS);
  if (feedbar && feedbar.hidden !== wantBar) feedbar.hidden = wantBar;
  // Float the panel over the map when opened from the Options corner; otherwise
  // it sits statically beside the play area (its normal in-room position). The COLUMN
  // is what floats, not the canvas, so the strip travels with the panel it belongs to.
  if (asMapOverlay) {
    panelCol.style.position = 'fixed';
    panelCol.style.left = '50%';
    panelCol.style.top = '50%';
    panelCol.style.transform = 'translate(-50%, -50%)';
    panelCol.style.zIndex = '50';
  } else if (panelCol.style.position === 'fixed') {
    panelCol.style.position = '';
    panelCol.style.left = '';
    panelCol.style.top = '';
    panelCol.style.transform = '';
    panelCol.style.zIndex = '';
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
//#region World map drawing | anchors: ensureDeskyData, openMapInfo, drawMap, aiPlaqueFor, drawMapOverlays | The branch map, its name plaques, and the record info panel (krokoměr).
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
  // The reveal is wall-clock driven, so the `ai` tier's art hold would have traced it
  // out behind the loading overlay and handed the player a map that never animated.
  // Start it on the frame that actually reaches them — which is this one, since the
  // hold withholds this call entirely. Gated on arrival: switching tier over a map that
  // is already up must not re-trace a reveal the player has watched once already.
  if (!mapPresented) mapRevealStart = performance.now();
  // The reveal (Depth, UMain.pas): from -3, +1 per ~60ms, tracing the map in from
  // the start; once it passes the deepest room the whole enabled map is shown.
  const depth = Math.floor((performance.now() - mapRevealStart) / 60) - 3;
  const cs = contentScaleFor(MAP_W, MAP_H);
  // The `ai` graphics level draws the map from AI-upscaled art re-composited at 4x,
  // so the backing store is 4x larger (still CSS-scaled to the same display box).
  // Reaching here at all means the art for this tier is ready: loop() withholds the
  // draw while mapArtHolding(), so the map is only ever presented in its final art.
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
    `|${mapInfoRoom ?? ''}|${mapInfoHover ?? ''}|${infoFazeKey}|${mapHoverRoom ?? ''}|${mapLaunching() ?? ''}`;
  // The minigame is modal over the map too (UMain.pas:1764), and animates, so its
  // frame counter joins the cache key.
  const sigT = tetris ? `|ttr${tetrisTick}` : '';
  if (sig + sigT === mapSig) return; // nothing visibly changed — skip the redraw entirely
  mapSig = sig + sigT;
  perfPaint++; // an actual map paint (past the cache check)
  setMapPresented(true); // a map frame is now the thing on screen (see syncLoadingUi)
  // A room launch (daRun/daReplay) darkens the map exactly as an open record panel
  // does — Delphi zeroes RTable for all three cases in the same statement
  // (UMain.pas:1445) and skips the room balls with it — and draws the launching room's
  // name plaque over that (KresliDesku, :1484).
  const launching = mapLaunching() !== null;
  const panelOpen = mapInfoRoom !== null;
  const unlit = panelOpen || launching;
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
      drawNodes: !unlit,
      litRegions: !unlit,
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
    const plaqueRoom = mapLaunching() ?? mapInfoRoom ?? mapHoverRoom;
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
    // Last, over the plaque: Delphi draws the plaque and then the parchment
    // (UMain.pas:1484 then :1489), and the two rectangles overlap.
    if (launching) {
      blitParchmentAi(ctx);
      markParchmentPainted(); // daRun -> daRealyRun: the load may now start
    }
    return;
  }
  const rgba = worldMap.render(solved, pulse, depth, cheated, mapHoverCorner, !unlit, !unlit);
  drawMapOverlays(rgba);
  if (launching) {
    blitParchment(rgba);
    markParchmentPainted(); // daRun -> daRealyRun: the load may now start
  }
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
  const plaqueRoom = mapLaunching() ?? mapInfoRoom ?? mapHoverRoom;
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
//#region Map navigation & story screens | anchors: showMap, returnFromRoom, showLegImage, playFirstRunIntro, openCredits, drawCredits | Entering/leaving the map, leg-completion pages, intro replay, the credits roll.
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

/**
 * Enter a room (Spust, UMain.pas:248).
 *
 * TWO routes, because the original has two. From the WORLD MAP a launch is `daRun`:
 * the map stays on screen and repaints with the parchment over it, and the load runs
 * behind that (see beginMapLaunch — this is the faithful one, and the one a player
 * ever sees). Everywhere else — the dev room picker, the story-page chain, SCORE,
 * ZAVER, an Escape restart — there is no map to keep, so the stage goes to the room
 * immediately and the delayed loading overlay explains the wait, exactly as before.
 *
 * `replay` is the best-solution move record to play back animated (map "Replay").
 */
//#region Room entry & fish animation | anchors: enterRoom, beginMapLaunch, panelAction, updateLipSync, fishFrameFor | The map → room transition (incl. the launch parchment), panel button actions, and which sprite frame each fish shows.
/** Keep the dev room picker in step with the room actually shown. */
function setRoomPicker(num: number): void {
  select.value = String(num);
}

function enterRoom(num: number, replay?: string): Promise<void> {
  if (canLaunchFromMap()) return beginMapLaunch(num, replay);
  return startRoom(num, replay, true);
}

/**
 * The load itself: KillSnd, then the room's assets (Spust, UMain.pas:248-249).
 *
 * `takeStage` is what separates the two routes above — false leaves `screen` on the
 * map for the launch flow, which flips it in loop() once the room can actually be
 * painted.
 */
function startRoom(num: number, replay: string | undefined, takeStage: boolean): Promise<void> {
  wake();
  stopRoomClock(); // bank the outgoing room's time before the switch
  if (takeStage) {
    screen = 'room';
    beginRoomLoadingUi(num); // delayed; a cached entry lands before it ever shows
  }
  startRoomClock(num); // TRoom.Start: casstartu := Date+Time
  mapHoverCorner = null; // drop any map corner hover on leaving the map
  mapHoverRoom = null;
  canvas.style.cursor = 'default';
  audio.killAll(); // stop the menu music + anything before the room starts its own
  select.value = String(num);
  const p = loadRoom(num);
  if (replay) {
    // movesOf, not stepsOf: this replay drives the REAL game loop (tryStep), so the
    // room's prog() marks the item and the exit-slide removes it exactly as in play —
    // re-applying the record's push-out markers here would remove it twice.
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

// The rendering plumbing — per-tier art sources, the WebGL compositors, the parity
// probes — lives in glPlumbing.ts. Wired HERE, where that code used to sit; it reads
// the game through these getters and writes nothing back.
//#region Render plumbing wiring | anchors: initGlPlumbing | Hands `glPlumbing.ts` its view of the game. The compositors are in that module.
initGlPlumbing({
  get aiRoom() {
    return aiRoom;
  },
  get count() {
    return count;
  },
  get enhancedArt() {
    return enhancedArt;
  },
  get enhancedObjects() {
    return enhancedObjects;
  },
  get fishSprites() {
    return fishSprites;
  },
  get room() {
    return room;
  },
  get setInfo() {
    return setInfo;
  },
  get subs() {
    return subs;
  },
});
//#region The frame painter | anchors: draw, updateRoomSubOverlay | One room frame, all three tiers, CPU and GPU. Everything on screen during play is painted from here.
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
      applySubScale(subCtx, subs);
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

//#region The logic tick | anchors: step, tickBlink, hracNespi | One 80 ms game step: script, engine, dialogue, death handling, screensaver.
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
    // The hold does not freeze the room: the original decrements countdown and then
    // still runs the gstav machine (`if countdown>0 then dec(countdown)` at
    // URoom.pas:24349, followed by its `repeat`), so anything still in motion when the
    // room was won finishes on screen. A gspec=9 push-out is the case that needs it —
    // it wins the room AND enters stav_ma_padat on the same tick (URoom.pas:24904), so
    // whatever the departed item held up would otherwise hang in the air until the map
    // came back. `advance()` is inert while idle: its swim/possession branches are all
    // gated on `!room.won`.
    engine.advance();
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

//#region Frame pacing & perf | anchors: roomLoading, roomLoadSeq, IDLE_LOOP_MS, updatePerfHud, roomAnimating, loopThrottleOk, wake | The idle throttle (60 fps ↔ 12.5 fps), the water/ZX wake rates, and the perf HUD. | Hot
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
 *     30/s                         1.05 %   <- was ~2x main, and made the GPU path more
 *                                              expensive than canvas-2D, which it had
 *                                              never been
 *     20/s   (this)                0.74 %
 *     15/s                         0.56 %
 *     12.5/s (no water animation)  0.48 %   <- the floor; `main` measures 0.51 %
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
 * a vector subtitle waving in is the common one — an uncapped `waterAnim` would repaint
 * the ×S composite on every one of those 60 frames, three times what the water asks for
 * (`waterAnimMs`, 20fps) and exactly the cost the render-on-dirty comment below exists to
 * avoid. Measured on tools/test-aisubs.mjs, which guards it: the ai tier's subtitle rate
 * against enhanced was 0.91 before any of this, 0.77-0.81 with an uncapped water repaint,
 * and 0.60 once ripples made each composite dearer — through a gate set at 0.70. Capped
 * here it is back at parity, and the water is unaffected because it only ever asked for
 * `waterAnimMs`.
 */
function waterOwesRepaint(now: number): boolean {
  return aiWaterAnimating() && now - lastWaterPaint >= waterAnimMs - PAINT_EPSILON_MS;
}

function aiWaterAnimating(): boolean {
  return (
    screen === 'room' &&
    room !== null &&
    // Not just `wamp !== 0`: a gspec=2 darkness room paints a flat fill and never
    // evaluates the wave, and CHODBA reaches that state with wamp = 5 the moment the
    // player switches the light off. Asking the compositor's own predicate keeps the
    // loop from waking 20x/s for a frame that cannot change.
    aiWaterVisible(room) &&
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
    // A launch is a short-lived state that ends on a condition nothing repaints for
    // (the room's assets landing), so keep the loop at full rate until it does —
    // otherwise the handover waits up to a whole idle tick behind the parchment.
    if (mapLaunching() !== null) return false;
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
//#region `loop()` | anchors: loop | The rAF callback: which screen paints, how many logic steps run, when to sleep.
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
  // While a hold is active, pause the simulation too, so the room's
  // scripts/gravity/subtitle timers/audio don't advance under a frame the player was
  // never shown — keeping logic in sync with the first visible frame (as classic mode
  // inherently is). acc keeps accumulating but the backlog guard above drops it, so
  // there's no fast-forward catch-up when the hold releases. Two holds share this
  // predicate because they want the identical thing of the clock, though they present
  // differently (the art hold keeps the PREVIOUS frame; roomLoading paints black):
  //
  // roomArtPending() — the anti-flash hold, while draw() holds the previous frame until
  // this room's art lands. Expressed as roomArtPending() rather than
  // `graphics === 'enhanced'` because every tier that draws truecolor art needs the
  // identical hold, and the ai tier additionally waits for its upscale.
  // `roomLoading` is the same rule one step earlier, and it is a correctness one, not
  // just an anti-flash one. enterRoom() flips `screen` to 'room' and runs its KillSnd
  // synchronously, but loadRoom() then AWAITS the new room's core assets — and until
  // buildRoom() swaps them, `room`/`activeScript`/`engine` are still the room the
  // player just left. Ticking those is a window the original cannot have: Spust
  // disables the game timer BEFORE it kills the sound and builds the new room
  // (`Timer1.Enabled:=false; KillSnd; Room:=TRoom.Create(...)`, UMain.pas:247-249),
  // so no Programky runs across the swap. Here the outgoing room's Programky ran on
  // after the KillSnd that was supposed to silence it, and every script that re-arms a
  // loop on `!playing(p)` did exactly that — SMETAK's alarm clock (smetak.ts:204),
  // MOTOR's engine (motor.ts:84), BARELY, BATYSKAF — leaving a looping effect sounding
  // under the NEXT room, because that KillSnd is the only thing a room change ever does
  // about it (buildRoom only re-kills on a restart).
  const simPaused = screen !== 'map' && !cutscene && (roomLoading || roomArtPending());
  // The minigame is modal in the original, so the room's timer does not run while
  // it is open (Tetris.ShowModal, URoom.pas:24565). It keeps its own 55ms clock.
  tickTetris(dt);
  const frozen = tetrisModal();
  while (!simPaused && !frozen && acc >= LOGIC_MS && steps < MAX_STEPS_PER_FRAME) {
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
  // Drive an armed room launch (daRealyRun) BEFORE anything downstream of `screen` reads
  // it — the GL hide, the mapPresented derivation and the draw dispatch below — so the
  // frame that hands the stage over is the frame that PAINTS the room.
  //
  // Running it after the draw instead (where it started) handed over a frame early for
  // everything but the canvas: drawPanel() put the control panel back into the layout at
  // the end of that frame while #screen still held the map, so the map visibly jumped
  // 90px left with no room under it. Measured 1 frame / 12 ms in enhanced and 2 / 25 ms
  // in ai, and the panel is a layout change, so a single frame of it reads as a flinch.
  //
  // The original's ordering is unaffected: the load still cannot start until a frame
  // carrying the parchment has actually been painted, because drawMap() is what sets
  // `painted` (UMain.pas:1489-1493 — the paint sets daRealyRun, Spust runs after it).
  tickMapLaunch();
  if (helpOpen || screen !== 'room' || roomLoading) glCanvas.style.display = 'none';
  // Exactly one branch below owns #screen for this frame, and every branch other than
  // the map's blits over whatever the map left there — help, the story page, the
  // credits roll, a cutscene, a room. So "is a map frame the thing on screen" is
  // derived here, in one place, rather than cleared at each of those sites; drawMap()
  // sets it back when it paints. During the map's own art hold this leaves it alone,
  // which is the point: it still says whether there is a map under the wait.
  if (helpOpen || screen !== 'map' || mapOverlay === 'credits') setMapPresented(false);
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
    // Lazy, and here rather than inside drawMap(): every route onto the map runs
    // through this branch — boot, the intro ending, leaving a room, a tier switch — so
    // the load starts exactly once without a begin() call bolted onto each of them.
    beginMapArt();
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
    } else if (!mapArtHolding()) drawMap(); // counts its own paint (it skips when cached)
    // ...and when it IS holding, nothing is painted: the map is presented once, in the
    // tier's final art, with syncLoadingUi() below covering the wait. The 2.36 MB of
    // AI map art against 0.59 MB of faithful BMPs measured 28.0s of enhanced map on
    // screen before it swapped (Slow 4G, cold cache) — the same defect rooms had.
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
  // After every draw branch: the overlay is a view of "is this screen still loading",
  // and hiding it here means the frame underneath has already been painted this tick.
  syncLoadingUi(now);
  updatePerfHud(now);
  scheduleNext();
}

//#region Keyboard | anchors: keydown / keyup listeners | Every key binding, including cheats, dev keys and modal handling.
window.addEventListener('keydown', (e) => {
  wake(); // return to 60fps immediately if the idle-loop throttle had us sleeping
  // The feedback form owns the keyboard while it is up. It is a modal <dialog>, so the
  // browser already keeps pointer and focus out of the game — but a keydown inside it
  // still bubbles to window. The fish keys are letters (WASD/IJKL, Uovl.pas:744) and
  // `X` arms the cheat buffer, so typing "the fish sank while I was pushing a crate"
  // swims the fish around behind the form — corrupting the very move record the report
  // is about. Escape is left alone: the dialog's own handler closes it.
  if (feedback?.isOpen()) return;
  // A room launch off the map is BLOCKING in the original (Spust runs inside the timer
  // handler, so no message is dispatched until the room is up). Swallow the keyboard
  // for as long as the parchment is on the map — the map's own pointer handlers do the
  // same. Anything else would let Escape, a cheat code or a tier switch act on a map
  // that is already on its way out.
  if (mapLaunching() !== null) {
    e.preventDefault();
    return;
  }
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

//#region Pointer | anchors: cellFromEvent, clickCell, dirToward, clickMapAt, panelCoords | Fish selection and click-to-swim target (the pathfinding is in `stepEngine.ts`), map and panel hit-testing.
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
    // A launch is BLOCKING in the original — Spust runs inside the timer handler, so
    // no message is processed until the room is up. Nothing on the map is clickable
    // while the parchment is on it.
    if (mapLaunching() !== null) return;
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
  if (screen !== 'map' || !worldMap || mapOverlay !== 'none' || mapLaunching() !== null) {
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

//#region Dev bar & window wiring | anchors: populateRooms, fitSelect, rendererSelect, graphicsSelect, idleDirtyToggle, winRoomBtn, resize / fullscreenchange / dpr watchers | The dev-only controls — room picker, fit mode, renderer, graphics tier, idle-render toggle, win-room — and the relayout triggers.
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
  // A local const, because TypeScript will not carry the null-narrowing of an
  // IMPORTED binding into a closure (an exporting module may reassign it; these
  // never do). Same one-line dance at the four dev-bar controls below.
  const el = fitSelect;
  el.value = settings.fitMode;
  el.addEventListener('change', () => {
    const v = el.value;
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
  const el = rendererSelect;
  el.value = renderer;
  el.addEventListener('change', () => setRenderer(el.value === 'cpu' ? 'cpu' : 'webgl'));
}
// Dev-bar graphics-level combobox. Mirrors the E hotkey (setGraphics keeps the
// select value in sync when E cycles), and is the primary point-and-click switch.
if (graphicsSelect) {
  const el = graphicsSelect;
  el.value = graphics;
  el.addEventListener('change', () => {
    const v = el.value;
    setGraphics(v === 'classic' || v === 'ai' ? v : 'enhanced');
  });
}
if (idleDirtyToggle) {
  const el = idleDirtyToggle;
  el.checked = renderOnDirty;
  el.addEventListener('change', () => setRenderOnDirty(el.checked));
}
if (winRoomBtn) {
  const el = winRoomBtn;
  el.addEventListener('click', () => {
    devWinRoom();
    el.blur(); // drop button focus so a Space/Enter dismiss doesn't re-click it
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

//#region Boot | anchors: await FontData.load, parseFfp, loadSoundPkg, loadRoom(7), initFeedback, requestAnimationFrame(loop) | The top-level-await boot sequence, in load order. What is critical vs. optional is documented inline.
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
  // The AI-upscaled map (Phase B) is NOT loaded here: it is fetched lazily the first
  // time the map is about to be shown in the `ai` tier (beginMapArt), so other tiers
  // pay nothing for it.
} catch {
  /* map optional */
}
await loadParchment(); // the room-entry parchment; optional, never fatal (roomLaunch.ts)
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
// The persistent global packages, in the order the original loads them: x00 effects,
// x03 ambient chatter (the "ob-*" idle lines, StdKecej / vyber_hlasku) and x02 death
// commentary (the "smrt-*" lines, StdSmrt). Each is optional — a missing one costs
// its lines, never the game. Kept sequential, as before: they are large, and the boot
// path is what the UI probes' 5 s budget is measured against.
for (const id of ['x00', 'x03', 'x02']) {
  await loadSoundPkg(id, `/data/Title/${id}.fft`, `/data/Sound/${id}.ffs`);
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
// The two lines the 1998 release referenced but shipped without (public/restored/,
// built by tools/build-restored-sounds.ts) — `pyr-m-nudi` and `jes-v-potvora2`. A
// package of its own rather than a patched 025/063, so the committed 1998 data stays
// byte-for-byte what ALTAR released.
//
// Fetched AFTER boot and off the critical path: each awaited package above is another
// serialized round trip before the game can start, and loading this one inline was
// measured pushing UI probes past their 5 s boot budget. The cost of that choice is
// real but small — if a player reaches room 25 or 63 before it lands, that one line
// keeps the 1998 silence, so the failure mode is the status quo ante, not a break.
void loadSoundPkg('restored', '/restored/restored.fft', '/restored/restored.ffs', true).then(
  (ok) => {
    if (!ok) console.warn('[audio] restored package unavailable — PYRAMIDA/JESKYNE keep the 1998 silence');
  },
);

// Boot: on first run, auto-play the intro (logo → intro) before the map, then
// flip the persisted flag so later runs go straight to the map (the original's
// START→NO first-run gate, UMain.pas:677-682). The intro is always replayable
// from the map's top-left corner.
if (settings.introSeen) {
  screen = 'map'; // the game opens on the world map
  mapRevealStart = performance.now(); // animate the map in from the start
  // Start the `ai` tier's map art HERE rather than leaving it to the loop's first
  // frame, so the hide below already sees the wait: on this path the map's loading
  // state is boot's loading state, and the overlay simply never comes down between
  // them. Left to the loop it would hide for a frame and re-show.
  beginMapArt();
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
// The feedback form. Reads the live game state only when the player opens it — there is
// no collection before that, and nothing is ever sent without a click (see feedback.ts).
feedback = initFeedback({
  build: { version: __APP_VERSION__, hash: __BUILD_HASH__, date: __BUILD_DATE__ },
  webgl2: () => webgl2Available(),
  game: () => {
    const inRoom = screen === 'room' && curNum > 0;
    const desc = inRoom ? roomByNumber(curNum) : undefined;
    return {
      screen,
      roomNum: inRoom ? curNum : null,
      roomName: desc?.jmeno ?? null,
      roomTitle: desc?.en ?? null,
      graphics,
      renderer,
      subtitles: settings.subtitles,
      moves: lengthOfRecord(engine?.srecord ?? ''),
      record: engine?.srecord ?? '',
    };
  },
});
// ...unless the map is still waiting for the art it will be presented in, in which case
// boot is not over from the player's side and the overlay stays up (see syncLoadingUi).
if (loadingEl && !mapArtHolding()) loadingEl.hidden = true;
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
// The debug/test interface (window.__ff). Its 215 entries live in debugHooks.ts;
// what they need of the running game is handed over here, as getters, with setters
// for the eleven values probes deliberately write. Assigned to window HERE, at the
// end of boot, because tools/ui-lib.mjs waits on window.__ff as the signal that boot
// has completed.
//#region `window.__ff` host | anchors: debugHooks | The 144-member host the debug hooks read the game through: getters, plus eleven setters for the values probes deliberately write. The hooks themselves are in `debugHooks.ts`.
(window as unknown as { __ff: unknown }).__ff = debugHooks({
  get O_OPTIONS() {
    return O_OPTIONS;
  },
  get SUB_FONT_CANDIDATES() {
    return SUB_FONT_CANDIDATES;
  },
  get activeScript() {
    return activeScript;
  },
  get aiKufr() {
    return aiKufr;
  },
  get aiKufrFrames() {
    return aiKufrFrames;
  },
  get aiPending() {
    return aiPending;
  },
  get aiRoom() {
    return aiRoom;
  },
  get aiRoomNum() {
    return aiRoomNum;
  },
  get aiRoomRenderActive() {
    return aiRoomRenderActive;
  },
  get aiSubScale() {
    return aiSubScale;
  },
  set aiSubScale(v: number) {
    aiSubScale = v;
  },
  get aiWaterAnimating() {
    return aiWaterAnimating;
  },
  get aiWorldMap() {
    return aiWorldMap;
  },
  get alpha() {
    return alpha;
  },
  get applySubFont() {
    return applySubFont;
  },
  get audio() {
    return audio;
  },
  get bestRecord() {
    return bestRecord;
  },
  get bestRecords() {
    return bestRecords;
  },
  get canSave() {
    return canSave;
  },
  get casHry() {
    return casHry;
  },
  get chatter() {
    return chatter;
  },
  get cheated() {
    return cheated;
  },
  get classicArtFor() {
    return classicArtFor;
  },
  get clickCell() {
    return clickCell;
  },
  get clickMapAt() {
    return clickMapAt;
  },
  get closeHelp() {
    return closeHelp;
  },
  get closeMapInfo() {
    return closeMapInfo;
  },
  get closeMapOverlay() {
    return closeMapOverlay;
  },
  get count() {
    return count;
  },
  get creditMode() {
    return creditMode;
  },
  get credits() {
    return credits;
  },
  get creditsStart() {
    return creditsStart;
  },
  set creditsStart(v: number) {
    creditsStart = v;
  },
  get curNum() {
    return curNum;
  },
  get cutscene() {
    return cutscene;
  },
  get deskyLang() {
    return deskyLang;
  },
  get dispatchMapCorner() {
    return dispatchMapCorner;
  },
  get enableWebgl() {
    return enableWebgl;
  },
  get engine() {
    return engine;
  },
  get enhancedArt() {
    return enhancedArt;
  },
  get enhancedArtActive() {
    return enhancedArtActive;
  },
  get enhancedArtFor() {
    return enhancedArtFor;
  },
  get enhancedPending() {
    return enhancedPending;
  },
  get enterRoom() {
    return enterRoom;
  },
  get feedback() {
    return feedback;
  },
  get ffr() {
    return ffr;
  },
  get fishFrameFor() {
    return fishFrameFor;
  },
  get fishSprites() {
    return fishSprites;
  },
  get forceBest() {
    return forceBest;
  },
  get forceRoomRedraw() {
    return forceRoomRedraw;
  },
  set forceRoomRedraw(v: boolean) {
    forceRoomRedraw = v;
  },
  get glAiCompositor() {
    return glAiCompositor;
  },
  get glChannelDiff() {
    return glChannelDiff;
  },
  get glCompositor() {
    return glCompositor;
  },
  get glFailed() {
    return glFailed;
  },
  get glParityCompare() {
    return glParityCompare;
  },
  get graphics() {
    return graphics;
  },
  get heldState() {
    return heldState;
  },
  get helpOpen() {
    return helpOpen;
  },
  get helpScreens() {
    return helpScreens;
  },
  get hooks() {
    return hooks;
  },
  get idle() {
    return idle;
  },
  get idleTimer() {
    return idleTimer;
  },
  get inReplay() {
    return inReplay;
  },
  get intro() {
    return intro;
  },
  get introMovie() {
    return introMovie;
  },
  get lastLine() {
    return lastLine;
  },
  get lastRoomBackend() {
    return lastRoomBackend;
  },
  get lastRoomSig() {
    return lastRoomSig;
  },
  get legImage() {
    return legImage;
  },
  get legImageAi() {
    return legImageAi;
  },
  get legImageNum() {
    return legImageNum;
  },
  get linesSpoken() {
    return linesSpoken;
  },
  get loadGame() {
    return loadGame;
  },
  get loadmode() {
    return loadmode;
  },
  get logoMovie() {
    return logoMovie;
  },
  get loopThrottleOk() {
    return loopThrottleOk;
  },
  get loopTicks() {
    return loopTicks;
  },
  get mapArtPending() {
    return mapArtPending;
  },
  get mapHoverCorner() {
    return mapHoverCorner;
  },
  set mapHoverCorner(v: MapAction | null) {
    mapHoverCorner = v;
  },
  get mapInfoFaze() {
    return mapInfoFaze;
  },
  get mapInfoHover() {
    return mapInfoHover;
  },
  get mapInfoRoom() {
    return mapInfoRoom;
  },
  get mapOverlay() {
    return mapOverlay;
  },
  // Derived, not a bare backing variable: the launch lives in one nullable object
  // (see MapLaunch) and probes only ever want the room number out of it.
  get mapLaunching() {
    return mapLaunching();
  },
  get parchmentReady() {
    return parchmentReady();
  },
  get mapPresented() {
    return mapPresented;
  },
  get openCredits() {
    return openCredits;
  },
  get openHelp() {
    return openHelp;
  },
  get openMapInfo() {
    return openMapInfo;
  },
  get openMapOptions() {
    return openMapOptions;
  },
  get ostav() {
    return ostav;
  },
  get panel() {
    return panel;
  },
  get panelAction() {
    return panelAction;
  },
  get panelState() {
    return panelState;
  },
  get playTime() {
    return playTime;
  },
  get poslMluv() {
    return poslMluv;
  },
  get previewSubFont() {
    return previewSubFont;
  },
  get renderer() {
    return renderer;
  },
  set renderer(v: "cpu" | "webgl") {
    renderer = v;
  },
  get replayIntro() {
    return replayIntro;
  },
  get replaymode() {
    return replaymode;
  },
  get restartRoom() {
    return restartRoom;
  },
  get room() {
    return room;
  },
  get roomArtPending() {
    return roomArtPending;
  },
  get roomDepth() {
    return roomDepth;
  },
  get roomGeometry() {
    return roomGeometry;
  },
  get roomLoadSeq() {
    return roomLoadSeq;
  },
  get roomLoading() {
    return roomLoading;
  },
  get roomPaints() {
    return roomPaints;
  },
  get saveExists() {
    return saveExists;
  },
  get saveGame() {
    return saveGame;
  },
  get saveSolved() {
    return saveSolved;
  },
  get scores() {
    return scores;
  },
  get screen() {
    return screen;
  },
  get screenShoveX() {
    return screenShoveX;
  },
  get scroll() {
    return scroll;
  },
  get setGraphics() {
    return setGraphics;
  },
  get setRenderOnDirty() {
    return setRenderOnDirty;
  },
  get setSubtitleMode() {
    return setSubtitleMode;
  },
  get settings() {
    return settings;
  },
  get showLegImage() {
    return showLegImage;
  },
  get showMap() {
    return showMap;
  },
  get showmode() {
    return showmode;
  },
  get showmodeHelptext() {
    return showmodeHelptext;
  },
  get showmodeLoading() {
    return showmodeLoading;
  },
  get showmodeTrace() {
    return showmodeTrace;
  },
  get showmodeTraceOn() {
    return showmodeTraceOn;
  },
  set showmodeTraceOn(v: boolean) {
    showmodeTraceOn = v;
  },
  get skipCutscene() {
    return skipCutscene;
  },
  get smoothLog() {
    return smoothLog;
  },
  set smoothLog(v: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string; }[] | null) {
    smoothLog = v;
  },
  get solved() {
    return solved;
  },
  get startCutscene() {
    return startCutscene;
  },
  get startShowmode() {
    return startShowmode;
  },
  get subFontFamily() {
    return subFontFamily;
  },
  get subFontIdx() {
    return subFontIdx;
  },
  get subFontReady() {
    return subFontReady;
  },
  get subFontWeight() {
    return subFontWeight;
  },
  get subLang() {
    return subLang;
  },
  get subOverlayGate() {
    return subOverlayGate;
  },
  set subOverlayGate(v: boolean) {
    subOverlayGate = v;
  },
  get subOverlayPainted() {
    return subOverlayPainted;
  },
  set subOverlayPainted(v: boolean) {
    subOverlayPainted = v;
  },
  get subOverlayPaints() {
    return subOverlayPaints;
  },
  get subOverlaySig() {
    return subOverlaySig;
  },
  set subOverlaySig(v: string) {
    subOverlaySig = v;
  },
  get subs() {
    return subs;
  },
  get syncSubOverlay() {
    return syncSubOverlay;
  },
  get talk() {
    return talk;
  },
  get togglePanelOptions() {
    return togglePanelOptions;
  },
  get tryStep() {
    return tryStep;
  },
  get wake() {
    return wake;
  },
  get waterAnimMs() {
    return waterAnimMs;
  },
  set waterAnimMs(v: number) {
    waterAnimMs = v;
  },
  get worldMap() {
    return worldMap;
  },
});
