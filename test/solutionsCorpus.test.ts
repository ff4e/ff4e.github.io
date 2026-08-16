/**
 * Corpus geometry — is a recording even POSSIBLE, before asking whether the port replays it?
 *
 * This exists because CHODBA #56 spent a long time filed as a port bug ("the divergence is
 * deep in the 3669-move solution, the robo-dogs desync from the recorded cadence") when the
 * recording itself was impossible. The measurement below takes about a millisecond and would
 * have said so immediately.
 *
 * The invariant: **a fish's X changes only through its own recorded left/right move.**
 * Nothing in this engine shifts a fish sideways — `pushObject` (URoom.pas:26514) moves items
 * a fish pushes, never the other way round, and gravity is vertical. So replaying a recording
 * as pure kinematics — turn-in-place semantics, no collisions, no room — gives a horizontal
 * span that is a LOWER BOUND on the width of the room it was recorded in. If that bound
 * exceeds the room, no physics fix can ever make the recording replay.
 *
 * Vertical span is deliberately NOT checked. Gravity moves a fish down with no recorded
 * character, so the kinematic Y drifts up against reality by exactly the distance fallen, and
 * a legitimate fall-and-climb recording (`floppy`, `map`) accumulates a Y span well past the
 * room height. X has no such escape hatch, which is what makes it worth pinning.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { ROOMS } from '../src/data/roomTable.js';
import { SOLUTION_ROOMS } from './solutionsMapping.js';
import { recordedMoves } from './solutionsSource.js';
import { gameDataDir } from './gameData.js';

const roomWidth = (num: number): number =>
  parseFfr(new Uint8Array(readFileSync(join(gameDataDir(), 'Graphic', `${String(num).padStart(3, '0')}.ffr`)))).width;

/** Direction letters that drive a fish left / right, in either control set (see solutionsHarness). */
const LEFT = new Set(['l', 'y']);
const RIGHT = new Set(['r', 'z']);

/**
 * Columns the given control case (lowercase = little, uppercase = big) needs, replaying
 * horizontal moves only. A press against the facing turns in place and costs no cell, which
 * matches both the port and FFNG's `Unit::goRight`/`goLeft`; assuming otherwise would only
 * make the span smaller, so the bound stays honest either way.
 */
export function horizontalSpan(moves: string, lowercase: boolean): number {
  let x = 0;
  let facingRight = true;
  let min = 0;
  let max = 0;
  for (const ch of moves) {
    if ((ch === ch.toLowerCase()) !== lowercase) continue;
    const c = ch.toLowerCase();
    const wantRight = RIGHT.has(c);
    if (!wantRight && !LEFT.has(c)) continue;
    if (facingRight !== wantRight) {
      facingRight = wantRight;
      continue;
    }
    x += wantRight ? 1 : -1;
    min = Math.min(min, x);
    max = Math.max(max, x);
  }
  return max - min + 1;
}

describe('recorded solutions fit the room they are pinned to', () => {
  for (const slug of Object.keys(SOLUTION_ROOMS).sort()) {
    const num = SOLUTION_ROOMS[slug]!;
    const jmeno = ROOMS[num - 1]!.jmeno;

    it(`${slug} → #${num} ${jmeno} needs no more columns than the room has`, () => {
      const moves = recordedMoves(slug);
      const width = roomWidth(num);
      for (const [which, lowercase] of [
        ['little', true],
        ['big', false],
      ] as const) {
        expect(
          horizontalSpan(moves, lowercase),
          `${slug}: the ${which} fish sweeps more columns than #${num} ${jmeno} has (${width}) — ` +
            `the recording cannot be a faithful log of this room, so this is a CORPUS bug, not a port bug`,
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

  it('flags it', () => {
    expect(horizontalSpan(CORRUPT_HEAD.repeat(5), true)).toBeGreaterThan(roomWidth(56));
  });

  it('and passes the recording that replaced it', () => {
    expect(horizontalSpan(recordedMoves('corridor'), true)).toBeLessThanOrEqual(roomWidth(56));
  });
});
