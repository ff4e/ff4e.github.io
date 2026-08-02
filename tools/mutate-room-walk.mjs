/**
 * Mutation harness for the shared room walk (src/render/roomWalk.ts).
 *
 * Each entry breaks ONE rule and asserts that EVERY listed test file goes red — each
 * run separately, so the harness reports which side failed to notice. That matters
 * twice over:
 *
 *  - the rules now have a single implementation, so a rule broken in roomWalk.ts must
 *    surface on BOTH the faithful and the `ai` side. A listed file that stays green is
 *    a rule that side is no longer really pinning.
 *  - a parity probe cannot catch a refactor that moves the oracle (see `dissolveKeeps`
 *    in aiTarget.ts). These pins assert hand-computed expectations rather than
 *    agreement between the two paths, which is the only kind that still means anything
 *    once the two paths share their rules.
 *
 * Run: node tools/mutate-room-walk.mjs      (reverts every mutation afterwards)
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = 'src/render/roomWalk.ts';
const A = 'src/render/roomAi.ts';

const MUTATIONS = [
  { rule: 'gspec=2 darkness visibility flip', file: W, tests: ['test/darkness.test.ts', 'test/roomAi.test.ts'],
    from: 'if (it.spec !== 2 && j !== room.littleIdx', to: 'if (it.spec !== 7 && j !== room.littleIdx' },
  { rule: 'gspec=5 young/old fish swap', file: W, tests: ['test/gspec5.test.ts'],
    from: 'const bigFishIdx = room.gspec === 5 ? room.startBig : room.bigIdx;', to: 'const bigFishIdx = room.bigIdx;' },
  { rule: 'gspec=5 BASE_FRAME forcing (the young fish sit still)', file: W, tests: ['test/gspec5.test.ts'],
    from: 'const anim = room.gspec === 5 ? undefined : fishAnim;', to: 'const anim = fishAnim;' },
  { rule: 'spec=11 / !visible skip', file: W, tests: ['test/visibility.test.ts', 'test/roomAi.test.ts'],
    from: '} else if (it.spec === 11 || !it.visible) {', to: '} else if (it.spec === 12 || !it.visible) {' },
  { rule: 'spec=1 mirror anchor position', file: W, tests: ['test/mirror.test.ts'],
    from: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };',
    to: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx + 1, y: it.y * FSIZE + sy };' },
  { rule: 'spec=3/4 rope endpoints', file: W, tests: ['test/rope.test.ts'],
    from: 'sink.rope(room, gear.x + 58, gear.y + 27, lift.x + 43, lift.y, col);',
    to: 'sink.rope(room, gear.x + 57, gear.y + 27, lift.x + 43, lift.y, col);' },
  { rule: 'spec=3 gear colour sample (col 1, row 58)', file: W, tests: ['test/rope.test.ts'],
    from: 'const ci = 58 * gear.bmp.w + 1;', to: 'const ci = 58 * gear.bmp.w + 2;' },
  { rule: 'slide interpolation rounding', file: W, tests: ['test/slide.test.ts', 'test/roomAi.test.ts'],
    from: 'Math.round(slide * FSIZE)', to: 'Math.floor(slide * FSIZE)' },
  { rule: 'slide direction deltas', file: W, tests: ['test/slide.test.ts'],
    from: 'const sx = shift * DX_DIR[it.dir]!;\n    const sy = shift * DY_DIR[it.dir]!;',
    to: 'const sx = shift * DY_DIR[it.dir]!;\n    const sy = shift * DX_DIR[it.dir]!;' },
  { rule: 'item z-order', file: W, tests: ['test/roomAi.test.ts'],
    from: 'for (let j = 1; j <= room.itemCount; j++) {', to: 'for (let j = room.itemCount; j >= 1; j--) {' },
  { rule: 'x S scaling of item positions (ai sink)', file: A, tests: ['test/roomAi.test.ts'],
    from: 'const px = (cell: number, shift: number): number => (cell * FSIZE + shift) * S;',
    to: 'const px = (cell: number, shift: number): number => (cell * FSIZE + shift) * (S + 1);' },
];

let failures = 0;
for (const m of MUTATIONS) {
  const src = fs.readFileSync(m.file, 'utf8');
  const hits = src.split(m.from).length - 1;
  if (hits !== 1) {
    console.log(`SETUP-FAIL  ${m.rule}: pattern matched ${hits} times in ${m.file}`);
    failures++;
    continue;
  }
  fs.writeFileSync(m.file, src.replace(m.from, m.to));
  const survived = m.tests.filter(
    (t) => spawnSync('npx', ['vitest', 'run', t], { encoding: 'utf8' }).status === 0,
  );
  fs.writeFileSync(m.file, src);
  const ok = survived.length === 0;
  const why = ok ? '' : `  <- still green: ${survived.join(' ')}`;
  console.log(`${ok ? 'OK   red  ' : 'SURVIVED  '}  ${m.rule}  [${m.tests.join(' ')}]${why}`);
  if (!ok) failures++;
}

// Belt and braces: every mutation already restores its file from the in-memory copy
// above, so this only matters if the run was interrupted. Skipped for files git does
// not track yet (a freshly added roomWalk.ts on a working branch).
const tracked = [W, A].filter((f) => spawnSync('git', ['ls-files', '--error-unmatch', f]).status === 0);
if (tracked.length > 0) execSync(`git checkout -- ${tracked.join(' ')}`);
console.log(failures === 0 ? '\nAll mutations killed.' : `\n${failures} mutation(s) SURVIVED — those rules are not pinned.`);
process.exit(failures === 0 ? 0 : 1);
