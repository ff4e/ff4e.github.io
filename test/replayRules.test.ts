/**
 * The rules the map "Replay" driver plays by, pinned against the rooms that prove they
 * are load-bearing.
 *
 * KUFRIK #2 adds a third, about what a replay must NOT do: start the tutorial
 * demonstration. Its moves are already in the record, and the last block below replays a
 * captured one into the exact room the live demo left (`replayAtShowmodeSpot`).
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
import { movesOf } from '../src/core/record.js';
import { decodeMoves } from '../src/core/solutionMoves.js';
import { ROOMS } from '../src/data/roomTable.js';
import { parseFfr } from '../src/data/ffr.js';
import { roomScript } from '../src/rooms/index.js';
import { gameDataDir } from './gameData.js';
import { recordedMoves } from './solutionsSource.js';
import { KNOWN_DIVERGENT, SOLUTION_ROOMS } from './solutionsMapping.js';

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
  /**
   * Give the next move back the `jizda` the last one landed with, across the settled tick
   * (`landed` in `replayMode.ts`). Not a correctness rule — it is how the replay keeps a
   * held key's acceleration — so it is on in `BOTH` and pinned harmless across the corpus.
   */
  carryJizda: boolean;
}

/**
 * `solutionsHarness.replaySolution` with the two rules made switchable. Deliberately a
 * copy rather than a parameter on the harness: the harness is the solvability net for 70
 * rooms and must not grow a knob that can silently change what that net asserts.
 */
function replayUnder(
  num: number,
  slug: string,
  rules: Rules,
  opts: { moves?: { which: 'little' | 'big'; dir: number }[]; atShowmodeSpot?: (room: Room, count: number) => void } = {},
): { won: boolean; dead: boolean; blocked: number; consumed: number; hash: string } {
  const jmeno = ROOMS[num - 1]!.jmeno;
  const ffr = join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`);
  const room = new Room(parseFfr(new Uint8Array(readFileSync(ffr))));
  const def = roomScript(jmeno) ?? null;
  const script = new Script(room, () => 12, () => false, {}, () => false);
  const engine = new StepEngine(room, script, def, { random: makeRng() });
  script.onWin = () => engine.triggerWin();
  let count = 0;
  if (opts.atShowmodeSpot) script.onShowmode = () => opts.atShowmodeSpot!(room, count);
  def?.init(script);
  if (room.padani()) engine.phase = 'fall';
  else {
    room.clearAllDirs();
    engine.phase = 'idle';
  }

  const steps = opts.moves ?? decodeMoves(recordedMoves(slug));
  let mi = 0;
  let landedJizda: number | null = null;
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
    const carried = landedJizda;
    landedJizda = null;
    if (rules.startedIdle && !idleAtStart) {
      landedJizda = engine.jizda;
      continue;
    }
    if (mi >= steps.length) {
      if (++idleAfterMoves > 120) break;
      continue;
    }
    const s = steps[mi]!;
    engine.active = s.which;
    room.hracNespi();
    if (rules.carryJizda && carried !== null) engine.jizda = carried;
    if (engine.press(s.which, s.dir) === 'busy' && rules.retryBusy) continue;
    mi++;
  }
  // The same snapshot as `__ff.posHash()`, so a live capture can be pasted in as-is.
  const hash = [
    ...room.items.map((it) => `${it.x},${it.y}`),
    `fL:${room.facingRight.little ? 1 : 0}`,
    `fB:${room.facingRight.big ? 1 : 0}`,
    `vL:${room.venku.little ? 1 : 0}`,
    `vB:${room.venku.big ? 1 : 0}`,
  ].join('|');
  return { won: engine.won, dead: room.anyFishDead, blocked: engine.blocked, consumed: mi, hash };
}

const BOTH: Rules = { startedIdle: true, retryBusy: true, carryJizda: true };

describe('map Replay rules', () => {
  // `solutions.test.ts` proves the corpus solves under the settled tick alone. The live
  // replay also carries `jizda` across it, which changes how many ticks each cell takes —
  // and so where every timed room script stands when the next move arrives. Measured: same
  // result in every room, 28% fewer ticks in total.
  it("every recorded room still solves under the replay's own timing", () => {
    const failed = Object.keys(SOLUTION_ROOMS)
      .filter((slug) => !KNOWN_DIVERGENT.has(slug))
      .map((slug) => ({ slug, ...replayUnder(SOLUTION_ROOMS[slug]!, slug, BOTH) }))
      .filter((r) => !r.won || r.dead || r.blocked > 0)
      .map(({ slug, won, dead, blocked, consumed }) => ({ slug, won, dead, blocked, consumed }));
    expect(failed).toEqual([]);
  });

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

  describe('KUFRIK #2: the demonstration is replayed from the record, never started', () => {
    // A real record, captured from live play on the build that introduced this test with
    // `__ff.record()` once the demonstration had run to its end: 155 player moves to the
    // tutorial spot, the demo's 22 to its F2 checkpoint, and the 200 it plays after its
    // last F3 load. Those last 200 rearrange the room — three items end somewhere else —
    // and a player's remaining moves are made in THAT room, so they cannot be skipped.
    const RECORD =
      'KLLLLLJSDDDDDDDDDDDDDDDDDDDDSSDDDDDDDDDSSSSSDDDDDAAAAADDDDDDAASSSSSSSSAAASSAAAAAWWAAWDAKKLLLLLLLLLLLLLLLKKLLLL' +
      'LLLLLLLLLJJJJLLLLLLKKKKKKKKKKKKKKJJJJJJJJJJJJJJJJJJJJKKAAAAAAAAASASJJJJJJJJJJJIIILLLLASSAAAAAAAAASSSSSDDDWKKKJJ' +
      'KKLLJJJJJJKKKWWLLLLLLLILAAASAAAAJJJJJIIIIJIKIIIIIIJLLLLIILLDDDDDDSDWWWJJJKKLLLKKKLLJJJJJJJKKKKKKLLLLLLLLLILLLIII' +
      'IIJJJLLLDDDAAAKKKKJJJAAADDDDLLLLIJDDDDDDJJLL';
    /** `__ff.posHash()` in the live room the moment the demonstration ended. */
    const DEMO_END = '0,0|17,7|17,25|16,26|28,18|22,24|24,29|4,17|11,27|13,24|9,34|fL:1|fB:1|vL:0|vB:0';

    /** `replayAtShowmodeSpot` (`src/app/replayMode.ts`): the demo's turn, and nothing else. */
    const turnBigLeft = (room: Room) => {
      room.facingRight.big = false; // natoceni[velka] := smer_vlevo
    };

    it('the recorded moves alone rebuild the room the demonstration left', () => {
      const r = replayUnder(2, 'briefcase', BOTH, { moves: movesOf(RECORD), atShowmodeSpot: turnBigLeft });
      expect(r).toMatchObject({ dead: false, consumed: 377 });
      expect(r.hash).toBe(DEMO_END);
    });

    // The capture above reached the spot with the big fish already facing left, so it
    // cannot tell whether the turn matters. Make the big fish turn right (a turn in place,
    // `D`) just before the little fish's last move brings both onto the spot: live, the
    // demo then turns it back without recording anything, so the record is otherwise the
    // same and the room must end the same.
    const TURNED = RECORD.slice(0, 154) + 'D' + RECORD.slice(154);

    it("the demo's unrecorded turn is replayed too", () => {
      const r = replayUnder(2, 'briefcase', BOTH, { moves: movesOf(TURNED), atShowmodeSpot: turnBigLeft });
      expect(r).toMatchObject({ dead: false, consumed: 378 });
      expect(r.hash).toBe(DEMO_END);
    });

    it('…and is load-bearing: without it the demo replays one cell off', () => {
      const r = replayUnder(2, 'briefcase', BOTH, { moves: movesOf(TURNED) });
      expect(r.hash).not.toBe(DEMO_END);
    });
  });
});
