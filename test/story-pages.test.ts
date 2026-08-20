/**
 * Which rooms can put a story page on screen — the room-entry preload's whole decision.
 *
 * `storyPageOfRoom` is what `roomPreload.ts` asks before deciding whether entering a room
 * has to fetch that room's story page. Getting it wrong does not break anything visibly:
 * the page is still fetched, just later — at the moment the win countdown lapses, which is
 * DURING PLAY, which is the one thing this whole change exists to stop. A room dropped from
 * this mapping therefore reintroduces the bug silently, and no probe would notice.
 *
 * So the mapping is pinned here rather than in the browser: it is a pure function of the
 * world tree, it costs milliseconds, and the two facts worth stating — "every leg's last
 * room, and ZAVER, and nothing else" — read as a sentence.
 */
import { describe, expect, it } from 'vitest';
import {
  REGISTERED_ROOMS,
  ZAVER_LEG,
  ZAVER_ROOM,
  branchOfRoom,
  depthOfRoom,
  storyPageOfRoom,
} from '../src/data/world.js';

/** Every room the game has, including the two unregistered ones (ZAVER, SCORE). */
const ALL_ROOMS = Array.from({ length: 72 }, (_, i) => i + 1);

describe('story pages a room can reach', () => {
  it('is exactly the eight leg-final rooms, one per leg', () => {
    const legFinals = REGISTERED_ROOMS.filter((r) => depthOfRoom(r) === 15);
    // Stated as a count as well as a mapping: the original's zobraz_obrazek is reached
    // from `hloubka=15`, and there is exactly one such room per branch 1..8.
    expect(legFinals).toHaveLength(8);
    expect(legFinals.map(storyPageOfRoom)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(legFinals.map(branchOfRoom)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('plus ZAVER, whose ENDING shows page 9 — the one that is easy to forget', () => {
    // `returnFromRoom` shows 009.$dv when ZAVER finishes, so without this the very last
    // asset of a playthrough would be fetched at the very last moment of it.
    expect(storyPageOfRoom(ZAVER_ROOM)).toBe(ZAVER_LEG);
  });

  it('and nothing else: no other room can put a page on screen', () => {
    const reaching = ALL_ROOMS.filter((r) => storyPageOfRoom(r) !== 0);
    expect(reaching).toHaveLength(9);
    // SCORE (72) is the other unregistered room, and it is deliberately never chained to
    // anything — asserted by name because "not in the list" is easy to satisfy by accident.
    expect(storyPageOfRoom(72)).toBe(0);
    // The first room of a leg is not its last: a depth check that had drifted to `>= 15`
    // or to the branch's first room would pass every assertion above but this one.
    expect(storyPageOfRoom(REGISTERED_ROOMS[0]!)).toBe(0);
  });
});
