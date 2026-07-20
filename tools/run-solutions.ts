/**
 * Run every committed solution against its PINNED room through the step-engine and
 * report won/dead/blocked. The pinned mapping resolves the ambiguous/needs-script
 * rows in mapping.tsv. Run from the port dir:  npx tsx tools/run-solutions.ts
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseFfr } from '../src/data/ffr.js';
import { Room } from '../src/core/room.js';
import { ROOMS } from '../src/data/roomTable.js';
import { replaySolution } from '../test/solutionsHarness.js';
import { SOLUTION_ROOMS } from '../test/solutionsMapping.js';

const GRAPHIC = join(process.env.FFNG_DATA ?? join(homedir(), '.cache/ffng-orig/extracted/MAINDIR'), 'Graphic');
const CORPUS = process.argv[2] ?? join(process.cwd(), 'test/fixtures/solutions');
const ffrPath = (num: number): string => join(GRAPHIC, `${String(num).padStart(3, '0')}.ffr`);

function main(): void {
  if (!existsSync(GRAPHIC)) {
    console.error(`No FFR data at ${GRAPHIC} (set $FFNG_DATA).`);
    process.exit(2);
  }
  const files = readdirSync(CORPUS)
    .filter((f) => f.endsWith('.moves'))
    .sort();
  let pass = 0;
  const fails: string[] = [];
  let excluded = 0;
  for (const f of files) {
    const slug = f.replace(/\.moves$/, '');
    const num = SOLUTION_ROOMS[slug];
    if (num === undefined) {
      excluded++; // unmapped on purpose (e.g. rush = FFNG-redesigned level, not an original room)
      continue;
    }
    const jmeno = ROOMS[num - 1]!.jmeno;
    const moves = readFileSync(join(CORPUS, f), 'utf8').trim();
    const room = new Room(parseFfr(new Uint8Array(readFileSync(ffrPath(num)))));
    const r = replaySolution(room, jmeno, moves);
    const ok = r.won && !r.dead && r.blocked === 0;
    if (ok) pass++;
    else
      fails.push(
        `${slug.padEnd(12)} -> #${num} ${jmeno}: won=${r.won} dead=${r.dead} blocked=${r.blocked} steps=${r.steps}`,
      );
  }
  if (fails.length) console.log('FAILURES:\n' + fails.join('\n'));
  const mapped = files.length - excluded;
  console.log(`\n${pass}/${mapped} mapped solutions solve cleanly (won, no death, 0 blocked); ${excluded} unmapped/excluded.`);
}

main();
