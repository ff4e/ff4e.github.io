/**
 * `solvemode` — the dev-only live smoke test: the room plays itself from its own recorded
 * solution, at normal speed, and stops loudly the moment anything goes wrong.
 *
 * It is the fourth automated-playback mode, beside `replaymode` (the map's "Replay"),
 * `showmode` (the KUFRIK demonstration) and `loadmode` (the fast-forward load). It exists
 * because the headless solvability net (`test/solutions.test.ts`) proves the MOVES still
 * solve the room against the shared step-engine, and proves nothing about the things only
 * the browser has: real-time script timing, dialogue scheduling, rendering, sound and the
 * win/return path. This drives all of those through the identical move-string.
 *
 * How it differs from `replaymode`, which it deliberately mirrors otherwise:
 *
 * 1. **Source of moves.** `replaymode` plays the PLAYER's own best solution out of their
 *    save; this plays the room's own recorded solution (`RoomScript.solution`), which
 *    exists whether or not the player has ever won the room.
 * 2. **Dialogue.** `replaymode` is deliberately SILENT — `scriptTalk` and `Zvuky_okoli`
 *    skip under `inReplay()`, which is FAITHFUL to the original's `loadtype=nej` replay
 *    (`UMain.pas:1027`, `URoom.pas:24937`). `solvemode` must speak, because a mode that
 *    cannot hear the dialogue cannot smoke-test the dialogue. So the silence stays keyed
 *    on `inReplay()` alone and this mode is not added to it — see `inAutoPlay()` below for
 *    the split, and do not "fix" the inconsistency: it is the whole point.
 * 3. **Recording.** The moves go through the real `tryStep`, so `srecord` builds exactly as
 *    if the keys had been pressed and undo/save/load and the move counter behave as in play.
 * 4. **Abort.** `replaymode` assumes its record is good, because the player produced it, and
 *    on trouble just slips quietly back to the map. This stops WHERE IT IS, leaves the room
 *    on screen, and says which move index failed and why — a silent stop is useless as a test.
 *
 * Dev-only: nothing arms this except `__ff` or the dev bar, both behind `host.devEnabled`.
 */
import { decodeMoves } from '../core/solutionMoves.js';
import type { Which } from '../core/solutionMoves.js';
import { replaymode } from './gameState.js';
import { solutionFor } from '../rooms/index.js';

/** Why a run stopped early. Named after the same failures `test/solutionsHarness.ts` reports. */
export type SolveAbortReason =
  /** A fish died. The recording is not supposed to kill anyone. */
  | 'dead'
  /** The engine rejected a recorded step — the recording and the port have diverged. */
  | 'blocked'
  /** The moves ran out and the room never latched a win. */
  | 'exhausted'
  /** Neither the recording nor the room moved for a while: something is wedged. */
  | 'stalled';

export interface SolveAbort {
  reason: SolveAbortReason;
  /** Index into the move-string of the move being played when it went wrong. */
  at: number;
  /** Total moves in the recording, so `at` reads as a position rather than a number. */
  of: number;
  /** One line, already phrased for a human: this is what the dev bar shows. */
  detail: string;
}

export interface SolveModeState {
  readonly jmeno: string;
  readonly moves: { which: Which; dir: number }[];
  idx: number;
  /**
   * Logic-tick multiplier. 1 is real speed — one move per idle tick, which is what "as a
   * player would play it" means and what makes the dialogue and script timing meaningful.
   * Above 1 the sim runs that many times faster in WALL-CLOCK by shortening the logic
   * tick (`renderLoop.ts`), never by feeding more moves per tick: every tick still happens,
   * in order, so the run being timed is the same run. `map`'s recording is 6 045 moves,
   * which is why the multiplier exists at all.
   */
  speed: number;
  /** Ticks since the recording last advanced or the engine last did something. */
  idleTicks: number;
  /** Set once, when it stops. Non-null means the run is over and the room is left as it fell. */
  abort: SolveAbort | null;
  /** Latched on the tick the room was won, so a finished run is distinguishable from an aborted one. */
  won: boolean;
}

/**
 * How many consecutive ticks of nothing happening count as wedged.
 *
 * Generous on purpose: a tick can legitimately pass with the recording not advancing
 * while a swim, a fall or a script animation plays out, and the longest of those are the
 * multi-cell falls. This is the "no progress at all" watchdog, not a pace check — it is
 * here to turn a hang into a report, and a hang does not end after 600 ticks (48 s of
 * game time).
 */
const STALL_TICKS = 600;

export let solvemode: SolveModeState | null = null;

export function setSolvemode(v: SolveModeState | null): void {
  solvemode = v;
}

/** True while a solution replay is running. Distinct from `inReplay()` — see the header. */
export function inSolvemode(): boolean {
  return solvemode !== null && solvemode.abort === null && !solvemode.won;
}

/**
 * The predicate the INPUT LOCKOUT asks: is the room playing itself, so the player's keys,
 * mouse and control panel must not reach it?
 *
 * Deliberately NOT the same question as `inReplay()` (`cutscene.ts`), and the two must not
 * be merged. `inReplay()` also gates the map replay's SILENCE (`scriptTalk` in `main.ts`,
 * `Zvuky_okoli` in `logicTick.ts`), which is faithful to the original's `loadtype=nej`
 * replay (`UMain.pas:1027`, `URoom.pas:24937`) and is exactly what `solvemode` must NOT
 * inherit — a mode that cannot hear the dialogue cannot smoke-test the dialogue. So there
 * is one predicate for "block the player" and a narrower one for "stay quiet". It reads
 * like an inconsistency and is not one; leave it that way.
 *
 * It reads `replaymode` straight off `gameState` rather than calling `inReplay()` so this
 * module does not import `cutscene.ts`, which imports this one.
 *
 * Escape, Backspace (restart) and leaving the room are all handled ABOVE the lockout, so
 * they always work: an auto-play the player cannot stop is a trap.
 */
export function inAutoPlay(): boolean {
  return replaymode !== null || inSolvemode();
}

/**
 * The logic-tick multiplier currently in force. 1 unless a solution replay is running fast,
 * so this is inert for every player session.
 */
export function solveSpeed(): number {
  return inSolvemode() ? Math.max(1, solvemode!.speed) : 1;
}

export type SolveArmError = 'missing' | 'undecodable';

/**
 * Prepare a run for `jmeno`. Returns the state to install, or why it cannot run — the
 * caller decides what to do about it (the dev bar greys the button out and says which).
 *
 * `missing` is not an error to fix: ZAVER #71 and SCORE #72 have no recording because
 * they are the ending and results screens rather than puzzles.
 */
export function armSolve(jmeno: string, speed = 1): SolveModeState | { error: SolveArmError; detail: string } {
  const found = solutionFor(jmeno);
  if (found.known !== 'ok') return { error: 'missing', detail: `${jmeno} has no recorded solution` };
  try {
    return {
      jmeno,
      moves: decodeMoves(found.moves),
      idx: 0,
      speed,
      idleTicks: 0,
      abort: null,
      won: false,
    };
  } catch (e) {
    return { error: 'undecodable', detail: `${jmeno}: ${(e as Error).message}` };
  }
}

/** Stop a run without calling it a failure — the player pressed Escape, or left the room. */
export function cancelSolve(): void {
  solvemode = null;
}

function fail(s: SolveModeState, reason: SolveAbortReason, detail: string): void {
  s.abort = { reason, at: s.idx, of: s.moves.length, detail };
}

/**
 * One tick of a solution replay, called from `logicTick` on an idle tick exactly where
 * `advanceReplay` is called for the map's "Replay".
 *
 * `ctx` is the small slice of host state this needs, passed in rather than imported so the
 * module stays testable and does not join `main.ts`'s import knot.
 */
export function advanceSolve(ctx: {
  anyFishDead: boolean;
  won: boolean;
  /** Applies one move through the REAL game loop (`tryStep`) and reports what it did. */
  play: (which: Which, dir: number) => 'moving' | 'turning' | 'blocked' | 'busy';
  wake: () => void;
}): void {
  const s = solvemode;
  if (!s || s.abort || s.won) return;

  if (ctx.won) {
    // The win latched on a previous tick's move. Let the normal win path (countdown ->
    // returnFromRoom) carry on exactly as it would for a player; nothing to abort.
    s.won = true;
    return;
  }
  if (ctx.anyFishDead) {
    fail(s, 'dead', `a fish died at move ${s.idx + 1}/${s.moves.length}`);
    return;
  }
  if (s.idx >= s.moves.length) {
    // Every recorded move was played and the room is still not won. The headless net says
    // these moves DO solve this room, so if this happens the divergence is in something
    // only the live loop has.
    fail(s, 'exhausted', `all ${s.moves.length} moves played and the room is not won`);
    return;
  }

  const at = s.idx;
  const m = s.moves[at]!;
  const outcome = ctx.play(m.which, m.dir);
  if (outcome === 'busy') {
    // Not a failure and not progress: the engine was not ready for it, so the move is NOT
    // consumed and is re-offered next tick — the same treatment the headless harness gives
    // it. The watchdog is what stops this from being an infinite retry.
    return;
  }
  if (outcome === 'blocked') {
    // A step the engine REFUSES is the signal the headless harness already trusts as "the
    // recording and the port have diverged" (`ReplayResult.blocked`/`blockedAt`). Reported
    // at the index of the refused move, and the recording is left sitting on it so the dev
    // bar shows where it stopped rather than one past it.
    fail(s, 'blocked', `the engine refused move ${at + 1}/${s.moves.length} (${moveName(m)})`);
    return;
  }
  s.idx = at + 1;
  s.idleTicks = 0;
  ctx.wake();
}

/**
 * Called on every logic tick, including the ones where no move is played because the
 * engine is mid-swim. That is what makes the watchdog able to see a hang: `advanceSolve`
 * only runs on IDLE ticks, so a run wedged in a non-idle phase would never reach it.
 */
export function tickSolveWatchdog(): void {
  const s = solvemode;
  if (!s || s.abort || s.won) return;
  s.idleTicks++;
  if (s.idleTicks > STALL_TICKS) {
    fail(s, 'stalled', `nothing moved for ${STALL_TICKS} ticks at move ${s.idx + 1}/${s.moves.length}`);
  }
}

const DIR_NAMES: Readonly<Record<number, string>> = { 1: 'up', 2: 'down', 3: 'left', 4: 'right' };

function moveName(m: { which: Which; dir: number }): string {
  return `${m.which} ${DIR_NAMES[m.dir] ?? `dir ${m.dir}`}`;
}

/** A one-line status for the dev bar and for `__ff`. */
export function solveStatus(): {
  running: boolean;
  jmeno: string | null;
  idx: number;
  total: number;
  speed: number;
  won: boolean;
  abort: SolveAbort | null;
} {
  const s = solvemode;
  return {
    running: inSolvemode(),
    jmeno: s?.jmeno ?? null,
    idx: s?.idx ?? 0,
    total: s?.moves.length ?? 0,
    speed: s?.speed ?? 1,
    won: s?.won ?? false,
    abort: s?.abort ?? null,
  };
}
