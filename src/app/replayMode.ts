/**
 * The map's "Replay": playing a room's stored best solution back at the player.
 *
 * One driver, one decision — when may the next recorded move be played — and it is a
 * different decision from the one a held key makes. That is the whole reason this is its
 * own module rather than another function in `cutscene.ts`: the KUFRIK demo and the
 * help.cap showmode next door really are `DalsiPrikaz` and really do share the keyboard's
 * cadence, and keeping the three in one file is what let this one quietly inherit a rule
 * that does not apply to it.
 *
 * The sibling to read alongside this is `solveMode.ts` — the dev-bar replay, same shape,
 * same cadence rule, opposite failure policy (it aborts loudly; this one hands control
 * back and returns to the map).
 */
// No `init*` host here, deliberately: both names this module needs have an owning module
// already (`hracNespi` in `gameState.ts`, `showMap` in `mapNav.ts`), so routing them
// through `main.ts` would only add an accessor to write and a wire to get wrong — see the
// host-accessor note in AGENTS.md.
import { count, engine, hracNespi, replaymode, room, setReplaymode } from './gameState.js';
import { showMap } from './mapNav.js';
import { tryStep } from './movement.js';

/** True while a map "Replay" is running. The SILENCE predicate (`scriptTalk`, `Zvuky_okoli`;
 *  faithful, `loadtype=nej`); the input lockout is `inAutoPlay()` in `solveMode.ts`. */
export function inReplay(): boolean {
  return replaymode !== null;
}

/**
 * The cell a replayed move just landed on, while the settled tick `startedIdle` asks for is
 * still to come — and the `jizda` the fish had as it landed.
 *
 * That settled tick is what keeps the replay correct, and it is also what made it look
 * wrong: drawn, it is a visible stop between every two cells, and `advance()` resets `jizda`
 * on it, so a long run never accelerated 3 -> 2 -> 1 ticks per cell the way a held key or
 * the KUFRIK demonstration does. Neither is something the room needs. So:
 *
 *  - `renderLoop.ts` runs the settled tick at once, in the same frame as the landing
 *    (`replaySettleDue`). Every tick still runs, in order — `prog` gets its at-rest pass —
 *    but none of it is drawn, so the fish moves straight on.
 *  - The next move gets back the `jizda` the landing had, which is exactly what a held key
 *    starts its next cell with (`dispatchHeldMove` presses on the landing tick itself).
 *
 * `jizda` only sets how many ticks a cell animates for, never where anything goes, and the
 * whole solution corpus replays to the same result under this timing as under the plain
 * settled tick — `test/replayRules.test.ts` holds that.
 */
let landed: { engine: object; tick: number; jizda: number } | null = null;

/** The tick just run landed a replayed move, so the next is its settled tick: run it now. */
export function replaySettleDue(): boolean {
  return replaymode !== null && landed?.engine === engine && landed.tick === count;
}

/**
 * KUFRIK's tutorial spot reached during a replay: the room script asks for the automatic
 * demonstration (URoom.pas:19923), and a replay must NOT start it.
 *
 * The demonstration's moves are already IN the record. `startShowmode`'s driver feeds
 * help.cap through `tryStep`, so `srecord` keeps every move the demo made — the walk to
 * its F2 checkpoint, and everything after its last F3 load, which rearranges the room the
 * player then went on to solve. Starting the demo again here put a second driver on the
 * same fish, interleaved with the recorded copy of the first, and both derailed. The
 * original never meets this: its replay is `loadmode`, which exits before `Programky`
 * (URoom.pas:24310), so no room script — and so no demonstration — runs at all. The
 * recorded demo moves simply play back, silent, like every other move.
 *
 * The briefcase STORY (`startKufrDemo`, InitKufrDemo) is held back for the same reason,
 * at the same wiring in `main.ts`: it moves nothing, so the record does not depend on it,
 * and the original's replay never reaches it. Played here it froze the replay for two
 * minutes of music and narration inside a replay that is otherwise silent.
 *
 * The one thing starting the demo did to the room that the record does NOT carry is the
 * facing: `natoceni[velka] := smer_vlevo` (`startShowmode`), with no move recorded for
 * it. The demo's first big-fish `left` was recorded as a step; replayed onto a big fish
 * that reached the spot facing right it becomes a turn in place, and every move after it
 * lands one cell off.
 *
 * `prog` asks on every tick both fish stand there (live, `showmode` gates it off after the
 * first), so this repeats until the first recorded move takes the little fish away. Every
 * arrival in a record starts the demo, so those moves are the demo's own, which leave the
 * big fish alone — repeating the turn changes nothing.
 */
export function replayAtShowmodeSpot(): void {
  if (room) room.facingRight.big = false; // natoceni[velka] := smer_vlevo
}

/**
 * Play back one move of the room's best solution per settled tick (daReplay, the
 * animated LoadSpeed:=1 replay, URoom.pas:1932). Each move drives the real swim
 * animation via tryStep; on the last move the normal win → winCountdown → showMap
 * path returns to the map. A death aborts back to the map.
 */
export function advanceReplay(
  /**
   * Whether this tick BEGAN at rest, not merely "is at rest now". A tick that only became
   * idle inside `engine.advance()` has not yet given the room's `prog` an at-rest pass, so
   * a move played on it starts BEFORE the script has observed the cell the previous move
   * landed on.
   *
   * This is deliberately STRICTER than the cadence a held key gets, because the original
   * has two different code paths here, not one:
   *
   *  - A HELD KEY goes through `DalsiPrikaz` inside the tick's `repeat … until` loop
   *    (URoom.pas:24351/24438, `until gstav >= stavy_platne` at :24927). A finished move
   *    sets `stav_ma_padat` (:24838), which becomes `stav_nic` when nothing is falling
   *    (:24881) — both below `stavy_platne`, so the loop spins back round and reaches
   *    `DalsiPrikaz` again on the SAME tick, with `Programky` running once afterwards
   *    (:24940). Held direction keys re-register on every call (`KeyRoom` 1→2 at :26945;
   *    `ZaznamenejPrikazKlavesou` returns true for them at any `stav`, Uovl.pas:787-806,
   *    while one-shot keys are gated `stav<>2` at :774/:781). The loose cadence in
   *    `logicTick.ts` is therefore faithful, and stays.
   *
   *  - A REPLAY does not go through `DalsiPrikaz` at all. The original replays a solution
   *    in `loadmode`, a separate tick body (URoom.pas:24102-24311) that `exit`s at :24310
   *    — before the state machine and before `Programky`. It applies each move instantly
   *    (:24240-24293) and never re-derives script effects: they are IN the recording, which
   *    is why entering WIN #68's bonus level is a literal `b`/`1` pair in the save stream
   *    (:24148-24162) rather than something the room script works out again.
   *
   * This port animates the replay through the live tick, so it DOES re-derive those effects
   * by running `prog` — which is only sound if `prog` observes every state the recording
   * passed through, i.e. one settled tick per move. Under the loose cadence it does not,
   * and exactly two rooms in the corpus break: WIN #68 dies at move 142, GRAL #64 plays all
   * 1691 moves and never wins. Pinning `jizda` to 0 changes neither, so the acceleration is
   * not the cause — the cadence is. `test/replayRules.test.ts` holds both measurements.
   */
  startedIdle: boolean,
): void {
  if (!replaymode || !room || !engine) return;
  if (room.anyFishDead) {
    // The best solution shouldn't kill a fish, but abort safely to the map if it does.
    setReplaymode(null);
    showMap();
    return;
  }
  if (!startedIdle) {
    landed = { engine, tick: count, jizda: engine.jizda }; // not a tick to move on — see `startedIdle`
    return;
  }
  const carried = landed?.engine === engine && landed.tick === count - 1 ? landed.jizda : null;
  landed = null;
  if (replaymode.idx >= replaymode.moves.length) {
    setReplaymode(null); // ran dry without a win (defensive) — hand control back
    return;
  }
  const m = replaymode.moves[replaymode.idx]!;
  engine.active = m.which;
  // hrac_nespi BEFORE the busy gate, exactly where DalsiPrikaz puts it (URoom.pas:26985 vs
  // the busy drop at :27003) — a replayed command counts as activity even when it is
  // dropped, which is what keeps ZELVA's turtle from seizing a fish mid-replay.
  hracNespi();
  // A move offered while a fish is talking is DROPPED, not consumed: `busy` clears on a
  // later tick and the recording only ever advanced on an accepted move, so consuming it
  // here loses it outright. That is a SECOND break, independent of the cadence above —
  // WIN #68 plays all 794 moves and never wins on this rule alone, with the cadence
  // correct, because its own bonus-level handover sets `busy` on both fish (URoom.pas:17953).
  // The headless net (`test/solutionsHarness.ts`) and the dev-bar driver (`solveMode.ts`)
  // both already retry; this was the path that did not.
  if (carried !== null) engine.jizda = carried; // see `landed`
  if (tryStep(m.which, m.dir) === 'busy') return;
  replaymode.idx++;
}
