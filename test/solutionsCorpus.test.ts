/**
 * Corpus geometry — is a recording even POSSIBLE, before asking whether the port replays it?
 *
 * This exists because CHODBA #56 spent a long time filed as a port bug ("the divergence is
 * deep in the 3669-move solution, the robo-dogs desync from the recorded cadence") when the
 * recording itself was impossible. The measurement below takes about a millisecond and would
 * have said so immediately.
 *
 * The invariant: **a fish's X changes only through its own recorded left/right move.**
 * `pushObject` (`src/core/room.ts:471-474`, URoom.pas:26514) moves the items a fish pushes,
 * never the fish, and gravity is vertical. So replaying a recording as pure kinematics —
 * turn-in-place semantics, no collisions, no room — gives a horizontal span that is a LOWER
 * BOUND on the width of the room it was recorded in. If that bound exceeds the room, no
 * physics fix can ever make the recording replay.
 *
 * Vertical span is deliberately NOT checked. Gravity moves a fish down with no recorded
 * character, so the kinematic Y drifts up against reality by exactly the distance fallen, and
 * a legitimate fall-and-climb recording (`floppy`, `map`) accumulates a Y span well past the
 * room height. X has no such escape hatch, which is what makes it worth pinning.
 *
 * **The one exception, ZELVA #37.** Its telepathic turtle SEIZES a fish and walks it to a
 * random cell (`natvrdo`, `src/rooms/zelva.ts:85-101`), which the engine drives through
 * `press()` (`src/core/stepEngine.ts:364-372`) — horizontal motion the player did not
 * command. The port stays sound because `press()` records into `srecord` either way
 * (`stepEngine.ts:98-100,119,127`), so a capture taken here contains those characters. A
 * THIRD-PARTY recording need not, and any un-recorded sideways step decouples kinematic X
 * from the real X for the rest of the file, in either direction. #37 is therefore the one
 * room where a failure here might be the room and not the recording — the failure message
 * says so, because being misread is exactly how CHODBA cost months.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import type { FfrRoom } from '../src/data/ffr.js';
import { ROOMS } from '../src/data/roomTable.js';
import { SOLUTION_ROOMS } from './solutionsMapping.js';
import { recordedMoves } from './solutionsSource.js';
import { gameDataDir } from './gameData.js';

const roomFfr = (num: number) =>
  parseFfr(new Uint8Array(readFileSync(join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`))));
const roomWidth = (num: number): number => roomFfr(num).width;

/**
 * One control channel = one driveable slot, with its own left/right characters.
 *
 * They are counted SEPARATELY, and that is the whole point of the shape. WIN #68's bonus
 * adds a second symbol set for the elderly pair (`w/x/y/z`, see `solutionsHarness.ts`), and
 * `ZapniBonuslevel`/`VypniBonuslevel` re-point the slots at different fish mid-recording
 * (`src/rooms/win.ts:64,66,80-81`). Summing `l/r` with `y/z` would therefore track a counter
 * that jumps between two fish standing in different places: measured on `windoze`, the merged
 * big-fish span comes to 37 while the two channels separately need 39 and 12 — the merge is
 * SMALLER than the real requirement, so a corrupt second-set channel could hide behind the
 * cancellation, and with the opposite sign it would invent a failure instead.
 */
const CHANNELS = [
  { name: 'little fish', left: 'l', right: 'r', startsRight: (f: FfrRoom) => f.startFacingRight.small },
  { name: 'big fish', left: 'L', right: 'R', startsRight: (f: FfrRoom) => f.startFacingRight.big },
  // The elderly pair only exists inside WIN #68's bonus, and `ZapniBonuslevel` forces BOTH
  // to face right on the way in (`src/rooms/win.ts:59-60`, URoom.pas:23700). So their start
  // facing is a constant, not a property of the `.ffr`.
  { name: 'elderly little fish (WIN bonus)', left: 'y', right: 'z', startsRight: () => true },
  { name: 'elderly big fish (WIN bonus)', left: 'Y', right: 'Z', startsRight: () => true },
] as const;

/**
 * Columns one channel needs. A press against the facing turns in place and costs no cell,
 * which matches both the port (`stepEngine.press`) and FFNG's `Unit::goRight`/`goLeft`.
 *
 * `startsRight` is NOT a detail: the first press either turns or moves depending on it, so
 * guessing it shifts the span by one in whichever direction the guess was wrong, and a bound
 * that can be one too LARGE is not a lower bound at all. It comes from the room's own `.ffr`
 * (`Room` reads the same field, `src/core/room.ts:333-335`). Assuming `true` for everything
 * reported `cave`'s little fish as 29 columns against a real 28, and `elevator1`'s as 26
 * against 27 — the first of those is the shape that invents failures.
 *
 * Returns 0 for a channel the recording never uses.
 */
export function horizontalSpan(moves: string, left: string, right: string, startsRight: boolean): number {
  let x = 0;
  let facingRight = startsRight;
  let min = 0;
  let max = 0;
  let used = false;
  for (const ch of moves) {
    const wantRight = ch === right;
    if (!wantRight && ch !== left) continue;
    used = true;
    if (facingRight !== wantRight) {
      facingRight = wantRight;
      continue;
    }
    x += wantRight ? 1 : -1;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return used ? max - min + 1 : 0;
}

/** ZELVA's turtle can walk a fish sideways without the player asking; see the header. */
const NATVRDO_ROOM = 37;

describe('recorded solutions fit the room they are pinned to', () => {
  for (const slug of Object.keys(SOLUTION_ROOMS).sort()) {
    const num = SOLUTION_ROOMS[slug]!;
    const jmeno = ROOMS[num - 1]!.jmeno;

    it(`${slug} → #${num} ${jmeno} needs no more columns than the room has`, () => {
      const moves = recordedMoves(slug);
      const ffr = roomFfr(num);
      const width = ffr.width;
      const caveat =
        num === NATVRDO_ROOM
          ? ' — NOTE: #37 is the one room whose turtle moves a fish sideways on its own ' +
            '(natvrdo), so here, and ONLY here, this can fail on a sound recording; read the ' +
            'header of this file before concluding anything'
          : ' — the recording cannot be a faithful log of this room, so this is a CORPUS bug, ' +
            'not a port bug';
      for (const c of CHANNELS) {
        expect(
          horizontalSpan(moves, c.left, c.right, c.startsRight(ffr)),
          `${slug}: the ${c.name} sweeps more columns than #${num} ${jmeno} has (${width})${caveat}`,
        ).toBeLessThanOrEqual(width);
      }
    });
  }
});

describe('the check catches the recording CHODBA was misfiled on', () => {
  /**
   * Kept as a regression pin with the corrupt string inline, because the file it used to
   * live in has been replaced by a working 523-move recording, and this measurement is the
   * only thing standing between CHODBA and being re-filed as a port bug a second time.
   * This is the head of the repeating block that made the old recording impossible:
   * `l r×24 d×18`, five repeats of which already need more columns than the room has.
   */
  const CORRUPT_HEAD = 'l' + 'r'.repeat(24) + 'd'.repeat(18);

  const chodbaFacesRight = () => roomFfr(56).startFacingRight.small;

  it('flags it', () => {
    expect(horizontalSpan(CORRUPT_HEAD.repeat(5), 'l', 'r', chodbaFacesRight())).toBeGreaterThan(roomWidth(56));
  });

  it('and passes the recording that replaced it', () => {
    expect(horizontalSpan(recordedMoves('corridor'), 'l', 'r', chodbaFacesRight())).toBeLessThanOrEqual(
      roomWidth(56),
    );
  });

  /**
   * The merge bug the four-channel split exists to prevent, pinned so the shape cannot
   * quietly regress: `windoze`'s two big-fish channels need 39 and 12 columns on their own,
   * and summing them onto one counter reports less than either the truth or the room.
   */
  it("counts WIN #68's two control sets separately, since summing them under-reports", () => {
    const windoze = recordedMoves('windoze');
    const bigStartsRight = roomFfr(68).startFacingRight.big;
    expect(horizontalSpan(windoze, 'L', 'R', bigStartsRight)).toBe(39);
    expect(horizontalSpan(windoze, 'Y', 'Z', true)).toBe(12);
  });
});
