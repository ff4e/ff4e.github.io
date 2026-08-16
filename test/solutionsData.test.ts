/**
 * The migration guard: the solutions in the ROOM DATA are exactly the recordings in the
 * staging area, and nothing else drifted when the source moved.
 *
 * `src/rooms/solutions.ts` is generated from `test/fixtures/solutions/*.moves` by
 * `npm run gen-solutions`. Generated-and-committed means it can be hand-edited, or left
 * stale after a recording changes, and nothing else in the suite would notice: the
 * replays in `solutions.test.ts` would just be replaying a different string than the one
 * the corpus holds, and still pass. This file is what makes that a failure.
 *
 * It needs no game data — a recording is a move-string — so it runs everywhere, including
 * CI, like `solutionsCoverage.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { ROOMS } from '../src/data/roomTable.js';
import { roomScript, solutionFor } from '../src/rooms/index.js';
import { ROOM_SOLUTIONS } from '../src/rooms/solutions.js';
import { SOLUTION_ROOMS } from './solutionsMapping.js';
import { recordedSlugs, stagedRecording } from './solutionsSource.js';

/** Both control sets: the standard fish pair (udlr) and WIN #68's elderly pair (wxyz). */
const MOVE_CHARS = /^[udlrwxyzUDLRWXYZ]+$/;

/** Recorded but pinned to no room, so it has no room data to live in. See `solutionsSource.ts`. */
const UNPORTED = new Set(['rush']);

describe('solutions as room data', () => {
  const jmenoOf = (slug: string): string => ROOMS[SOLUTION_ROOMS[slug]! - 1]!.jmeno;
  const portedSlugs = recordedSlugs().filter((s) => !UNPORTED.has(s));

  it('every staged recording that belongs to a room round-trips byte-identically', () => {
    const drifted = portedSlugs.filter((s) => ROOM_SOLUTIONS[jmenoOf(s)] !== stagedRecording(s));
    expect(drifted, 'room data differs from the staged recording — run `npm run gen-solutions`').toEqual([]);
  });

  it('the generated table is exactly the ported slugs, no more and no less', () => {
    expect(Object.keys(ROOM_SOLUTIONS).length, 'rooms carrying a solution').toBe(portedSlugs.length);
    const expected = portedSlugs.map(jmenoOf).sort();
    expect(Object.keys(ROOM_SOLUTIONS).sort()).toEqual(expected);
  });

  it('every solution is attached to a real room that has a script module', () => {
    const names = Object.keys(ROOM_SOLUTIONS);
    const notARoom = names.filter((n) => !ROOMS.some((r) => r.jmeno === n));
    expect(notARoom, 'solutions keyed by something that is not a room name').toEqual([]);

    const noScript = names.filter((n) => !roomScript(n));
    expect(noScript, 'solutions with no room script to attach to').toEqual([]);

    const notAttached = names.filter((n) => roomScript(n)?.solution !== ROOM_SOLUTIONS[n]);
    expect(notAttached, 'solution present in the table but not on the RoomScript').toEqual([]);
  });

  it('every solution is a non-empty string of move characters only', () => {
    const bad = Object.entries(ROOM_SOLUTIONS).filter(([, m]) => !MOVE_CHARS.test(m));
    expect(bad.map(([n]) => n), 'solutions containing non-move characters').toEqual([]);
  });

  /**
   * The accessor is what every caller is supposed to use, so its two answers are pinned
   * by name. `missing` is not a gap to close: ZAVER #71 is the ending and SCORE #72 the
   * results screen, and neither is a puzzle.
   */
  it('solutionFor answers ok for every puzzle room and missing for the two that are not', () => {
    const missing = ROOMS.filter((r) => solutionFor(r.jmeno).known === 'missing').map((r) => `#${r.num} ${r.jmeno}`);
    expect(missing, 'rooms whose solution the accessor cannot find').toEqual(['#71 ZAVER', '#72 SCORE']);

    expect(solutionFor('PRVNI').moves, 'a room that has one').toBe(ROOM_SOLUTIONS['PRVNI']);
    expect(solutionFor('NOT_A_ROOM'), 'a name that is not a room at all').toEqual({ moves: null, known: 'missing' });
  });

  /**
   * Attaching the solution must not disturb the script it is attached to. `roomScript()`
   * returns a composed object rather than the module's own export, so this pins that the
   * composition copied the behaviour across rather than replacing it.
   */
  it('attaching a solution leaves the room script itself intact', () => {
    for (const r of ROOMS) {
      const s = roomScript(r.jmeno);
      if (!s) continue;
      expect(s.name, `${r.jmeno} kept its name`).toBe(r.jmeno);
      expect(typeof s.init, `${r.jmeno} kept init`).toBe('function');
      expect(typeof s.prog, `${r.jmeno} kept prog`).toBe('function');
    }
  });
});
