/**
 * Mutation harness for the room-walk rules (task: fish_fillets_unify_room_walk).
 *
 * Each entry breaks ONE rule in the current, un-refactored code and asserts the
 * named test files go RED. A rule whose mutation stays green is not pinned, and
 * must not be moved into the shared walk until it is.
 *
 * Run: node tools/mutate-room-walk.mjs      (reverts every mutation afterwards)
 */
import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';

const R = 'src/render/renderRoom.ts';
const A = 'src/render/roomAi.ts';

const MUTATIONS = [
  { rule: 'gspec=2 darkness visibility flip (faithful)', file: R, tests: ['test/darkness.test.ts'],
    from: 'if (it.spec !== 2 && j !== room.littleIdx', to: 'if (it.spec !== 7 && j !== room.littleIdx' },
  { rule: 'gspec=2 darkness visibility flip (ai)', file: A, tests: ['test/roomAi.test.ts'],
    from: 'if (it.spec !== 2 && j !== room.littleIdx', to: 'if (it.spec !== 7 && j !== room.littleIdx' },
  { rule: 'gspec=5 young/old fish swap (faithful)', file: R, tests: ['test/gspec5.test.ts'],
    from: 'const bigFishIdx = room.gspec === 5 ? room.startBig : room.bigIdx;', to: 'const bigFishIdx = room.bigIdx;' },
  { rule: 'gspec=5 BASE_FRAME forcing (faithful)', file: R, tests: ['test/gspec5.test.ts'],
    from: "art.drawFish(screen, room, 'big', it, sx, sy, room.gspec === 5 ? BASE_FRAME : (fishAnim?.big ?? BASE_FRAME));",
    to: "art.drawFish(screen, room, 'big', it, sx, sy, fishAnim?.big ?? BASE_FRAME);" },
  { rule: 'spec=11 / !visible skip (faithful)', file: R, tests: ['test/visibility.test.ts'],
    from: '} else if (it.spec === 11 || !it.visible) {', to: '} else if (it.spec === 12 || !it.visible) {' },
  { rule: 'spec=11 / !visible skip (ai)', file: A, tests: ['test/roomAi.test.ts'],
    from: '} else if (it.spec === 11 || !it.visible) {', to: '} else if (it.spec === 12 || !it.visible) {' },
  { rule: 'spec=1 mirror anchor position (faithful)', file: R, tests: ['test/mirror.test.ts'],
    from: 'if (bm) mirror = { x: it.x * FSIZE + sx, y: it.y * FSIZE + sy, w: bm.w, h: bm.h };',
    to: 'if (bm) mirror = { x: it.x * FSIZE + sx + 1, y: it.y * FSIZE + sy, w: bm.w, h: bm.h };' },
  { rule: 'spec=3/4 rope endpoints (faithful)', file: R, tests: ['test/rope.test.ts'],
    from: 'screen.drawRope(gearX + 58, gearY + 27, liftX + 43, liftY, col);',
    to: 'screen.drawRope(gearX + 57, gearY + 27, liftX + 43, liftY, col);' },
  { rule: 'spec=3 gear colour sample (col 1, row 58) (faithful)', file: R, tests: ['test/rope.test.ts'],
    from: 'const ci = 58 * gearBmp.w + 1;', to: 'const ci = 58 * gearBmp.w + 2;' },
  { rule: 'slide interpolation rounding (faithful)', file: R, tests: ['test/slide.test.ts'],
    from: 'Math.round(slide * FSIZE)', to: 'Math.floor(slide * FSIZE)' },
  { rule: 'slide interpolation rounding (ai)', file: A, tests: ['test/roomAi.test.ts'],
    from: 'Math.round(f.slide * FSIZE)', to: 'Math.floor(f.slide * FSIZE)' },
  { rule: 'slide direction deltas (faithful)', file: R, tests: ['test/slide.test.ts'],
    from: 'const sx = shift * DX_DIR[it.dir]!;\n    const sy = shift * DY_DIR[it.dir]!;',
    to: 'const sx = shift * DY_DIR[it.dir]!;\n    const sy = shift * DX_DIR[it.dir]!;' },
  { rule: 'item z-order (ai)', file: A, tests: ['test/roomAi.test.ts'],
    from: '    for (let j = 1; j <= room.itemCount; j++) {', to: '    for (let j = room.itemCount; j >= 1; j--) {' },
  { rule: 'x S scaling of item positions (ai)', file: A, tests: ['test/roomAi.test.ts'],
    from: 'const x0 = (it.x * FSIZE + sx) * S;', to: 'const x0 = (it.x * FSIZE + sx) * (S + 1);' },
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
  const r = spawnSync('npx', ['vitest', 'run', ...m.tests], { encoding: 'utf8' });
  fs.writeFileSync(m.file, src);
  const red = r.status !== 0;
  console.log(`${red ? 'OK   red  ' : 'SURVIVED  '}  ${m.rule}  [${m.tests.join(' ')}]`);
  if (!red) failures++;
}

execSync(`git checkout -- ${R} ${A}`);
console.log(failures === 0 ? '\nAll mutations killed.' : `\n${failures} mutation(s) SURVIVED — those rules are not pinned.`);
process.exit(failures === 0 ? 0 : 1);
