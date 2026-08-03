/**
 * Mutation harness for the shared room walk (src/render/roomWalk.ts).
 *
 * Each entry breaks ONE rule and asserts that every listed test file goes red — each run
 * separately, so the harness reports which file failed to notice. That matters because
 * the rules now have a single implementation: a parity probe cannot catch a refactor
 * that moves the oracle (see `dissolveKeeps` in aiTarget.ts), so these pins assert
 * hand-computed expectations rather than agreement between the two paths, and this
 * harness is what proves the pins actually bite.
 *
 * Where a mutation lists BOTH a faithful and an `ai` test file, it is also evidence that
 * the rule really is shared. Most list one, because only one side has a fixture for it —
 * "all mutations killed" means every listed expectation bites, NOT that every rule is
 * pinned on both sides.
 *
 * Run: node tools/mutate-room-walk.mjs
 *
 * Refuses to run on a dirty working tree, because it edits tracked sources in place;
 * every mutation is reverted from an in-memory snapshot in a `finally`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const W = 'src/render/roomWalk.ts';
const A = 'src/render/roomAi.ts';

const ALL_TESTS = [
  'test/darkness.test.ts',
  'test/gspec5.test.ts',
  'test/lode-wreck.test.ts',
  'test/mirror.test.ts',
  'test/roomAi.test.ts',
  'test/rope.test.ts',
  'test/slide.test.ts',
  'test/visibility.test.ts',
];

const MUTATIONS = [
  { rule: 'gspec=2 darkness visibility flip', file: W, tests: ['test/darkness.test.ts', 'test/roomAi.test.ts'],
    from: 'if (it.spec !== 2 && j !== room.littleIdx', to: 'if (it.spec !== 7 && j !== room.littleIdx' },
  { rule: 'gspec=2 ignores `visible` (replaces the normal test, does not AND with it)', file: W,
    tests: ['test/darkness.test.ts', 'test/roomAi.test.ts'],
    from: 'if (it.spec !== 2 && j !== room.littleIdx && j !== room.bigIdx) continue;',
    to: 'if (!it.visible || (it.spec !== 2 && j !== room.littleIdx && j !== room.bigIdx)) continue;' },
  { rule: 'gspec=5 young/old fish swap (big)', file: W, tests: ['test/gspec5.test.ts'],
    from: 'const bigFishIdx = room.gspec === 5 ? room.startBig : room.bigIdx;', to: 'const bigFishIdx = room.bigIdx;' },
  { rule: 'gspec=5 young/old fish swap (little)', file: W, tests: ['test/gspec5.test.ts'],
    from: 'const littleFishIdx = room.gspec === 5 ? room.startLittle : room.littleIdx;',
    to: 'const littleFishIdx = room.littleIdx;' },
  { rule: 'gspec=5 BASE_FRAME forcing (the young fish sit still)', file: W, tests: ['test/gspec5.test.ts'],
    from: 'const anim = room.gspec === 5 ? undefined : fishAnim;', to: 'const anim = fishAnim;' },
  { rule: 'spec=11 / !visible skip', file: W, tests: ['test/visibility.test.ts', 'test/roomAi.test.ts'],
    from: '} else if (it.spec === 11 || !it.visible) {', to: '} else if (it.spec === 12 || !it.visible) {' },
  { rule: 'spec=1 mirror anchor position', file: W, tests: ['test/mirror.test.ts'],
    from: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };',
    to: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx + 1, y: it.y * FSIZE + sy };' },
  { rule: 'spec=1 mirror anchor uses the SLID position', file: W, tests: ['test/mirror.test.ts'],
    from: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };',
    to: 'if (bmp) mirror = { item: it, index: j, bmp, x: it.x * FSIZE, y: it.y * FSIZE };' },
  { rule: 'KresliSpec post-pass ordering (mirror applied after the WHOLE item pass)', file: W,
    tests: ['test/mirror.test.ts'],
    from: '    else sink.item(room, it, j, sx, sy);\n  }',
    to: '    else sink.item(room, it, j, sx, sy);\n    if (mirror && it.spec === 1) { sink.mirror(room, mirror); mirror = null; }\n  }' },
  { rule: 'spec=3/4 rope endpoints (pulley end)', file: W, tests: ['test/rope.test.ts'],
    from: 'sink.rope(room, gear.x + 58, gear.y + 27, lift.x + 43, lift.y, col);',
    to: 'sink.rope(room, gear.x + 57, gear.y + 27, lift.x + 43, lift.y, col);' },
  { rule: 'spec=3/4 rope endpoints (lift end)', file: W, tests: ['test/rope.test.ts'],
    from: 'sink.rope(room, gear.x + 58, gear.y + 27, lift.x + 43, lift.y, col);',
    to: 'sink.rope(room, gear.x + 58, gear.y + 27, lift.x + 40, lift.y, col);' },
  { rule: 'spec=3 gear colour sample (col 1, row 58)', file: W, tests: ['test/rope.test.ts'],
    from: 'const ci = 58 * gear.bmp.w + 1;', to: 'const ci = 58 * gear.bmp.w + 2;' },
  { rule: 'spec=3 gear samples the BASE bitmap, not the animation phase', file: W, tests: ['test/rope.test.ts'],
    from: 'gear = { bmp: room.bitmaps[it.bmp] ?? null,', to: 'gear = { bmp: room.bitmaps[it.bmp + it.afaze] ?? null,' },
  { rule: 'spec=3/4 anchors use the SLID position', file: W, tests: ['test/rope.test.ts'],
    from: 'gear = { bmp: room.bitmaps[it.bmp] ?? null, x: it.x * FSIZE + sx, y: it.y * FSIZE + sy };',
    to: 'gear = { bmp: room.bitmaps[it.bmp] ?? null, x: it.x * FSIZE, y: it.y * FSIZE };' },
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

  // ── LODE's falling wreck at xS (applyWreckSwapScaled / syncWreck, roomAi.ts) ──
  // The replay is pinned against the FAITHFUL renderer, byte-exact, in lode-wreck.test.ts.
  // These prove that pin bites: the sibling AI backend replays through the same function,
  // so a CPU<->GPU probe cannot kill any of them (see dissolveKeeps / PR #11).
  { rule: 'wreck: the swap is an EXCHANGE, not an overwrite', file: A, tests: ['test/lode-wreck.test.ts'],
    from: '          const oldBg = bg.data[bp + channel]!;\n          bg.data[bp + channel] = sprite.data[sp + channel]!;\n          sprite.data[sp + channel] = oldBg;',
    to: '          bg.data[bp + channel] = sprite.data[sp + channel]!;' },
  { rule: 'wreck: the background receives the ship (not only the ship the background)',
    file: A, tests: ['test/lode-wreck.test.ts'],
    from: '          const oldBg = bg.data[bp + channel]!;\n          bg.data[bp + channel] = sprite.data[sp + channel]!;\n          sprite.data[sp + channel] = oldBg;',
    to: '          sprite.data[sp + channel] = bg.data[bp + channel]!;' },
  { rule: 'wreck: every native pixel becomes an SxS BLOCK', file: A, tests: ['test/lode-wreck.test.ts'],
    from: '    for (let by = 0; by < S; by++) {', to: '    for (let by = 0; by < 1; by++) {' },
  { rule: 'wreck: the SxS block is square (columns too)', file: A, tests: ['test/lode-wreck.test.ts'],
    from: '      for (let bx = 0; bx < S; bx++) {', to: '      for (let bx = 0; bx < 1; bx++) {' },
  { rule: 'wreck: padded background column -> art column (- FFR_EXTRA)', file: A,
    tests: ['test/lode-wreck.test.ts'],
    from: '    const dx = swap.x + j - FFR_EXTRA;', to: '    const dx = swap.x + j;' },
  { rule: 'wreck: the ship offset decodes as row-major over swap.width', file: A,
    tests: ['test/lode-wreck.test.ts'],
    from: '    const i = Math.floor(pixel / swap.width);\n    const j = pixel % swap.width;',
    to: '    const j = Math.floor(pixel / swap.width);\n    const i = pixel % swap.width;' },
  { rule: 'wreck: written pixels are forced OPAQUE (BG_FS writes a=1, canvas-2D does not)',
    file: A, tests: ['test/lode-wreck.test.ts'],
    from: '        bg.data[bp + 3] = 255;\n        sprite.data[sp + 3] = 255;',
    to: '        bg.data[bp + 3] = sprite.data[sp + 3]!;' },
  { rule: 'wreck: rows past the bottom of the xS art are clipped', file: A,
    tests: ['test/lode-wreck.test.ts'],
    from: '    if (dy < 0 || dy * S >= artH) continue;', to: '    if (dy < 0) continue;' },
  { rule: 'wreck: columns past the right edge of the xS art are clipped', file: A,
    tests: ['test/lode-wreck.test.ts'],
    from: '    if (dx < 0 || dx * S >= artW) continue;', to: '    if (dx < 0) continue;' },
  { rule: 'wreck: the readback rect covers the whole ship footprint', file: A,
    tests: ['test/lode-wreck.test.ts'],
    from: '  const x1 = Math.min(artW, (swap.x - FFR_EXTRA) * scale + spriteW);',
    to: '  const x1 = Math.min(artW, (swap.x - FFR_EXTRA) * scale + spriteW - 1);' },
  { rule: 'wreck: a no-op swap needs no readback at all', file: A, tests: ['test/lode-wreck.test.ts'],
    from: '  if (swap.pixels.length === 0) return null;', to: '  if (swap.pixels.length < 0) return null;' },
  { rule: 'wreck: the mutated background moves the composite cache key', file: A,
    tests: ['test/roomAi.test.ts'],
    from: '`${faze}|${shifts === null ? 0 : count}|${aiImageRevision(bg)}`',
    to: '`${faze}|${shifts === null ? 0 : count}`' },
];

const run = (tests) => spawnSync('npx', ['vitest', 'run', ...tests], { encoding: 'utf8' });

if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', W, A]).status !== 0) {
  console.error(`Refusing to run: ${W} or ${A} has uncommitted changes.`);
  console.error('This harness edits those files in place; commit or stash first.');
  process.exit(2);
}

// A mutation "kills" a test by making it fail, which is only meaningful if the test
// passes to begin with. Without this, an already-red suite reports every mutation as
// killed and the harness becomes a rubber stamp.
const baseline = run(ALL_TESTS);
if (baseline.status !== 0) {
  console.error('Refusing to run: the pinned suites are not green before mutating.');
  console.error(baseline.stdout?.slice(-2000) ?? '');
  process.exit(2);
}
console.log(`baseline green (${ALL_TESTS.length} suites)\n`);

let failures = 0;
for (const m of MUTATIONS) {
  const src = fs.readFileSync(m.file, 'utf8');
  const hits = src.split(m.from).length - 1;
  if (hits !== 1) {
    console.log(`SETUP-FAIL  ${m.rule}: pattern matched ${hits} times in ${m.file}`);
    failures++;
    continue;
  }
  let survived = [];
  try {
    fs.writeFileSync(m.file, src.replace(m.from, m.to));
    survived = m.tests.filter((t) => {
      const r = run([t]);
      // Distinguish "the test failed" (killed) from "the runner never ran" (inconclusive).
      if (r.error || r.signal || r.status === null) {
        throw new Error(`could not run ${t}: ${r.error?.message ?? `signal ${r.signal}`}`);
      }
      return r.status === 0;
    });
  } finally {
    fs.writeFileSync(m.file, src);
  }
  const ok = survived.length === 0;
  const why = ok ? '' : `  <- still green: ${survived.join(' ')}`;
  console.log(`${ok ? 'OK   red  ' : 'SURVIVED  '}  ${m.rule}  [${m.tests.join(' ')}]${why}`);
  if (!ok) failures++;
}

console.log(failures === 0 ? '\nAll mutations killed.' : `\n${failures} mutation(s) SURVIVED — those rules are not pinned.`);
process.exit(failures === 0 ? 0 : 1);
