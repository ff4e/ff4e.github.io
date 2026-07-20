/**
 * Solutions E2E harness — the port's regression net over physics + room scripts.
 *
 * For each committed FFNG solution (test/fixtures/solutions/*.moves) we replay the
 * move-string against its pinned room through the SHARED step-engine (the same
 * physics + prog() + win-hook path the browser game loop uses). A room PASSES iff at
 * the end `won === true && anyFishDead === false && blocked === 0` — a blocked move
 * means the port's physics diverged from the reference, so we hard-fail on it.
 *
 * The FFR game data is not in the repo (copyright), so these tests SKIP cleanly when
 * it isn't present. Point $FFNG_DATA at the extracted MAINDIR to run them, exactly
 * like test/rooms.test.ts.
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

const DATA = process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');
const GRAPHIC = join(DATA, 'Graphic');
const hasData = existsSync(GRAPHIC);
const CORPUS = join(process.cwd(), 'test/fixtures/solutions');

const ffrPath = (num: number): string => join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);
const readMoves = (slug: string): string => readFileSync(join(CORPUS, `${slug}.moves`), 'utf8').trim();
const loadRoom = (num: number): Room => new Room(parseFfr(new Uint8Array(readFileSync(ffrPath(num)))));

const slugs = Object.keys(SOLUTION_ROOMS).sort();

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
      const r = replaySolution(loadRoom(num), jmeno, readMoves(slug));
      expect(r.dead, `${title}: a fish died during replay`).toBe(false);
      expect(r.blocked, `${title}: ${r.blocked} move(s) blocked — physics diverged from reference`).toBe(0);
      expect(r.won, `${title}: room not solved after ${r.steps} moves`).toBe(true);
    });
  }
});

describe.skipIf(!hasData)('coverage', () => {
  it('reports solution coverage across the 72 rooms', () => {
    const mapped = new Set(Object.values(SOLUTION_ROOMS));
    const clean = slugs.filter((s) => !KNOWN_DIVERGENT.has(s));
    const uncovered = ROOMS.filter((r) => !mapped.has(r.num)).map((r) => `#${r.num} ${r.jmeno}`);
    // eslint-disable-next-line no-console
    console.log(
      `[solutions] ${clean.length}/${slugs.length} solutions clean; ` +
        `${mapped.size}/${ROOMS.length} rooms have a solution; ` +
        `${KNOWN_DIVERGENT.size} known divergences (${[...KNOWN_DIVERGENT].sort().join(', ')}).\n` +
        `[solutions] rooms with no committed solution (${uncovered.length}): ${uncovered.join(', ')}`,
    );
    // Guardrail: the clean set must not silently shrink.
    expect(clean.length).toBeGreaterThanOrEqual(62);
  });
});

if (!hasData) {
  // eslint-disable-next-line no-console
  console.warn(`[solutions.test] skipped — game data not found at ${GRAPHIC} (set $FFNG_DATA to enable)`);
}
