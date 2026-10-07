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
 * ── What the fish have already said ──────────────────────────────────────────
 * The one place this is explained; `lineMute.ts`, `takeUnsaid` and `Script` only point
 * here. None of it is the original's, which has no undo.
 *
 * A point's snapshot rewinds the room's "already said" flags with the position: they live
 * in the item Vars and `roompole`, beside puzzle state and timers that must match it, so
 * no flag is ever kept back. The rewound script is therefore free to queue a line again,
 * and undo works on what the player HEARS instead, never on the state. In order:
 *  1. Tag. Before each tick the host sets `Script.progTag` to the history's length, and
 *     every entry `prog()` queues carries it (`tag`); entries `init()` queued carry
 *     `INIT_TAG`. `tag <= idx` therefore means "queued before point idx was banked, so its
 *     flag is in that point's snapshot".
 *  2. Bank. A tagged line is credited as heard when it starts playing, and `bankHeard`
 *     files it on the newest point (`said`). The line a press cuts off is taken back out,
 *     so it plays again, but only the first time that line is cut in the attempt
 *     (`forgiveCut`); cut again, it counts as heard, or a burst of presses would restart
 *     it on every press. Carried to be said again (step 4), it waits ~1 s first, afresh
 *     at each press, so the fish stay quiet while the player keeps pressing. Speech a room plays straight away
 *     with `talkNow`, and lines that are not the room script's (the exit cheer, idle
 *     chatter, death commentary), are outside all of this and never held back.
 *  3. Mute. An undo to point idx moves the heard lines its snapshot predates (`tag > idx`;
 *     everything, past `SNAPSHOT_DEPTH`) into the attempt's `mutedLines` (`takeUnsaid`).
 *     The rebuilt script drops, once, a conversation of its own that contains one, by line
 *     family so a random variant counts too (`Script.endProg`, `dropMutedRun`). Its `set`
 *     entries still run: only voice, subtitle and their time are skipped.
 *  4. Carry. A line queued but not heard yet when undo is pressed is moved into the rebuilt
 *     Script when its flag is in the target's snapshot (`tag <= idx`, or `INIT_TAG`) — the
 *     rewound script would never queue it again (`transferPendingDialogue`). The rebuild's
 *     own `init()` queue is dropped, so the room's opening does not restart. A carried line
 *     comes with a hold against one re-trigger of it, kept on that Script only, so a later
 *     undo that discards the line cannot leave a mute behind.
 * Mutes last for the attempt; a save does not carry them.
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
 * Exactly one attempt. It is cleared where a fresh attempt begins — a room change and
 * `restartRoom` — and kept everywhere else. A SAVE carries
 * it (`encodeUndoHistory`, written by `saveGame`), so a load resumes the attempt rather
 * than only its final position: undo after an F3 steps back through the moves that
 * reached the save, one at a time, exactly as if the player had never left.
 *
 * The death auto-restarts are the one fresh attempt that keeps the old one behind it
 * (`deadAttempt`). Once neither fish is left in play, the room erodes the skeletons and
 * restarts by itself (URoom.pas:24337), about a second later. When both fish go at once —
 * one crush, or the last fish dying after the other swam out — a history cleared there
 * left the player nothing to press undo on: the fatal move was exactly the one they could
 * not take back. So the ended attempt stays one press away while the new one is still at
 * its start: undo there goes back to the ended attempt's newest point, and that attempt
 * continues from it as if the restart had not happened. The first move of the new attempt
 * drops it — by then the player has chosen the restart. The restart itself stays: it is
 * the original's.
 *
 * The newest point is the position before the FIRST death, not the last one, because the
 * sampler banks nothing while a fish is dead. For a simultaneous death that is the position
 * before the fatal move. When the deaths came one after the other — a lone survivor played
 * on and then died too — it is the position before the first fish died, and the survivor's
 * moves since are not recoverable. That is the point undo already returns to while one fish
 * is dead and the record has run past it (`undoTargetIndex`, "adrift"), so the restart does
 * not move where undo lands.
 */
import { activeScript, clearUndoHistory, cutscene, deadAttempt, dropDeadAttempt, engine, forgivenCuts, loadmode, mutedLines, replaymode, room, setUndoHistory, showmode, undoHistory } from './gameState.js';
import { focusRestoredFish, restore } from './movement.js';
import { atRest } from './roomGates.js';
import { continuePhoneRoom } from './phoneViewport.js';
import { phoneUndoFocus } from './phoneUndoFocus.js';
import { phoneUi } from './touchButtons.js';
import { ui } from './screenState.js';
import { inSolvemode } from './solveMode.js';
import { decodeUndoHistory, encodeUndoHistory, forgiveCut, shareSnapshot, takeUnsaid, undoTargetIndex } from '../core/undoStack.js';
import { forwardScript, INIT_TAG, lineFamily, shareVars } from '../core/lineMute.js';
import type { Script } from '../core/script.js';
import type { Room } from '../core/room.js';
import type { UndoSaveData } from '../core/undoStack.js';

/** Points that the replay failed to reproduce, for the probes. See `undoMove`. */
let undoDiverged = 0;

/** Was the previous tick driven by something other than the player? See `sampleUndoPoint`. */
let wasPlayback = false;

/**
 * How many of the newest points keep their script snapshot.
 *
 * Before sparse banks, a `ScriptSnapshot` was ~8 KB, almost all of it `globpole`'s
 * 1024 numbers, and `shareSnapshot` normally reduced that to nothing because a move
 * left the array untouched. In TRUHLA and BANKA it did not: both use `globpole` as a
 * per-tick animation timer bank (`src/rooms/truhla.ts:136`, `src/rooms/banka.ts:450`),
 * so every point held its own copy and an attempt as long as TRUHLA's committed solution retained 20 MB — on
 * hardware that may be a phone, and 4 MB of it into a save slot shared with the player's
 * progress records.
 * Sparse capture removes those zero-filled copies now; the retention policy stays
 * unchanged rather than bundling a deeper script-history behaviour change with storage.
 *
 * So the DEPTH stays unlimited and the snapshots do not. Past this many points back, a
 * point keeps its record and drops its snapshot: undo still lands on the right position,
 * because the position comes from replaying the record, and only loses the script's
 * "already said" flags — which `takeUnsaid` makes up for by muting every line heard in the
 * attempt (step 3 above). Position history stays unlimited; the hearing history is what
 * covers for the snapshots let go.
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
  bankHeard();
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
  const rec = engine.srecord;
  if (deadAttempt && rec !== '') dropDeadAttempt(); // moved on from a death restart's start
  if (room.anyFishDead || room.won || engine.won) return;
  const top = undoHistory[undoHistory.length - 1];
  if (top && top.rec === rec) return; // nothing has happened since the last point
  const snapshot = activeScript?.s.snapshot() ?? null;
  undoHistory.push({ rec, snapshot: snapshot ? shareSnapshot(top?.snapshot ?? null, snapshot) : null });
  const drop = undoHistory.length - 1 - SNAPSHOT_DEPTH;
  if (drop >= 0 && undoHistory[drop]!.snapshot !== null) undoHistory[drop]!.snapshot = null;
}

/**
 * Step 4 above: move what the old Script still had to say, and that the rewound flags will
 * not bring back, into the rebuilt one. With no `old` (undo resuming a death-ended attempt)
 * nothing is carried, but the rebuild's own `init()` queue is still dropped. Queued `set`
 * entries are closures over the Script and the item arrays that queued them, so the old
 * Script forwards every field to the new one (`forwardScript`) and the new room adopts the
 * old item arrays (`shareVars`).
 */
function transferPendingDialogue(old: { s: Script; room: Room } | null, idx: number, replayCut: boolean): void {
  const s = activeScript?.s;
  if (!s || old?.s === s) return;
  const keep = old ? old.s.pendingDialogue(replayCut).filter((d) => d.tag === INIT_TAG || (d.tag !== undefined && d.tag <= idx)) : [];
  if (old && keep.length) {
    shareVars(old.room.items, s.room.items);
    forwardScript(old.s, s);
  }
  s.adoptPendingDialogue(keep);
}

/** File the room-script lines heard since the last tick under the newest point. */
function bankHeard(): void {
  const top = undoHistory[undoHistory.length - 1];
  if (!top) return; // keep them in the Script until the room's first point is banked
  const heard = activeScript?.s.takeHeard();
  if (heard?.length) (top.said ??= []).push(...heard);
}

/**
 * Is there a position behind the current one? A fact about the HISTORY, and the one the
 * HUD asks — deliberately without `canUndo`'s gates. `setInfo()` runs when a move is
 * DISPATCHED, before it has settled, so an `atRest()` in this test would hide the hint
 * for exactly as long as the player was doing the thing that creates something to undo:
 * make a move, no hint; undo it, hint appears. Same shape as `saveExists()` beside it.
 */
export function undoAvailable(): boolean {
  if (engine === null) return false;
  return undoTargetIndex(undoHistory, engine.srecord) >= 0 || resumesDeadAttempt();
}

/**
 * Would a press go back into the attempt a death auto-restart ended? Only from the new
 * attempt's start: `deadAttempt` is dropped on its first move, and before then the new
 * history has nothing of its own to undo. The dead attempt's newest point is the position
 * before the fatal move — the sampler banks nothing once a fish is dead — so its target is
 * that point, unless the fatal move was the first one and it IS this start.
 */
function resumesDeadAttempt(): boolean {
  return (
    deadAttempt !== null &&
    engine !== null &&
    engine.srecord === '' &&
    undoTargetIndex(undoHistory, '') < 0 &&
    undoTargetIndex(deadAttempt, '') >= 0
  );
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
  const focusBeforeUndo = phoneUi() && engine ? { rec: engine.srecord, active: engine.active } : null;
  // File what was heard under the history it was heard in, before a resume can swap it,
  // minus the line this press is about to cut off: half a sentence is not "already said".
  bankHeard();
  const replayCut = forgiveCut(undoHistory, activeScript?.s.cutLine() ?? null, forgivenCuts);
  // Back into the attempt the death restart ended: it becomes the history again, and the
  // loop below lands on its newest point exactly as it would on a death without a restart.
  const resuming = resumesDeadAttempt();
  if (resuming) setUndoHistory(deadAttempt!);
  // Whose queue to carry (step 4). Not the restart's when resuming: its tags count from its
  // own fresh history, so all of it would pass `tag <= idx`, and its opening would play in
  // the attempt the player went back into.
  const old = activeScript && !resuming ? { s: activeScript.s, room: activeScript.s.room } : null;
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
    for (const name of takeUnsaid(undoHistory, idx)) mutedLines.add(lineFamily(name));
    undoHistory.length = idx + 1;
    // `animated: false` — the instant branch, matching FFNG's snap-back. An animated
    // rewind would play the room's whole record back at load speed on every press, which
    // is unusable at the rate a player taps undo. This is the first non-test caller of
    // that branch; the load and the demo both take the animated one.
    const previousRoom = room;
    restore(target.rec, target.snapshot, false, false);
    if (activeScript) activeScript.s.mutedLines = mutedLines;
    if (previousRoom && room) continuePhoneRoom(previousRoom, room);
    if (engine?.srecord === target.rec && room?.anyFishDead === false) {
      transferPendingDialogue(old, idx, replayCut);
      if (focusBeforeUndo) {
        const which = phoneUndoFocus(focusBeforeUndo.rec, target.rec, focusBeforeUndo.active, room.alive);
        if (which) focusRestoredFish(which);
      }
      return true;
    }
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
