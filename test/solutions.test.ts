/**
 * Solutions E2E harness — the port's regression net over physics + room scripts.
 *
 * For each committed FFNG solution (test/fixtures/solutions/*.moves) we replay the
 * move-string against its pinned room through the SHARED step-engine (the same
 * physics + prog() + win-hook path the browser game loop uses). A room PASSES iff at
 * the end `won === true && anyFishDead === false && blocked === 0` — a blocked move
 * means the port's physics diverged from the reference, so we hard-fail on it.
 *
 * These replays used to be gated behind `describe.skipIf(!hasData)`, keyed on a PRIVATE
 * extraction of the original game at ~/.cache/ffng-orig — so CI, which has no such cache,
 * silently skipped all 62 solvability assertions on every push and still reported green.
 * The `console.warn` that said so is invisible in a passing run.
 *
 * The premise behind that gate was wrong. The room data is NOT withheld from this repo:
 * ALTAR GPL-released the Fish Fillets data in 2002, all 72 `Graphic/*.ffr` are tracked
 * under `public/data/` because the site ships them, and they are byte-identical to a
 * private extraction (verified across all 72). So there is nothing to skip for: the
 * replays now run everywhere off the repo's own data, in under a second. See
 * `test/gameData.ts` for how the directory is resolved, and $FFNG_DATA to override it.
 *
 * Missing data is therefore a FAILURE, not a skip — `the solvability net is armed` below
 * asserts the data resolved AND that every room it is about to replay is readable, so this
 * file can never again contribute zero coverage while the run reports success. The
 * inventory half (which rooms should be here at all) is `solutionsCoverage.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { ROOMS } from '../src/data/roomTable.js';
import { replaySolution } from './solutionsHarness.js';
import { SOLUTION_ROOMS, KNOWN_DIVERGENT } from './solutionsMapping.js';
import { recordedMoves } from './solutionsSource.js';
import { gameDataDir } from './gameData.js';

const GRAPHIC = join(gameDataDir(), 'Graphic');

const ffrPath = (num: number): string => join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
const loadRoom = (num: number): Room => new Room(parseFfr(new Uint8Array(readFileSync(ffrPath(num)))));

const slugs = Object.keys(SOLUTION_ROOMS).sort();
const clean = slugs.filter((s) => !KNOWN_DIVERGENT.has(s));

/**
 * The guard against this file quietly checking nothing. It is not enough to know the data
 * directory exists: a `.skip`, a renamed file, or a resolution bug upstream would each
 * leave the run green with zero replays. So assert the exact set of rooms that is about to
 * be replayed is real and readable — if this passes, the 70 tests below have their input.
 */
describe('the solvability net is armed', () => {
  it('has readable room data for all 70 rooms it is about to replay', () => {
    expect(existsSync(GRAPHIC), `no room data at ${GRAPHIC} — set $FFNG_DATA, or check public/data is intact`).toBe(
      true,
    );
    const unreadable = clean.filter((s) => !existsSync(ffrPath(SOLUTION_ROOMS[s]!)));
    expect(unreadable, `no .ffr for these rooms under ${GRAPHIC}`).toEqual([]);
    expect(clean.length, 'rooms about to be replayed').toBe(70);
  });
});

describe('every mapped room is solvable by its reference solution', () => {
  for (const slug of slugs) {
    const num = SOLUTION_ROOMS[slug]!;
    const jmeno = ROOMS[num - 1]!.jmeno;
    const title = `${slug} → #${num} ${jmeno}`;

    if (KNOWN_DIVERGENT.has(slug)) {
      // Documented port-script divergence the harness flags (not silently skipped):
      // its physics/script does not yet faithfully replay the reference solution.
      // Remove the slug from KNOWN_DIVERGENT once the room is fixed.
      it.skip(`${title} (KNOWN DIVERGENCE — port-script bug, see solutionsMapping.ts)`, () => {});
      continue;
    }

    it(`${title} is solvable (won, no death, 0 blocked)`, () => {
      const r = replaySolution(loadRoom(num), jmeno, recordedMoves(slug));
      expect(r.dead, `${title}: a fish died during replay`).toBe(false);
      expect(r.blocked, `${title}: ${r.blocked} move(s) blocked — physics diverged from reference`).toBe(0);
      expect(r.won, `${title}: room not solved after ${r.steps} moves`).toBe(true);
    });
  }
});

// The coverage assertions used to live here, inside the same skipIf — so on CI they never
// ran, and a room losing its solution was indistinguishable from a green run. They are now
// in solutionsCoverage.test.ts, which needs no game data and runs everywhere.
