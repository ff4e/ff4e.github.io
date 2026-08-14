/**
 * `window.__ff` — the app's debug/test interface.
 *
 * 216 entries, and every one of the 86 UI probes in tools/ reads this object. It is
 * effectively the public API of the game for testing, which is why CONTRIBUTING.md
 * freezes its shape while main.ts is being split: it is the only external oracle a
 * refactor of that file has, and an oracle that moves with the code proves nothing.
 *
 * It was a sixth of main.ts (15 200 tokens) and the single most-edited region of it —
 * 18 of the last 25 commits touched it, because every feature adds a probe hook. None
 * of that weight is anything a change to the GAME needs to read. Moving it out is the
 * largest single cut available, and this is it.
 *
 * ── Why one module and not several ────────────────────────────────────────────
 * The plan costed splitting these hooks into per-area files (room, render, screens,
 * perf...). Grouped that way the small groups do not pay: 53 of the screen hooks are
 * one-liners whose share of the context costs about what the hooks weigh. Kept
 * together they share ONE context instead of several overlapping ones, which is why
 * this saves ~13 700 tokens where the grouped version saved ~8 100.
 *
 * ── The seam ──────────────────────────────────────────────────────────────────
 * Every name this file needs that ONLY main.ts has arrives in `host`: 114 members, down
 * from 144. Members are getters, so they read live state at the moment a probe asks, and
 * the eight that probes deliberately WRITE (the renderer, the perf switches, the overlay
 * signature) are settable. The interface was generated from the TypeScript checker
 * rather than hand-written, so it states main.ts's real types instead of a guess at them.
 *
 * The forty that left did not need a seam at all. They were game state, and it now has
 * owning modules — `gameState.ts` for the live room, `screenState.ts` for the screens —
 * so this file imports `room` and reads `ui.screen` the way any other module would. A
 * getter per name per consumer is the tax for state that only main.ts can see, and these
 * stopped paying it. That also removes a class of bug rather than guarding against it:
 * with no accessor between the probe and the value, there is nothing left to wire to the
 * wrong one.
 *
 * main.ts still performs the assignment to `window.__ff` itself, at the end of boot.
 * That matters: tools/ui-lib.mjs waits on `window.__ff` as the signal that boot has
 * COMPLETED, so publishing it from here — at import time — would have made every
 * probe race the boot it is supposed to wait for.
 */
import { AudioEngine } from '../audio/audio.js';
import type { ChatterState } from '../core/chatter.js';
import { Dir } from '../core/dir.js';
import { HookSystem } from '../core/hooks.js';
import { lengthOfRecord } from '../core/record.js';
import type { RecordStep } from '../core/record.js';
import { Room } from '../core/room.js';
import { Script } from '../core/script.js';
import type { RoomScript, ScriptSnapshot } from '../core/script.js';
import { saveSettings } from '../core/settings.js';
import type { GraphicsLevel, Settings, SubtitleMode } from '../core/settings.js';
import { MOVE_FRAMES, StepEngine, exitFramesFor } from '../core/stepEngine.js';
import type { TetrisKey } from '../core/tetris.js';
import type { FfpPanel } from '../data/ffp.js';
import type { FfrRoom } from '../data/ffr.js';
import type { CapAction } from '../intro/helpCap.js';
import { KufrDemo } from '../intro/kufrDemo.js';
import type { AiKufr } from '../intro/kufrDemo.js';
import {
  Canvas2dAiTarget,
  RIPPLE,
  activeRipples,
  faithfulWobbleShifts,
  nextRippleBirth,
  smoothWobbleShift,
  wobblePhase,
} from '../render/aiTarget.js';
import type { AiWobble } from '../render/aiTarget.js';
import type { ArtSource } from '../render/artSource.js';
import { ClassicArtSource } from '../render/classicArtSource.js';
import { CREDIT_SPEED, CREDIT_TICK_MS, Credits } from '../render/credits.js';
import {
  activeScript,
  alpha,
  chatter,
  count,
  cutscene,
  engine,
  ffr,
  lastLine,
  linesSpoken,
  loadmode,
  poslMluv,
  replaymode,
  room,
  roomDepth,
  screenShoveX,
  setShowmodeTraceOn,
  showmode,
  showmodeHelptext,
  showmodeLoading,
  showmodeTrace,
  showmodeTraceOn,
  subs,
} from './gameState.js';
import { renderer, setRendererValue } from './renderSettings.js';
import { ui } from './screenState.js';
import { artFailureShown } from './artFailure.js';
import { EnhancedArtSource, classicOnlyBackground } from '../render/enhancedArtSource.js';
import type { EnhancedArt, FishSprites } from '../render/enhancedArtSource.js';
import { sum } from '../render/filmEffects.js';
import { IndexedScreen } from '../render/framebuffer.js';
import { GlAiScreen } from '../render/glRoomAi.js';
import { GlScreen } from '../render/glScreen.js';
import { HelpScreens } from '../render/help.js';
import { hitTest as panelHitTest } from '../render/hud.js';
import type { PanelState } from '../render/hud.js';
import type { InfoButton } from '../render/mapInfo.js';
import {
  FSIZE,
  HL_MRK,
  HL_TLACI,
  TL_NAHORU,
  TL_PLAV,
  TL_ZAKLAD,
  renderRoomBackgroundRgba,
  renderRoomInto,
  renderRoomRgba,
} from '../render/renderRoom.js';
import type { FishFrame } from '../render/renderRoom.js';
import { AiRoom } from '../render/roomAi.js';
import type { AiRoomFrame } from '../render/roomAi.js';
import { SUB_SUBSTEPS, SubtitleSystem } from '../render/subtitles.js';
import { domSubsEnabled, selectSubRenderer } from './subtitleDom.js';
import type { SubRenderer } from './subtitleDom.js';
import { renderTetris, tetrisRgba } from '../render/tetrisRender.js';
import { MapAction, WorldMap } from '../render/worldMap.js';
import { AiWorldMap } from '../render/worldMapAi.js';
import {
  applyFrameEffects,
  applyMapCheat,
  applyRoomCheat,
  cheatFishSprites,
  cheatSolveRoom,
  closeTetris,
  devWinRoom,
  interlacedFaze,
  mapCheats,
  megabombFlash,
  roomCheats,
  setMegabombFlash,
  silentFilm,
  tetris,
  tetrisArt,
  tetrisTick,
  ultraviolence,
} from './cheats.js';
import { canvas, ctx, glCanvas, loadingEl, subCanvas, subCtx } from './dom.js';
import type { FeedbackUi } from './feedback.js';
import { IntroPlayer } from './intro.js';
import type { RoomGeometry } from './layout.js';

/**
 * What the debug hooks see of the running game.
 *
 * Generated from main.ts's own declarations; keep it that way. Eleven members are
 * writable because probes set them (setRenderer, setSubsGate, subScale, ...); the
 * rest are read-only views.
 */
export interface DebugHost {
  readonly aiKufr: AiKufr | null;
  readonly aiKufrFrames: Map<string, ImageBitmap>;
  readonly aiPending: boolean;
  readonly aiRoom: AiRoom | null;
  readonly aiRoomNum: number;
  readonly aiRoomRenderActive: (r: Room) => boolean;
  aiSubScale: number;
  readonly aiWaterAnimating: () => boolean;
  readonly aiWorldMap: AiWorldMap | null;
  readonly applySubFont: (i: number) => void;
  readonly audio: AudioEngine;
  readonly bestRecord: (roomNum: number) => string | undefined;
  readonly bestRecords: Map<number, string>;
  readonly canSave: () => boolean;
  readonly casHry: () => number;
  readonly cheated: Set<number>;
  readonly classicArtFor: (r: Room) => ClassicArtSource;
  readonly clickCell: (cx: number, cy: number) => void;
  readonly clickMapAt: (mx: number, my: number) => void;
  readonly closeHelp: () => void;
  readonly closeMapInfo: () => void;
  readonly closeMapOverlay: () => void;
  readonly curNum: number;
  readonly dispatchMapCorner: (action: MapAction | null) => void;
  readonly enableWebgl: () => void;
  readonly enhancedArt: EnhancedArt | null;
  readonly enhancedArtActive: () => boolean;
  readonly enhancedArtFor: (r: Room) => EnhancedArtSource;
  readonly enhancedPending: boolean;
  readonly enterRoom: (num: number, replay?: string) => Promise<void>;
  readonly fishFrameFor: (which: "little" | "big") => FishFrame;
  readonly fishSprites: FishSprites | null;
  readonly forceBest: (roomNum: number, rec: string, moves: number) => void;
  forceRoomRedraw: boolean;
  readonly glAiCompositor: () => GlAiScreen | null;
  readonly glChannelDiff: (
    cpu: Uint8Array,
    gpu: Uint8Array,
    w?: number,
  ) => { max: number; rmse: number; overPct: number; worstAt: [number, number] } | null;
  readonly glCompositor: () => GlScreen | null;
  readonly glFailed: boolean;
  readonly glParityCompare: (art: ArtSource) => Record<string, unknown> | null;
  readonly graphics: GraphicsLevel;
  readonly heldState: number;
  readonly helpScreens: HelpScreens;
  readonly hooks: HookSystem;
  readonly idle: () => boolean;
  /**
   * Whether the frame clock is sleeping on the idle timer rather than on rAF. Was the
   * timer handle itself until the clock moved to `frameClock.ts`; the handle was never
   * anything but a truthiness test here, and the boolean is what `onTimer` always meant.
   */
  readonly loopIdle: boolean;
  readonly inReplay: () => boolean;
  readonly intro: IntroPlayer;
  readonly introMovie: () => string;
  readonly lastRoomBackend: "cpu" | "webgl";
  readonly lastRoomSig: string;
  readonly loadGame: () => void;
  readonly logoMovie: () => string;
  readonly loopThrottleOk: () => boolean;
  readonly loopTicks: number;
  readonly mapArtPending: () => boolean;
  readonly mapLaunching: number | null;
  readonly parchmentReady: boolean;
  readonly mapPresented: boolean;
  readonly O_OPTIONS: number;
  readonly openCredits: () => Promise<void>;
  readonly openHelp: () => void;
  readonly openMapInfo: (roomNum: number) => void;
  readonly openMapOptions: () => void;
  readonly panelAction: (region: number, panelX?: number) => void;
  readonly panelState: () => PanelState;
  readonly playTime: Map<number, number>;
  readonly previewSubFont: (next?: boolean) => void;
  readonly replayIntro: () => void;
  readonly restartRoom: () => void;
  readonly roomArtPending: () => boolean;
  readonly roomGeometry: (r: Room) => RoomGeometry;
  readonly roomLoading: boolean;
  readonly roomLoadSeq: number;
  readonly roomPaints: number;
  readonly saveExists: () => boolean;
  readonly saveGame: () => void;
  readonly saveSolved: () => void;
  readonly scores: Map<number, number>;
  readonly setGraphics: (level: GraphicsLevel) => void;
  readonly setRenderOnDirty: (v: boolean) => void;
  readonly setSubtitleMode: (mode: SubtitleMode) => void;
  readonly settings: Settings;
  readonly showLegImage: (leg: number, pending?: { room: number; replay?: string; }) => Promise<void>;
  readonly showMap: () => void;
  readonly skipCutscene: () => void;
  smoothLog: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string; }[] | null;
  readonly solved: Set<number>;
  readonly startCutscene: () => Promise<void>;
  readonly startShowmode: () => void;
  readonly SUB_FONT_CANDIDATES: readonly { name: string; family: string; weight: string; }[];
  readonly subFontFamily: string;
  readonly subFontIdx: number;
  readonly subFontReady: boolean;
  readonly subFontWeight: string;
  readonly subLang: () => "cz" | "en";
  subOverlayGate: boolean;
  subOverlayPainted: boolean;
  readonly subOverlayPaints: number;
  subOverlaySig: string;
  readonly syncSubOverlay: () => void;
  readonly talk: (which: "little" | "big") => void;
  readonly togglePanelOptions: () => void;
  readonly tryStep: (which: "little" | "big", dir: number) => "moving" | "turning" | "blocked" | "busy";
  readonly wake: () => void;
  waterAnimMs: number;
}

/**
 * Build the `__ff` object for a running game.
 *
 * Returns it rather than assigning it, so main.ts keeps control of WHEN the hook
 * appears on `window` — see the note on ui-lib's boot signal above.
 */
export function debugHooks(host: DebugHost): Record<string, unknown> {
  return {
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
        littleFrame: host.fishFrameFor('little'),
      };
    },
    press: (which: 'little' | 'big', dir: number) => {
      if (!host.idle() || !engine) return;
      engine.swim = null;
      engine.active = which;
      host.tryStep(which, dir);
    },
    click: (cx: number, cy: number) => host.clickCell(cx, cy),
    talk: (which: 'little' | 'big') => host.talk(which),
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
    roomGeom: () => (room ? host.roomGeometry(room) : null),
    phase: () => engine?.phase ?? 'idle',
    moveFrames: () => engine?.moveFrames() ?? MOVE_FRAMES, // current ticks/cell (jizda speed-up)
    jizda: () => engine?.jizda ?? 0,
    record: () => engine?.srecord ?? '',
    moves: () => lengthOfRecord(engine?.srecord ?? ''),
    restart: () => host.restartRoom(),
    smoothOn: () => {
      host.smoothLog = [];
    },
    smoothLog: () => (host.smoothLog ? host.smoothLog.slice() : []),
    save: () => host.saveGame(),
    load: () => host.loadGame(),
    hasSave: () => host.saveExists(),
    /** CanSave (URoom.pas:26900): whether the current position may be saved at all. */
    canSave: () => host.canSave(),
    /** The panel's per-element colour state (for asserting the greyed save button). */
    panelState: () => host.panelState(),
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
    heads: () => ({ little: host.fishFrameFor('little').headFrame, big: host.fishFrameFor('big').headFrame }),
    music: () => host.audio.currentMusic,
    graphics: () => host.graphics,
    setGraphics: (m: GraphicsLevel) => host.setGraphics(m),
    // The movie URL that would be played for the active graphics level right now
    // (reflects the `ai` upscale once its HEAD probe has resolved). Debug/test only.
    logoMovieUrl: () => host.logoMovie(),
    introMovieUrl: () => host.introMovie(),
    renderer: () => renderer,
    setRenderer: (m: 'cpu' | 'webgl') => {
      setRendererValue(m);
      if (renderer === 'webgl') host.enableWebgl();
      localStorage.setItem('ff.renderer', renderer);
    },
    subFont: () => ({ idx: host.subFontIdx, ...host.SUB_FONT_CANDIDATES[host.subFontIdx]! }),
    subFontList: () => host.SUB_FONT_CANDIDATES.map((c) => c.name),
    setSubFont: (i: number) => host.applySubFont(i),
    cycleSubFont: (next = true) => host.previewSubFont(next),
    // True when the last frame was actually presented by the WebGL backend.
    //
    // In a room this reports the backend that PAINTED, not the one the canvas stacking
    // suggests. That distinction is the whole point: the `ai` tier used to paint on
    // canvas-2D while `renderer` still read `webgl`, and a display-only check said the
    // GPU was engaged. Off the room screen (map, cutscene) the visible canvas is still
    // the honest signal.
    glActive: () =>
      renderer === 'webgl' &&
      !host.glFailed &&
      // While the room is loading or the help overlay is up, loop() hides #screen-gl and
      // nothing paints the room at all, so `lastRoomBackend` is stale — the visible-canvas
      // test is the honest one there, exactly as it is off the room screen.
      (ui.screen === 'room' && !host.roomLoading && !ui.helpOpen
        ? host.lastRoomBackend === 'webgl'
        : glCanvas.style.display !== 'none'),
    // Loop-throttle diagnostics (perf): whether the render loop may drop to the idle
    // timer rate right now, and the room-side conditions that force the full-rate rAF
    // spin when any is true (see loopThrottleOk). Used by the perf regression test.
    throttleInfo: () => ({
      throttleOk: host.loopThrottleOk(),
      onTimer: host.loopIdle,
      // Why an idle room may still be waking faster than the 12.5 Hz logic tick: the ai
      // tier's water is sampled per paint on the GPU (see aiWaterAnimating).
      waterAnim: host.aiWaterAnimating(),
      loops: host.loopTicks,
      roomPaints: host.roomPaints,
      heldState: host.heldState,
      phase: engine?.phase ?? 'idle',
      enhancedPending: host.enhancedPending,
      aiPending: host.aiPending,
      roomArtPending: host.roomArtPending(),
      ostav: ui.ostav,
      forceRoomRedraw: host.forceRoomRedraw,
    }),
    /** Dev/perf hook: mirror of the dev bar's idle-saver checkbox (P). */
    setRenderOnDirty: (v: boolean) => host.setRenderOnDirty(v),
    enhancedLoaded: () => host.enhancedArt !== null,
    // Is the "artwork would not load" screen up? Read off the DOM rather than from a
    // state flag: what matters to a probe is that the player was actually shown it.
    artFailShown: () => artFailureShown(),
    artFailTitle: () => document.getElementById('art-fail-title')?.textContent ?? '',
    enhancedActive: () =>
      host.enhancedArtActive() &&
      host.enhancedArt !== null &&
      room !== null &&
      !classicOnlyBackground(room.gspec) &&
      host.enhancedArt.w === (ffr?.width ?? 0) * FSIZE,
    playingPrior: (prior: number) => host.audio.playing(prior),
    voicePlaying: () => host.audio.playing(1) || host.audio.playing(2) || host.audio.playing(3),
    panelHit: (x: number, y: number) => panelHitTest(x, y, ui.ostav === host.O_OPTIONS),
    panelAction: (region: number, panelX = 0) => host.panelAction(region, panelX),
    hasPanel: () => ui.panel !== null,
    // Options sub-panel state (for UI probes): the scroll state + persisted settings.
    panelOstav: () => ui.ostav,
    panelScroll: () => ui.scroll,
    toggleOptions: () => host.togglePanelOptions(),
    optionsOpen: () => ui.ostav === host.O_OPTIONS,
    volumes: () => ({ ...host.settings.volume }),
    /** music_volume as the room scripts see it (0..64), i.e. Volumes[slider index]. */
    scriptMusicVolume: () => activeScript?.s.musicVolume ?? null,
    subtitleMode: () => host.settings.subtitles,
    titDef: () => host.settings.titDef,
    // Help overlay (for UI probes): open/close + page state.
    helpOpen: () => ui.helpOpen,
    // Feedback form (for UI probes): open/close, plus the payload and links exactly as
    // the player sees them. Read-only — nothing here sends anything.
    feedbackOpen: () => ui.feedback?.isOpen() ?? false,
    openFeedback: (kind?: 'bug' | 'idea') => ui.feedback?.open(kind),
    closeFeedback: () => ui.feedback?.close(),
    feedbackPreview: () => ui.feedback?.preview() ?? '',
    feedbackLinks: () => ui.feedback?.links() ?? { issue: '', email: '' },
    feedbackNote: () => ui.feedback?.note() ?? '',
    openHelp: () => host.openHelp(),
    closeHelp: () => host.closeHelp(),
    helpPage: () => host.helpScreens.page,
    helpPageCount: () => host.helpScreens.pages(host.subLang()).length,
    hasMap: () => ui.worldMap !== null,
    screen: () => ui.screen,
    // Debug: true while a room's assets are still loading (loadRoom). Until this
    // clears, the PREVIOUS room is still the live one — `screen() === 'room'` alone
    // does NOT mean the room you asked for is up, because enterRoom() flips the
    // screen synchronously but loads asynchronously.
    roomLoading: () => host.roomLoading,
    // Debug: true while the room is still waiting for the art tier it will PRESENT —
    // the counterpart of roomLoading() for the visual side (see roomArtPending).
    roomArtPending: () => host.roomArtPending(),
    // Debug: the same question for the world map — true while the `ai` tier's map art
    // is in flight, and so while loop() is withholding the map draw (mapArtHolding).
    mapArtPending: () => host.mapArtPending(),
    // Debug: has the `ai` tier's world-map art finished loading? Distinct from
    // mapArtPending(): a failed load also clears the hold, but leaves this false.
    aiMapLoaded: () => host.aiWorldMap !== null,
    // Debug: is a map frame the thing currently on screen? (What decides whether the
    // map's overlay goes up at once or on the 200ms delay — see syncLoadingUi.)
    mapPresented: () => host.mapPresented,
    // Debug: the room a map launch is running for (daRun/daRealyRun), else null — the
    // window in which the map stays on screen with the parchment over it.
    mapLaunching: () => host.mapLaunching,
    // Debug: is the parchment art available at all? (Without it enterRoom falls back to
    // the full-screen overlay — see canLaunchFromMap.)
    parchmentReady: () => host.parchmentReady,
    // Debug: is the post-boot room-loading overlay on screen right now?
    loadingVisible: () => loadingEl?.hidden === false,
    // Debug: the current room's AI art has finished loading / is actually painting
    // this frame. Two different questions — the art can be loaded while the frame is
    // withheld by the aiRoomRenderActive gate (hooks, ZX, frame effects…).
    aiRoomLoaded: () => host.aiRoom !== null && host.aiRoomNum === host.curNum,
    aiRoomActive: () => room !== null && host.aiRoomRenderActive(room),
    // Debug: the room number that is actually built and running (curNum) — not the
    // one currently being loaded.
    roomNum: () => host.curNum,
    // Debug: how many room loads have COMPLETED (see roomLoadSeq).
    roomLoads: () => host.roomLoadSeq,
    // Debug: the signature of the most recently PAINTED room frame
    // (`count|roomArtPending|graphics|renderer|glFailed`, see the room-draw branch
    // of loop()). Lets a test tell "a frame has been drawn in this graphics mode"
    // apart from "the art happens to have animated", which a frame-hash comparison
    // cannot distinguish in a room whose art animates every tick.
    paintedRoomSig: () => host.lastRoomSig,
    /** ZAVER finale cutscene active (zavermode) — for the completion-trigger UI test. */
    zaverMode: () => activeScript?.s.zavermode ?? false,
    // Leg-completion story page (obrazek): the shown leg number (1..8), or null when none.
    legImage: () => (ui.legImage ? ui.legImageNum : null),
    /** Debug: show a leg story page directly (probes cannot easily win a leg-final room). */
    showLegImage: (leg: number) => { void host.showLegImage(leg); },
    /** Debug: is the upscaled story page in use for the page on screen? */
    legImageAiActive: () => ui.legImageAi !== null,
    /** Debug: how many cutscene frames are being served from the upscaled set. */
    kufrAi: () => (host.aiKufr ? { frames: host.aiKufrFrames.size, order: host.aiKufr.order.length, scale: host.aiKufr.scale } : null),
    showMap: () => host.showMap(),
    enterRoom: (n: number) => host.enterRoom(n),
    enterRoomAwait: (n: number) => host.enterRoom(n),
    mapHit: (x: number, y: number) => ui.worldMap?.hitTest(x, y, host.solved, host.cheated) ?? 0,
    // World-map record info panel + best-solution replay (for UI probes).
    mapInfoRoom: () => ui.mapInfoRoom,
    mapInfoHover: () => ui.mapInfoHover,
    mapInfoFaze: () => ui.mapInfoFaze,
    deskyLang: () => ui.deskyLang, // language of the currently loaded room-name plaques
    openMapInfo: (n: number) => host.openMapInfo(n),
    closeMapInfo: () => host.closeMapInfo(),
    /** Click at map (x,y): routes exactly like a real left-click (panel button / open panel / launch). */
    clickMap: (x: number, y: number) => host.clickMapAt(x, y),
    replayActive: () => host.inReplay(),
    replayIndex: () => replaymode?.idx ?? -1,
    bestRecord: (n: number) => host.bestRecord(n) ?? null,
    bestRecords: () => Object.fromEntries(host.bestRecords),
    markBest: (n: number, rec: string) => host.forceBest(n, rec, lengthOfRecord(rec)),
    // Intro movie + map-corner menu overlays (for UI probes).
    introPlaying: () => host.intro.playing,
    introSeen: () => host.settings.introSeen,
    setIntroSeen: (v: boolean) => {
      host.settings.introSeen = v;
      saveSettings(host.settings);
    },
    skipIntro: () => host.intro.skip(),
    replayIntro: () => host.replayIntro(),
    mapCorner: (x: number, y: number) => ui.worldMap?.cornerAction(x, y) ?? null,
    mapHover: () => ui.mapHoverCorner,
    setMapHover: (a: MapAction | null) => {
      ui.mapHoverCorner = a;
    },
    clickMapCorner: (x: number, y: number) => host.dispatchMapCorner(ui.worldMap?.cornerAction(x, y) ?? null),
    mapOverlay: () => ui.mapOverlay,
    openMapOptions: () => host.openMapOptions(),
    openCredits: () => host.openCredits(),
    creditMode: () => ui.creditMode,
    // Debug/test only: jump the roll to a scroll offset by back-dating its start.
    creditSeek: (posun: number) => { ui.creditsStart = performance.now() - (posun / CREDIT_SPEED) * CREDIT_TICK_MS; },
    creditLength: () => (ui.credits ? ui.credits.delka : 0),
    closeMapOverlay: () => host.closeMapOverlay(),
    solvedRooms: () => [...host.solved],
    scores: () => Object.fromEntries(host.scores),
    cheatedRooms: () => [...host.cheated],
    markSolved: (n: number) => {
      host.solved.add(n);
      host.saveSolved();
    },
    cheat: () => cheatSolveRoom(),
    lines: () => linesSpoken,
    lastLine: () => lastLine,
    subsActive: () => subs?.active ?? false,
    /** True while a subtitle is still waving in or scrolling (perf probes/benchmarks). */
    subsAnimating: () => subs?.vectorAnimating(count) ?? false,
    /** Perf probe: cumulative count of vector-overlay re-renders (see subOverlayPaints). */
    subPaints: () => host.subOverlayPaints,
    /** Perf A/B: turn the overlay repaint gate off to reproduce the pre-fix cost. */
    setSubsGate: (v: boolean) => {
      host.subOverlayGate = v;
      host.subOverlaySig = '';
    },
    /**
     * Parity probe: repaint the vector overlay for an arbitrary logic tick, bypassing
     * the repaint gate, and report the geometry the reference implementation needs to
     * reproduce it (game-pixel screen size, the overlay backing size and its scale).
     */
    subsPaintAt: (at: number, frac = 0) => {
      if (!subs?.active || !room) return null;
      const { scale: cs } = host.roomGeometry(room);
      const dpr = window.devicePixelRatio || 1;
      host.syncSubOverlay();
      subCtx.setTransform(1, 0, 0, 1, 0, 0);
      subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
      subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
      subs.drawVector(subCtx, at, host.subFontFamily, host.subFontWeight, frac);
      host.subOverlayPainted = true;
      host.subOverlaySig = ''; // painted behind the gate's back — force the next real repaint
      return {
        w: subCanvas.width,
        h: subCanvas.height,
        scale: cs * dpr,
        screenW: subs.vectorScreen.w,
        screenH: subs.vectorScreen.h,
        family: host.subFontFamily,
        weight: host.subFontWeight,
        substeps: SUB_SUBSTEPS,
        lines: subs.debugLines(),
      };
    },
    /**
     * Prototype: choose how the vector subtitles are drawn — 'canvas' (the shipped
     * path) or 'dom' (real text animated by the compositor, see subtitleDom.ts).
     * Persisted, so a reload keeps whichever is being judged. The same call the dev
     * bar's Subtitles select makes, so the two stay in step.
     */
    setSubRenderer: (which: SubRenderer) => selectSubRenderer(which),
    subRenderer: () => (domSubsEnabled() ? 'dom' : 'canvas'),
    /** Test hook: inject a subtitle directly (deterministic, no room dialogue needed). */
    pushSubtitle: (text: string, code: string) => subs?.newSubtitle(text, code, count),
    /** Test hooks for the win auto-return hold: read the countdown / clear subtitles. */
    winCountdown: () => engine?.winCountdown ?? 0,
    clearSubtitles: () => subs?.clear(),
    audioHas: (name: string) => host.audio.has(name),  playSound: (name: string) => host.audio.play(name),
    // Debug: the room's .ffs voice package now loads AFTER the room's art (it is the
    // bulk of an entry's bytes and nothing visual needs it), so a probe that asserts on
    // a room-specific SOUND must wait for this rather than for the room itself.
    roomAudioReady: () => host.audio.roomLoaded,
    /** How many sounds a named package currently answers for (probe: x01 in a leg-final). */
    soundPkgSize: (id: string) => host.audio.entryCount(id),
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
      host.forceRoomRedraw = true;
      host.wake();
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
    aiWreckDigest: () => (host.aiRoom && host.aiRoomNum === host.curNum ? host.aiRoom.wreckDigest() : null),
    /**
     * The ENHANCED tier's replay of the same wreck history, as a native-px damage box.
     * Renders the background first so the source actually replays it, then reports what it
     * changed — the independent footprint `aiWreckDigest().damage` is compared against.
     */
    enhWreckDamage: () => {
      if (!room) return null;
      const art = host.enhancedArtFor(room);
      renderRoomBackgroundRgba(room, art, { count: 0 });
      return art.wreckDamageRect();
    },
    /** Stable fixed-count frame hash used by browser tests to prove a visible delta. */
    roomFrameHash: (mode: GraphicsLevel = host.graphics) => {
      if (!room) return null;
      const art = mode === 'classic' ? host.classicArtFor(room) : host.enhancedArtFor(room);
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
    roomEffectFrameHash: (mode: GraphicsLevel = host.graphics, grain = false) => {
      if (!room) return null;
      const art = mode === 'classic' ? host.classicArtFor(room) : host.enhancedArtFor(room);
      const frame = renderRoomRgba(room, art, { count: 0 });
      // Snapshot the one-shot state applyFrameEffects consumes, so merely ASKING for
      // the hash cannot swallow a megabomb flash the player is owed.
      const flash = megabombFlash;
      const force = host.forceRoomRedraw;
      applyFrameEffects(frame, true, grain);
      setMegabombFlash(flash);
      host.forceRoomRedraw = force;
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
    roomBgFrameHash: (mode: GraphicsLevel = host.graphics) => {
      if (!room) return null;
      const art = mode === 'classic' ? host.classicArtFor(room) : host.enhancedArtFor(room);
      const frame = renderRoomBackgroundRgba(room, art, { count: 0 });
      let hash = 2166136261;
      for (const byte of frame.rgba) hash = Math.imul(hash ^ byte, 16777619);
      return hash >>> 0;
    },
    /** Hacky (xfisher): spawn a fishing hook; read the hook count/states. */
    spawnHook: () => {
      if (room) host.hooks.add(room);
    },
    hookCount: () => host.hooks.count,
    /** Type a cheat code as the player would (the leading X arms the machine). */
    typeCheat: (code: string) => {
      const entry = ui.screen === 'map' ? mapCheats : roomCheats;
      for (const ch of code) {
        const r = entry.press(ch);
        if (r.cheat) {
          if (ui.screen === 'map') applyMapCheat(r.cheat);
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
    roomBackend: () => host.lastRoomBackend,
    /** cas_hry in days, plus the raw per-room banked milliseconds behind it. */
    casHry: () => host.casHry(),
    playTime: () => Object.fromEntries(host.playTime),
    water: () => (room ? { wamp: room.wamp, wper: room.wper, wspd: room.wspd } : null),
    /** The ENHANCED (truecolor) fish body sprite actually in use, for the sprite
     *  cheats — a separate art path from the FFR frames below. */
    enhancedFishSprite: (which: 'little' | 'big') => {
      const set = (cheatFishSprites ?? host.fishSprites)?.[which === 'little' ? 'small' : 'big'].left;
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
    hookStates: () => host.hooks.snapshot.map((h) => ({ stav: h.stav, cil: h.cil, x: h.x, y: h.y })),
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
      const comp = host.glCompositor();
      if (!comp) return { webgl: false };
      comp.renderBackgroundOnly(room, room.palette, count);
      const gpu = comp.readback();
      const cpu = renderRoomBackgroundRgba(room, host.classicArtFor(room), { count: count });
      if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
      return { webgl: true, w: gpu.w, h: gpu.h, ...host.glChannelDiff(cpu.rgba, gpu.rgba) };
    },
    // Test probe: render the WHOLE current room (background + items + fish) on the
    // GPU via the shared compositor (renderRoomInto → GlScreen) and compare to the
    // CPU frame, byte-for-byte. Classic art source, resting pose (count only).
    glRoomParity: () => (room ? host.glParityCompare(host.classicArtFor(room)) : null),
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
      if (!room || !host.aiRoom || host.aiRoomNum !== host.curNum) return null;
      const comp = host.glAiCompositor();
      const geom = host.roomGeometry(room);
      const w = geom.nativeW * host.aiRoom.scale;
      const h = geom.nativeH * host.aiRoom.scale;
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
          host.aiRoom!.drawInto(cpuTarget, room!, frame(i));
        }
        c2.getImageData(0, 0, 1, 1); // drain the 2D command queue
        return performance.now() - t;
      };
      const gpuRun = (n: number): number => {
        const t = performance.now();
        for (let i = 0; i < n; i++) {
          comp!.begin(w, h);
          host.aiRoom!.drawInto(comp!, room!, frame(i));
        }
        comp!.finish();
        return performance.now() - t;
      };
      cpuRun(4); // warm caches on both sides before either clock starts
      const cpuMs = (cpuRun(2 * frames) - cpuRun(frames)) / frames;
      let gpuMs = null;
      if (comp) {
        comp.track(host.aiRoom);
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
      if (!room || !host.aiRoom || host.aiRoomNum !== host.curNum) return null;
      const comp = host.glAiCompositor();
      if (!comp) return { webgl: false };
      const geom = host.roomGeometry(room);
      const w = geom.nativeW * host.aiRoom.scale;
      const h = geom.nativeH * host.aiRoom.scale;
      // Present at a real minification (the shipping case), small enough to score quickly.
      const pw = Math.max(2, Math.round(geom.nativeW));
      const ph = Math.max(2, Math.round(geom.nativeH));
      const rest = { bodyFrame: TL_ZAKLAD[0]!, headFrame: 0 };
      const f: AiRoomFrame = { count: count, slide: 0, fishAnim: { little: rest, big: rest } };
      comp.track(host.aiRoom);
      if (!comp.begin(w, h)) return { webgl: true, unsupported: true };
      host.aiRoom.drawInto(comp, room, f);
      const gpu = comp.presentReadback(pw, ph);

      // Reference: the canvas-2D composite, scaled to the presented size by the browser.
      const big = document.createElement('canvas');
      big.width = w;
      big.height = h;
      const bg = big.getContext('2d', { willReadFrequently: true });
      if (!bg) return { webgl: true, noCanvas: true };
      bg.clearRect(0, 0, w, h);
      host.aiRoom.drawInto(new Canvas2dAiTarget(bg), room, f);
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
     * 1. `oracleMax` — vs a JS reimplementation of BG_FS (the continuous curve from
     *    `smoothWobbleShift`, linearly interpolated between source columns, then the wall
     *    composited over it), built from this room's SOURCE art rather than from the other
     *    AI backend. Precisely what it is independent OF is worth stating, because it is
     *    not everything: it is independent of the GLSL and of both backends, so a rule
     *    broken identically on both AI targets — the `dissolveKeeps` failure mode — shows
     *    up here. It is NOT independent of the shared JS rule (`smoothWobbleShift`,
     *    `activeRipples`, `wobblePhase`), which the shader is fed from; that half is
     *    pinned instead by test/roomAi.test.ts against the faithful `waterShift`, and by
     *    tools/mutate-room-walk.mjs.
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
      if (!room || !host.aiRoom || host.aiRoomNum !== host.curNum) return null;
      const S = host.aiRoom.scale;
      const geom = host.roomGeometry(room);
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
        host.aiRoom.drawBackgroundInto(new Canvas2dAiTarget(c2), room, at, alpha);
        og.drawImage(cv, x, y, w, h, 0, 0, w, h);
      } else {
        const comp = host.glAiCompositor();
        if (!comp) return null;
        comp.track(host.aiRoom);
        if (!comp.begin(W, H)) return null;
        host.aiRoom.drawBackgroundInto(comp, room, at, alpha);
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
    /** Vector-subtitle size in the `ai` tier, as a fraction of the faithful size. */
    subScale: (v?: number) => {
      if (v !== undefined) {
        host.aiSubScale = Math.max(0.2, Math.min(1, v));
        host.subOverlaySig = ''; // the overlay caches on a signature; force the next repaint
        host.forceRoomRedraw = true;
        host.wake();
      }
      return host.aiSubScale;
    },
    /** Idle water wake period in ms (see waterAnimMs) — the perf/smoothness trade, live. */
    waterAnimMs: (ms?: number) => {
      if (ms !== undefined) {
        host.waterAnimMs = Math.max(16, Math.min(80, ms));
        host.forceRoomRedraw = true;
        host.wake();
      }
      return host.waterAnimMs;
    },
    /**
     * Live ripple state for the tuning lab (tools/ripple-lab.html): what is on screen now,
     * and how long until the next train. `startTrainNow` shifts the birth schedule so one
     * begins immediately, rather than making the tuner wait out `periodTicks`.
     */
    rippleState: () => {
      if (!room) return null;
      const w: AiWobble = {
        wamp: room.wamp, wper: room.wper, wspd: room.wspd, count: count, time: count + alpha,
      };
      const clock = w.time + RIPPLE.offsetTicks;
      const active = activeRipples(w, host.roomGeometry(room).nativeH);
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
      host.forceRoomRedraw = true;
    },
    aiWobbleCheck: (opts: { alpha?: number; minRun?: number } = {}) => {
      if (!room || !host.aiRoom || host.aiRoomNum !== host.curNum) return null;
      const comp = host.glAiCompositor();
      if (!comp) return { webgl: false };
      const art = host.aiRoom.backgroundArt(room);
      if (!art) return { webgl: true, noArt: true };
      const S = host.aiRoom.scale;
      const geom = host.roomGeometry(room);
      const W = geom.nativeW * S;
      const H = geom.nativeH * S;
      const alpha = opts.alpha ?? 0;
      const minRun = opts.minRun ?? 160;

      comp.track(host.aiRoom);
      if (!comp.begin(W, H)) return { webgl: true, unsupported: true };
      host.aiRoom.drawBackgroundInto(comp, room, count, alpha);
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
        wamp: room.wamp, wper: room.wper, wspd: room.wspd, count: count, time: count + alpha,
      };
      const phase = wobblePhase(w);
      const ripples = activeRipples(w, geom.nativeH);
      const banded = wobbles ? faithfulWobbleShifts(w, geom.nativeH) : null;
      // gspec=42: the shader replaces the wall's COLOUR with this frame's loading stripe
      // for the native row (BG_FS `uZx`). Read back the very sequence the GPU was handed
      // rather than deriving it — generating it advances the room's band state, so a
      // second derivation would be a different frame's stripes.
      const zxBands = room.gspec === 42 ? host.aiRoom.lastZxBands() : null;
      const wallRgb = (o: number, ch: number, y: number): number => {
        if (!zxBands) return wallPx[o + ch]!;
        const c = room!.palette[zxBands[Math.min(zxBands.length - 1, Math.floor(y / S))]!];
        return ch === 0 ? (c?.r ?? 0) : ch === 1 ? (c?.g ?? 0) : (c?.b ?? 0);
      };

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
            const want = wallRgb(o, ch, y) * wa + bg * (1 - wa);
            const got = gpu.rgba[o + ch]!;
            const d = Math.abs(want - got);
            if (d > oracleMax) oracleMax = d;
            sq += d * d;
            n++;
            const wantB = wallRgb(o, ch, y) * wa + bgPx[rowOff + cb * 4 + ch]! * (1 - wa);
            const dB = Math.abs(wantB - got);
            if (dB > bandedMax) bandedMax = dB;
            const n0 = Math.min(Math.max(x + fN, 0), W - 1);
            const n1 = Math.min(Math.max(x + fN + 1, 0), W - 1);
            const na = bgPx[rowOff + n0 * 4 + ch]!;
            const nb = bgPx[rowOff + n1 * 4 + ch]!;
            const wantN = wallRgb(o, ch, y) * wa + (wobbles ? na + (nb - na) * fracN : na) * (1 - wa);
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
      if (!room || !host.aiRoom || host.aiRoomNum !== host.curNum) return null;
      const comp = host.glAiCompositor();
      if (!comp) return { webgl: false };
      const geom = host.roomGeometry(room);
      const w = geom.nativeW * host.aiRoom.scale;
      const h = geom.nativeH * host.aiRoom.scale;
      const f: AiRoomFrame = {
        count: count,
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
        host.aiRoom.drawInto(new Canvas2dAiTarget(c2), room, f); // scratch target: see aiRenderBench
        const cpu = new Uint8Array(c2.getImageData(0, 0, w, h).data.buffer.slice(0));
        comp.track(host.aiRoom);
        comp.begin(w, h);
        host.aiRoom.drawInto(comp, room, f);
        const gpu = comp.readback();
        if (gpu.w !== w || gpu.h !== h) return { webgl: true, dimMismatch: true };
        return { webgl: true, w, h, stillWater: opts.stillWater === true, ...host.glChannelDiff(cpu, gpu.rgba, w) };
      } finally {
        room.wamp = savedWamp;
      }
    },
    // Test probe: same, through the ENHANCED (FFNG truecolor) art source.
    // `enh` reports whether the FFNG masters were actually engaged for this room.
    glEnhParity: () => {
      if (!room) return null;
      const r = host.glParityCompare(host.enhancedArtFor(room));
      if (r && typeof r === 'object' && 'webgl' in r && r.webgl) (r as Record<string, unknown>).enh = host.enhancedArt !== null;
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
      const comp = host.glCompositor();
      if (!comp) return { webgl: false };
      const art = host.classicArtFor(room);
      const opts = {
        count: count,
        slide: 0.5,
        fishAnim: {
          little: { bodyFrame: TL_PLAV[1]!, headFrame: HL_MRK },
          big: { bodyFrame: TL_NAHORU[1]!, headFrame: HL_TLACI },
        },
        hooks: host.hooks.snapshot,
      };
      const cpu = renderRoomRgba(room, art, opts);
      subs?.draw(cpu, count); // baked classic subtitles (setIndex on the CPU target)
      comp.begin(cpu.width, cpu.height, room.palette);
      renderRoomInto(comp, room, art, opts);
      subs?.draw(comp, count); // baked classic subtitles (setIndex on the GPU target)
      if (comp.unsupported) return { webgl: true, unsupported: true };
      const gpu = comp.readback();
      if (gpu.w !== cpu.width || gpu.h !== cpu.height) return { webgl: true, dimMismatch: true };
      return { webgl: true, w: gpu.w, h: gpu.h, ...host.glChannelDiff(cpu.rgba, gpu.rgba) };
    },
    // Cutscene GPU parity probe: render the current briefcase-demo frame through the
    // GPU indexed path (GlScreen.renderIndexed → offscreen FBO) and compare to a CPU
    // IndexedScreen.toRgba of the same palette-indexed pixels. The FBO is sampled
    // NEAREST from a palette LUT, so it is byte-exact (max=0); the LINEAR present
    // upscale is cosmetic and NOT part of this comparison (readback reads the FBO,
    // not the presented canvas). Requires an active cutscene.
    glCutsceneParity: () => {
      if (!cutscene) return null;
      const comp = host.glCompositor();
      if (!comp) return { webgl: false };
      const w = cutscene.width;
      const h = cutscene.height;
      comp.renderIndexed(cutscene.pixels, w, h, cutscene.palette);
      const gpu = comp.readback();
      const frame = new IndexedScreen(w, h);
      frame.px.set(cutscene.pixels);
      const cpu = frame.toRgba(cutscene.palette);
      if (gpu.w !== w || gpu.h !== h) return { webgl: true, dimMismatch: true };
      return { webgl: true, w, h, ...host.glChannelDiff(cpu, gpu.rgba) };
    },
    // Present-filter probe (guards a LINEAR-filter leak the parity suite can't catch,
    // since it reads the FBO not the canvas). Renders a 2px black→white step, then
    // presents it upscaled to 16px three times and reads the CANVAS back each time:
    // crisp (NEAREST, no intermediate greys) → smooth (LINEAR, intermediate greys) →
    // crisp again (asserts the smooth present didn't leave the filter LINEAR).
    glPresentFilterProbe: () => {
      const comp = host.glCompositor();
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
    subFontReady: () => host.subFontReady,
    // the current art source (classic/enhanced). Isolates the compositing+present
    // cost from the rAF vsync cap, so it reveals real headroom (both backends sit
    // at 60fps under vsync when there's slack). WebGL is timed with a gl.finish()
    // per frame so real GPU execution — not just async command submission — counts.
    benchRender: (mode: 'cpu' | 'webgl', frames = 120, warmup = 20) => {
      if (!room) return null;
      const art = host.enhancedArtActive() ? host.enhancedArtFor(room) : host.classicArtFor(room);
      const { nativeW: sw, nativeH: sh, scale: benchCs } = host.roomGeometry(room);
      const opts = { count: count };
      const samples: number[] = [];
      // The ZX room's blitZX advances room.zx every render; snapshot it so the
      // benchmark (warmup + frames iterations) leaves the live animation untouched.
      const zxSnap = room.gspec === 42 ? { ...room.zx } : null;
      if (mode === 'webgl') {
        const comp = host.glCompositor();
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
      const { scale: cs } = host.roomGeometry(room);
      host.syncSubOverlay();
      const dpr = window.devicePixelRatio || 1;
      let tick = at;
      const run = (draw: boolean, flush: boolean): number[] => {
        const one = (): void => {
          subCtx.setTransform(1, 0, 0, 1, 0, 0);
          subCtx.clearRect(0, 0, subCanvas.width, subCanvas.height);
          if (draw) {
            subCtx.setTransform(cs * dpr, 0, 0, cs * dpr, 0, 0);
            subs!.drawVector(subCtx, advance ? tick++ : at, host.subFontFamily, host.subFontWeight);
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
      host.subOverlayPainted = true;
      host.subOverlaySig = ''; // the probe painted behind the gate's back — force a repaint
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
    chatCount: () => host.audio.entryCount('x03'),
    deathBank: () => host.audio.entryCount('x02'),
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
    startCutscene: () => void host.startCutscene(),
    cutsceneDone: () => cutscene?.done ?? null,
    cutsceneActive: () => cutscene !== null,
    skipCutscene: () => host.skipCutscene(),
    setLang: (l: SubtitleMode) => {
      host.setSubtitleMode(l);
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
      const r = host.tryStep('big', dir);
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
    forceShowmode: () => host.startShowmode(),
    // Debug replay trace: toggle recording, read the rows, and clear.
    showmodeTraceOn: (on: boolean) => {
      setShowmodeTraceOn(on);
      if (!on) showmodeTrace.length = 0;
    },
    showmodeTrace: () => showmodeTrace.slice(),
    // Debug: true while a fast-forward load animation is replaying (loadmode).
    loading: () => loadmode !== null,
    soundLog: () => host.audio.soundLog.slice(),
    clearSoundLog: () => {
      host.audio.soundLog.length = 0;
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
}
