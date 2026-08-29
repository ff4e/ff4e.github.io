/**
 * Single-move undo: `-` on a keyboard, the bar's Undo button on a phone, one move per
 * press, as many times as there are moves.
 *
 * ── How a move is taken back ─────────────────────────────────────────────────
 * Not by reversing it. There is no inverse of a Fish Fillets move to write — a push, a
 * settle, an exit and a `gspec=9` push-out would each need one, with no faithful
 * reference to check them against, since the 1998 game has no undo at all. Instead undo
 * reuses the machinery an F3 load already runs: rebuild the room and replay a shorter
 * record (`movement.ts`'s `restore`). That path is already trusted by the load and the
 * KUFRIK demo, and it is silent by construction — `applyRecordStep` drives the same
 * physics as a live push but bypasses every side-effect hook, so nothing re-fires.
 *
 * It is also cheap enough not to think about: the longest committed FFNG solution record
 * is ~6 000 characters (`test/fixtures/solutions/`), so even replaying a whole one is a
 * few thousand array operations — well inside a frame, at any press rate.
 *
 * ── What it deliberately does NOT copy from save ─────────────────────────────
 * `Room.canSave` refuses to save while a fish is dead (`URoom.pas:26900`), and a lone
 * survivor deliberately keeps playing here rather than being auto-restarted. Undo does
 * NOT mirror that rule: taking back the move that killed a fish is its single most
 * valuable use, and it is exactly the state saving forbids. Only `atRest()` and the
 * playback modes gate it (Martin's call, 2026-08-29).
 *
 * ── Why the key is matched on `e.key`, alone in this game ────────────────────
 * Every other keyboard binding here uses `e.code`, a PHYSICAL key position on a US
 * layout, and is right to: IJKL and WASD are chosen as shapes under the hands, so a Czech
 * or French player should get the same two squares whatever those keys print. A key
 * chosen for the CHARACTER on it is the opposite case. On a Czech QWERTZ the `-` key sits
 * where US has `/` and reports `code: 'Slash'`, so a `code: 'Minus'` binding does nothing
 * there — and silently binds `=`, the key that IS in that position. Reported from a real
 * Czech keyboard: the on-screen button worked and the key did not. Matching the character
 * makes the key the player is told to press the key that works, on every layout, and
 * covers the numpad's `-` for free.
 *
 * ── How long a history lives ─────────────────────────────────────────────────
 * Exactly one attempt. It is cleared where a fresh attempt begins — a room change,
 * `restartRoom`, and either death auto-restart — and kept everywhere else. A SAVE carries
 * it (`encodeUndoHistory`, written by `saveGame`), so a load resumes the attempt rather
 * than only its final position: undo after an F3 steps back through the moves that
 * reached the save, one at a time, exactly as if the player had never left.
 */
import { activeScript, clearUndoHistory, cutscene, engine, loadmode, replaymode, room, setUndoHistory, showmode, undoHistory } from './gameState.js';
import { restore } from './movement.js';
import { atRest } from './roomGates.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { decodeUndoHistory, encodeUndoHistory, shareSnapshot, undoTargetIndex } from '../core/undoStack.js';
import type { UndoSaveData } from '../core/undoStack.js';

/** Points that the replay failed to reproduce, for the probes. See `undoMove`. */
let undoDiverged = 0;

/** Was the previous tick driven by something other than the player? See `sampleUndoPoint`. */
let wasPlayback = false;

/**
 * How many of the newest points keep their script snapshot.
 *
 * A `ScriptSnapshot` is ~8 KB, almost all of it `globpole`'s 1024 numbers, and
 * `shareSnapshot` normally reduces that to nothing because a move leaves the array
 * untouched. In TRUHLA and BANKA it does not: both use `globpole` as a per-tick animation
 * timer bank (`src/rooms/truhla.ts:136`, `src/rooms/banka.ts:450`), so every point holds
 * its own copy and an attempt as long as TRUHLA's committed solution retains 20 MB — on
 * hardware that may be a phone, and 4 MB of it into a save slot shared with the player's
 * progress records.
 *
 * So the DEPTH stays unlimited and the snapshots do not. Past this many points back, a
 * point keeps its record and drops its snapshot: undo still lands on the right position,
 * because the position comes from replaying the record, and only loses the script's
 * "already said" progress, so a line the fish spoke that long ago may be spoken again.
 * That is the right thing to spend — an undo 120 moves deep is already far outside what
 * this is for, and losing a position would be a real loss where repeating a line is not.
 */
const SNAPSHOT_DEPTH = 120;

/**
 * Record the position, if the room has settled into a new one. Called once per logic
 * tick, from `logicTick.ts`, straight after the engine's phase machine and BEFORE the
 * held-key repeat — which is the whole reason it is a tick-level sample and not a call
 * inside `press()`. `recordMove` fires the instant a push is ACCEPTED, before its
 * animation and before any push-out marker it causes; and a held direction starts the
 * next cell on the same tick the previous one completed, so a sample taken after the
 * repeat would collapse a five-cell hold into a single undo point.
 *
 * Points stop being recorded once a fish is dead, and `undoTargetIndex` is built around
 * that — see its comment for why a record containing a death cannot be replayed back.
 */
export function sampleUndoPoint(): void {
  if (!room || !engine || ui.screen !== 'room') return;
  if (engine.phase !== 'idle') return; // mid-move: not a position to come back to
  // Something other than the player is driving the record: the KUFRIK demonstration, the
  // map's "Replay", or a dev solution run. Bank nothing while one plays — those are not
  // the player's positions — and throw the history away when one ENDS, because by then
  // the record is the demo's and not the player's.
  //
  // Clearing on the transition rather than trusting the driver to put the record back is
  // deliberate: nothing does. `startShowmode` never captures the pre-demo record
  // (`cutscene.ts`), `endShowmode` only clears flags, and the demo's own scripted restart
  // rebuilds the room — resetting `srecord` to empty — through the `carryPole` path that
  // keeps the history. Left alone, the first press after a demo would replay the player's
  // whole pre-demo record instead of taking one move back.
  //
  // `loadmode` is NOT in that set. A load is the player, and its history is the saved
  // attempt's, deliberately installed by `loadUndoHistory` before the replay starts.
  if (showmode || replaymode || inSolvemode()) {
    wasPlayback = true;
    return;
  }
  if (wasPlayback) {
    wasPlayback = false;
    clearUndoHistory();
  }
  if (loadmode || cutscene) return;
  if (room.anyFishDead || room.won || engine.won) return;
  const rec = engine.srecord;
  const top = undoHistory[undoHistory.length - 1];
  if (top && top.rec === rec) return; // nothing has happened since the last point
  const snapshot = activeScript?.s.snapshot() ?? null;
  undoHistory.push({ rec, snapshot: snapshot ? shareSnapshot(top?.snapshot ?? null, snapshot) : null });
  const drop = undoHistory.length - 1 - SNAPSHOT_DEPTH;
  if (drop >= 0 && undoHistory[drop]!.snapshot !== null) undoHistory[drop]!.snapshot = null;
}

/**
 * Is there a position behind the current one? A fact about the HISTORY, and the one the
 * HUD asks — deliberately without `canUndo`'s gates. `setInfo()` runs when a move is
 * DISPATCHED, before it has settled, so an `atRest()` in this test would hide the hint
 * for exactly as long as the player was doing the thing that creates something to undo:
 * make a move, no hint; undo it, hint appears. Same shape as `saveExists()` beside it.
 */
export function undoAvailable(): boolean {
  return engine !== null && undoTargetIndex(undoHistory, engine.srecord) >= 0;
}

/** Is there a position to go back to, and is the room in a state to accept the command? */
export function canUndo(): boolean {
  if (!room || !engine || ui.screen !== 'room') return false;
  // `atRest()` and not `idle()`: `idle()` also excludes a dead fish, which is the case
  // undo exists for. A win is excluded here instead — the room is on its auto-return
  // countdown and about to be left.
  if (!atRest() || loadmode || showmode || replaymode || cutscene || inSolvemode()) return false;
  if (room.won || engine.won) return false;
  return undoAvailable();
}

/**
 * Take back one move. Returns false if there was nothing to take back, so the callers
 * that want to say so (the debug hook, the probes) can.
 */
export function undoMove(): boolean {
  if (!canUndo()) return false;
  let idx = undoTargetIndex(undoHistory, engine?.srecord ?? '');
  // Fall back down the history until the replay actually lands where the point says.
  //
  // The premise — that a shorter record replays back to the position it describes — is
  // true in 69 of the 70 rooms with a committed solution and NOT true in PARTY2, where
  // replaying one of its own banked records instantly leaves a fish dead: `prog()` runs
  // between moves on the live path and not on this one, and that room's script is what
  // the difference falls out of. Without this the press would crush a fish the player had
  // not crushed, and then wedge — `engine.srecord` would no longer match any point, so
  // every later press would restore the same one for ever.
  //
  // Checking after the fact rather than before is not laziness: whether a record replays
  // faithfully can only be found out by replaying it, and doing that speculatively on
  // every press would cost a full rebuild per candidate anyway. The bottom point is the
  // room's start with an empty record, which cannot diverge, so this always terminates.
  while (idx >= 0) {
    const target = undoHistory[idx]!;
    // Truncate FIRST: this both drops the position being left and leaves `target` on top,
    // so the history's "the newest point is where the player is" invariant holds again
    // and the next sample sees nothing new.
    undoHistory.length = idx + 1;
    // `animated: false` — the instant branch, matching FFNG's snap-back. An animated
    // rewind would play the room's whole record back at load speed on every press, which
    // is unusable at the rate a player taps undo. This is the first non-test caller of
    // that branch; the load and the demo both take the animated one.
    restore(target.rec, target.snapshot, false, false);
    if (engine?.srecord === target.rec && room?.anyFishDead === false) return true;
    undoDiverged++;
    idx--;
  }
  return false;
}

/** How many points the replay has failed to reproduce this session. Read by the probes;
 *  a number that is not 0 in an ordinary room is a real regression, not a curiosity. */
export function undoDivergedCount(): number {
  return undoDiverged;
}

/**
 * The history as a save slot wants it, or null when there is nothing worth writing.
 *
 * A save carries the history so a load resumes the ATTEMPT and not merely the position
 * it ended on (Martin's call, 2026-08-29): undo after an F3 steps back through the moves
 * that reached the save. `saveGame` writes this beside the record and drops it if the
 * slot will not take it — see `encodeUndoHistory` for why that is unlikely, and
 * `saveGame` for why the history is the part that yields.
 */
export function undoHistoryForSave(): UndoSaveData | null {
  return encodeUndoHistory(undoHistory);
}

/**
 * Take the history out of a save slot, before its record is replayed.
 *
 * The saved attempt's points REPLACE the live ones — a load resumes that attempt, so its
 * history is the one that applies. Called before `restore`, which does not touch it: the
 * animated fast-forward suppresses the sampler while it runs, and when it lands the
 * record equals the newest point's, so nothing is banked on top.
 *
 * Anything unrecognised — a save from a build before this, or one whose history did not
 * fit — decodes to empty, which leaves the sampler to bank the loaded position as the
 * only point. That degrades to "nothing to undo until you move", never to a lost save.
 */
export function loadUndoHistory(data: unknown): void {
  setUndoHistory(decodeUndoHistory(data));
}
