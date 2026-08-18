/**
 * Generate `src/rooms/solutions.ts` — the recorded reference solutions, as room data.
 *
 * Input is the staging area: `test/fixtures/solutions/*.moves` (one recording per FFNG
 * slug) plus the pinned `SOLUTION_ROOMS` slug -> room-number map. Output is a table keyed
 * by `Jmeno` (`Desc[].Jmeno`, the same key `src/rooms/index.ts` already uses), which
 * `roomScript()` attaches to each `RoomScript` as `solution`.
 *
 * The slug -> room match is ambiguous and had to be pinned by hand (see the header of
 * `test/solutionsMapping.ts`). Resolving it HERE, once, at generation time, is the point:
 * the running game never needs the mapping, and there is one less thing to keep in sync.
 *
 * Recordings whose slug is not pinned to a room stay in the staging area only — `rush`
 * solves an FFNG level this port does not contain, so it has no room to live in.
 *
 * Run: `npm run gen-solutions`. Verified byte-for-byte by `test/solutionsData.test.ts`,
 * so a hand-edit of the generated file is a test failure rather than a silent divergence.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOMS } from '../src/data/roomTable.js';
import { SOLUTION_ROOMS } from '../test/solutionsMapping.js';

const CORPUS = join(process.cwd(), 'test/fixtures/solutions');
const OUT = join(process.cwd(), 'src/rooms/solutions.ts');

const jmenoOf = (num: number): string => {
  const room = ROOMS[num - 1];
  if (!room) throw new Error(`solution mapped to room #${num}, which is not in roomTable`);
  return room.jmeno;
};

const rows = Object.entries(SOLUTION_ROOMS)
  .map(([slug, num]) => {
    const moves = readFileSync(join(CORPUS, `${slug}.moves`), 'utf8').trim();
    if (!moves) throw new Error(`${slug}.moves is empty`);
    if (!/^[udlrwxyzUDLRWXYZ]+$/.test(moves)) throw new Error(`${slug}.moves has non-move characters`);
    return { jmeno: jmenoOf(num), slug, num, moves };
  })
  .sort((a, b) => a.num - b.num);

const staged = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.moves'))
  .map((f) => f.slice(0, -'.moves'.length));
const unported = staged.filter((s) => !(s in SOLUTION_ROOMS)).sort();

const header = `/**
 * AUTO-GENERATED — do not edit by hand; regenerate via \`npm run gen-solutions\`.
 * Source: \`test/fixtures/solutions/*.moves\` + the pinned map in \`test/solutionsMapping.ts\`.
 *
 * A recorded solution for each room, as room data: \`src/rooms/index.ts\` attaches these to
 * the room's \`RoomScript\` as \`solution\`, so the moves that solve a room ship beside the
 * behaviour they solve, keyed by the same \`Jmeno\`. The ambiguous FFNG-slug -> room match is
 * resolved at generation time, so the running game never looks it up.
 *
 * Encoding, unchanged from the recordings: lowercase = the little fish, UPPERCASE = the big
 * one; \`u\`/\`d\`/\`l\`/\`r\` = up/down/left/right. One character is one move, which is exactly
 * what \`replaymode\` feeds through \`tryStep\` — one per idle tick.
 *
 * WIN #68's bonus level adds a SECOND symbol set, \`w\`/\`x\`/\`y\`/\`z\` (+ uppercase), for the
 * elderly fish pair — see the header of \`test/solutionsHarness.ts\` for why. Any decoder of
 * these strings has to accept both sets; \`decodeMove\` there is the reference.
 *
 * These live in the PLAYER bundle, not behind the dev flag. That is deliberate and costs
 * ~12 kB gzipped (${rows.reduce((n, r) => n + r.moves.length, 0)} B of move characters; GitHub Pages gzips text on the wire).
 * They leak nothing: this repo is public and the recordings are already committed and
 * readable under \`test/fixtures/solutions/\`.
 *
 * ${unported.length} recording${unported.length === 1 ? '' : 's'} stayed in the staging area with no room here: ${unported.join(', ') || '(none)'}.
 * \`rush\` solves FFNG's own "Filled Car Park", one of nine levels the 1998 original never had.
 *
 * PROVENANCE AND LICENCE — this must travel with the strings.
 * The recordings come from the FFNG community solution archives, principally
 * \`alfonz19/ff-ng-saves\` and Brian Raiter's archive, and are GPL-2.0-or-later, the same
 * licence as this port. See \`test/fixtures/solutions/README.md\` for the full attribution.
 */

/** Recorded solutions by room name (\`Desc[].Jmeno\`), in room order. */
export const ROOM_SOLUTIONS: Readonly<Record<string, string>> = {
`;

const body = rows
  .map((r) => `  // #${r.num} ${r.jmeno} — ${r.slug}.moves, ${r.moves.length} moves\n  ${r.jmeno}: '${r.moves}',\n`)
  .join('');

writeFileSync(OUT, `${header}${body}};\n`, 'utf8');

// eslint-disable-next-line no-console
console.log(
  `[gen-solutions] wrote ${rows.length} solutions (${rows.reduce((n, r) => n + r.moves.length, 0)} move chars) to ${OUT}` +
    `${unported.length ? `; left unported in staging: ${unported.join(', ')}` : ''}`,
);
