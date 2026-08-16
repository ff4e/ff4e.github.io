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
    ctx: () => ({
      anyFishDead: state.anyFishDead,
      won: state.won,
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
  setSolvemode({ jmeno: 'TEST', moves: decodeMoves(moves), idx: 0, speed, idleTicks: 0, abort: null, won: false });
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

  it('aborts when the moves run out without a win', () => {
    const h = harness();
    arm('ud');
    advanceSolve(h.ctx());
    advanceSolve(h.ctx());
    expect(solveStatus().abort, 'not yet — every move was accepted').toBeNull();
    advanceSolve(h.ctx());

    const { abort } = solveStatus();
    expect(abort?.reason).toBe('exhausted');
    expect(abort?.at).toBe(2);
    expect(abort?.detail).toContain('all 2 moves played');
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
