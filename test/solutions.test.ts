/**
 * Solutions E2E harness — the port's regression net over physics + room scripts.
 *
 * For each committed FFNG solution (test/fixtures/solutions/*.moves) we replay the
 * move-string against its pinned room through the SHARED step-engine (the same
 * physics + prog() + win-hook path the browser game loop uses). A room PASSES iff at
 * the end `won === true && anyFishDead === false && blocked === 0` — a blocked move
 * means the port's physics diverged from the reference, so we hard-fail on it.
 *
 * The FFR game data is not in the repo (copyright), so the REPLAYS below skip when it
 * isn't present. Point $FFNG_DATA at the extracted MAINDIR to run them, exactly like
 * test/rooms.test.ts.
 *
 * That skip used to be silent, which made a run with ZERO solvability coverage look
 * exactly like a green one — a `console.warn` nobody reads in a passing run. Two things
 * fix that now:
 *   - the coverage half moved to `solutionsCoverage.test.ts`, needs no game data, and so
 *     runs everywhere INCLUDING CI (that is what catches a room losing its solution);
 *   - `npm run test:solutions` sets $FFNG_REQUIRE_SOLUTIONS, which turns the skip into a
 *     hard failure. It is part of `npm run test:all`, so the pre-PR gate can no longer
 *     pass while quietly checking nothing. CI does NOT set it: CI cannot have the data,
 *     and pretending otherwise would just be a permanently red job (see README).
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { ROOMS } from '../src/data/roomTable.js';
import { replaySolution } from './solutionsHarness.js';
import { SOLUTION_ROOMS, KNOWN_DIVERGENT } from './solutionsMapping.js';
import { recordedMoves } from './solutionsSource.js';

const DATA = process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');
const GRAPHIC = join(DATA, 'Graphic');
const hasData = existsSync(GRAPHIC);
const dataRequired = process.env.FFNG_REQUIRE_SOLUTIONS === '1';

const ffrPath = (num: number): string => join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
const loadRoom = (num: number): Room => new Room(parseFfr(new Uint8Array(readFileSync(ffrPath(num)))));

const slugs = Object.keys(SOLUTION_ROOMS).sort();

// Always runs. Without $FFNG_REQUIRE_SOLUTIONS it is a no-op; with it, a missing data
// directory fails the run instead of skipping 62 assertions behind a warning.
describe('the solvability replay is actually running', () => {
  it.skipIf(!dataRequired)('has the original game data it needs', () => {
    expect(
      hasData,
      `$FFNG_REQUIRE_SOLUTIONS is set but the game data is missing at ${GRAPHIC}. ` +
        `Every room-solvability assertion would have skipped silently. ` +
        `Point $FFNG_DATA at the extracted MAINDIR, or run \`npm test\` instead of \`npm run test:solutions\`.`,
    ).toBe(true);
  });
});

describe.skipIf(!hasData)('every mapped room is solvable by its reference solution', () => {
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
