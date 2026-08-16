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
import { recordedSlugs, recordedMoves } from './solutionsSource.js';
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

describe('corridor is unmappable, not merely unmapped', () => {
  /**
   * Pinned as a number so nobody re-files CHODBA as a port bug. 1398 columns is not "a bit
   * over" 34 — it is wider than the widest room in the game by a factor of 27, and the track
   * is ~50 repeats of a `l r×24 d×18` block that never returns left. See solutionsMapping.ts.
   */
  it('corridor.moves needs more columns than any of the 72 rooms', () => {
    expect(recordedSlugs()).toContain('corridor');
    const span = horizontalSpan(recordedMoves('corridor'), true);
    expect(span, 'corridor little-fish horizontal span').toBe(1398);

    const widest = Math.max(...ROOMS.map((r) => roomWidth(r.num)));
    expect(span, `widest room in the game is ${widest} columns`).toBeGreaterThan(widest);
  });

  /** The other channel is ordinary, which is why the file looks like a real recording. */
  it("corridor.moves' big-fish track is room-sized, so only the little-fish channel is corrupt", () => {
    expect(horizontalSpan(recordedMoves('corridor'), false)).toBeLessThanOrEqual(roomWidth(56));
  });
});
