/**
 * The native game: the composition root that `src/app/main.ts` is for the browser, minus
 * everything that is the browser's (the DOM, audio, the map, the menus, the panel).
 *
 * What runs here is the game's own flow, unmodified: `roomLoad` enters a room,
 * `logicTick.step` is one 80 ms game step, `movement`'s held-key state machine turns keys
 * into moves, `undo` takes them back, `persist` keeps progress. Their DOM-bound imports are
 * swapped for native/js/seams/ at bundle time (native/build-js.mjs). What is restated here
 * is what `main.ts` owns and does not export — building a room, the save slots, the win
 * bookkeeping, the room part of the keyboard router, the frame loop's step — each marked
 * with where it comes from, and kept to what the native host can use.
 *
 * With no map, a solved room leads to the next one (`nextRoom`).
 */
import { Room } from '../../src/core/room.js';
import { Script } from '../../src/core/script.js';
import type { ScriptSnapshot } from '../../src/core/script.js';
import { StepEngine } from '../../src/core/stepEngine.js';
import { HookSystem } from '../../src/core/hooks.js';
import { newDeathState } from '../../src/core/deathlines.js';
import { lengthOfRecord } from '../../src/core/record.js';
import { roomScript } from '../../src/rooms/index.js';
import { ROOMS } from '../../src/data/roomTable.js';
import { BRANCHES, RES_REACHABLE, REGISTERED_ROOMS, ZAVER_ROOM, computeResena, depthOfRoom } from '../../src/data/world.js';
import {
  activeScript, engine, ffr, hracNespi, loadmode, pokus, poslMluv, prevKostra, room, clearUndoHistory, setActiveScript,
  setCount, setDeathState, setEngine, setLoadmode, setRoom, setRoomDepth, setScreenShoveX, setSubs, talkIdx,
} from '../../src/app/gameState.js';
import { initQuiet } from '../../src/app/initQuiet.js';
import { MLUVI_PRIOR, KEYS, ARROWS, NOOP_SCRIPT } from '../../src/app/keyTables.js';
import { armChatter, initLogicTick, step } from '../../src/app/logicTick.js';
import { beginHeldMove, clearHeldKey, initMovement, releaseHeldKey, restartRoom, restore, wallShove } from '../../src/app/movement.js';
import { openSaveStore } from '../../src/app/persist.js';
import { replaySettleDue } from '../../src/app/replayMode.js';
import { initRoomLoad, loadRoom } from '../../src/app/roomLoad.js';
import { atRest, fishBusy } from '../../src/app/roomGates.js';
import { ui } from '../../src/app/screenState.js';
import { armSolve, inAutoPlay, setSolvemode, cancelSolve } from '../../src/app/solveMode.js';
import { loadUndoHistory, undoAvailable, undoHistoryForSave, undoMove } from '../../src/app/undo.js';
import { aiRoom, aiRoomReady } from './seams/art.js';
import { audio } from './seams/audioEngine.js';
import { endShowmode, inShowmode } from './seams/cutscene.js';
import { roomLoading } from './seams/framePacing.js';
import { onLeaveRoom, returnFromRoom } from './seams/mapNav.js';
import { DEFAULT_LINE_TICKS, LOGIC_MS } from './seams/stageGeometry.js';
import { aiFrame } from './frame.js';
import type { NativeAiScreen } from './nativeAiScreen.js';

export type Which = 'little' | 'big';

/** How the game leaves a room — `mapNav`'s two exits, handed over by the seam. */
export type LeaveReason = 'won' | 'replayEnded';

export interface GameOptions {
  /** Print the info line whenever it changes (`main.ts`'s `setInfo`, to the console). */
  readonly verbose: boolean;
  /** Arm a solution replay (`solvemode`) on every room entry: the game plays itself. */
  readonly demo: boolean;
  /** Called when a room is left; the default goes to `nextRoom`. */
  readonly onLeave?: (num: number, why: LeaveReason) => void;
}

/** The game's state that `main.ts` keeps at module scope. One native session = one game. */
let opts: GameOptions = { verbose: false, demo: false };
let store!: ReturnType<typeof openSaveStore>;
/** The room being played — `main.ts`'s `select.value`. */
let roomNum = 0;

/**
 * The fishing hooks (Hacky). Only the `ultraviolence` cheat ever adds one, and the native
 * host has no way to type a cheat, so `killByHook` is unreachable here.
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
 * dialogy's talk hook. With no audio there is no voice to time a line by, so every line is
 * the browser's fallback length for a line without audio (`DEFAULT_LINE_TICKS`).
 */
function talk(_name: string, _prior: number): number {
  return DEFAULT_LINE_TICKS;
}

/**
 * `main.ts`'s `buildRoom`, minus what the native host does not have: audio (the restart's
 * KillExcept and the sound hooks), the cheats (sprite, water, silent film, hooks), the
 * subtitles, the store review and KUFRIK's demonstration and briefcase cutscene (their
 * script callbacks stay unset). Everything that decides how the room PLAYS is here, in
 * the same order.
 */
function buildRoom(carryPole = false, carried: readonly number[] = []): void {
  if (!ffr) return;
  clearHeldKey();
  const savedPole = carryPole && activeScript ? [...activeScript.s.roompole] : null;
  const built = new Room(ffr);
  setRoom(built);
  setLoadmode(null);
  hooks.clear();
  if (!carryPole) clearUndoHistory();
  setScreenShoveX(0);
  setCount(0);
  setSubs(null);
  talkIdx.little = 0;
  talkIdx.big = 0;
  poslMluv.little = -1;
  poslMluv.big = -1;
  prevKostra.little = false;
  prevKostra.big = false;
  const def = roomScript(ROOMS[roomNum - 1]?.jmeno ?? '');
  let initializing = true; // until `init` returns: see initQuiet
  const s = new Script(built, talk, (prior) => audio.playing(prior), initQuiet(carried, () => initializing, {}), (prior) => audio.talking(prior));
  s.pokus = pokus;
  if (savedPole) for (let i = 0; i < s.roompole.length; i++) s.roompole[i] = savedPole[i] ?? 0;
  const eng = new StepEngine(built, s, def ?? NOOP_SCRIPT, {
    random: (n) => Math.floor(Math.random() * n),
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

function peekAtPlayer(which: Which): void {
  if (!engine || inShowmode() || loadmode) return;
  engine.startKuk(which);
}

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

function selectFish(which: Which): void {
  if (!room || !engine || ui.screen !== 'room' || !room.alive[which]) return;
  if (fishBusy(which)) return;
  engine.active = which;
  engine.swim = null;
  peekAtPlayer(which);
  setInfo();
}

// ── Save slots and the win (main.ts `saveGame`, `loadGame`, `onWinBookkeeping`) ──────

const saveKey = (): string => `ff.save.${roomNum}`;

export function canSave(): boolean {
  return !!room && room.canSave;
}

export function saveExists(): boolean {
  try {
    return localStorage.getItem(saveKey()) !== null;
  } catch {
    return false;
  }
}

/** The move record, the script state and the undo history; the history yields if it must. */
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

/** Load and re-simulate the saved record (animated, as the player's F3 is). */
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
 * The room after `cur`, with no map to choose from: the first room the map would offer
 * (reachable and not yet solved, by the map's own unlock rule, `computeResena`) numbered
 * above `cur`, else the lowest-numbered one. Rooms are numbered leg by leg, so within a leg
 * this is simply the next room. With every registered room solved it is the finale, ZAVER,
 * and after ZAVER there is nothing: null.
 */
export function nextRoom(cur: number, solved: ReadonlySet<number>, cheated: ReadonlySet<number> = new Set()): number | null {
  if (cur === ZAVER_ROOM) return null;
  if (REGISTERED_ROOMS.every((r) => solved.has(r) || cheated.has(r))) return ZAVER_ROOM;
  const resena = computeResena(solved, cheated);
  const open: number[] = [];
  BRANCHES.forEach((b, i) => {
    for (let j = 0; j < b.length; j++) if (resena[i]?.[j] === RES_REACHABLE) open.push(b.start + j);
  });
  open.sort((a, b) => a - b);
  return open.find((n) => n > cur) ?? open[0] ?? null;
}

function leaveRoom(why: LeaveReason): void {
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
    console.log(left === ZAVER_ROOM ? 'The end. Every room is solved.' : 'No room left to play.');
    __native.quit();
    return;
  }
  void enterRoom(next);
}

/**
 * `main.ts`'s `startRoom`, for the native host: there is no map to launch from, so the
 * stage is the room's at once, and `loadRoom` does the rest exactly as it does there.
 */
export async function enterRoom(num: number): Promise<void> {
  store.stopRoomClock();
  ui.screen = 'room';
  store.startRoomClock(num);
  roomNum = num;
  await loadRoom(num);
  if (opts.demo) armDemo();
}

function armDemo(): void {
  const jmeno = ROOMS[roomNum - 1]?.jmeno ?? '';
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
  store = openSaveStore();
  ui.screen = 'map';
  initMovement({ buildRoom, endShowmode, hracNespi, setInfo });
  initRoomLoad({ buildRoom, endShowmode, ffrUrl, solved: store.solved });
  initLogicTick({ buildRoom, casHry: store.casHry, hooks, updateLipSync: () => {} });
  onLeaveRoom(leaveRoom);
  return store;
}

/** The room a new session starts in: where the player left off. */
export function firstRoom(): number {
  return nextRoom(0, store.solved, store.cheated) ?? 1;
}

/** Is a room on screen, built, with its art, and so ready to tick and draw? */
export function roomReady(): boolean {
  return ui.screen === 'room' && !roomLoading && aiRoomReady() && room !== null && engine !== null;
}

// ── Input (the room part of main.ts's keydown/keyup router) ─────────────────────────

/** Returns false when the key asks the session to end (Escape: there is no map to go back to). */
export function keyDown(code: string): boolean {
  if (code === 'Escape') {
    cancelSolve();
    return false;
  }
  if (ui.screen !== 'room') return true;
  hracNespi(); // TRoom.FormKeyDown's first statement (URoom.pas:26787)
  if (code === 'Backspace') {
    restartRoom();
    return true;
  }
  if (code === 'F2') {
    if (atRest() && !inAutoPlay() && canSave()) saveGame();
    return true;
  }
  if (code === 'F3') {
    if (atRest() && !inAutoPlay() && saveExists()) loadGame();
    return true;
  }
  if (code === 'Minus' || code === 'NumpadSubtract') {
    undoMove();
    return true;
  }
  if (activeScript?.s.natvrdo === 1) return true; // possessed by ZELVA
  if (activeScript?.s.zavermode) return true; // ZAVER finale
  if (inShowmode() || inAutoPlay() || loadmode) return true;
  if (code === 'Space' || code === 'Tab') {
    swapActive();
    return true;
  }
  if (code === 'Digit1' || code === 'Digit2') {
    selectFish(code === 'Digit1' ? 'little' : 'big');
    return true;
  }
  const arrow = ARROWS[code];
  if (arrow !== undefined) {
    beginHeldMove(code, true, engine?.active ?? 'little', arrow);
    return true;
  }
  const map = KEYS[code];
  if (map) beginHeldMove(code, false, map.which, map.dir);
  return true;
}

export function keyUp(code: string): void {
  releaseHeldKey(code);
}

/** The window lost focus, so a held key's keyup will never arrive: drop it (main.ts's blur). */
export function blur(): void {
  clearHeldKey();
}

// ── The frame (renderLoop.ts `loop`, the logic half; framePainter.ts, the AI draw) ─────

let acc = 0;

/**
 * Advance the game by the wall-clock time since the last frame: at most one 80 ms step,
 * dropping a backlog rather than fast-forwarding (`MAX_STEPS_PER_FRAME`, renderLoop.ts);
 * paused while the room is loading or its art has not landed. Returns the sub-tick alpha.
 */
export function advance(dt: number): number {
  acc += dt;
  if (acc > LOGIC_MS * 2) acc = LOGIC_MS;
  if (!roomReady()) return 0;
  if (acc >= LOGIC_MS) {
    acc -= LOGIC_MS;
    if (step()) acc = 0;
    else if (replaySettleDue() && step()) acc = 0;
  }
  return Math.min(acc / LOGIC_MS, 1);
}

/** Composite the current room into `target`; false when there is nothing to draw yet. */
export function draw(target: NativeAiScreen, alpha: number): boolean {
  if (!roomReady() || !aiRoom || !room) return false;
  target.begin(aiRoom.nativeWidth * aiRoom.scale, aiRoom.nativeHeight * aiRoom.scale);
  aiRoom.drawInto(target, room, aiFrame(alpha));
  return true;
}

/** The room being played, for the smoke gate. */
export function currentRoom(): number {
  return roomNum;
}
