/**
 * Mutation harness for BG_FS — the `ai` tier's water-wobble shader (src/render/glRoomAi.ts).
 *
 * Why this exists separately from tools/mutate-room-walk.mjs: that harness proves the
 * VITEST pins bite, and vitest cannot reach GLSL. The wobble rule is now implemented
 * twice on purpose — continuously in BG_FS, and at 1998's quantization in
 * `faithfulWobbleShifts` — so the CPU↔GPU parity probe can no longer see the shader
 * half at all. `tools/test-gl-room-ai.mjs` step 6 is what guards it instead, and this is
 * what proves step 6 actually would notice.
 *
 * Each mutation breaks ONE rule and asserts the probe goes red, then reverts from an
 * in-memory snapshot in a `finally`. Refuses to run on a dirty glRoomAi.ts.
 *
 * Needs a dev server, because it drives the real browser probe:
 *
 *     npx vite --port 5399 --strictPort &
 *     FF_UI_PORT=5399 node tools/mutate-gl-room-ai.mjs
 *
 * Result on the shipping shader (2026-08-04, all four killed):
 *
 *   centring dropped              → oracleMax 7.18
 *   interpolation dropped         → oracleMax 15.05, exactRows 100 %
 *   regressed to 1998 sampling    → oracleMax 22.23, exactRows 100 %, bandsVarying 0 %
 *   shift direction flipped       → oracleMax 40.95
 *
 * The third is the one worth reading twice: a silent regression to the old banded shader
 * trips all three of step 6's checks, which is exactly what that step was written for.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const F = 'src/render/glRoomAi.ts';

const MUTATIONS = [
  {
    rule: 'the scaled row is centred before becoming a native row',
    from: '    float row = (float(y) + 0.5) / float(uScale) - 0.5;',
    to: '    float row = float(y) / float(uScale);',
  },
  {
    rule: 'the fractional shift is interpolated (not snapped to the lower column)',
    from: '    bg = mix(texelFetch(uBg, ivec2(s0, y), 0).rgb, texelFetch(uBg, ivec2(s1, y), 0).rgb, sh - f);',
    to: '    bg = texelFetch(uBg, ivec2(s0, y), 0).rgb;',
  },
  {
    rule: 'regression to the 1998 sampling (one rounded native-px shift per native row)',
    from: '    float row = (float(y) + 0.5) / float(uScale) - 0.5;\n    float sh = uAmpS * sin(row / uPer + uPhase);',
    to: '    float row = floor(float(y) / float(uScale));\n    float sh = floor(uAmpS * sin(row / uPer + uPhase) / float(uScale) + 0.5) * float(uScale);',
  },
  {
    rule: 'the shift is applied in the right direction (dest[j] = bg[j+k])',
    from: '    int s0 = clamp(x + int(f), 0, uBgW - 1);\n    int s1 = clamp(x + int(f) + 1, 0, uBgW - 1);',
    to: '    int s0 = clamp(x - int(f), 0, uBgW - 1);\n    int s1 = clamp(x - int(f) + 1, 0, uBgW - 1);',
  },
];

if (spawnSync('git', ['diff', '--quiet', 'HEAD', '--', F]).status !== 0) {
  console.error(`Refusing to run: ${F} has uncommitted changes.`);
  console.error('This harness edits it in place; commit or stash first.');
  process.exit(2);
}

const run = () => spawnSync('node', ['tools/test-gl-room-ai.mjs'], { encoding: 'utf8' });

// A mutation "kills" the probe only if the probe passes to begin with.
const baseline = run();
if (baseline.status !== 0) {
  console.error('Refusing to run: tools/test-gl-room-ai.mjs is not green before mutating.');
  console.error('(Is a dev server up? FF_UI_PORT defaults to 5173.)');
  console.error(baseline.stdout?.slice(-3000) ?? '');
  process.exit(2);
}
console.log('baseline green\n');

let survived = 0;
for (const m of MUTATIONS) {
  const src = fs.readFileSync(F, 'utf8');
  const hits = src.split(m.from).length - 1;
  if (hits !== 1) {
    console.log(`SETUP-FAIL  ${m.rule}: pattern matched ${hits} times`);
    survived++;
    continue;
  }
  try {
    fs.writeFileSync(F, src.replace(m.from, m.to));
    const r = run();
    if (r.status !== 0) {
      const why = (r.stdout.match(/ {2}FAIL wobble[^\n]*/g) ?? []).join(' | ');
      console.log(`OK   red    ${m.rule}\n              ${why.slice(0, 300)}`);
    } else {
      console.log(`SURVIVED    ${m.rule}  <- step 6 did not notice`);
      survived++;
    }
  } finally {
    fs.writeFileSync(F, src);
  }
}

console.log(survived ? `\n${survived} mutation(s) SURVIVED — that rule is not pinned.` : '\nAll shader mutations killed.');
process.exit(survived ? 1 : 0);
