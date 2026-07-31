/**
 * Batch-generate ONE model variant for many pictures (e.g. after adding a new
 * upscaler backend, or when changing the default model — the Studio only
 * generates on demand, so a new default would otherwise fall back to whatever
 * older variant happens to be cached).
 *
 * Writes cache/<hash>/<modelId>.png atomically (temp → rename), so the running
 * server never observes a half-written PNG and can be left up.
 *
 * Usage:
 *   node tools/studio/batch-generate.mjs <modelId> [--scope used|cached|all]
 *                                        [--shard i/N] [--limit N] [--force]
 *
 *   --scope used    pictures referenced by any room (default)
 *          cached   pictures that already have a cache dir
 *          all      every picture in the index
 *   --shard i/N     process only every Nth picture (offset i) — run several
 *                   shards as separate processes to use more of the machine
 *   --force         regenerate even if the variant already exists
 *
 * Env: REALESRGAN_NCNN / REALCUGAN_NCNN / APISR_CLI (as for the server).
 */
import { readFileSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODEL_BY_ID, requireBins, generateVariant, layerPadFor, SCALE } from './lib/upscale.mjs';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const cacheDir = join(studioDir, 'cache');
const index = JSON.parse(readFileSync(join(studioDir, 'index.json'), 'utf8'));

const argv = process.argv.slice(2);
const modelId = argv[0];
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const flag = (name) => argv.includes(`--${name}`);

const spec = MODEL_BY_ID[modelId];
if (!spec) { console.error(`unknown model "${modelId}" — known: ${Object.keys(MODEL_BY_ID).join(', ')}`); process.exit(1); }

const scope = opt('scope', 'used');
const limit = Number(opt('limit', 0));
const [shardI, shardN] = (opt('shard', '0/1')).split('/').map(Number);

function targets() {
  if (scope === 'all') return Object.keys(index.pictures);
  if (scope === 'cached') return Object.keys(index.pictures).filter((h) => existsSync(join(cacheDir, h)));
  // `used` = everything the app can actually display: room layers PLUS the
  // separately-indexed fish and shared-object lists (they are NOT reachable
  // from rooms[].objects, so walking rooms alone silently skips them).
  const used = new Set();
  for (const r of Object.values(index.rooms)) {
    if (r.bg) used.add(r.bg);
    if (r.wall) used.add(r.wall);
    for (const o of r.objects || []) for (const h of o.frames || []) used.add(h);
  }
  for (const h of index.fish || []) used.add(h);
  for (const h of index.sharedObjects || []) used.add(h);
  return [...used].filter((h) => index.pictures[h]);
}

const bins = requireBins();
const all = targets()
  .filter((h, i) => (i % shardN) === shardI)
  .filter((h) => flag('force') || !existsSync(join(cacheDir, h, `${modelId}.png`)));
const list = limit > 0 ? all.slice(0, limit) : all;

console.log(`[shard ${shardI}/${shardN}] ${modelId}: ${list.length} picture(s) to generate (scope=${scope})`);
let ok = 0, failed = 0;
const t0 = Date.now();
for (let i = 0; i < list.length; i++) {
  const hash = list[i];
  const pic = index.pictures[hash];
  const srcAbs = join(root, 'public', pic.sample);
  if (!existsSync(srcAbs)) { console.error(`  missing source for ${hash}`); failed++; continue; }
  const dir = join(cacheDir, hash);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.${modelId}.batch.png`);
  try {
    generateVariant(srcAbs, tmp, spec, pic.alpha, bins, SCALE, layerPadFor(pic.kind));
    renameSync(tmp, join(dir, `${modelId}.png`)); // atomic publish
    ok++;
  } catch (e) {
    rmSync(tmp, { force: true });
    failed++;
    console.error(`  FAILED ${hash}: ${String(e.message || e).slice(0, 160)}`);
  }
  if ((i + 1) % 25 === 0 || i === list.length - 1) {
    const el = (Date.now() - t0) / 1000;
    const rate = (i + 1) / el;
    const eta = (list.length - i - 1) / rate;
    console.log(`  [shard ${shardI}] ${i + 1}/${list.length} ok=${ok} fail=${failed} ${rate.toFixed(2)}/s eta ${(eta / 60).toFixed(1)}min`);
  }
}
console.log(`[shard ${shardI}] done: ok=${ok} failed=${failed} in ${((Date.now() - t0) / 1000 / 60).toFixed(1)}min`);
// Exit non-zero on any failure: this is driven by shard scripts, and a silent 0 let a
// partially-generated batch look like a complete one.
if (failed > 0) process.exitCode = 1;
