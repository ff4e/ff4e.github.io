/**
 * One-off experiment (not part of the build): does the ORDER of the two upscale
 * passes matter?
 *
 * For scales above ×4 a model with native scales {2,3,4} must compose two passes,
 * and every target has exactly two cheapest chains — e.g. ×8 is 2×4 or 4×2, ×5/×6
 * are 2×3 or 3×2. generateVariantAt runs the SMALLEST pass first, which keeps every
 * intermediate small (Real-CUGAN SIGSEGVs on large inputs). This measures what that
 * choice costs or gains in image terms.
 *
 * Usage: node tools/compare-order.mjs [outDir]
 */
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  requireBins, MODEL_BY_ID, buildSprite, buildLayer,
  decodePngRgba, encodePngRgba, resampleAreaTo,
} from './studio/lib/upscale.mjs';

const OUT = process.argv[2] || '/tmp/order';
mkdirSync(OUT, { recursive: true });
const bins = requireBins();

/** Render `src` to exactly `target`× via the given pass sequence. */
export function chain(src, dst, spec, alpha, target, seq) {
  const work = mkdtempSync(join(tmpdir(), 'ord-'));
  try {
    const step = alpha ? buildSprite : buildLayer;
    let cur = src;
    seq.forEach((k, i) => {
      const o = join(work, `p${i}.png`);
      step(cur, o, spec, bins, k);
      cur = o;
    });
    const s0 = decodePngRgba(src);
    const im = decodePngRgba(cur);
    const d = resampleAreaTo(im.rgba, im.w, im.h, s0.w * target, s0.h * target);
    encodePngRgba(d.rgba, d.w, d.h, dst);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

/** Mean |Δ| over opaque pixels, plus the worst single channel difference. */
export function diff(a, b) {
  const A = decodePngRgba(a), B = decodePngRgba(b);
  if (A.w !== B.w || A.h !== B.h) return null;
  let s = 0, n = 0, mx = 0;
  for (let i = 0; i < A.w * A.h; i++) {
    if (A.rgba[i * 4 + 3] < 128) continue;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(A.rgba[i * 4 + c] - B.rgba[i * 4 + c]);
      s += d; n++; if (d > mx) mx = d;
    }
  }
  return { mean: n ? s / n : 0, max: mx };
}

/**
 * Edge-transition WIDTH: for each strong edge, how many pixels the ramp spans.
 * This is what reads as "blurry" — unlike gradient peak height, which stays high
 * on a soft edge as long as the total contrast is preserved.
 */
export function edgeWidth(f) {
  const i = decodePngRgba(f);
  const L = (x, y) => {
    const p = (y * i.w + x) * 4, a = i.rgba[p + 3] / 255;
    return ((i.rgba[p] + i.rgba[p + 1] + i.rgba[p + 2]) / 3) * a + 255 * (1 - a);
  };
  const grad = (x, y) => Math.hypot(L(x + 1, y) - L(x - 1, y), L(x, y + 1) - L(x, y - 1));
  let strong = 0, wide = 0;
  for (let y = 2; y < i.h - 2; y++) {
    for (let x = 2; x < i.w - 2; x++) {
      const g = grad(x, y);
      if (g < 60) continue;                       // only real edges
      strong++;
      // count how far the gradient stays at least half its peak along x
      let w = 1;
      for (let d = 1; d <= 6; d++) {
        if (grad(x + d, y) >= g * 0.5) w++; else break;
      }
      wide += w;
    }
  }
  return strong ? wide / strong : 0;
}

const SUBJECTS = [
  ['small-rest', 'public/enhanced/_fish/small/left/body_rest_00.png', 'cugan_c', true],
  ['small-talk', 'public/enhanced/_fish/small/left/body_talk_00.png', 'cugan_c', true],
  ['small-swam', 'public/enhanced/_fish/small/left/body_swam_00.png', 'cugan_c', true],
  ['big-rest', 'public/enhanced/_fish/big/left/body_rest_00.png', 'cugan_c', true],
  ['big-swam', 'public/enhanced/_fish/big/left/body_swam_00.png', 'cugan_c', true],
];
// Each target's two cheapest chains: smallest-pass-first vs largest-pass-first.
const PLANS = { 5: [[2, 3], [3, 2]], 6: [[2, 3], [3, 2]], 8: [[2, 4], [4, 2]] };

async function main() {
  console.log('subject      scale  order   edgeWidth   Δ vs other (mean/max)');
  for (const [name, src, model, alpha] of SUBJECTS) {
    const spec = MODEL_BY_ID[model];
    for (const scale of Object.keys(PLANS).map(Number)) {
      const files = {};
      for (const seq of PLANS[scale]) {
        const tag = seq.join('x');
        const dst = join(OUT, `${name}-x${scale}-${tag}.png`);
        const t0 = Date.now();
        chain(src, dst, spec, alpha, scale, seq);
        files[tag] = { dst, ms: Date.now() - t0 };
      }
      const [a, b] = Object.keys(files);
      const d = diff(files[a].dst, files[b].dst);
      for (const tag of [a, b]) {
        console.log(
          `${name.padEnd(12)} x${scale}    ${tag.padEnd(6)} ${edgeWidth(files[tag].dst).toFixed(3).padStart(7)}`
          + `     ${d ? `${d.mean.toFixed(2)} / ${d.max}` : 'n/a'}   ${(files[tag].ms / 1000).toFixed(1)}s`,
        );
      }
    }
  }
}
main();
