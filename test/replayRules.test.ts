/**
 * The two rules the map "Replay" driver plays by, pinned against the rooms that prove they
 * are load-bearing.
 *
 * `test/solutions.test.ts` replays the whole corpus under the rules the driver is SUPPOSED
 * to use, and passes. That is the wrong shape to protect a rule: it says the corpus solves,
 * not that it stops solving if the rule goes. So this file replays the two rooms that
 * notice with each rule REMOVED, and fails if they still win — which is what turns
 * "`startedIdle` looks redundant, the phase is already idle" into a red suite instead of a
 * shipped regression.
 *
 * Both rules live on `advanceReplay` (`src/app/replayMode.ts`), and its `startedIdle`
 * parameter carries the derivation from the Delphi source: why the original's replay
 * (`loadmode`, URoom.pas:24102-24311) needs them and why a held key — which really does go
 * through `DalsiPrikaz` and really does issue the next move on the same tick — does not.
 *
 * BE CLEAR ABOUT WHAT THIS DOES NOT COVER. It runs the shared step engine, not
 * `src/app/`, so it cannot see the driver itself: if `advanceReplay` stopped applying
 * either rule, this file would stay green. Its job is to keep the REASONS true and
 * discoverable. The live path is asserted by the cadence rate in `tools/test-mapinfo.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Room } from '../src/core/room.js';
import { Script } from '../src/core/script.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { decodeMoves } from '../src/core/solutionMoves.js';
import { ROOMS } from '../src/data/roomTable.js';
import { parseFfr } from '../src/data/ffr.js';
import { roomScript } from '../src/rooms/index.js';
import { gameDataDir } from './gameData.js';
import { recordedMoves } from './solutionsSource.js';

/** Deterministic RNG, matching `solutionsHarness.ts` so these runs are comparable to it. */
function makeRng(): (n: number) => number {
  let state = 0x2545f491;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return n > 0 ? state % n : 0;
  };
}

interface Rules {
  /** Play a move only on a tick that BEGAN idle (the cadence rule). */
  startedIdle: boolean;
  /** Leave a move the engine refused as `busy` unconsumed, to retry (the busy rule). */
  retryBusy: boolean;
}

/**
 * `solutionsHarness.replaySolution` with the two rules made switchable. Deliberately a
 * copy rather than a parameter on the harness: the harness is the solvability net for 70
 * rooms and must not grow a knob that can silently change what that net asserts.
 */
function replayUnder(num: number, slug: string, rules: Rules): { won: boolean; dead: boolean; consumed: number } {
  const jmeno = ROOMS[num - 1]!.jmeno;
  const ffr = join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
  const room = new Room(parseFfr(new Uint8Array(readFileSync(ffr))));
  const def = roomScript(jmeno) ?? null;
  const script = new Script(room, () => 12, () => false, {}, () => false);
  const engine = new StepEngine(room, script, def, { random: makeRng() });
  script.onWin = () => engine.triggerWin();
  def?.init(script);
  if (room.padani()) engine.phase = 'fall';
  else {
    room.clearAllDirs();
    engine.phase = 'idle';
  }

  const steps = decodeMoves(recordedMoves(slug));
  let count = 0;
  let mi = 0;
  let idleAfterMoves = 0;
  const guardMax = steps.length * 60 + 20_000;
  for (let guard = 0; guard < guardMax; guard++) {
    count++;
    const idleAtStart = engine.phase === 'idle';
    engine.runScript(count, 0);
    script.dialogy(count);
    engine.advance();
    if (engine.won || room.anyFishDead) break;
    if (engine.phase !== 'idle') continue;
    if (rules.startedIdle && !idleAtStart) continue;
    if (mi >= steps.length) {
      if (++idleAfterMoves > 120) break;
      continue;
    }
    const s = steps[mi]!;
    engine.active = s.which;
    room.hracNespi();
    if (engine.press(s.which, s.dir) === 'busy' && rules.retryBusy) continue;
    mi++;
  }
  return { won: engine.won, dead: room.anyFishDead, consumed: mi };
}

const BOTH: Rules = { startedIdle: true, retryBusy: true };

describe('map Replay rules', () => {
  it('both rules together solve the two rooms that notice', () => {
    expect(replayUnder(68, 'windoze', BOTH)).toMatchObject({ won: true, dead: false });
    expect(replayUnder(64, 'grail', BOTH)).toMatchObject({ won: true, dead: false });
  });

  describe('the cadence rule is load-bearing', () => {
    it('WIN #68 crushes the elderly big fish without it', () => {
      // The bonus tile is pushable (`kind_heavy`) until `ZapniBonuslevel` pins it static
      // (URoom.pas:23713), and the handover fires from a positional trigger in `prog`
      // (:17944). Issue the next move on the tick the fish arrives adjacent and the push is
      // already marked (`posun_ryby`, :24744) when the trigger fires, so the whole bonus
      // level slides one cell into its own static frame.
      const r = replayUnder(68, 'windoze', { ...BOTH, startedIdle: false });
      expect(r.won).toBe(false);
      expect(r.dead).toBe(true);
      expect(r.consumed).toBe(142);
    });

    it('GRAL #64 plays every move and never wins without it', () => {
      const r = replayUnder(64, 'grail', { ...BOTH, startedIdle: false });
      expect(r.won).toBe(false);
      expect(r.dead).toBe(false);
      expect(r.consumed).toBe(1691); // the whole recording, to no effect
    });
  });

  describe('the busy rule is load-bearing, and separately so', () => {
    it('WIN #68 plays every move and never wins when a busy-dropped move is consumed', () => {
      // Not a variant of the cadence failure: the cadence here is CORRECT. A command
      // offered while a fish is mid-dialogue is dropped by DalsiPrikaz (URoom.pas:27003),
      // and the recording only ever advanced on an accepted move — so consuming it loses a
      // move outright. WIN #68 notices because its own handover sets `busy` on both fish
      // for the bonus-level dialogue (:17953).
      const r = replayUnder(68, 'windoze', { ...BOTH, retryBusy: false });
      expect(r.won).toBe(false);
      expect(r.dead).toBe(false);
      expect(r.consumed).toBe(794);
    });
  });
});
