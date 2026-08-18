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
  /**
   * Idle ticks since the last recorded move was played. A room is not required to be won
   * ON the final move: a gspec=9 push-out latches its win from the at-rest `spec9` mark a
   * tick or more later, and the cork slide runs after that. So "moves exhausted" only
   * becomes a failure once the room has also been idle for a while.
   */
  idleAfterMoves: number;
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

/**
 * How long to keep waiting for an autonomous win after the last recorded move.
 *
 * The same 120 the headless harness uses (`test/solutionsHarness.ts`), and for the same
 * reason: the recording ends when the PLAYER stopped pressing keys, not when the room
 * finished resolving. Eight rooms win by pushing an item out (gspec=9 — LODE, SPUNT,
 * ZELVA, BARELY, MAPA, POHON, GRAL, DISKETA), where the win is latched by the at-rest
 * `spec9` mark and the exit slide that follows, all of it after the final move. Calling
 * `exhausted` on the first idle tick failed every one of them.
 */
const WIN_GRACE_TICKS = 120;

/**
 * The only way a speed ever reaches the state. Anything else is a browser hang waiting to
 * happen: `renderLoop` divides `LOGIC_MS` by this and uses it as the per-frame step cap, so
 * `Infinity` gives a 0 ms tick and an uncapped loop (`acc >= 0 && steps < Infinity` never
 * ends), and `NaN` gives `acc >= NaN`, which is false forever — a run that silently never
 * advances. Both are reachable from `__ff.solveRoom(n)`, which is a dev hook a human types
 * into a console, so "no one would pass that" is not an argument.
 *
 * 50 is well past the point the frame rate stops being the limit; `Math.floor(n) || 1` maps
 * NaN, 0 and -0 to 1.
 */
const clampSpeed = (n: number): number => Math.max(1, Math.min(50, Math.floor(n) || 1));

export let solvemode: SolveModeState | null = null;

/**
 * The verdict of the last run, kept after `solvemode` itself is gone.
 *
 * A run does not get to choose when it is torn down. Winning starts the auto-return
 * countdown, and when that lapses `returnFromRoom` -> `endShowmode` -> `cancelSolve()`
 * clears the state — at a high multiplier that can all happen inside ONE frame, so a
 * caller polling `solveStatus()` would see "running" and then nothing, never the win.
 * Keeping the verdict here means the answer to "how did it go" survives the cleanup, which
 * is also what lets the dev bar still show it once the map is back.
 */
let lastResult: { jmeno: string; idx: number; total: number; won: boolean; abort: SolveAbort | null } | null = null;

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
  return inSolvemode() ? clampSpeed(solvemode!.speed) : 1;
}

/**
 * Change the multiplier of a run already going. The dev bar starts every run at real
 * speed, because watching it at real speed is the point; this is the other half of D5 —
 * the knob for when it is being used as a test rather than watched, which is what the UI
 * probe does. Clamped so a stray 0 cannot stop the clock.
 */
export function setSolveSpeed(n: number): void {
  if (solvemode) solvemode.speed = clampSpeed(n);
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
    lastResult = null; // a new run's verdict is not the old one's
    return {
      jmeno,
      moves: decodeMoves(found.moves),
      idx: 0,
      speed: clampSpeed(speed),
      idleTicks: 0,
      idleAfterMoves: 0,
      abort: null,
      won: false,
    };
  } catch (e) {
    return { error: 'undecodable', detail: `${jmeno}: ${(e as Error).message}` };
  }
}

/** Stop a run without calling it a failure — the player pressed Escape, or left the room. */
export function cancelSolve(): void {
  if (solvemode) {
    // Preserve a verdict the run had already reached; a teardown is not a result of its own.
    if (solvemode.won || solvemode.abort) rememberResult(solvemode);
    else lastResult = null;
  }
  solvemode = null;
}

function rememberResult(s: SolveModeState): void {
  lastResult = { jmeno: s.jmeno, idx: s.idx, total: s.moves.length, won: s.won, abort: s.abort };
}

function fail(s: SolveModeState, reason: SolveAbortReason, detail: string): void {
  s.abort = { reason, at: s.idx, of: s.moves.length, detail };
  rememberResult(s);
}

/**
 * Latch a DEATH as early as the win is latched, from the top of the tick.
 *
 * `advanceSolve` sees a death only on a tick it could also have played a move on, and the
 * death-restart path does not wait for one: once both fish have eroded (~14 ticks) it calls
 * `buildRoom(true)` and returns, deliberately WITHOUT tearing playback down, because the
 * KUFRIK demonstration has to survive its own scripted deaths. A run left armed across that
 * rebuild would carry on feeding the rest of the recording to a freshly spawned room, and
 * report the resulting nonsense as a `blocked` at some later index instead of the death
 * that actually happened.
 */
export function noteSolveDeath(anyFishDead: boolean): void {
  const s = solvemode;
  if (!s || s.abort || s.won || !anyFishDead) return;
  fail(s, 'dead', `a fish died at move ${s.idx + 1}/${s.moves.length}`);
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
  /**
   * Was the room at rest when this tick STARTED — not merely by the time it got here?
   *
   * A move may only be played on such a tick, exactly as `test/solutionsHarness.ts` does
   * it. A tick that only became idle inside `advance()` has not yet given the room's `prog`
   * an at-rest pass, so a move played there steals the tick from autonomous at-rest logic
   * and puts the fish one cell further along than the recording meant.
   *
   * Be precise about WHY, because the obvious reason is wrong: it is NOT that a player
   * cannot press a key mid-animation. This port's held-key repeat does exactly that —
   * `dispatchHeldMove` runs deliberately AFTER `advance()` (`logicTick.ts`) so a completed
   * cell starts the next one on the same tick. The rule is a property of how the FFNG
   * corpus was recorded and of the harness that validates it, which is precisely why it
   * belongs to this mode and was not imposed on `replaymode` or on held keys.
   *
   * WIN #68 is where the difference is fatal. Its bonus level (`ZapniBonuslevel`,
   * URoom.pas:17944/23700) re-points little/big at the elderly pair from a positional
   * trigger in `prog`. The trigger still fires under the loose cadence — what breaks is
   * that a move issued on the SAME tick as the handover lands the pair at (25,11)/(25,13)
   * instead of (24,11)/(24,13), and the big one arrives crushed.
   *
   * That divergence is NOT confined to this mode, and this rule masks rather than fixes it:
   * the map's "Replay" and a held key both use the loose cadence, so WIN #68 and GRAL #64
   * are reachable failures there today. Recorded as a task rather than fixed here, because
   * the fix belongs in the tick and is player-facing.
   */
  startedIdle: boolean;
  /** Applies one move through the REAL game loop (`tryStep`) and reports what it did. */
  play: (which: Which, dir: number) => 'moving' | 'turning' | 'blocked' | 'busy';
  wake: () => void;
}): void {
  const s = solvemode;
  if (!s || s.abort || s.won) return;

  if (ctx.won) {
    // Already won on an earlier tick (usually latched by `noteSolveWin` before this branch
    // is even reachable). Let the normal win path — countdown -> returnFromRoom — carry on
    // exactly as it would for a player; nothing to abort, and no further move to play.
    s.won = true;
    return;
  }
  if (ctx.anyFishDead) {
    fail(s, 'dead', `a fish died at move ${s.idx + 1}/${s.moves.length}`);
    return;
  }
  if (!ctx.startedIdle) return; // not a tick this may move on — see `startedIdle`
  if (s.idx >= s.moves.length) {
    // Every recorded move has been played. Do NOT call that a failure yet — give the room
    // the same grace the headless harness gives it, because a win can still arrive on its
    // own (see WIN_GRACE_TICKS). Only once it has been idle this long with no win is the
    // recording genuinely not solving the room, and that IS worth reporting: the headless
    // net says these moves solve it, so the divergence is in something only the live loop
    // has.
    if (++s.idleAfterMoves <= WIN_GRACE_TICKS) return;
    fail(s, 'exhausted', `all ${s.moves.length} moves played and the room did not win within ${WIN_GRACE_TICKS} ticks`);
    return;
  }

  const at = s.idx;
  const m = s.moves[at]!;
  // Count as player activity BEFORE the move is offered, not after it is accepted — the
  // headless harness does the same (`room.hracNespi()` ahead of its busy gate) and its
  // comment records why: ZELVA's turtle seizes a fish that has been idle 40 ticks, and a
  // long scripted line can hold a fish `busy` for longer than that. Waking only on an
  // accepted move let the idle timers climb during exactly the window the harness keeps
  // them down, so the live replay could be possessed where the headless one is not.
  ctx.wake();
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
}

/**
 * Latch a win the moment the ENGINE reports one, from wherever in the tick this is called.
 *
 * It must be `engine.won`, not `room.won`: `room.won` is `venku.little && venku.big` (both
 * fish outside), and the eight gspec=9 push-out rooms win with the fish still INSIDE —
 * only the pushed item leaves. `stepEngine.ts` says so where `won` is declared, and the
 * headless harness asserts `engine.won` for exactly this reason.
 *
 * And it must be latched OUTSIDE the idle branch. A win immediately starts the auto-return
 * countdown, and `logicTick` returns early for the whole tick while that runs (and again
 * while anything is still falling), so `advanceSolve` is never reached again after the win.
 * Latching only there left a solved push-out room reported as a failure — or as nothing at
 * all, once `returnFromRoom` tore the run down.
 */
export function noteSolveWin(engineWon: boolean): void {
  const s = solvemode;
  if (!s || s.abort || s.won) return;
  if (!engineWon) return;
  s.won = true;
  rememberResult(s);
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
  if (!s) {
    return {
      running: false,
      jmeno: lastResult?.jmeno ?? null,
      idx: lastResult?.idx ?? 0,
      total: lastResult?.total ?? 0,
      speed: 1,
      won: lastResult?.won ?? false,
      abort: lastResult?.abort ?? null,
    };
  }
  return {
    running: inSolvemode(),
    jmeno: s.jmeno,
    idx: s.idx,
    total: s.moves.length,
    speed: s.speed,
    won: s.won,
    abort: s.abort,
  };
}
