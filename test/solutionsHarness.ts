/**
 * Headless solution-replay harness. Builds a room, attaches its ported script, and
 * replays a decoded FFNG move-string through the SHARED step-engine (the same
 * physics + prog() + win-hook path the browser game loop uses), reporting whether
 * the room is solved cleanly (won, no death, no blocked move).
 *
 * Move encoding lives in `src/core/solutionMoves.ts`, which this shares with the dev-bar
 * solution replay — including WIN #68's second control set. "Turn-in-place first" (a
 * horizontal press while facing away only flips facing, consuming no cell) matches the
 * port, so step counts line up.
 */
import { Room } from '../src/core/room.js';
import { Script } from '../src/core/script.js';
import { decodeMoves } from '../src/core/solutionMoves.js';
import type { Which } from '../src/core/solutionMoves.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { roomScript } from '../src/rooms/index.js';

export type { Which };

export interface ReplayResult {
  won: boolean;
  dead: boolean;
  blocked: number;
  steps: number;
  /**
   * How many recorded commands the replay CONSUMED before it stopped. The loop aborts on a
   * win and on a death, so this is < `steps` whenever either happened.
   *
   * "Consumed", not "applied", and the distinction is the point: a command the engine
   * refuses still consumes its step (the recording moves on), while one dropped as `busy`
   * does not (it is retried next tick). So this counts commands taken off the recording,
   * which is what you want for "how far did we get" — it is not a count of successful moves.
   *
   * It is reported because reading `blocked / steps` as a rate is a live trap. A
   * case-swapped CHODBA replay scores "6 blocked of 3669", which reads like a room that
   * almost works; it got 15 commands in before a fish died, so the real rate is 6 of 15.
   * That reading is what put "the fish identities are swapped in CHODBA and POHON" on the
   * table for a while — see the corridor note in `solutionsMapping.ts`.
   *
   * `blocked` is not a count over this either, though it usually matches: the engine also
   * presses on its own behalf, for ZELVA's possession retry and the auto-swim
   * (`stepEngine.ts:372,377`), and a refusal there lands in the same counter. If `blocked`
   * ever exceeds `consumed`, that is where the difference went — not a recorded move.
   */
  consumed: number;
  wonAt: number; // step index the win latched at (-1 if never)
  blockedAt: number[]; // step indices the engine rejected (for diagnosis)
}

/** Deterministic RNG so replays never vary (the engine only uses it for cheer/bubble sound choice). */
function makeRng(): (n: number) => number {
  let state = 0x2545f491;
  return (n: number): number => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return n > 0 ? state % n : 0;
  };
}

/**
 * Replay `moves` against a freshly-built `room` (already parsed, not yet settled).
 * `jmeno` selects the ported room script (Programky) so script-gated wins (gspec=9
 * push-out, PARTY2, CHODBA, …) resolve exactly as in-game.
 */
export function replaySolution(room: Room, jmeno: string, moves: string): ReplayResult {
  const def = roomScript(jmeno) ?? null;
  const script = new Script(
    room,
    () => 12, // talk: return a nominal line length; audio/subtitles are irrelevant headless
    () => false,
    {},
    () => false,
  );
  const engine = new StepEngine(room, script, def, { random: makeRng() });
  script.onWin = () => engine.triggerWin();
  def?.init(script);

  // Load-time gravity settle (buildRoom): animate the initial fall so the script can
  // observe it, exactly like the game loop.
  if (room.padani()) engine.phase = 'fall';
  else {
    room.clearAllDirs();
    engine.phase = 'idle';
  }

  // An undecodable character used to be dropped here silently, which is how 214 of
  // windoze's 783 moves (27% of the solution) went missing without the replay ever
  // saying so — it "passed" a quarter of a room it never played. `decodeMoves` throws
  // instead, so a recording that grows a character the decoder does not know fails
  // rather than replaying a shorter solution.
  let steps;
  try {
    steps = decodeMoves(moves);
  } catch (e) {
    throw new Error(`${(e as Error).message} of the ${jmeno} recording`);
  }
  let wonAt = -1;
  const blockedAt: number[] = [];

  // One faithful tick loop mirroring the original's Timer order: Programky (prog) +
  // motion run FIRST, THEN a recorded move is applied while at rest (DalsiPrikaz in
  // stav_klid). A move is applied only on a tick that STARTED idle — i.e. one where
  // `prog` already ran at rest — so autonomous at-rest logic (the gspec=9 Spec9 mark
  // that starts the cork slide) gets to preempt a trailing recorded push instead of
  // the harness applying it into a wall and (wrongly) counting it blocked.
  let count = 0;
  let mi = 0; // index of the next recorded move to apply
  let idleAfterMoves = 0;
  const guardMax = steps.length * 60 + 20_000;
  for (let guard = 0; guard < guardMax; guard++) {
    count++;
    const idleAtStart = engine.phase === 'idle';
    engine.runScript(count, 0);
    script.dialogy(count); // keep is_dialog evolving (some prog gates on it)
    engine.advance();
    if (engine.won) {
      wonAt = mi;
      break;
    }
    if (room.anyFishDead) break;
    if (engine.phase !== 'idle' || !idleAtStart) continue; // still animating, or prog
    // has not yet had an at-rest tick on this freshly-settled frame.
    if (mi < steps.length) {
      const s = steps[mi]!;
      engine.active = s.which; // the moved fish becomes active (aktivni)
      // DalsiPrikaz calls hrac_nespi as it reads each command out of the capture file
      // (URoom.pas:26985) — a replayed command counts as the player being awake, exactly
      // like a keypress (26787) or a click (26871). It is deliberately BEFORE the busy
      // gate: the original reaches `busy[mala]>0 -> kdo:=0` only at :27003, so a command
      // dropped mid-dialogue has already reset the timers. Without this the idle timers
      // (delay[]) only ever grow here, because nothing else in the shared step-engine
      // resets them: `hracNespi` lives in `src/app/`, and the browser's own replay path
      // calls it (`cutscene.ts:199`).
      //
      // ZELVA #37 is the room that notices. Its telepathic turtle SEIZES a fish and walks
      // it across the room once `delay[mala] > 40` and `delay[velka] > 40` (`zelva.ts:85`),
      // which under a replay used to be "always, from move ~40 on" — so the port drove the
      // big fish off the recorded route, refused the player's moves in runs while it did,
      // and killed the little fish 111 moves into a 620-move solution. It looked exactly
      // like a physics divergence and was not one.
      room.hracNespi();
      const before = engine.blocked;
      const r = engine.press(s.which, s.dir);
      // DalsiPrikaz drops a command while the fish is busy (mid-dialogue). The recording
      // only ever advanced on an ACCEPTED move, so wait — don't consume this step —
      // until the scheduled dialogue clears busy on a later tick.
      if (r === 'busy') continue;
      if (engine.blocked > before) blockedAt.push(mi);
      mi++;
    } else if (++idleAfterMoves > 120) {
      break; // moves exhausted and the room has been idle a while — no autonomous win
    }
  }
  if (engine.won && wonAt < 0) wonAt = mi;

  return { won: engine.won, dead: room.anyFishDead, blocked: engine.blocked, steps: steps.length, consumed: mi, wonAt, blockedAt };
}
