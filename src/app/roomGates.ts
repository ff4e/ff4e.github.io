/**
 * The three command gates: may the room accept a command at all, is it at rest, and is
 * one fish busy.
 *
 * They are the questions every input path asks before it does anything — the keyboard,
 * the pointer, the replay driver, the save/load path and the debug hooks — and they
 * answer purely from `gameState`, so they belong to none of those callers.
 */
import { engine, room } from './gameState.js';
import { roomLoading } from './framePacing.js';

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
export const idle = (): boolean =>
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
export const atRest = (): boolean => engine !== null && !roomLoading && engine.phase === 'idle';

/** DalsiPrikaz busy gate (URoom.pas:27002-27016): a fish command is dropped while that
 *  fish is busy (mid-dialogue, turned to face the player). */
export function fishBusy(which: 'little' | 'big'): boolean {
  return room !== null && room.busy[which] > 0;
}
