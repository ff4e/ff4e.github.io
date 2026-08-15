/**
 * The one place that knows WHERE recorded reference solutions live.
 *
 * Today they are `.moves` files under `test/fixtures/solutions/`. The devbar
 * solution-replay work moves them into the room modules themselves
 * (`RoomScript.solution`), and when it does, only the two functions below change —
 * `solutions.test.ts` and `solutionsCoverage.test.ts` assert against this accessor and
 * against the pinned counts, never against file paths, so they survive the move.
 *
 * Reading a solution needs NO game data: it is just the recorded move-string. Only
 * REPLAYING one needs the original `.ffr` room geometry ($FFNG_DATA). That split is the
 * whole point of the accessor — it lets the coverage assertions (which are what catch a
 * room silently losing its solution) run everywhere, including CI.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CORPUS = join(process.cwd(), 'test/fixtures/solutions');
const EXT = '.moves';

/** Every slug that has a recorded solution, sorted. */
export function recordedSlugs(): string[] {
  return readdirSync(CORPUS)
    .filter((f) => f.endsWith(EXT))
    .map((f) => f.slice(0, -EXT.length))
    .sort();
}

/** The recorded move-string for a slug. Throws if there is no recording — a missing one is a bug, not a skip. */
export function recordedMoves(slug: string): string {
  return readFileSync(join(CORPUS, `${slug}${EXT}`), 'utf8').trim();
}
