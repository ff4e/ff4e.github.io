/**
 * How a keypress becomes a game step, and how a saved record is replayed back into a room.
 *
 * Two things that look separate and are not: the held-key state machine mirrors the
 * original's `KeyRoom` (one key tracked at a time, the ENGINE driving auto-repeat rather
 * than the OS), and `restore`/`advanceLoadmode` drive the same `tryStep` path from a
 * record instead of from the keyboard. Both end in one engine press, which is why they
 * share a file.
 */
import { wake } from './frameClock.js';
import { activeScript, cutscene, engine, loadmode, pokus, room, screenShoveX, setLoadmode, setPokus, setScreenShoveX } from './gameState.js';
import { fishBusy } from './roomGates.js';
import { ui } from './screenState.js';
import { Dir } from '../core/dir.js';
import { stepsOf } from '../core/record.js';
import type { RecordStep } from '../core/record.js';
import { ITEM_WALL } from '../core/room.js';
import type { ScriptSnapshot } from '../core/script.js';

/**
 * The four names this module needs from `main.ts`.
 */
export interface MovementHost {
  /** Rebuild the room; `carryPole` keeps the room-scoped cheats (the RESTART flavour). */
  readonly buildRoom: (carryPole?: boolean) => void;
  /** Ends any running KUFRIK demonstration. */
  readonly endShowmode: () => void;
  /** The player is awake: reset the idle timers (delay[]) and the ambient-chatter clock. */
  readonly hracNespi: () => void;
  /** Refresh the info line under the room. */
  readonly setInfo: () => void;
}

let host!: MovementHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initMovement(h: MovementHost): void {
  host = h;
}

/** Turn-first-then-move; horizontal turns animate (stav_otocka), moves slide. */
export function tryStep(which: 'little' | 'big', dir: number): 'moving' | 'turning' | 'blocked' | 'busy' {
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

/**
 * The `KeyRoom` state itself, for the debug surface. A function rather than an exported
 * binding because it is only ever read from outside, and every write must stay in here.
 */
export function heldKeyState(): number {
  return heldState;
}

/**
 * FormKeyUp (Uovl.pas:1006): 1→3 (guarantee one dispatch for a tap), otherwise →0.
 * Ignores a keyup for anything other than the key currently held.
 */
export function releaseHeldKey(code: string): void {
  if (code !== heldKey) return;
  if (heldState === 1) heldState = 3;
  else clearHeldKey();
}

export function clearHeldKey(): void {
  heldKey = null;
  heldState = 0;
  heldDir = Dir.no;
}

/** FormKeyDown (Uovl.pas:990): record a held movement key. OS auto-repeat and any second
 *  key are absorbed while one is already held, so the engine (not the OS) drives repeat. */
export function beginHeldMove(code: string, sys: boolean, which: 'little' | 'big', dir: number): void {
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
 *  press; the state still advances if the move is dropped, so it retries next tick.
 *
 *  No `hracNespi()` here, deliberately. DalsiPrikaz's `hrac_nespi` (URoom.pas:26985) sits
 *  in its SHOWMODE branch — it is how a REPLAYED command counts as activity, which is why
 *  the port's replay paths call it (`cutscene.ts`, `test/solutionsHarness.ts`) and this
 *  one does not. A live command was already counted when the key went down
 *  (FormKeyDown, :26787). Resetting again on every engine-driven repeat tick would be a
 *  stronger reset than the original's, which only refreshes on the OS's own key repeat. */
export function dispatchHeldMove(): void {
  if (heldState === 0 || !engine || !room) return;
  const which = heldSys ? engine.active : heldWhich;
  const release = heldState === 3;
  heldState = release ? 0 : 2;
  if (release) heldKey = null;
  if (fishBusy(which)) return; // dropped while the fish is talking (kdo:=0)
  engine.swim = null;
  engine.active = which;
  tryStep(which, heldDir);
  host.setInfo();
}

/**
 * KAJUTA1 screen-shove (URoom.pas:24727-24761): a blocked big-fish left/right push
 * against a wall, while gspec is 3 or 4, slides the view and arms gspec:=4. Wired as
 * the engine's onBlockedMove hook so a rejected push still shoves the screen.
 */
export function wallShove(which: 'little' | 'big', dir: number): void {
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
    setScreenShoveX(Math.max(-20, Math.min(20, screenShoveX + delta)));
  }
}

/**
 * Apply one recorded move to `room` instantly (no animation), via the shared engine.
 * Used to re-simulate for undo/load. Returns false if the move was blocked.
 */
export function applyMoveInstant(which: 'little' | 'big', dir: number): boolean {
  return engine ? engine.applyMoveInstant(which, dir) : false;
}

/**
 * Apply one recorded step of a move-only re-simulation (load / undo). The step itself
 * belongs to the engine — it owns both the physics and the record — so this is only the
 * host's null-safe way in.
 */
export function applyRecordStep(st: RecordStep): void {
  engine?.applyRecordStep(st);
}

/**
 * Rebuild the room and replay a move record (load / undo). When `animated` (the
 * player F3 and the demo's reload), the replay is fast-forwarded over several ticks
 * at LoadSpeed moves/tick (TRoom.Load loadmode, URoom.pas:24102) so the fish visibly
 * rewind to spawn and race back to the saved position; otherwise it is applied
 * instantly (used by deterministic tests).
 */
export function restore(
  rec: string,
  snapshot: ScriptSnapshot | null = null,
  preserveShowmode = false,
  animated = false,
): void {
  if (!preserveShowmode) host.endShowmode(); // loading a saved game ends any KUFRIK demonstration
  setLoadmode(null);
  // Rebuild with carryPole, i.e. the RESTART flavour: TRoom.Load runs InitItems +
  // InitProgramky (URoom.pas:1905-1948), never TRoom.Init, so loading a save must
  // not clear the room-scoped cheats (or roompole) the way a room change does.
  host.buildRoom(true); // fresh room (resets srecord); may leave pending fall dirs
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
    setLoadmode({ steps, idx: 0, speed, snapshot });
    host.setInfo();
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
  host.setInfo();
}

/**
 * Advance a fast-forward load (loadmode): apply up to `speed` recorded moves this
 * tick; on completion re-apply the saved script snapshot and settle. Mirrors the
 * per-Timer1Timer `while kolo<LoadSpeed` replay in URoom.pas:24135.
 */
export function advanceLoadmode(): void {
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
    setLoadmode(null);
    // The original's loadmode branch ends `LoadDone; kdo:=0; ...; hrac_nespi`
    // (URoom.pas:24111). What that reset is FOR here is the ambient-chatter clock
    // (casposlzmeny), not the fish idle timers: `logicTick` returns at the loadmode branch
    // before it ever reaches `runScript`, so `delay[]` is frozen for the whole load (the
    // same freeze the cutscene comment in `logicTick.ts` describes) while `count` — and so
    // the chatter clock — keeps running. A load can fast-forward thousands of recorded
    // moves with the player watching and touching nothing, and without this the room
    // resumes already overdue for a StdKecej line.
    host.hracNespi();
    host.setInfo();
  }
}

/**
 * Restart the room (TRoom.Restart, URoom.pas:1577): the original's Restart action.
 * Discards the whole move record, resets every object to its start, and counts a
 * fresh attempt (pokus++). This is NOT a single-move undo — the 1998 Delphi game
 * had none; the tutorial's "1st-m-backspace" line teaches Backspace = start over.
 */
export function restartRoom(): void {
  wake();
  if (!room || ui.screen !== 'room' || cutscene) return;
  host.endShowmode(); // a player restart aborts the KUFRIK demonstration (unlike a death-restart)
  setPokus(pokus + 1);
  host.buildRoom(true);
  host.setInfo();
}
