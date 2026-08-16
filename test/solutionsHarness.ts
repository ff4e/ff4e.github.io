/**
 * Headless solution-replay harness. Builds a room, attaches its ported script, and
 * replays a decoded FFNG move-string through the SHARED step-engine (the same
 * physics + prog() + win-hook path the browser game loop uses), reporting whether
 * the room is solved cleanly (won, no death, no blocked move).
 *
 * Move encoding: lowercase = little (small) fish, UPPERCASE = big; u/d/l/r = up/
 * down/left/right. "Turn-in-place first" (a horizontal press while facing away only
 * flips facing, consuming no cell) matches the port, so step counts line up.
 *
 * WIN #68's bonus level adds a SECOND symbol set, w/x/y/z (+ W/X/Y/Z). FFNG models the
 * two elderly fish as extra units whose control symbols are spelled out in the model
 * kind — `fish_extra-wxyz` / `fish_EXTRA-WXYZ` in `script/windoze/models.lua` — and
 * `ModelFactory::parseExtraControlSym` reads those four characters as (up, down, left,
 * right) in that order. Hence w=up, x=down, y=left, z=right, lowercase = `staramala`
 * and uppercase = `staravelka`. The Delphi original has no second set: ZapniBonuslevel
 * (URoom.pas:23700) re-points Little/Big at the elderly pair, so the SAME two slots are
 * being driven and the letters simply map onto little/big.
 */
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { Script } from '../src/core/script.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { roomScript } from '../src/rooms/index.js';

export type Which = 'little' | 'big';

export interface ReplayResult {
  won: boolean;
  dead: boolean;
  blocked: number;
  steps: number;
  /**
   * How many recorded moves were actually APPLIED before the replay stopped. The loop
   * aborts on a win and on a death, so this is < `steps` whenever either happened — and
   * `blocked` is counted over THIS many moves, not over `steps`.
   *
   * It is reported because reading `blocked / steps` as a rate is a live trap. A
   * case-swapped CHODBA replay scores "6 blocked of 3669", which reads like a room that
   * almost works; it applied 15 moves before a fish died, so the real rate is 6 of 15.
   * That reading is what put "the fish identities are swapped in CHODBA and POHON" on the
   * table for a while — see the corridor note in `solutionsMapping.ts`.
   */
  applied: number;
  wonAt: number; // step index the win latched at (-1 if never)
  blockedAt: number[]; // step indices the engine rejected (for diagnosis)
}

/** Direction letters per control set: the standard fish pair, then WIN's elderly pair. */
const MOVE_LETTERS: Readonly<Record<string, number>> = {
  u: Dir.up,
  d: Dir.down,
  l: Dir.left,
  r: Dir.right,
  w: Dir.up,
  x: Dir.down,
  y: Dir.left,
  z: Dir.right,
};

export function decodeMove(ch: string): { which: Which; dir: number } | null {
  const l = ch.toLowerCase();
  const dir = MOVE_LETTERS[l];
  if (dir === undefined) return null;
  return { which: (ch === l ? 'little' : 'big') as Which, dir };
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
  // saying so — it "passed" a quarter of a room it never played. A recording that
  // grows a character this decoder does not know is a bug in one of the two, so say
  // so loudly rather than replaying a shorter solution.
  const steps = [...moves].map((ch, i) => {
    const m = decodeMove(ch);
    if (!m) {
      throw new Error(
        `undecodable move character ${JSON.stringify(ch)} at index ${i} of the ${jmeno} recording ` +
          `(known: ${Object.keys(MOVE_LETTERS).join('')} in either case)`,
      );
    }
    return m;
  });
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

  return { won: engine.won, dead: room.anyFishDead, blocked: engine.blocked, steps: steps.length, applied: mi, wonAt, blockedAt };
}
