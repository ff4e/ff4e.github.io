/**
 * The native game: the composition root that `src/app/main.ts` is for the browser, minus
 * everything that is the browser's (the DOM, the menus, the panel).
 *
 * What runs here is the game's own flow, unmodified: `roomLoad` enters a room,
 * `logicTick.step` is one 80 ms game step, `movement`'s held-key state machine turns keys
 * into moves, `undo` takes them back, `persist` keeps progress. Their DOM-bound imports are
 * swapped for native/js/seams/ at bundle time (native/build-js.mjs). What is restated here
 * is what `main.ts` owns and does not export — building a room, the save slots, the win
 * bookkeeping, the room part of the keyboard router, the frame loop's step — each marked
 * with where it comes from, and kept to what the native host can use.
 *
 * A session starts on the world map (`mapScreen.ts`) and comes back to it after a room,
 * through the story pages where the browser shows them. `--demo` and the smoke gate keep
 * going from room to room instead (`nextRoom`).
 */
import { Room } from '../../src/core/room.js';
import { Script } from '../../src/core/script.js';
import type { ScriptSnapshot } from '../../src/core/script.js';
import { StepEngine } from '../../src/core/stepEngine.js';
import { HookSystem } from '../../src/core/hooks.js';
import { newDeathState } from '../../src/core/deathlines.js';
import { lengthOfRecord, moveChar, movesOf } from '../../src/core/record.js';
import { decodeMoves } from '../../src/core/solutionMoves.js';
import { roomScript, solutionFor } from '../../src/rooms/index.js';
import { ROOMS } from '../../src/data/roomTable.js';
import {
  BRANCHES, RES_REACHABLE, REGISTERED_ROOMS, ZAVER_LEG, ZAVER_ROOM, branchOfRoom, computeResena, depthOfRoom,
} from '../../src/data/world.js';
import {
  activeScript, count, cutscene, engine, showmode, ffr, fftEntries, font, hracNespi, linesSpoken, loadmode, pokus, poslMluv, prevKostra, room,
  subs, clearUndoHistory, setActiveScript, setCount, setDeathState, setEngine, setLastLine, setLinesSpoken, setLoadmode,
  setReplaymode, setRoom, setRoomDepth, setScreenShoveX, setSubs, talkIdx,
} from '../../src/app/gameState.js';
import { SubtitleSystem } from '../../src/render/subtitles.js';
import { initQuiet } from '../../src/app/initQuiet.js';
import { MLUVI_PRIOR, KEYS, ARROWS, NOOP_SCRIPT } from '../../src/app/keyTables.js';
import { armChatter, initLogicTick, step } from '../../src/app/logicTick.js';
import { beginHeldMove, clearHeldKey, initMovement, releaseHeldKey, restartRoom, restore, wallShove } from '../../src/app/movement.js';
import { openSaveStore } from '../../src/app/persist.js';
import { inReplay, replayAtShowmodeSpot, replaySettleDue } from '../../src/app/replayMode.js';
import { initRoomLoad, loadRoom, roomEntryHeld, roomVoicesSettled } from '../../src/app/roomLoad.js';
import { atRest, fishBusy } from '../../src/app/roomGates.js';
import { ui } from '../../src/app/screenState.js';
import { armSolve, inAutoPlay, setSolvemode, cancelSolve } from '../../src/app/solveMode.js';
import { endShowmode, initCutscene, inShowmode, skipCutscene, startCutscene, startShowmode } from '../../src/app/cutscenePlay.js';
import { loadUndoHistory, undoAvailable, undoHistoryForSave, undoMove } from '../../src/app/undo.js';
import { aiRoom, aiRoomReady } from './seams/art.js';
import { audio } from './seams/audioEngine.js';
import { roomLoading } from './seams/framePacing.js';
import { onLeaveRoom, returnFromRoom } from './seams/mapNav.js';
import { DEFAULT_LINE_TICKS, EFFECT_VOL, LOGIC_MS, LOGIC_SEC } from './seams/stageGeometry.js';
import { initNativeSettings, subLang, subsOn } from './seams/playerSettings.js';
import { aiFrame } from './frame.js';
import { disposeKufrArt } from './cutsceneScreen.js';
import { showTutorialHint } from './tutorialHint.js';
import { closeLegPage, initMapScreen, mapArrived, openLegPage } from './mapScreen.js';
import { initIntroScreen } from './introScreen.js';
import type { NativeAiScreen } from './nativeAiScreen.js';
import type { MapAction } from '../../src/render/worldMap.js';
import { loadStore, pullRemoteProgress } from './shims.js';
import { initSound, loadGlobalSounds, musicLevel, soundTime, startMenuMusic, updateLipSync } from './sound.js';
import { MUSIC_PRIOR, TALKING_MEZ_SEC } from '../../src/audio/audio.js';
import { musicForCHud, musicUrl } from '../../src/audio/music.js';

export type Which = 'little' | 'big';

/** How the game leaves a room — `mapNav`'s two exits, handed over by the seam. */
export type LeaveReason = 'won' | 'replayEnded';

export interface GameOptions {
  /** Print the info line whenever it changes (`main.ts`'s `setInfo`, to the console). */
  readonly verbose: boolean;
  /**
   * Arm a solution replay (`solvemode`) on every room entry: the game plays itself, and a
   * won room leads straight to the next (`nextRoom`) rather than to the map.
   */
  readonly demo: boolean;
  /** Called when a room is left, instead of going to the map (the smoke gate). */
  readonly onLeave?: (num: number, why: LeaveReason) => void;
  /** Ⓐ on a map corner button: the native Options (`menus.ts`), which the map cannot import. */
  readonly openCorner?: (action: MapAction) => void;
}

/** The game's state that `main.ts` keeps at module scope. One native session = one game. */
let opts: GameOptions = { verbose: false, demo: false };
let store!: ReturnType<typeof openSaveStore>;
/** The room being played — `main.ts`'s `select.value`. */
let roomNum = 0;

/**
 * The fishing hooks (Hacky). Only the `ultraviolence` cheat ever adds one, and the native
 * host has no way to type a cheat, so `killByHook` is unreachable here.
 * restates src/app/main.ts `const hooks = new HookSystem(` @ e8aaaa2d3751
 */
const hooks = new HookSystem({ killByHook: () => {} });

const ffrUrl = (num: number): string => `/data/Graphic/${String(num).padStart(3, '0')}.ffr`;

// ── Room construction (main.ts `buildRoom`, `scriptTalk`, `setInfo`) ─────────────────

let lastInfo = '';
function setInfo(): void {
  if (!opts.verbose) return;
  const d = ROOMS[roomNum - 1];
  const moves = lengthOfRecord(engine?.srecord ?? '');
  const info = !d ? '' : room?.won
    ? `#${roomNum} ${d.jmeno} — ${d.en}: SOLVED in ${moves} moves`
    : room?.anyFishDead
      ? `#${roomNum} ${d.jmeno}: crushed — restarting…`
      : `#${roomNum} ${d.jmeno} — ${d.en} · active: ${engine?.active ?? 'little'} · moves: ${moves}${undoAvailable() ? ' · undo' : ''}${saveExists() ? ' · load' : ''}`;
  if (info !== lastInfo) console.log(info);
  lastInfo = info;
}

/**
/**
 * dialogy's talk hook: show the subtitle and play the voice, as the browser's does, and
 * return the line's length in game ticks — the FFT record's `delka`, less Talking()'s lead
 * (RSound mez), never anything the mixer reports. The subtitle's own timing is the subtitle
 * system's (its length in characters), as in the browser. A best-solution replay neither
 * shows nor plays it, as the original's loadmode replay does. The browser's dialogue hint is
 * the legend's pulse here (`tutorialHint.ts`).
 * restates src/app/main.ts `function scriptTalk(` @ db999691d54e
 */
function talk(name: string, prior: number): number {
  if (inReplay()) {
    const dur = audio.duration(name);
    return dur > 0 ? Math.max(1, Math.round((dur - TALKING_MEZ_SEC) / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
  }
  // The room's FFT arrives before its voice package, so it is consulted directly; the global
  // packages (chatter, death lines, border remarks, the restored lines) through the engine.
  const entry = fftEntries.find((e) => e.name === name) ?? audio.entry(name);
  if (entry && subs && subsOn()) {
    const t = subLang() === 'cz' ? entry.cz : entry.en;
    // globtit (Talk, URoom.pas:654): LODE's announced coordinate goes in for the '@'.
    const text =
      t.text.includes('@') && activeScript ? t.text.replace('@', activeScript.s.globtit) : t.text;
    if (text) subs.newSubtitle(text, t.color, count, prior);
  }
  audio.play(name, 1, prior, 'voice');
  setLastLine({ name, count });
  setLinesSpoken(linesSpoken + 1);
  const dur = audio.duration(name);
  showTutorialHint(name, dur > 0 ? dur * 1000 : DEFAULT_LINE_TICKS * LOGIC_MS);
  return dur > 0 ? Math.max(1, Math.round((dur - TALKING_MEZ_SEC) / LOGIC_SEC)) : DEFAULT_LINE_TICKS;
}

/**
 * `main.ts`'s `buildRoom`, minus what the native host does not have: the cheats (sprite,
 * water, silent film, hooks) and the store review. Everything that decides how the room
 * PLAYS — and how it sounds, and what it subtitles, and KUFRIK's briefcase story and
 * tutorial demonstration, held back during a map Replay — is here, in the same order.
 * restates src/app/main.ts `function buildRoom(` @ 95a7c5e6b334
 */
function buildRoom(carryPole = false, carried: readonly number[] = []): void {
  if (!ffr) return;
  clearHeldKey();
  const savedPole = carryPole && activeScript ? [...activeScript.s.roompole] : null;
  if (carryPole) audio.killVoices(carried); // TRoom.Restart's KillExcept(-999), and `carriedSounds`
  const built = new Room(ffr);
  setRoom(built);
  setLoadmode(null);
  hooks.clear();
  if (!carryPole) clearUndoHistory();
  setScreenShoveX(0);
  const keptSubs = carried.length > 0 ? subs?.rebase(count) : undefined; // carried lines keep theirs
  setCount(0);
  const wall = built.bitmaps[built.wallItem.bmp];
  setSubs(keptSubs ?? (font && wall ? new SubtitleSystem(font, ffr.palette, ffr.width, wall.w, wall.h) : null));
  talkIdx.little = 0;
  talkIdx.big = 0;
  poslMluv.little = -1;
  poslMluv.big = -1;
  prevKostra.little = false;
  prevKostra.big = false;
  const def = roomScript(ROOMS[roomNum - 1]?.jmeno ?? '');
  const roomMusic = musicForCHud(ROOMS[roomNum - 1]?.cHud ?? -1);
  let initializing = true; // until `init` returns: see initQuiet
  const s = new Script(
    built,
    talk,
    (prior) => audio.playing(prior),
    initQuiet(carried, () => initializing, {
      snd: (name, prior) => audio.snd(name, prior, false, EFFECT_VOL),
      sndcyc: (name, prior) => audio.snd(name, prior, true, EFFECT_VOL),
      sndvol: (name, prior, vol) => audio.snd(name, prior, false, Math.max(0, Math.min(1, vol / 64))),
      ksnd: (prior) => audio.killVoice(prior),
      music: (name, prior) => void audio.musicSnd(name, prior, musicUrl(name)),
      musiccyc: (name, prior) => {
        if (prior === MUSIC_PRIOR) {
          if (roomMusic) void audio.playMusic(roomMusic.name, musicUrl(roomMusic.name), roomMusic.loopSample);
        } else {
          void audio.musicSnd(name, prior, musicUrl(name), 0.45, true);
        }
      },
      talkNow: (name, prior) => talk(name, prior),
      voicesReady: () => roomVoicesSettled,
    }),
    (prior) => audio.talking(prior),
  );
  s.pokus = pokus;
  s.musicVolume = musicLevel();
  if (savedPole) for (let i = 0; i < s.roompole.length; i++) s.roompole[i] = savedPole[i] ?? 0;
  s.musName = roomMusic?.name ?? '';
  s.onKufrDemo = () => void (inReplay() ? null : startCutscene()); // see replayAtShowmodeSpot
  s.onShowmode = () => (inReplay() ? replayAtShowmodeSpot() : startShowmode());
  const eng = new StepEngine(built, s, def ?? NOOP_SCRIPT, {
    random: (n) => Math.floor(Math.random() * n),
    onLanding: (kind) =>
      audio.playRandom(kind === 1 ? ['sp-zuch1', 'sp-zuch2'] : ['sp-ocel1', 'sp-ocel2'], EFFECT_VOL),
    playSound: (name, which) => (which ? void talk(name, MLUVI_PRIOR[which]) : audio.play(name)),
    onBlockedMove: (which, dir) => wallShove(which, dir),
    onWin: () => onWinBookkeeping(),
    onReturnToMap: () => returnFromRoom(),
  });
  setEngine(eng);
  s.onWin = () => eng.triggerWin();
  def?.init(s);
  initializing = false;
  for (let j = 1; j <= built.itemCount; j++) {
    const it = built.items[j];
    if (it) it.initSpec = it.spec;
  }
  // Keep an in-flight KUFRIK demonstration alive across a death-restart (the new
  // Script reset s.showmode to false; the persistent replay state survived).
  if (showmode) s.showmode = true;
  setActiveScript({ def: def ?? NOOP_SCRIPT, s });
  if (built.padani()) eng.phase = 'fall';
  else {
    built.clearAllDirs();
    eng.phase = 'idle';
  }
  armChatter(store.solved.has(roomNum));
  setDeathState(newDeathState());
  setRoomDepth(depthOfRoom(roomNum));
  setInfo();
}

// ── Fish selection (main.ts `peekAtPlayer`, `swapActive`, `selectFish`) ────────────────

// restates src/app/main.ts `function peekAtPlayer(` @ c17cfe7989ba
function peekAtPlayer(which: Which): void {
  if (!engine || inShowmode() || loadmode) return;
  engine.startKuk(which);
}

// restates src/app/main.ts `function swapActive(` @ 60c1695cea31
function swapActive(): boolean {
  if (!room || !engine || ui.screen !== 'room') return false;
  const other = engine.active === 'little' ? 'big' : 'little';
  if (!room.alive[other]) return false;
  engine.active = other;
  engine.swim = null;
  peekAtPlayer(other);
  setInfo();
  return true;
}

// restates src/app/main.ts `function selectFish(` @ d43eed8c096b
function selectFish(which: Which): void {
  if (!room || !engine || ui.screen !== 'room' || !room.alive[which]) return;
  if (fishBusy(which)) return;
  engine.active = which;
  engine.swim = null;
  peekAtPlayer(which);
  setInfo();
}

// ── Save slots and the win (main.ts `saveGame`, `loadGame`, `onWinBookkeeping`) ──────

// restates src/app/main.ts `const saveKey = (` @ d8549da01f3c
const saveKey = (): string => `ff.save.${roomNum}`;

// restates src/app/main.ts `function canSave(` @ e3221a0959aa
export function canSave(): boolean {
  return !!room && room.canSave;
}

// restates src/app/main.ts `function saveExists(` @ 1d71d939694c
export function saveExists(): boolean {
  try {
    return localStorage.getItem(saveKey()) !== null;
  } catch {
    return false;
  }
}

/**
 * The move record, the script state and the undo history; the history yields if it must.
 * restates src/app/main.ts `function saveGame(` @ c66c3dea8c42
 */
export function saveGame(): void {
  if (!canSave()) return;
  const snapshot = activeScript?.s.snapshot() ?? null;
  const rec = engine?.srecord ?? '';
  try {
    localStorage.setItem(saveKey(), JSON.stringify({ rec, vars: snapshot, undo: undoHistoryForSave() }));
  } catch {
    try {
      localStorage.setItem(saveKey(), JSON.stringify({ rec, vars: snapshot }));
    } catch {
      /* storage unavailable */
    }
  }
  setInfo();
}

/**
 * Load and re-simulate the saved record (animated, as the player's F3 is).
 * restates src/app/main.ts `function loadGame(` @ b660c12a48c6
 */
export function loadGame(): void {
  if (!saveExists()) return;
  const raw = localStorage.getItem(saveKey());
  if (raw === null) return;
  let rec = raw;
  let snapshot: ScriptSnapshot | null = null;
  let undoData: unknown = null;
  try {
    const parsed = JSON.parse(raw) as { rec?: string; vars?: ScriptSnapshot | null; undo?: unknown };
    if (parsed && typeof parsed === 'object' && typeof parsed.rec === 'string') {
      rec = parsed.rec;
      snapshot = parsed.vars ?? null;
      undoData = parsed.undo ?? null;
    }
  } catch {
    /* legacy plain-string save (just the move record) */
  }
  loadUndoHistory(undoData);
  restore(rec, snapshot, false, true, true);
}

// restates src/app/main.ts `function onWinBookkeeping(` @ 1c135eaa688c
function onWinBookkeeping(): void {
  if (!store.solved.has(roomNum)) {
    store.solved.add(roomNum);
    store.saveSolved();
  }
  const rec = engine?.srecord ?? '';
  store.recordScore(roomNum, lengthOfRecord(rec));
  store.recordBest(roomNum, rec, lengthOfRecord(rec));
  setInfo();
}

// ── Where the game goes next ───────────────────────────────────────────────────────

/**
 * The room after `cur`, with no map to choose from:
 *
 * - the first room the map would offer (reachable and not yet solved, by the map's own
 *   unlock rule, `computeResena`) numbered above `cur`, else the lowest-numbered one. Rooms
 *   are numbered leg by leg, so within a leg this is simply the next room;
 * - with every registered room solved, the finale, ZAVER — once: a game whose ZAVER is
 *   solved too is a finished game being replayed, and goes on to the next registered room
 *   by number, wrapping to room 1 (so a new session of a finished game starts in room 1,
 *   rather than replaying the finale every time);
 * - after ZAVER itself, nothing: null, and the session ends.
 *
 * `cur` 0 asks where a session starts.
 * restates src/app/mapNav.ts `export function returnFromRoom(` @ 346eda134c13
 */
export function nextRoom(cur: number, solved: ReadonlySet<number>, cheated: ReadonlySet<number> = new Set()): number | null {
  if (cur === ZAVER_ROOM) return null;
  const done = (n: number): boolean => solved.has(n) || cheated.has(n);
  if (REGISTERED_ROOMS.every(done)) {
    if (!done(ZAVER_ROOM)) return ZAVER_ROOM;
    return REGISTERED_ROOMS.find((n) => n > cur) ?? REGISTERED_ROOMS[0] ?? null;
  }
  const resena = computeResena(solved, cheated);
  const open: number[] = [];
  BRANCHES.forEach((b, i) => {
    for (let j = 0; j < b.length; j++) if (resena[i]?.[j] === RES_REACHABLE) open.push(b.start + j);
  });
  open.sort((a, b) => a - b);
  return open.find((n) => n > cur) ?? open[0] ?? null;
}

/** Where a room is left to: `mapNav`'s two exits, handed over by its seam. */
function leaveRoom(why: LeaveReason): void {
  if (opts.onLeave || opts.demo) {
    const left = roomNum;
    store.stopRoomClock();
    ui.screen = 'map'; // no room on screen: `step` and the undo sampler stand down
    clearHeldKey();
    endShowmode();
    if (opts.onLeave) {
      opts.onLeave(left, why);
      return;
    }
    const next = nextRoom(left, store.solved, store.cheated);
    if (next === null) {
      console.log(left === ZAVER_ROOM ? 'The end.' : 'No room left to play.');
      __native.quit();
      return;
    }
    void enterRoom(next);
    return;
  }
  if (why === 'won') afterWin();
  else showMap();
}

/**
 * Show the world map, tearing the room down as the browser does — KillSnd, then the menu
 * music — minus the store review, which the native host has not got.
 * restates src/app/mapNav.ts `export function showMap(` @ 5407b541588e
 */
export function showMap(): void {
  store.stopRoomClock(); // bank this visit's play time before the room goes away
  ui.screen = 'map';
  clearHeldKey(); // drop any held movement key when leaving the room
  endShowmode(); // leaving the room ends any KUFRIK demonstration
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  ui.mapRevealStart = performance.now(); // restart the reveal animation (Depth := -3)
  audio.killAll(); // KillSnd: stop room music + every voice/effect
  activeScript?.s.clearDialog(); // zrus_dialogy: drop the pending speech queue
  subs?.clear(); // ZrusTitulky: clear any on-screen subtitle
  poslMluv.little = -1;
  poslMluv.big = -1;
  startMenuMusic();
  mapArrived();
}

/** chybi=0 (USoutez.pas:729): every registered room genuinely solved. */
// restates src/app/mapNav.ts `export function allRegisteredSolved(` @ c8fc8d640d91
function allRegisteredSolved(): boolean {
  return REGISTERED_ROOMS.every((r) => store.solved.has(r));
}

/**
 * Back to the map after a win: through the leg's story page when the room ends a leg, into
 * ZAVER when that win finishes the game, and to the map through the closing page after
 * ZAVER itself. The reasons for each are on the original.
 * restates src/app/mapNav.ts `export function returnFromRoom(` @ 346eda134c13
 */
function afterWin(): void {
  const finale = REGISTERED_ROOMS.includes(roomNum) && depthOfRoom(roomNum) === 15 && allRegisteredSolved();
  if (store.solved.has(roomNum) && depthOfRoom(roomNum) === 15) {
    const leg = branchOfRoom(roomNum);
    if (leg >= 1 && leg <= 8) {
      void showLegImage(leg, finale ? { room: ZAVER_ROOM } : undefined);
      return;
    }
  }
  if (finale) {
    void enterRoom(ZAVER_ROOM);
    return;
  }
  if (roomNum === ZAVER_ROOM) {
    void showLegImage(ZAVER_LEG); // no `pending` ⇒ dismisses to the map
    return;
  }
  showMap();
}

/** What dismissing the story page on screen does: enter the room it deferred, or the map. */
let legPending: { room: number; replay?: string | undefined } | null = null;

/**
 * zobraz_obrazek (UMain.pas:831): a leg's story page, the AI-upscaled one. A page that
 * cannot be shown completes the transition without it, as the browser's does.
 * restates src/app/mapNav.ts `export async function showLegImage(` @ 376a76f28cb9
 */
export async function showLegImage(leg: number, pending?: { room: number; replay?: string | undefined }): Promise<void> {
  if (!(await openLegPage(leg))) {
    if (pending) void enterRoom(pending.room, pending.replay);
    else showMap();
    return;
  }
  legPending = pending ?? null;
  clearHeldKey();
  endShowmode();
  if (engine) {
    engine.swim = null;
    engine.winCountdown = 0;
  }
  activeScript?.s.clearDialog(); // zrus_dialogy
  subs?.clear(); // ZrusTitulky
  audio.killAll(); // Killsnd
  void audio.playMusic('rybky11', musicUrl('rybky11'), 0); // Music('rybky11')
}

/**
 * zrus_obrazek (UMain.pas:847): any button on the story page.
 * restates src/app/mapNav.ts `export function dismissLegImage(` @ 241d9e41502a
 */
export function dismissLegImage(): void {
  closeLegPage();
  const pending = legPending;
  legPending = null;
  if (pending) void enterRoom(pending.room, pending.replay);
  else showMap();
}

/**
 * `main.ts`'s `startRoom`, for the native host: the stage is the room's at once — the map's
 * parchment frame stays in the window until the room's first frame replaces it
 * (`mapScreen.ts`) — and `loadRoom` does the rest exactly as it does there, with a `replay`
 * record armed once the room is built (the map's Replay).
 * restates src/app/main.ts `function startRoom(` @ 90ab370483c0
 */
export async function enterRoom(num: number, replay?: string): Promise<void> {
  await globalSounds; // the browser's boot has these before its first room
  store.stopRoomClock();
  ui.screen = 'room';
  store.startRoomClock(num);
  ui.mapHoverCorner = null;
  ui.mapHoverRoom = null;
  audio.killAll(); // stop the menu music + anything before the room starts its own
  roomNum = num;
  const p = loadRoom(num);
  if (replay) {
    // movesOf: this replay drives the real game loop (tryStep), as the browser's does.
    const moves = movesOf(replay);
    void p.then(() => {
      if (moves.length) setReplaymode({ moves, idx: 0 });
    });
  }
  await p;
  if (opts.demo && !replay) armDemo();
}

/**
 * Rooms whose recorded solution cannot be played as a live run, and is played as the map's
 * Replay of it instead (`--demo` and the smoke gate): the same moves through the same
 * `tryStep`, with what a Replay holds back held back.
 *
 * KUFRIK: its solution walks both fish through the tutorial spot, and a live run that does
 * starts the demonstration — which restarts the room and replays help.cap, so the rest of the
 * solution no longer fits it. The browser's dev solve ends there too (`startShowmode` ends any
 * solution playback). A Replay plays neither the demonstration nor the briefcase story.
 */
export const PLAYED_AS_REPLAY: ReadonlySet<string> = new Set(['KUFRIK']);

/** A room's recorded solution as a move record: what a win stores and the map's Replay plays. */
export function solutionRecord(jmeno: string): string {
  const sol = solutionFor(jmeno);
  if (sol.known !== 'ok') throw new Error(`${jmeno} has no recorded solution`);
  return decodeMoves(sol.moves).map((m) => moveChar(m.which, m.dir) ?? '').join('');
}

function armDemo(): void {
  const jmeno = ROOMS[roomNum - 1]?.jmeno ?? '';
  if (PLAYED_AS_REPLAY.has(jmeno)) {
    const moves = movesOf(solutionRecord(jmeno));
    if (moves.length) setReplaymode({ moves, idx: 0 });
    return;
  }
  const armed = armSolve(jmeno);
  if ('error' in armed) console.log(`#${roomNum} ${jmeno}: ${armed.detail} — play it yourself`);
  else setSolvemode(armed);
}

// ── Boot ───────────────────────────────────────────────────────────────────────────

/**
 * Wire the flow modules to this host and open the save store. `openSaveStore()` runs the
 * save migration, so it comes before anything reads an `ff.*` key — as in `main.ts`.
 */
export function initGame(o: GameOptions): ReturnType<typeof openSaveStore> {
  opts = o;
  loadStore(); // first, and loudly: persist.ts would swallow an unreadable store
  store = openSaveStore();
  initNativeSettings(__native.locale());
  initSound(); // reads the persisted volumes, so after the save migration
  globalSounds = loadGlobalSounds();
  // Fatal, as on the browser's boot path: a room entry waits on this, so a failure left
  // pending would turn every later launch from the map into a silent no-op.
  globalSounds.catch((e: unknown) => {
    console.error('fatal: the global sound packages did not load:', e);
    __native.quit(1);
  });
  ui.screen = 'map';
  initMovement({ buildRoom, endShowmode, hracNespi, setInfo });
  initRoomLoad({ buildRoom, endShowmode, ffrUrl, solved: store.solved });
  initLogicTick({ buildRoom, casHry: store.casHry, hooks, updateLipSync });
  initCutscene({ buildRoom, hracNespi, selectFish, swapActive, disposeAiKufr: disposeKufrArt });
  onLeaveRoom(leaveRoom);
  initIntroScreen({ showMap });
  initMapScreen({
    solved: store.solved,
    cheated: store.cheated,
    scores: store.scores,
    bestRecord: store.bestRecord,
    enterRoom: (room, replay) => void enterRoom(room, replay),
    showLegImage: (leg, pending) => void showLegImage(leg, pending),
    dismissLegImage,
    lastRoom: () => roomNum,
    openCorner: (action) => opts.openCorner?.(action),
  });
  return store;
}

/** The global sound packages' load, started by `initGame`; a room entry waits for it. */
let globalSounds: Promise<void> = Promise.resolve();

/** The room a `--demo` session starts in: where the player left off. */
/**
 * Another device's progress arrived (iCloud's change notification, the host's `!kvs`): merge
 * it into the store (`TvStore.pullRemote`) and into the running game's own sets and maps, in
 * place — the map reads these very objects, so a room solved on another Apple TV shows at the
 * next frame. Only ever adds: the merge keeps the best of both. Returns the keys that changed.
 */
export function adoptRemoteProgress(): string[] {
  const changed = pullRemoteProgress();
  const read = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? 'null');
  for (const key of changed) {
    const v = read(key);
    if (key === 'ff.solved' || key === 'ff.cheated') {
      for (const n of v as number[]) (key === 'ff.solved' ? store.solved : store.cheated).add(n);
    } else {
      const into = key === 'ff.scores' ? store.scores : key === 'ff.best' ? store.bestRecords : store.playTime;
      for (const [k, x] of Object.entries(v as Record<string, number | string>)) (into as Map<number, typeof x>).set(Number(k), x);
    }
  }
  return changed;
}

export function firstRoom(): number {
  return nextRoom(0, store.solved, store.cheated) ?? 1;
}

/**
 * Is a room on screen, built, with its art and its sound, and so ready to tick and draw? The
 * browser does not hand a room the stage until it can be heard as well as seen either.
 */
export function roomReady(): boolean {
  return ui.screen === 'room' && !roomLoading && aiRoomReady() && !roomEntryHeld() && room !== null && engine !== null;
}

// ── Input (the room part of main.ts's keydown/keyup router) ─────────────────────────

/**
 * A key down while a room is up (the map's are `mapScreen.ts`'s). Escape — the gamepad's Ⓑ —
 * goes back to the map, as the browser's does; while KUFRIK's briefcase story plays it skips
 * the story instead, and every other key is swallowed.
 * restates src/app/main.ts `window.addEventListener('keydown',` @ 6ff168e62d28
 */
export function keyDown(code: string): void {
  // While the briefcase story plays, input is swallowed; Escape skips it (zrus_kufr).
  if (cutscene) {
    if (code === 'Escape') skipCutscene();
    return;
  }
  if (code === 'Escape') {
    cancelSolve(); // always an escape hatch: an auto-play the player cannot stop is a trap
    if (ui.screen === 'room') showMap();
    return;
  }
  if (ui.screen !== 'room') return;
  hracNespi(); // TRoom.FormKeyDown's first statement (URoom.pas:26787)
  if (code === 'Backspace') {
    restartRoom();
    return;
  }
  if (code === 'F2') {
    if (atRest() && !inAutoPlay() && canSave()) saveGame();
    return;
  }
  if (code === 'F3') {
    if (atRest() && !inAutoPlay() && saveExists()) loadGame();
    return;
  }
  if (code === 'Minus' || code === 'NumpadSubtract') {
    undoMove();
    return;
  }
  if (activeScript?.s.natvrdo === 1) return; // possessed by ZELVA
  if (activeScript?.s.zavermode) return; // ZAVER finale
  if (inShowmode() || inAutoPlay() || loadmode) return;
  if (code === 'Space' || code === 'Tab') {
    swapActive();
    return;
  }
  if (code === 'Digit1' || code === 'Digit2') {
    selectFish(code === 'Digit1' ? 'little' : 'big');
    return;
  }
  const arrow = ARROWS[code];
  if (arrow !== undefined) {
    beginHeldMove(code, true, engine?.active ?? 'little', arrow);
    return;
  }
  const map = KEYS[code];
  if (map) beginHeldMove(code, false, map.which, map.dir);
  return;
}

// restates src/app/main.ts `window.addEventListener('keyup',` @ 0b500e289a81
export function keyUp(code: string): void {
  releaseHeldKey(code);
}

/**
 * The window lost focus, so a held key's keyup will never arrive: drop it (main.ts's blur).
 * restates src/app/main.ts `window.addEventListener('blur',` @ 273b73a2b08d
 */
export function blur(): void {
  clearHeldKey();
}

// ── The frame (renderLoop.ts `loop`, the logic half; framePainter.ts, the AI draw) ─────

let acc = 0;
/** A menu is over the room (`menus.ts`): no step runs, and the frame holds its alpha. */
let paused = false;
let lastAlpha = 0;

/** Pause or resume the room for a menu. Pausing lets go of held keys: their keyups go to the menu. */
export function setPaused(on: boolean): void {
  if (on && !paused) clearHeldKey();
  // Resume where the frame stood, so a sliding fish does not jump back to the tick's start —
  // and not with the time the menu was up.
  if (!on && paused) acc = lastAlpha * LOGIC_MS;
  paused = on;
}

export function isPaused(): boolean {
  return paused;
}

/**
 * Advance the game by the wall-clock time since the last frame: at most one 80 ms step,
 * dropping a backlog rather than fast-forwarding (`MAX_STEPS_PER_FRAME`, renderLoop.ts);
 * paused while the room is loading or its art has not landed. Returns the sub-tick alpha.
 * restates src/app/renderLoop.ts `export function loop(` @ 93dcdefa23f9
 */
export function advance(dt: number): number {
  soundTime(dt);
  acc += dt;
  if (acc > LOGIC_MS * 2) acc = LOGIC_MS;
  if (!roomReady()) return 0;
  if (paused) {
    acc = lastAlpha * LOGIC_MS;
    return lastAlpha;
  }
  if (acc >= LOGIC_MS) {
    acc -= LOGIC_MS;
    if (step()) acc = 0;
    else if (replaySettleDue() && step()) acc = 0;
  }
  return (lastAlpha = Math.min(acc / LOGIC_MS, 1));
}

/** Composite the current room into `target`; false when there is nothing to draw yet. */
export function draw(target: NativeAiScreen, alpha: number): boolean {
  if (!roomReady() || !aiRoom || !room) return false;
  target.begin(aiRoom.nativeWidth * aiRoom.scale, aiRoom.nativeHeight * aiRoom.scale, aiRoom.scale);
  aiRoom.drawInto(target, room, aiFrame(alpha));
  return true;
}

/** The room being played, for the smoke gate. */
export function currentRoom(): number {
  return roomNum;
}
