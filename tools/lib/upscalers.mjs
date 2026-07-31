/**
 * Shared upscaler model table + ncnn/ffmpeg helpers for the world-map AI tools
 * (build-map-matrix.mjs, build-map-contest.mjs). One source of truth for "which models
 * do we compare", so the many upcoming regeneration passes only edit COLS here.
 *
 * Each column has a `make(ctx)` that writes img `ctx.out(id)`; ctx = { prep, binp, out(id) }
 * where `prep` is the source PNG to upscale. `gen_wdn50` blends `gen`+`gen_wdn`, so
 * MAKE_ORDER produces both before it.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SCALE = 4;

// Extra ncnn models that must live in <binDir>/models (beyond the 2022 binary's built-ins).
export const EXTRA_MODELS = [
  'RealESRGAN_General_x4_v3', 'RealESRGAN_General_WDN_x4_v3',
  '4x_NMKD-Siax_200k', '4xNomos8kSC', '4xLSDIR', '4xHFA2k',
];

export function run(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.status !== 0) { console.error(`FAILED ${label} (${cmd} exit ${r.status})`); process.exit(1); }
}
export function requireBin(env, hint) {
  const p = process.env[env];
  if (!p || !existsSync(p)) { console.error(`${env} not set/found. ${hint}`); process.exit(1); }
  return p;
}
export function requireModels(binp) {
  const models = join(dirname(binp), 'models');
  for (const m of EXTRA_MODELS) {
    if (!existsSync(join(models, `${m}.param`))) { console.error(`Missing model ${m}.param in ${models}`); process.exit(1); }
  }
}

export function nn4(src, dst) {
  run('nn x4', 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`, dst]);
}
export function aiScale(src, dst, model, binp) {
  const binDir = dirname(binp);
  run(`AI ${model}`, binp, ['-i', src, '-o', dst, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(binDir, 'models')]);
}
// Blend `top` over `bottom` at opacity w (both same-size pngs).
export function blend(bottom, top, dst, w) {
  run(`blend ${w}`, 'ffmpeg', ['-y', '-v', 'error', '-i', bottom, '-i', top,
    '-filter_complex', `[0][1]blend=all_mode=normal:all_opacity=${w}`, '-frames:v', '1', dst]);
}

// id, label, group, hero?, make(ctx). x4plus is the currently-shipped map pick (hero).
export const COLS = [
  { id: 'orig', label: 'original (native ×4)', group: 'reference', make: (c) => nn4(c.prep, c.out('orig')) },
  { id: 'x4plus', label: 'x4plus (current pick)', group: 'reference', hero: true, make: (c) => aiScale(c.prep, c.out('x4plus'), 'realesrgan-x4plus', c.binp) },
  { id: 'av3', label: 'animevideov3', group: 'reference', make: (c) => aiScale(c.prep, c.out('av3'), 'realesr-animevideov3-x4', c.binp) },
  { id: 'anime', label: 'x4plus-anime', group: 'reference', make: (c) => aiScale(c.prep, c.out('anime'), 'realesrgan-x4plus-anime', c.binp) },
  { id: 'gen', label: 'General v3 (dn 0)', group: 'General v3 · tunable denoise', make: (c) => aiScale(c.prep, c.out('gen'), 'RealESRGAN_General_x4_v3', c.binp) },
  { id: 'gen_wdn50', label: 'General ⊕ WDN 50%', group: 'General v3 · tunable denoise', make: (c) => blend(c.out('gen'), c.out('gen_wdn'), c.out('gen_wdn50'), 0.5) },
  { id: 'gen_wdn', label: 'General WDN (dn 1)', group: 'General v3 · tunable denoise', make: (c) => aiScale(c.prep, c.out('gen_wdn'), 'RealESRGAN_General_WDN_x4_v3', c.binp) },
  { id: 'siax', label: '4x NMKD-Siax', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('siax'), '4x_NMKD-Siax_200k', c.binp) },
  { id: 'nomos', label: '4x Nomos8kSC', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('nomos'), '4xNomos8kSC', c.binp) },
  { id: 'lsdir', label: '4x LSDIR', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('lsdir'), '4xLSDIR', c.binp) },
  { id: 'hfa2k', label: '4x HFA2k (anime)', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('hfa2k'), '4xHFA2k', c.binp) },
];
// gen_wdn50 blends gen + gen_wdn; produce both first.
export const MAKE_ORDER = ['orig', 'x4plus', 'av3', 'anime', 'gen', 'gen_wdn', 'gen_wdn50', 'siax', 'nomos', 'lsdir', 'hfa2k'];

const BY_ID = Object.fromEntries(COLS.map((c) => [c.id, c]));

/** Run the make() of each id (default: all, in dependency-safe MAKE_ORDER) for one ctx. */
export function generate(ctx, ids = MAKE_ORDER) {
  // Always honour MAKE_ORDER so gen/gen_wdn precede gen_wdn50 even for a subset.
  const want = new Set(ids);
  for (const id of MAKE_ORDER) if (want.has(id)) BY_ID[id].make(ctx);
}
