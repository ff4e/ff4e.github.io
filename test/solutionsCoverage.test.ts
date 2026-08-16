/**
 * Solution COVERAGE — the half of the solvability net that needs no game data.
 *
 * `solutions.test.ts` replays every recorded solution and so needs the room `.ffr` data.
 * That used to be believed impossible in CI — the data was thought to be unshippable — and
 * the coverage assertions sat behind the same gate, so on CI a room could lose its solution,
 * or the corpus could shrink, and every check still reported green. The premise was wrong
 * (`test/gameData.ts` has the history; the data is committed under `public/data`) and the
 * replays run everywhere now, but the split is still worth keeping.
 *
 * Nothing here needs the game data at all: a recorded solution is a move-string, and the
 * mapping is source. So these assertions hold even in a checkout with the data stripped, and
 * they are what makes "a room silently lost its solution" a failure rather than a skip.
 *
 * The numbers are pinned exactly, on purpose, so that a room quietly losing its solution
 * is a failure rather than a smaller number nobody looks at. They are not frozen: coverage
 * numbers move UP as rooms gain solutions, and `KNOWN_DIVERGENT` moves DOWN as port bugs
 * are fixed. Either way the PR that moves them has to say so in the same change — same
 * reasoning as the line budgets in `file-budgets.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { ROOMS } from '../src/data/roomTable.js';
import { SOLUTION_ROOMS, KNOWN_DIVERGENT } from './solutionsMapping.js';
import { recordedSlugs, recordedMoves } from './solutionsSource.js';

/**
 * Recorded but deliberately NOT mapped to a room: `rush` solves FFNG's own "Filled Car
 * Park", one of nine levels the 1998 original never had, so this port does not contain it.
 * POHON #58's counterpart is `propulsion`, which is mapped. See `solutionsMapping.ts`.
 */
const DELIBERATELY_UNMAPPED = new Set(['rush']);

describe('solution coverage', () => {
  const slugs = recordedSlugs();
  const mappedSlugs = Object.keys(SOLUTION_ROOMS).sort();
  const cleanSlugs = mappedSlugs.filter((s) => !KNOWN_DIVERGENT.has(s));

  it('the recorded corpus is exactly the pinned inventory', () => {
    expect(slugs.length, 'recorded solutions').toBe(71);
    expect(mappedSlugs.length, 'solutions pinned to a room').toBe(70);
    expect([...KNOWN_DIVERGENT].sort(), 'known port divergences').toEqual([]);
  });

  it('every mapped slug has a recording, and every unmapped recording is a deliberate one', () => {
    const recorded = new Set(slugs);
    const missing = mappedSlugs.filter((s) => !recorded.has(s));
    expect(missing, 'mapped to a room but no recorded solution').toEqual([]);

    const unmapped = slugs.filter((s) => !(s in SOLUTION_ROOMS));
    expect(unmapped.sort(), 'recorded but unmapped — pin it, or record it in DELIBERATELY_UNMAPPED').toEqual(
      [...DELIBERATELY_UNMAPPED].sort(),
    );
  });

  it('every mapping points at a distinct, real room', () => {
    const nums = Object.values(SOLUTION_ROOMS);
    const outOfRange = nums.filter((n) => !ROOMS[n - 1]);
    expect(outOfRange, 'mapped room numbers outside roomTable').toEqual([]);
    expect(new Set(nums).size, 'two solutions pinned to the same room').toBe(nums.length);
  });

  it('every recording is a non-empty move-string', () => {
    const empty = slugs.filter((s) => recordedMoves(s).length === 0);
    expect(empty, 'recorded solutions with no moves').toEqual([]);
  });

  /**
   * The promise this project actually makes. It is NOT "all 72 rooms are solvable" — it is
   * "every room with a clean recorded solution is still solvable", which is 70 of 72. The
   * shortfall is printed on every run so the gap is visible now rather than discovered later;
   * closing it belongs to the solutions-harness work, not here.
   */
  it('70 of the 72 rooms have a clean recorded solution — and the shortfall is reported', () => {
    const mapped = new Set(Object.values(SOLUTION_ROOMS));
    const uncovered = ROOMS.filter((r) => !mapped.has(r.num)).map((r) => `#${r.num} ${r.jmeno}`);

    // eslint-disable-next-line no-console
    console.log(
      `[solutions] coverage: ${cleanSlugs.length}/${ROOMS.length} rooms guarded by a clean solution ` +
        `(${mapped.size} mapped, ${KNOWN_DIVERGENT.size} divergent` +
        `${KNOWN_DIVERGENT.size ? `: ${[...KNOWN_DIVERGENT].sort().join(', ')}` : ''}).\n` +
        `[solutions] no recorded solution (${uncovered.length}): ${uncovered.join(', ')}`,
    );

    expect(cleanSlugs.length, 'rooms with a clean recorded solution').toBe(70);
    // Pinned by name, not just by count. Every playable room in the game now has a
    // recording and every one of them replays clean; the two left are the ending and the
    // results screens, which are not puzzles. There is nothing else to close.
    expect(uncovered, 'rooms with no recorded solution at all').toEqual(['#71 ZAVER', '#72 SCORE']);
  });
});
