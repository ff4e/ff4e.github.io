/**
 * One-off experiment (not part of the build): render the same picture to its target
 * scale by three different routes and measure invented grain.
 *
 *   A  current  — picked model ×4, then a generic av3-x2, then resample to target
 *   B  pure2x4  — picked model ×4 twice (→×16), then resample to target
 *   C  pure2f   — picked model ×2 first, then ×4 (→×8), then resample   [×2-capable models only]
 *
 * Grain = mean |pixel − local 3×3 mean|. Structure raises it too, so the meaningful
 * signal is the RATIO between routes on the SAME crop, and especially how that ratio
 * behaves on flat areas versus detailed ones.
 */
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  requireBins, MODEL_BY_ID, generateVariant, generateVariantAt,
  buildSprite, buildLayer, decodePngRgba, encodePngRgba, resampleAreaTo,
} from './studio/lib/upscale.mjs';

const bins = requireBins();
const OUT = process.env.OUT || '/tmp/cmp';

/** Mean |pixel − local 3×3 mean| over a region: high-frequency energy. */
export function grain(img, x0, y0, w, h) {
  const L = (x, y) => {
    const p = (y * img.w + x) * 4;
    return (img.rgba[p] + img.rgba[p + 1] + img.rgba[p + 2]) / 3;
  };
  let s = 0, n = 0;
  for (let y = Math.max(1, y0); y < Math.min(img.h - 1, y0 + h); y++) {
    for (let x = Math.max(1, x0); x < Math.min(img.w - 1, x0 + w); x++) {
      let a = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) a += L(x + dx, y + dy);
      s += Math.abs(L(x, y) - a / 9); n++;
    }
  }
  return n ? s / n : 0;
}

const to = (src, target, dst) => {
  const s0 = decodePngRgba(src), im = decodePngRgba(dst === null ? src : dst);
  return { s0, im, target };
};

function routeA(src, dst, spec, alpha, target) {
  generateVariantAt(src, dst, spec, alpha, bins, target);
}

function chain(src, dst, spec, alpha, target, first, second) {
  const work = mkdtempSync(join(tmpdir(), 'cmp-'));
  try {
    const mid = join(work, 'mid.png');
    const big = join(work, 'big.png');
    const step = alpha ? buildSprite : buildLayer;
    step(src, mid, spec, bins, first);
    step(mid, big, spec, bins, second);
    const s0 = decodePngRgba(src), im = decodePngRgba(big);
    const d = resampleAreaTo(im.rgba, im.w, im.h, s0.w * target, s0.h * target);
    encodePngRgba(d.rgba, d.w, d.h, dst);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

export async function compare(name, src, modelId, alpha, target, routes = ['A', 'B', 'C']) {
  const spec = MODEL_BY_ID[modelId];
  const res = {};
  for (const r of routes) {
    const dst = `${OUT}-${name}-${r}.png`;
    const t0 = Date.now();
    try {
      if (r === 'A') routeA(src, dst, spec, alpha, target);
      else if (r === 'B') chain(src, dst, spec, alpha, target, 4, 4);
      else chain(src, dst, spec, alpha, target, 2, 4);
      res[r] = { file: dst, ms: Date.now() - t0 };
    } catch (e) {
      res[r] = { error: String(e.message || e).split('\n')[0].slice(0, 90), ms: Date.now() - t0 };
    }
  }
  return res;
}

export { decodePngRgba, MODEL_BY_ID };
