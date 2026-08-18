/**
 * The one place that knows WHERE recorded reference solutions live.
 *
 * They now live in the ROOM DATA: `RoomScript.solution`, attached by `src/rooms/index.ts`
 * from the generated `src/rooms/solutions.ts`, keyed by `Jmeno`. `test/fixtures/solutions/`
 * is the staging area the generator reads, not the source the game or these tests read —
 * so a recording that never made it into a room module is a coverage failure here rather
 * than an invisible one. `tools/gen-solutions.ts` moves recordings across, and
 * `solutionsData.test.ts` proves the two agree byte-for-byte.
 *
 * Only the two functions below changed when the source moved: `solutions.test.ts` and
 * `solutionsCoverage.test.ts` assert against this accessor and against the pinned counts,
 * never against file paths, so the migration left them untouched.
 *
 * Reading a solution needs NO game data: it is just the recorded move-string. Only
 * REPLAYING one needs the original `.ffr` room geometry ($FFNG_DATA). That split is the
 * whole point of the accessor — it lets the coverage assertions (which are what catch a
 * room silently losing its solution) run everywhere, including CI.
 *
 * One recording has no room to live in: `rush` solves an FFNG level the 1998 original
 * never had, so it stays staging-only and is read from there. That is the single reason
 * this file still touches the filesystem at all.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOMS } from '../src/data/roomTable.js';
import { solutionFor } from '../src/rooms/index.js';
import { SOLUTION_ROOMS } from './solutionsMapping.js';

const STAGING = join(process.cwd(), 'test/fixtures/solutions');
const EXT = '.moves';

/** The room name a slug is pinned to, or undefined if it is pinned to no room. */
const jmenoOf = (slug: string): string | undefined => {
  const num = SOLUTION_ROOMS[slug];
  return num === undefined ? undefined : ROOMS[num - 1]?.jmeno;
};

/** Every slug that has a recorded solution, sorted. */
export function recordedSlugs(): string[] {
  return readdirSync(STAGING)
    .filter((f) => f.endsWith(EXT))
    .map((f) => f.slice(0, -EXT.length))
    .sort();
}

/** The recorded move-string for a slug. Throws if there is no recording — a missing one is a bug, not a skip. */
export function recordedMoves(slug: string): string {
  const jmeno = jmenoOf(slug);
  if (jmeno === undefined) return stagedRecording(slug); // unported: `rush` has no room here
  const found = solutionFor(jmeno);
  if (found.known !== 'ok') {
    throw new Error(
      `${slug} is pinned to ${jmeno} but that room carries no solution — regenerate with \`npm run gen-solutions\``,
    );
  }
  return found.moves;
}

/** The staged recording for a slug, straight off disk: the generator's INPUT, for verifying its output. */
export function stagedRecording(slug: string): string {
  return readFileSync(join(STAGING, `${slug}${EXT}`), 'utf8').trim();
}
