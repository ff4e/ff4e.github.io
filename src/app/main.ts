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

import { Room, ITEM_WATER } from '../core/room.js';
import { HookSystem } from '../core/hooks.js';
import { Dir } from '../core/dir.js';
import {
  FSIZE,
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
import { SubtitleSystem } from '../render/subtitles.js';
import { type FishSprites } from '../render/enhancedArtSource.js';
import { MAP_W, MAP_H } from '../render/worldMap.js';
import { hitInfoButton } from '../render/mapInfo.js';
import { requiredAsset, requiredJson } from '../render/assetFetch.js';
import { framesIdle, wake } from './frameClock.js';
import { depthOfRoom, branchOfRoom } from '../data/world.js';
import { hitTest as panelHitTest, sliderIndex, PANEL_W, PANEL_H } from '../render/hud.js';
import { TALKING_MEZ_SEC, MUSIC_PRIOR } from '../audio/audio.js';
import { musicForCHud } from '../audio/music.js';
import { Script, type ScriptSnapshot } from '../core/script.js';
import { StepEngine, TURN_FRAMES } from '../core/stepEngine.js';
import { newChatter } from '../core/chatter.js';
import { newDeathState } from '../core/deathlines.js';
import { movesOf, lengthOfRecord } from '../core/record.js';
import { roomScript } from '../rooms/index.js';
import { ROOMS } from '../data/roomTable.js';
import { isUnsupportedDevice, showUnsupportedNotice } from './deviceGate.js';
import { canvas, info, panelCanvas, select } from './dom.js';
import { ARROWS, KEYS, MLUVI_PRIOR, NOOP_SCRIPT, TETRIS_KEYS } from './keyTables.js';
import { audio, initAudio } from './audioEngine.js';
import { atRest, fishBusy, idle } from './roomGates.js';
import { initRoomLoad, loadRoom, roomVoicesSettled, talk } from './roomLoad.js';
import { initRenderLoop, loop } from './renderLoop.js';
import {
  beginHeldMove,
  clearHeldKey,
  heldKeyState,
  initMovement,
  releaseHeldKey,
  restartRoom,
  restore,
  tryStep,
  wallShove,
} from './movement.js';
import {
  aiKufr,
  aiKufrFrames,
  endShowmode,
  inReplay,
  inShowmode,
  initCutscene,
  skipCutscene,
  startCutscene,
  startShowmode,
} from './cutscene.js';
import { cancelSolve, inAutoPlay, inSolvemode } from './solveMode.js';
import {
  closeMapOverlay,
  dismissLegImage,
  dispatchMapCorner,
  initMapNav,
  openCredits,
  openMapOptions,
  replayIntro,
  returnFromRoom,
  showLegImage,
  showMap,
} from './mapNav.js';
import { initBoot, runBoot } from './boot.js';
import { hracNespi, initLogicTick, step } from './logicTick.js';
import { openSaveStore } from './persist.js';
import { initFramePainter } from './framePainter.js';
import {
  aiSubScale,
  initIntro,
  intro,
  introMovie,
  logoMovie,
  setAiSubScale,
} from './introOverlay.js';
import {
  SUB_FONT_CANDIDATES,
  initStageState,
  setSubFontFamily,
  setSubFontIdx,
  setSubFontWeight,
  subFontFamily,
  subFontIdx,
  subFontReady,
  subFontWeight,
} from './stageState.js';
import { initDevBar, syncSolveBtn } from './devBar.js';
import { closeMapInfo, ensureDeskyData, initMapDraw, openMapInfo } from './mapDraw.js';
import { closeHelp, initPanel, openHelp, panelState, togglePanelOptions } from './panel.js';
import { beginRoomLoadingUi, initLoadingUi } from './loadingUi.js';
import {
  applyVolumeSettings,
  initPlayerSettings,
  musicLevel,
  setSubtitleMode,
  setVolume,
  settings,
  subLang,
  subsOn,
  syncScriptMusicVolume,
} from './playerSettings.js';
import {
  GRAPHICS_LEVELS,
  devEnabled,
  enhancedArtActive,
  graphics,
  initRenderSettings,
  renderOnDirty,
  renderer,
  setDevEnabled,
  setGraphics,
  setRenderOnDirty,
  setRenderer,
} from './renderSettings.js';
import {
  DEFAULT_LINE_TICKS,
  EFFECT_VOL,
  LOGIC_MS,
  LOGIC_SEC,
  initStageGeometry,
  roomGeometry,
} from './stageGeometry.js';
import {
  aiWaterAnimating,
  forceRoomRedraw,
  initFramePacing,
  lastRoomBackend,
  lastRoomSig,
  loopThrottleOk,
  loopTicks,
  roomLoadSeq,
  roomLoading,
  roomPaints,
  setForceRoomRedraw,
  setSmoothLog,
  setWaterAnimMs,
  smoothLog,
  waterAnimMs,
} from './framePacing.js';
import {
  activeScript,
  blink,
  count,
  cutscene,
  cutsceneSubs,
  darkFlicker,
  engine,
  ffr,
  fftEntries,
  font,
  linesSpoken,
  loadmode,
  pokus,
  poslMluv,
  prevKostra,
  room,
  setActiveScript,
  setChatter,
  setCount,
  setDeathState,
  setEngine,
  setLastLine,
  setLinesSpoken,
  setLoadmode,
  setReplaymode,
  setRoom,
  setRoomDepth,
  setScreenShoveX,
  setSubs,
  showmode,
  subs,
  talkIdx,
} from './gameState.js';
import { O_OPTIONS, helpScreens, ui } from './screenState.js';
import { debugHooks } from './debugHooks.js';
import {
  classicArtFor,
  enableWebgl,
  enhancedArtFor,
  glAiCompositor,
  glChannelDiff,
  glCompositor,
  glFailed,
  glParityCompare,
  initGlPlumbing,
} from './glPlumbing.js';
import {
  aiCredits,
  aiPending,
  aiRoom,
  aiRoomNum,
  aiRoomRenderActive,
  aiWorldMap,
  curNum,
  decodePngResponse,
  enhancedArt,
  enhancedObjects,
  enhancedPending,
  initArt,
  mapArtHolding,
  mapArtPending,
  mapPresented,
  roomArtPending,
} from './art.js';
import {
  applyMapCheat,
  applyRoomCheat,
  applySpriteCheats,
  closeTetris,
  initCheats,
  mapCheats,
  oldWater,
  resetRoomScopedCheats,
  roomCheats,
  silentFilm,
  tetris,
  tetrisModal,
  ultraviolence,
} from './cheats.js';
import {
  beginMapLaunch,
  canLaunchFromMap,
  initRoomLaunch,
  mapLaunching,
  parchmentReady,
} from './roomLaunch.js';
//#region Device gate | anchors: isUnsupportedDevice, showUnsupportedNotice | Phones are refused here, before any art is fetched — and before every other side effect in the file. The stage scaling and the tick constants that used to sit with it are in `stageGeometry.ts`.

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

//#region Stage geometry wiring | anchors: initStageGeometry | Hands `stageGeometry.ts` its one name and takes the first stage measurement. The scaling itself is in that module.
// Immediately after the gate, which is where the stage used to be measured: the window
// is only read once the device has been accepted, and never at import time.
//
// It takes no arguments: `settings` was its only dependency and now lives in
// `playerSettings.ts`, which this module imports directly.
initStageGeometry();

//#region Stage state wiring | anchors: initStageState | Assembles the stage and loads the persisted subtitle font. The state itself is in `stageState.ts`.
initStageState();

//#region Loading UI wiring | anchors: initLoadingUi | Hands `loadingUi.ts` its one name and installs the boot-failure traps. The overlay, the fatal screen and relayout() are in that module.
initLoadingUi();

//#region Intro wiring | anchors: initIntro | Builds the intro player and probes for the AI movie variants. The movies and the subtitle overlay are in `introOverlay.ts`.
initIntro();

//#region Screen & overlay state | anchors: ui, hideAiCredits | The mutable globals for panel/options/credits/map-info/help/leg-image moved to `screenState.ts` — import `ui` from there. Only the credits-overlay restore is left, because it is behaviour, not state.
/** Put the game canvas back after the GPU credits overlay was shown. */
function hideAiCredits(): void {
  if (aiCredits) aiCredits.hide();
  if (canvas.style.display === 'none') canvas.style.display = '';
}
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
    return ui.screen;
  },
  get devEnabled() {
    return devEnabled;
  },
  // `cutscene` counts too: it leaves `ui.screen` alone, so every other arming guard passes
  // during the briefcase demo, and `step()` gives it the whole tick.
  playbackBusy: () => inReplay() || inShowmode() || loadmode !== null || cutscene !== null,
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
    setForceRoomRedraw(v);
  },
});
//#region Player settings wiring | anchors: initPlayerSettings | Hands `playerSettings.ts` its two names and loads the persisted options. Subtitle language and the volume buses are in that module.
// Called HERE, where `const settings = loadSettings()` used to sit: after the save store is
// open (so the `ff.*` read is legal) and after the device gate.
initPlayerSettings({
  get ensureDeskyData() {
    return ensureDeskyData;
  },
  get setInfo() {
    return setInfo;
  },
});

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
//#region Render settings wiring | anchors: initRenderSettings | Hands `renderSettings.ts` its one name and loads the four persisted choices. The tier/backend switches are in that module.
// Called HERE, where the declarations used to sit: after the save store is open, which is
// what makes reading the `ff.*` keys legal (persist.ts), and after the device gate.
initRenderSettings({
  get setInfo() {
    return setInfo;
  },
});

// Art loading for the enhanced and `ai` tiers lives in art.ts. Wired HERE, where that
// code used to sit. It reads the game through these getters; `forceRoomRedraw` is the
// repaint invalidation it fires when an async load lands.
//
// Eight members, down from thirteen: the five it lost (screen, mapOverlay, mapSig,
// panelSig, worldMap) were all screen state, and art.ts imports `ui` from
// `screenState.ts` for those now. That is the whole argument for giving shared state an
// owner — a getter per name per consumer is the tax for state that only main.ts can see.
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
    setForceRoomRedraw(v);
  },
  get graphics() {
    return graphics;
  },
  get hooks() {
    return hooks;
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
    setForceRoomRedraw(v);
  },
  get inShowmode() {
    return inShowmode;
  },
  get helpOpen() {
    return ui.helpOpen;
  },
  get mapArtHolding() {
    return mapArtHolding;
  },
  get mapOverlay() {
    return ui.mapOverlay;
  },
  get mapPresented() {
    return mapPresented;
  },
  get mapSig() {
    return ui.mapSig;
  },
  set mapSig(v: string | null) {
    ui.mapSig = v;
  },
  get roomArtPending() {
    return roomArtPending;
  },
  get roomLoading() {
    return roomLoading;
  },
  get screen() {
    return ui.screen;
  },
  set screen(v: 'map' | 'room' | 'intro' | 'legimage') {
    ui.screen = v;
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
  const m = await requiredJson<Record<'small' | 'big', Record<'left' | 'right', string[]>>>(
    '/enhanced/_fish/manifest.json',
    'the enhanced fish sprites',
    'mustHave',
  );
  const build = async (size: 'small' | 'big', facing: 'left' | 'right') => {
    const map = new Map<string, { w: number; h: number; rgba: Uint8Array }>();
    await Promise.all(
      (m[size]?.[facing] ?? []).map(async (f) => {
        const url = `/enhanced/_fish/${size}/${facing}/${f}`;
        const r = await requiredAsset(url, 'an enhanced fish sprite', 'mustHave', { expect: 'image' });
        const d = await decodePngResponse(r, 'mustHave');
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
}
void loadFishSprites();
//#region Audio & fish selection | anchors: initAudio, hooks, peekAtPlayer, swapActive, selectFish | Builds the AudioEngine (owned by `audioEngine.ts`), the fishing-hook easter egg, and switching which fish is active. The key/constant tables are in `keyTables.ts`.
initAudio();
applyVolumeSettings(); // restore persisted volume levels before any sound plays
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

/** stav_kuk trigger: the newly-active fish peeks at the player after a switch/select,
 *  unless we're replaying the demo (showmode) or fast-loading — the original suppresses
 *  it during `capturemode or showmode` (URoom.pas:24459/24712). */
function peekAtPlayer(which: 'little' | 'big'): void {
  if (!engine || inShowmode() || loadmode) return;
  engine.startKuk(which);
}

/** akce_switch (URoom.pas:24456): make the other fish active, only if it is alive. */
function swapActive(): void {
  if (!room || !engine || ui.screen !== 'room') return;
  const other = engine.active === 'little' ? 'big' : 'little';
  if (!room.alive[other]) return;
  engine.active = other;
  engine.swim = null;
  peekAtPlayer(other);
  setInfo();
}

/** akce_set (URoom.pas:24708): select a fish as active, if it is alive. */
function selectFish(which: 'little' | 'big'): void {
  if (!room || !engine || ui.screen !== 'room' || !room.alive[which]) return;
  if (fishBusy(which)) return; // DalsiPrikaz: akce_set (kdo=mala/velka) dropped while that fish busy
  engine.active = which;
  engine.swim = null;
  peekAtPlayer(which);
  setInfo();
}

//#region Room construction | anchors: buildRoom, setInfo, applySubFont, scriptTalk | Turns parsed FFR data into a live `Room` + `StepEngine`, and refreshes the info line. Room *loading*, audio, movement and drawing are elsewhere.
const ffrUrl = (num: number): string => `/data/Graphic/${String(num).padStart(3, '0')}.ffr`;

function setInfo(): void {
  // The room changed (or something about it did), so re-ask whether it has a solution to
  // play: the button greys out for the two rooms that are not puzzles.
  syncSolveBtn();
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
  setSubFontIdx(((i % n) + n) % n);
  const c = SUB_FONT_CANDIDATES[subFontIdx]!;
  setSubFontFamily(c.family);
  setSubFontWeight(c.weight);
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
  // Bound locally as well as published: `room` is an imported binding now (gameState.ts),
  // and TypeScript cannot narrow one — it has to assume any call could reassign it. The
  // local is the same object, and keeps the rest of this function reading as it did.
  const built = new Room(ffr);
  setRoom(built);
  setLoadmode(null); // cancel any in-flight load fast-forward on a room build
  // NOTE: `showmode` is deliberately NOT cleared here. A death-restart during the
  // KUFRIK demonstration (both fish die — the demo shows "what you shouldn't do")
  // must keep the demo running, exactly as the original: DalsiPrikaz auto-restarts
  // on CountDown=0 without clearing showmode (URoom.pas:26911-26920). The room-change
  // and player-restart paths call endShowmode() explicitly instead.
  hooks.clear(); // nhacku := 0 (URoom.pas:1502)
  // ultraviolence (URoom.pas:1503): once the code is typed on the map, every room
  // opens with a hook already descending.
  if (ultraviolence) hooks.add(built);
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
    built.wamp = 10;
    built.wspd = 4;
    built.wper = 6;
  }
  setScreenShoveX(0); // reset the KAJUTA1 screen-shove offset
  setCount(0);
  const wall = built.bitmaps[built.wallItem.bmp];
  setSubs(font && wall ? new SubtitleSystem(font, ffr.palette, ffr.width, wall.w, wall.h) : null);
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
        music: (name, prior) => void audio.musicSnd(name, prior, `/data/Music/${name}.wav`),
        musiccyc: (name, prior) => {
          // prior -999 = the room-music channel: re-cue the room's own track
          // (MusicCycle(MusName,-999,MusCycle)) rather than a separate effect source.
          if (prior === MUSIC_PRIOR) {
            if (roomMusic) {
              void audio.playMusic(roomMusic.name, `/data/Music/${roomMusic.name}.wav`, roomMusic.loopSample);
            }
          } else {
            void audio.musicSnd(name, prior, `/data/Music/${name}.wav`, 0.45, true);
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
    setEngine(new StepEngine(room, s, def ?? NOOP_SCRIPT, {
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
    }));
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
    setActiveScript({ def: def ?? NOOP_SCRIPT, s });
  } else {
    setActiveScript(null);
    setEngine(null);
  }
  // Settle gravity at load; if anything falls, animate it (phase 'fall') so the room
  // script can observe the fall (e.g. KUFRIK's briefcase dropping in).
  if (engine) {
    if (built.padani()) engine.phase = 'fall';
    else {
      built.clearAllDirs();
      engine.phase = 'idle';
    }
  }
  setChatter(activeScript ? newChatter(activeScript.s, 1000 / LOGIC_MS) : null);
  setDeathState(newDeathState());
  setRoomDepth(depthOfRoom(Number(select.value)));
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
  setLastLine({ name, count }); // debug: track dialogue line firing
  setLinesSpoken(linesSpoken + 1);
  const dur = audio.duration(name);
  // Talking() lead (RSound mez): count the line as "sounding" until ~0.4535s before
  // the sample truly ends, so the mouth stops (and the queue advances) a beat early
  // rather than flapping through the sample's trailing tail (matches the original).
  return dur > 0 ? Math.max(1, Math.round((dur - TALKING_MEZ_SEC) / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
}

/** Launch the briefcase story cutscene (InitKufrDemo), loading its assets once. */
//#region Cutscene wiring | anchors: initCutscene | Hands `cutscene.ts` the five names it needs — the things a cutscene does to the game when it starts, ends or is skipped. The KUFRIK demo, the movies and the replay are in that module.
initCutscene({
  get buildRoom() {
    return buildRoom;
  },
  get hracNespi() {
    return hracNespi;
  },
  get selectFish() {
    return selectFish;
  },
  get showMap() {
    return showMap;
  },
  get swapActive() {
    return swapActive;
  },
});

//#region Room load wiring | anchors: initRoomLoad | Hands `roomLoad.ts` the three names it needs. Fetching a room, arming its voices and starting its music are in that module.
initRoomLoad({
  get buildRoom() {
    return buildRoom;
  },
  get endShowmode() {
    return endShowmode;
  },
  get ffrUrl() {
    return ffrUrl;
  },
});

//#region Movement wiring | anchors: initMovement | Hands `movement.ts` the four names it needs. The held-key state machine, the record replay and the room restart are in that module.
initMovement({
  get buildRoom() {
    return buildRoom;
  },
  get endShowmode() {
    return endShowmode;
  },
  get hracNespi() {
    return hracNespi;
  },
  get setInfo() {
    return setInfo;
  },
});

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
//#region Panel wiring | anchors: initPanel | Hands `panel.ts` its three names. The side panel, the options sub-panel and the help overlay are in that module.
initPanel({
  get canSave() {
    return canSave;
  },
  get closeMapOverlay() {
    return closeMapOverlay;
  },
  get saveExists() {
    return saveExists;
  },
});

//#region Map drawing wiring | anchors: initMapDraw | Hands `mapDraw.ts` the four names it needs, all of them the persisted record the map is a view of. The drawing is in that module.
initMapDraw({
  get bestRecord() {
    return bestRecord;
  },
  get cheated() {
    return cheated;
  },
  get scores() {
    return scores;
  },
  get solved() {
    return solved;
  },
});

//#region Map navigation wiring | anchors: initMapNav | Hands `mapNav.ts` the five names it needs. Entering/leaving the map, the leg pages, the intro replay and the credits roll are in that module.
initMapNav({
  get enterRoom() {
    return enterRoom;
  },
  get hideAiCredits() {
    return hideAiCredits;
  },
  get setInfo() {
    return setInfo;
  },
  get solved() {
    return solved;
  },
  get stopRoomClock() {
    return stopRoomClock;
  },
});

//#region Room entry & fish animation | anchors: enterRoom, beginMapLaunch, panelAction, updateLipSync, fishFrameFor | The map → room transition (incl. the launch parchment), panel button actions, and which sprite frame each fish shows.
/** Keep the dev room picker in step with the room actually shown. */
function setRoomPicker(num: number): void {
  select.value = String(num);
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
    ui.screen = 'room';
    beginRoomLoadingUi(num); // delayed; a cached entry lands before it ever shows
  }
  startRoomClock(num); // TRoom.Start: casstartu := Date+Time
  ui.mapHoverCorner = null; // drop any map corner hover on leaving the map
  ui.mapHoverRoom = null;
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
      if (moves.length) setReplaymode({ moves, idx: 0 });
    });
  }
  return p;
}

/** Dispatch a control-panel button (ZaznamenejPrikazMysi, Uovl.pas:630).
 *  `panelX` is the click's panel x-coordinate, used by the volume sliders (PomObl). */
function panelAction(region: number, panelX = 0): void {
  // `TOvl.OvlMouseDown`'s first statement is `hrac_nespi` (Uovl.pas:946), before it has even
  // worked out which region was hit — the same unconditional shape as the room image
  // (URoom.pas:26871) and the keyboard (:26787). It used to sit inside the two direction
  // cases, below their `idle()`/`fishBusy` guards, so a player driving the fish entirely
  // from the on-screen panel stopped counting as awake the moment a fish started talking.
  hracNespi();
  switch (region) {
    case 1:
    case 2:
    case 3:
    case 4: // little fish up/down/left/right (region == Dir value)
      if (idle() && engine && !fishBusy('little')) {
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
  get enhancedArt() {
    return enhancedArt;
  },
  get enhancedObjects() {
    return enhancedObjects;
  },
  get fishSprites() {
    return fishSprites;
  },
  get setInfo() {
    return setInfo;
  },
});
//#region Frame painter wiring | anchors: initFramePainter | Hands `framePainter.ts` the two names it needs: which sprite frame each fish shows, and the hook system. The frame itself — all three tiers, both backends, the subtitle overlay — is in that module.
initFramePainter({
  get fishFrameFor() {
    return fishFrameFor;
  },
  get hooks() {
    return hooks;
  },
});

//#region Logic tick wiring | anchors: initLogicTick | Hands `logicTick.ts` the four names it needs. The 80 ms step itself — script, engine, dialogue, death, screensaver — is in that module.
initLogicTick({
  get buildRoom() {
    return buildRoom;
  },
  get casHry() {
    return casHry;
  },
  get hooks() {
    return hooks;
  },
  get updateLipSync() {
    return updateLipSync;
  },
});

//#region Frame pacing wiring | anchors: initFramePacing | Hands `framePacing.ts` its view of the game. The idle throttle, the wake rates and the perf HUD are in that module.
// Eight names, because the state those rates read has owning modules now. Before
// `screenState.ts` and `gameState.ts` the same seam would have needed the forties.
initFramePacing(
  {
    get enhancedArtActive() {
      return enhancedArtActive;
    },
    get heldState() {
      return heldKeyState();
    },
    get inShowmode() {
      return inShowmode;
    },
    get intro() {
      return intro;
    },
    get loop() {
      return loop;
    },
    get renderOnDirty() {
      return renderOnDirty;
    },
    get renderer() {
      return renderer;
    },
    get subFontReady() {
      return subFontReady;
    },
  },
  LOGIC_MS,
);
/** The render loop: steps the game at a fixed timestep, then draws (capped, see
 *  MAX_PAINT_FPS) once per RAF. */
//#region Render loop wiring | anchors: initRenderLoop | Hands `renderLoop.ts` the one name it still needs: a logic step. Everything it paints it imports. The rAF callback is in that module.
initRenderLoop({
  get step() {
    return step;
  },
});

//#region Keyboard | anchors: keydown / keyup listeners | Every key binding, including cheats, dev keys and modal handling.
window.addEventListener('keydown', (e) => {
  wake(); // return to 60fps immediately if the idle-loop throttle had us sleeping
  // The feedback form owns the keyboard while it is up. It is a modal <dialog>, so the
  // browser already keeps pointer and focus out of the game — but a keydown inside it
  // still bubbles to window. The fish keys are letters (WASD/IJKL, Uovl.pas:744) and
  // `X` arms the cheat buffer, so typing "the fish sank while I was pushing a crate"
  // swims the fish around behind the form — corrupting the very move record the report
  // is about. Escape is left alone: the dialog's own handler closes it.
  if (ui.feedback?.isOpen()) return;
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
  if (ui.mapOverlay === 'credits') {
    e.preventDefault();
    closeMapOverlay();
    return;
  }
  // Any key dismisses the leg-completion story page (zrus_obrazek).
  if (ui.screen === 'legimage') {
    e.preventDefault();
    dismissLegImage();
    return;
  }
  // While the help screens are open, arrows page through them and any other key
  // closes the viewer (Help.pas:Image1Click / FormKeyDown).
  if (ui.helpOpen) {
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
      setForceRoomRedraw(true);
    }
    return;
  }
  // TRoom.FormKeyDown's very first statement is `hrac_nespi` (URoom.pas:26787) — before
  // the held-key gate, before the command mapping, before anything. The player touched a
  // key, so the idle timers (delay[]) and the ambient-chatter clock restart, whatever the
  // key turns out to do and whether or not it ends up doing anything.
  //
  // The port had no equivalent: the only keyboard reset was inside `dispatchHeldMove`,
  // which is busy-gated, so while a fish was mid-dialogue the keyboard stopped counting as
  // activity entirely. Everything downstream of `delay[]` then behaved as if the player had
  // walked away — PRVNI's "why aren't we moving?" hint, KAJUTA2's "we should think", NCP's
  // grin at the seahorse, ZELVA's turtle possession, and StdKecej's idle chatter.
  //
  // Gated on being in a room because this is the ROOM form's handler; the map, the help
  // screens, Tetris and the cutscenes are separate forms with their own, above.
  if (ui.screen === 'room') hracNespi();
  // Typed cheat codes (ZaznamenejPrikazKlavesou, Uovl.pas:744; the map screen keeps
  // its own buffer, UMain.pas:1750). `X` arms the machine; while a code is part-typed
  // the letters are swallowed, and the first letter that cannot continue any code
  // parks it and falls through to the normal handler below.
  {
    // The original feeds EVERY key through the buffer, so an arrow, Space or
    // Backspace breaks the prefix and parks the machine before doing its normal
    // job (Uovl.pas:748-769). Only letters can extend a code, so anything else is
    // fed as a cancelling key and then handled normally below.
    const entry = ui.screen === 'map' ? mapCheats : roomCheats;
    const letter = e.key.length === 1 && /[a-z]/i.test(e.key);
    // A solution replay is a measurement, and a typed cheat would change the thing being
    // measured — xmorph and friends rewrite sprites, ultraviolence spawns a hook — so any
    // abort after one would be blamed on the recording. Deliberately keyed on
    // `inSolvemode()` and NOT `inAutoPlay()`: the map's "Replay" has always accepted typed
    // cheats and that is not this change's business to alter.
    //
    // Skips only the BUFFER, and must never `return`: Escape, Backspace, F2/F3 and the
    // dev-pane toggle are all handled BELOW this block, so returning here took away every
    // keyboard way to stop a run — including the Escape the button's tooltip promises.
    if (!(inSolvemode() && ui.screen === 'room')) {
      const r = letter ? entry.press(e.key) : entry.cancel();
      if (r.cheat) {
        if (ui.screen === 'map') applyMapCheat(r.cheat);
        else applyRoomCheat(r.cheat);
        return;
      }
      if (r.swallowed) return;
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
  }
  // Backspace restarts the room (TRoom.Restart) — the original's Restart action,
  // which the tutorial fish teach ("1st-m-backspace"). It is NOT a single-move undo.
  if (e.code === 'Backspace') {
    e.preventDefault();
    restartRoom(); // ends any solution replay too: it calls endShowmode()
    return;
  }
  if (e.code === 'F2') {
    e.preventDefault();
    // `atRest()` is true between the recording's moves, so without this a running replay
    // would bank a half-played record as the player's save.
    if (atRest() && !inSolvemode()) saveGame();
    return;
  }
  if (e.code === 'F3') {
    e.preventDefault();
    // Same hole as F2: `atRest()` is true between the recording's moves, and a load would
    // drop a saved room on top of a running replay. Escape is how you stop one.
    if (atRest() && !inSolvemode()) loadGame();
    return;
  }

  if (e.code === 'Escape') {
    e.preventDefault();
    cancelSolve(); // always an escape hatch: an auto-play the player cannot stop is a trap
    if (ui.screen === 'map') {
      if (ui.mapInfoRoom !== null) closeMapInfo(); // close the record panel first (daCancel)
      else if (ui.mapOverlay !== 'none') closeMapOverlay(); // close an open menu overlay
      else if (room && select.value !== 'map') enterRoom(Number(select.value)); // Number('map') is NaN: not a room
    } else showMap();
    return;
  }
  if (ui.screen === 'map') return; // no fish keys on the map
  if (activeScript?.s.natvrdo === 1) return; // possessed by ZELVA: input is ignored
  if (activeScript?.s.zavermode) return; // ZAVER finale cutscene: only restart/exit above work
  if (inShowmode()) return; // KUFRIK demonstration: fish keys blocked (Backspace/Escape end it above)
  if (inAutoPlay()) return; // "Replay"/solution playback: player fish keys are blocked
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
  releaseHeldKey(e.code);
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
  if (ui.helpOpen) {
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
  if (ui.screen === 'legimage') {
    e.preventDefault();
    dismissLegImage();
    return;
  }
  if (ui.screen === 'room') setForceRoomRedraw(true); // repaint promptly on any in-room click
  if (ui.screen === 'room' && activeScript?.s.natvrdo === 1) {
    e.preventDefault(); // possessed by ZELVA: input is ignored
    return;
  }
  if (ui.screen === 'room' && inShowmode()) {
    e.preventDefault(); // KUFRIK demonstration: mouse input ignored while it plays
    return;
  }
  if (ui.screen === 'room' && inAutoPlay()) {
    e.preventDefault(); // "Replay"/solution playback: mouse input ignored while it plays
    return;
  }
  if (ui.screen === 'room' && loadmode) {
    e.preventDefault(); // fast-forward load in progress
    return;
  }
  // Right button (in a room): step the active fish toward the click (mbRight).
  if (e.button === 2) {
    e.preventDefault();
    if (ui.screen !== 'room' || !room) return;
    // Image1MouseDown's first statement is `hrac_nespi` (URoom.pas:26871), the same shape as
    // FormKeyDown's (:26787): a mouse-down on the room counts as the player being awake
    // whatever it turns out to do — including one dropped because the fish is talking. This
    // used to sit below the busy gate, so a player who only right-clicked at a talking fish
    // still looked idle. The keyboard half of that was fixed first; this is the rest of it.
    hracNespi();
    if (room.won || !idle() || !engine) return;
    if (fishBusy(engine.active)) return; // sys dir_* dropped while the active fish is busy
    const { cx, cy } = cellFromEvent(e);
    const dir = dirToward(engine.active, cx, cy);
    if (dir !== Dir.no) {
      engine.swim = null;
      tryStep(engine.active, dir);
      setInfo();
    }
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  // World map: a corner "button" (intro/credits/options) or a room node.
  if (ui.screen === 'map') {
    if (!ui.worldMap) return;
    // A launch is BLOCKING in the original — Spust runs inside the timer handler, so
    // no message is processed until the room is up. Nothing on the map is clickable
    // while the parchment is on it.
    if (mapLaunching() !== null) return;
    // A click anywhere during the credits roll dismisses it (UMain.pas:1595).
    if (ui.mapOverlay === 'credits') {
      closeMapOverlay();
      return;
    }
    // The Options panel is modal: while it's open, map clicks are inert (its own
    // canvas handles the sliders/buttons).
    if (ui.mapOverlay === 'options') return;
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
  if (!ui.worldMap) return;
  // Record info panel open (InfoMode>0): its Run/Replay/Cancel buttons take the
  // click; anywhere else closes it (daCancel, UMain.pas:1612/1626).
  if (ui.mapInfoRoom !== null) {
    const room = ui.mapInfoRoom;
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
  const room = ui.worldMap.hitTest(mx, my, solved, cheated);
  if (room) {
    // A genuinely solved (or cheated) room opens the record panel instead of
    // launching immediately (daInfo, UMain.pas:1611); unsolved rooms launch.
    if (solved.has(room) || cheated.has(room)) openMapInfo(room);
    else void enterRoom(room);
    return;
  }
  dispatchMapCorner(ui.worldMap.cornerAction(mx, my));
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
  if (ui.screen !== 'map' || !ui.worldMap || ui.mapOverlay !== 'none' || mapLaunching() !== null) {
    if (ui.mapHoverCorner) ui.mapHoverCorner = null;
    return;
  }
  wake(); // map hover changes the corner highlight — resume 60fps to repaint promptly
  const { mx, my } = mapCoords(e);
  // Record panel open: hover the Run/Replay/Cancel buttons (dAkce, UMain.pas:1626).
  if (ui.mapInfoRoom !== null) {
    const btn = hitInfoButton(mx, my);
    if (btn !== ui.mapInfoHover) {
      ui.mapInfoHover = btn;
      ui.mapSig = null; // the highlighted icon changed — repaint
    }
    canvas.style.cursor = btn ? 'pointer' : 'default';
    return;
  }
  const corner = ui.worldMap.cornerAction(mx, my);
  ui.mapHoverCorner = corner === 'exit' ? null : corner;
  // Track the hovered room node for its name plaque (KresliDesku on dAkce=daRun).
  const overRoomNum = ui.worldMap.hitTest(mx, my, solved, cheated);
  if (overRoomNum !== (ui.mapHoverRoom ?? 0)) {
    ui.mapHoverRoom = overRoomNum || null;
    ui.mapSig = null; // the plaque changed — repaint
  }
  canvas.style.cursor = ui.mapHoverCorner || overRoomNum ? 'pointer' : 'default';
});

canvas.addEventListener('mouseleave', () => {
  wake();
  ui.mapHoverCorner = null;
  if (ui.mapHoverRoom !== null) {
    ui.mapHoverRoom = null;
    ui.mapSig = null;
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
  if (!ui.panel) return;
  if (tetrisModal()) {
    e.preventDefault(); // modal minigame: the control panel is inert behind it
    return;
  }
  if (inAutoPlay()) {
    e.preventDefault(); // "Replay"/solution playback: the control panel is inert
    return;
  }
  // Right-click anywhere on the panel toggles the options sub-panel (Uovl.pas:633-639),
  // or closes the Options overlay when it was opened over the map.
  if (e.button === 2) {
    e.preventDefault();
    if (ui.mapOverlay === 'options') closeMapOverlay();
    else togglePanelOptions();
    return;
  }
  if (e.button !== 0) return;
  e.preventDefault();
  const { x, y } = panelCoords(e);
  const region = panelHitTest(x, y, ui.ostav === O_OPTIONS);
  // On the map, the options corner button (region 16) closes the overlay rather
  // than scrolling back to the (nonexistent) in-room panel.
  if (ui.mapOverlay === 'options' && region === 16) {
    closeMapOverlay();
    return;
  }
  if (region) {
    ui.panelPressed = region; // lit-button feedback until release
    // A press on a volume slider begins a drag (updates live as the mouse moves).
    if (region >= 17 && region <= 19) {
      ui.panelDragBus = region === 17 ? 'effect' : region === 18 ? 'voice' : 'music';
    }
    panelAction(region, x);
  }
});

// Slider drag: while a volume slider is held, track the handle to the mouse x.
panelCanvas.addEventListener('mousemove', (e) => {
  if (!ui.panelDragBus || !ui.panel) return;
  e.preventDefault();
  const { x } = panelCoords(e);
  setVolume(ui.panelDragBus, sliderIndex(x));
});

window.addEventListener('mouseup', () => {
  ui.panelPressed = 0;
  ui.panelDragBus = null;
});

//#region Dev bar wiring | anchors: initDevBar | Hands `devBar.ts` its two names. The room picker, the dev selects and the relayout watchers are in that module.
initDevBar({
  get enterRoom() {
    return enterRoom;
  },
  get showMap() {
    return showMap;
  },
});

//#region Boot | anchors: initBoot, runBoot | Hands `boot.ts` the one name it needs, then runs the boot sequence. The sequence itself — fonts, graphics, the save store, the sound packages, room 7, the first frame — is in that module.
initBoot({
  get setInfo() {
    return setInfo;
  },
});
await runBoot();

// Debug hook for headless verification.
// The debug/test interface (window.__ff). The entries themselves live in debugHooks.ts;
// what they need of the running game is handed over here, as getters, with setters
// for the few values probes deliberately write. Assigned to window HERE, at the
// end of boot, because tools/ui-lib.mjs waits on window.__ff as the signal that boot
// has completed.

//#region `window.__ff` host | anchors: debugHooks | The host the debug hooks read the game through: every member is a getter, and a few also have a setter, for the values probes deliberately write. State that has an owning module is imported there directly instead. The hooks themselves are in `debugHooks.ts`.
(window as unknown as { __ff: unknown }).__ff = debugHooks({
  get O_OPTIONS() {
    return O_OPTIONS;
  },
  get SUB_FONT_CANDIDATES() {
    return SUB_FONT_CANDIDATES;
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
    setAiSubScale(v);
  },
  get aiWaterAnimating() {
    return aiWaterAnimating;
  },
  get aiWorldMap() {
    return aiWorldMap;
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
  get curNum() {
    return curNum;
  },
  get dispatchMapCorner() {
    return dispatchMapCorner;
  },
  get enableWebgl() {
    return enableWebgl;
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
    setForceRoomRedraw(v);
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
    return heldKeyState();
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
  get loopIdle() {
    return framesIdle();
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
  get lastRoomBackend() {
    return lastRoomBackend;
  },
  get lastRoomSig() {
    return lastRoomSig;
  },
  get loadGame() {
    return loadGame;
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
  get panelAction() {
    return panelAction;
  },
  get panelState() {
    return panelState;
  },
  get playTime() {
    return playTime;
  },
  get previewSubFont() {
    return previewSubFont;
  },
  get replayIntro() {
    return replayIntro;
  },
  get restartRoom() {
    return restartRoom;
  },
  get roomArtPending() {
    return roomArtPending;
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
  get skipCutscene() {
    return skipCutscene;
  },
  get smoothLog() {
    return smoothLog;
  },
  set smoothLog(v: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string; }[] | null) {
    setSmoothLog(v);
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
  get subFontWeight() {
    return subFontWeight;
  },
  get subLang() {
    return subLang;
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
    setWaterAnimMs(v);
  },
});
