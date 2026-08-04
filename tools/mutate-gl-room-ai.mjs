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
 * Result on the shipping shader (2026-08-04, all seven killed):
 *
 *   centring dropped               → oracleMax 8.38
 *   interpolation dropped          → oracleMax 12.96, exactRows 99 %
 *   regressed to 1998 sampling     → oracleMax, exactRows and bandsVarying all trip
 *   shift direction flipped        → oracleMax 36.70
 *   ripple term ignored            → rippleDelta collapses to the oracle's own floor
 *   crests driven by band position → oracleMax (this IS the ~19 Hz aliasing bug)
 *   ripple window dropped          → oracleMax (a train becomes the whole room)
 *
 * The third is the one worth reading twice: a silent regression to the old banded shader
 * trips all three of step 6's spatial checks, which is exactly what it was written for.
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
    from: '    sh *= float(uScale);',
    to: '    sh = floor(uAmp * sin(floor(float(y) / float(uScale)) / uPer + uPhase) + 0.5) * float(uScale);',
  },
  {
    rule: 'the ripple trains reach the shader at all (uRip not ignored)',
    from: '      sh += uRip[i].z * exp(-0.5 * e * e) * sin(row * uRip[i].w + uRipPh[i]);',
    to: '      sh += 0.0 * uRip[i].z * e;',
  },
  {
    rule: 'ripple crests are driven by the carrier phase, not by the band position',
    from: '      sh += uRip[i].z * exp(-0.5 * e * e) * sin(row * uRip[i].w + uRipPh[i]);',
    to: '      sh += uRip[i].z * exp(-0.5 * e * e) * sin((row - uRip[i].x) * uRip[i].w);',
  },
  {
    rule: 'the ripple band is a Gaussian WINDOW (not the whole room)',
    from: '      sh += uRip[i].z * exp(-0.5 * e * e) * sin(row * uRip[i].w + uRipPh[i]);',
    to: '      sh += uRip[i].z * sin(row * uRip[i].w + uRipPh[i]);',
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
