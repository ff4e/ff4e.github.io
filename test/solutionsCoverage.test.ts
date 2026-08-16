/**
 * Solution COVERAGE — the half of the solvability net that needs no game data.
 *
 * `solutions.test.ts` replays every recorded solution and is therefore gated on the
 * original 1998 `.ffr` data, which cannot live in a public repo. That gate used to cover
 * the coverage assertions too, so on CI — which has no data — a room could lose its
 * solution, or the corpus could shrink, and every check still reported green.
 *
 * Nothing here needs the game data: a recorded solution is a move-string, and the mapping
 * is source. So these assertions run EVERYWHERE, including CI, and they are what makes
 * "a room silently lost its solution" a failure rather than a skip.
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
 * Recorded but deliberately NOT mapped to a room, each for a reason pinned in the long
 * notes in `solutionsMapping.ts`: `rush` solves FFNG's own "Filled Car Park" (a level the
 * 1998 original never had — POHON #58's real FFNG counterpart is `propulsion`, which the
 * corpus has no save for), and `corridor` is a corrupt recording whose little fish needs
 * 1398 columns of a 34-column room. Both stay in the corpus for the record.
 */
const DELIBERATELY_UNMAPPED = new Set(['corridor', 'rush']);

describe('solution coverage', () => {
  const slugs = recordedSlugs();
  const mappedSlugs = Object.keys(SOLUTION_ROOMS).sort();
  const cleanSlugs = mappedSlugs.filter((s) => !KNOWN_DIVERGENT.has(s));

  it('the recorded corpus is exactly the pinned inventory', () => {
    expect(slugs.length, 'recorded solutions').toBe(65);
    expect(mappedSlugs.length, 'solutions pinned to a room').toBe(63);
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
   * "every room with a clean recorded solution is still solvable", which is 63 of 72. The
   * shortfall is printed on every run so the gap is visible now rather than discovered later;
   * closing it belongs to the solutions-harness work, not here.
   */
  it('63 of the 72 rooms have a clean recorded solution — and the shortfall is reported', () => {
    const mapped = new Set(Object.values(SOLUTION_ROOMS));
    const uncovered = ROOMS.filter((r) => !mapped.has(r.num)).map((r) => `#${r.num} ${r.jmeno}`);

    // eslint-disable-next-line no-console
    console.log(
      `[solutions] coverage: ${cleanSlugs.length}/${ROOMS.length} rooms guarded by a clean solution ` +
        `(${mapped.size} mapped, ${KNOWN_DIVERGENT.size} divergent` +
        `${KNOWN_DIVERGENT.size ? `: ${[...KNOWN_DIVERGENT].sort().join(', ')}` : ''}).\n` +
        `[solutions] no recorded solution (${uncovered.length}): ${uncovered.join(', ')}`,
    );

    expect(cleanSlugs.length, 'rooms with a clean recorded solution').toBe(63);
    // Pinned by name, not just by count: the 9 are five rooms awaiting a hand-recorded
    // solution (CHODBA, SPUNT, ZELVA, BARELY, POHON), two gspec=9 push-out rooms the FFNG
    // corpus ships nothing for (LODE, GRAL), and two non-playable screens (ZAVER, SCORE).
    // CHODBA and POHON each have a plausible-looking recording that is NOT theirs — read
    // the two notes in `solutionsMapping.ts` before assuming either can simply be pinned.
    expect(uncovered, 'rooms with no recorded solution at all').toEqual([
      '#19 LODE',
      '#29 SPUNT',
      '#37 ZELVA',
      '#44 BARELY',
      '#56 CHODBA',
      '#58 POHON',
      '#64 GRAL',
      '#71 ZAVER',
      '#72 SCORE',
    ]);
  });
});
