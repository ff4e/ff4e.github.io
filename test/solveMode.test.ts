/**
 * The `solvemode` driver: what it plays, and — the point of the mode — what makes it stop.
 *
 * A dev tool whose failure detection is untested is a dev tool that reports success. Each
 * of the four abort conditions D4 settled on is provoked here, and each is checked for the
 * FAILING MOVE INDEX as well as the reason, because "it stopped" without "where" is what
 * makes an abort useless for diagnosis.
 *
 * The driver is exercised through its `ctx` seam rather than through the browser loop, so
 * these need no DOM, no room data and no engine — the live wiring is covered by the UI
 * probe. What is pinned here is the state machine.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { decodeMove, decodeMoves } from '../src/core/solutionMoves.js';
import {
  advanceSolve,
  armSolve,
  cancelSolve,
  inSolvemode,
  noteSolveWin,
  setSolvemode,
  solveSpeed,
  solveStatus,
  tickSolveWatchdog,
} from '../src/app/solveMode.js';

type Outcome = 'moving' | 'turning' | 'blocked' | 'busy';

/** A stand-in for the room: records what was played and answers however the test wants. */
function harness(outcomes: Outcome | Outcome[] = 'moving') {
  const played: { which: string; dir: number }[] = [];
  const state = { anyFishDead: false, won: false, woke: 0 };
  let i = 0;
  return {
    played,
    state,
    ctx: (startedIdle = true) => ({
      anyFishDead: state.anyFishDead,
      won: state.won,
      startedIdle,
      play: (which: 'little' | 'big', dir: number): Outcome => {
        played.push({ which, dir });
        return Array.isArray(outcomes) ? (outcomes[i++] ?? 'moving') : outcomes;
      },
      wake: () => {
        state.woke++;
      },
    }),
  };
}

/**
 * Install a run directly rather than through `armSolve`, so a test's move-string is its
 * own and these assertions are not tied to which rooms happen to carry a recording.
 * `armSolve` itself is covered by its own case below.
 */
const arm = (moves: string, speed = 1): void => {
  setSolvemode({
    jmeno: 'TEST',
    moves: decodeMoves(moves),
    idx: 0,
    speed,
    idleTicks: 0,
    idleAfterMoves: 0,
    abort: null,
    won: false,
  });
};

describe('solvemode', () => {
  beforeEach(() => cancelSolve());

  it('decodes both control sets, so WIN #68 is not silently shortened', () => {
    expect(decodeMove('u')).toEqual({ which: 'little', dir: Dir.up });
    expect(decodeMove('R')).toEqual({ which: 'big', dir: Dir.right });
    // WIN's elderly pair: w/x/y/z = up/down/left/right (`ModelFactory::parseExtraControlSym`).
    expect(decodeMove('w')).toEqual({ which: 'little', dir: Dir.up });
    expect(decodeMove('Z')).toEqual({ which: 'big', dir: Dir.right });
    expect(decodeMove('q')).toBeNull();
    expect(() => decodeMoves('udq')).toThrow(/index 2/);
  });

  it('plays one move per idle tick, in order, through the real step path', () => {
    const h = harness();
    arm('udLR');
    for (let i = 0; i < 4; i++) advanceSolve(h.ctx());
    expect(h.played).toEqual([
      { which: 'little', dir: Dir.up },
      { which: 'little', dir: Dir.down },
      { which: 'big', dir: Dir.left },
      { which: 'big', dir: Dir.right },
    ]);
    expect(solveStatus().idx).toBe(4);
    expect(h.state.woke, 'each accepted move counts as player activity').toBe(4);
  });

  it('aborts on a death, naming the move it died on', () => {
    const h = harness();
    arm('uuuu');
    advanceSolve(h.ctx());
    advanceSolve(h.ctx());
    h.state.anyFishDead = true;
    advanceSolve(h.ctx());

    const { abort } = solveStatus();
    expect(abort?.reason).toBe('dead');
    expect(abort?.at, 'the move it had reached').toBe(2);
    expect(abort?.detail).toContain('move 3/4');
    expect(inSolvemode(), 'the run is over').toBe(false);
    expect(h.played.length, 'no further move is played after the abort').toBe(2);
  });

  it('aborts on a blocked move, at the index of the move the engine refused', () => {
    const h = harness(['moving', 'moving', 'blocked']);
    arm('uuur');
    for (let i = 0; i < 4; i++) advanceSolve(h.ctx());

    const { abort } = solveStatus();
    expect(abort?.reason).toBe('blocked');
    expect(abort?.at, 'the refused move, not the one after it').toBe(2);
    expect(abort?.of).toBe(4);
    expect(abort?.detail).toContain('little up');
    expect(h.played.length, 'it stops where it is').toBe(3);
  });

  it('does not consume a move the engine was merely busy for', () => {
    const h = harness(['busy', 'busy', 'moving']);
    arm('ud');
    advanceSolve(h.ctx());
    expect(solveStatus().idx, 'a busy tick retries the same move').toBe(0);
    advanceSolve(h.ctx());
    expect(solveStatus().idx).toBe(0);
    advanceSolve(h.ctx());
    expect(solveStatus().idx, 'and it lands once the engine is ready').toBe(1);
    expect(h.played.every((p) => p.dir === Dir.up), 'it was the SAME move all three times').toBe(true);
    expect(solveStatus().abort, 'busy is not a failure').toBeNull();
  });

  /**
   * The grace window, and why it exists: the recording ends when the PLAYER stopped
   * pressing keys, not when the room finished resolving. Eight gspec=9 push-out rooms
   * latch their win from the at-rest `spec9` mark and the exit slide that follows, all
   * AFTER the final recorded move. Failing on the first idle tick failed every one of them
   * — LODE #19 reported `exhausted` on a recording the headless net proves solves it.
   */
  it('does not call exhausted until the room has had its grace window', () => {
    const h = harness();
    arm('ud');
    advanceSolve(h.ctx());
    advanceSolve(h.ctx());
    expect(solveStatus().abort, 'not yet — every move was accepted').toBeNull();

    for (let i = 0; i < 120; i++) advanceSolve(h.ctx());
    expect(solveStatus().abort, 'still waiting: a win can arrive on its own').toBeNull();

    advanceSolve(h.ctx());
    const { abort } = solveStatus();
    expect(abort?.reason).toBe('exhausted');
    expect(abort?.at).toBe(2);
    expect(abort?.detail).toContain('all 2 moves played');
  });

  it('a win arriving inside the grace window is a win, not an exhaustion', () => {
    const h = harness();
    arm('ud');
    advanceSolve(h.ctx());
    advanceSolve(h.ctx());
    for (let i = 0; i < 60; i++) advanceSolve(h.ctx()); // idling, moves already spent
    h.state.won = true; // the push-out finally latches
    advanceSolve(h.ctx());

    const s = solveStatus();
    expect(s.won, 'a late autonomous win still counts').toBe(true);
    expect(s.abort).toBeNull();
  });

  /**
   * The win has to latch from OUTSIDE the idle branch. A win starts the auto-return
   * countdown and `logicTick` then returns for the whole tick, so `advanceSolve` is never
   * reached again — a gspec=9 room would be torn down by `returnFromRoom` with the run
   * still reading "running", and the probe would wait for a status that never arrives.
   */
  it('noteSolveWin latches a win reported anywhere in the tick', () => {
    arm('uuuu');
    noteSolveWin(false);
    expect(solveStatus().won, 'no win yet').toBe(false);
    noteSolveWin(true);
    expect(solveStatus().won, 'latched without ever reaching an idle tick').toBe(true);
    expect(inSolvemode(), 'the run is over, so the lockout lifts').toBe(false);
    expect(solveStatus().abort, 'a win is never an abort').toBeNull();
  });

  it('noteSolveWin does not resurrect or overwrite a run that already aborted', () => {
    const h = harness(['blocked']);
    arm('uuuu');
    advanceSolve(h.ctx());
    expect(solveStatus().abort?.reason).toBe('blocked');
    noteSolveWin(true);
    expect(solveStatus().won, 'an aborted run does not become a win').toBe(false);
    expect(solveStatus().abort?.reason, 'and keeps its abort').toBe('blocked');
  });

  it('aborts when nothing moves for long enough, rather than hanging', () => {
    const h = harness('busy');
    arm('uuuu');
    for (let i = 0; i < 601; i++) {
      advanceSolve(h.ctx());
      tickSolveWatchdog();
    }
    const { abort } = solveStatus();
    expect(abort?.reason).toBe('stalled');
    expect(abort?.detail).toContain('move 1/4');
  });

  it('the watchdog does not fire while the recording is still advancing', () => {
    const h = harness();
    arm('u'.repeat(2000));
    for (let i = 0; i < 1500; i++) {
      advanceSolve(h.ctx());
      tickSolveWatchdog();
    }
    expect(solveStatus().abort, 'progress every tick resets it').toBeNull();
    expect(solveStatus().idx).toBe(1500);
  });

  it('a win ends the run as a success, and plays no further move', () => {
    const h = harness();
    arm('uuuu');
    advanceSolve(h.ctx());
    h.state.won = true;
    advanceSolve(h.ctx());

    const s = solveStatus();
    expect(s.won).toBe(true);
    expect(s.abort, 'a win is not an abort').toBeNull();
    expect(inSolvemode(), 'the lockout lifts so the normal win path is not fought').toBe(false);
    expect(h.played.length).toBe(1);
  });

  it('the speed multiplier is inert unless a run is actually going', () => {
    expect(solveSpeed(), 'no run: the logic tick is untouched').toBe(1);
    arm('uuuu', 8);
    expect(solveSpeed()).toBe(8);
    const h = harness();
    h.state.won = true;
    advanceSolve(h.ctx());
    expect(solveSpeed(), 'and it returns to real time the moment the run ends').toBe(1);
  });

  it('arming reports missing rather than throwing, for the two rooms that are not puzzles', () => {
    for (const jmeno of ['ZAVER', 'SCORE', 'NOT_A_ROOM']) {
      const r = armSolve(jmeno);
      expect('error' in r && r.error, `${jmeno} has no recording`).toBe('missing');
    }
    const ok = armSolve('PRVNI');
    expect('error' in ok, 'a real puzzle room arms').toBe(false);
    expect('moves' in ok && ok.moves.length, 'and carries its decoded moves').toBeGreaterThan(0);
  });

  /**
   * The rule that WIN #68 paid for. A tick that only became idle inside `advance()` has
   * not given the room's `prog` an at-rest pass yet, so a move played there arrives one
   * cell ahead of where the recording meant it — and WIN's bonus level opens on a
   * positional trigger, so that cell crushed the elderly fish at move 143 of 794 on a
   * recording the headless net wins with.
   */
  it('will not play a move on a tick that only became idle part-way through', () => {
    const h = harness();
    arm('uuuu');
    advanceSolve(h.ctx(false));
    advanceSolve(h.ctx(false));
    expect(h.played.length, 'nothing played on a tick that did not start at rest').toBe(0);
    expect(solveStatus().idx).toBe(0);
    expect(solveStatus().abort, 'and it is not an error, just not this tick').toBeNull();

    advanceSolve(h.ctx(true));
    expect(h.played.length, 'and it plays on the next tick that does').toBe(1);
  });

  it('a non-idle tick still counts toward the stall watchdog', () => {
    const h = harness();
    arm('uuuu');
    for (let i = 0; i < 601; i++) {
      advanceSolve(h.ctx(false));
      tickSolveWatchdog();
    }
    expect(solveStatus().abort?.reason, 'a room wedged mid-animation still fails').toBe('stalled');
  });

  it('cancelling stops the run and unlocks input', () => {
    const h = harness();
    arm('uuuu');
    advanceSolve(h.ctx());
    expect(inSolvemode()).toBe(true);
    cancelSolve();
    expect(inSolvemode()).toBe(false);
    expect(solveStatus().running).toBe(false);
    advanceSolve(h.ctx());
    expect(h.played.length, 'a cancelled run plays nothing more').toBe(1);
  });
});
