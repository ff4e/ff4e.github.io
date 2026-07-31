/**
 * Generation worker for the Upscaler Studio (run as a child process so the server
 * stays responsive during the blocking ncnn/ffmpeg calls). Generates the candidate
 * variants for ONE picture (hash) into cache/<hash>/<modelId>.png, atomically
 * (temp → rename), and maintains cache/<hash>/.status.json for the poller.
 *
 * argv: <indexFile> <cacheDir> <hash> [scale]   (scale defaults to ×4; above ×4 the
 * cache file is suffixed `@<scale>`, so the scales coexist)
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import {
  requireBins, availableModels, generateVariant, generateVariantAt, variantName, layerPadFor, SCALE, MAX_SCALE,
} from './upscale.mjs';

const [indexFile, cacheDir, hash, scaleArg] = process.argv.slice(2);
// Scale IS part of the cache key (variantName suffixes anything above ×4), so higher
// factors no longer poison the ×4 cache — the Studio uses this to preview a room at
// the scale it actually ships at. Still bounded: outside [SCALE, MAX_SCALE] is a bug.
const scale = Number(scaleArg || SCALE);
if (!Number.isInteger(scale) || scale < SCALE || scale > MAX_SCALE) {
  console.error(`refusing scale ${scale}: expected an integer in [${SCALE}, ${MAX_SCALE}]`);
  process.exit(1);
}
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

function main() {
  const index = JSON.parse(readFileSync(indexFile, 'utf8'));
  const pic = index.pictures[hash];
  if (!pic) { console.error(`unknown hash ${hash}`); process.exit(1); }
  const srcAbs = join(root, 'public', pic.sample);
  if (!existsSync(srcAbs)) { console.error(`missing source ${srcAbs}`); process.exit(1); }
  const dir = join(cacheDir, hash);
  mkdirSync(dir, { recursive: true });
  // Per-scale status, so a ×8 run can't overwrite the ×4 run's progress.
  const statusFile = join(dir, scale === SCALE ? '.status.json' : `.status@${scale}.json`);
  const bins = requireBins();
  const writeStatus = (s) => writeFileSync(statusFile, JSON.stringify(s));

  const models = availableModels(bins); // skip engines that aren't installed
  const todo = models.filter((m) => !existsSync(join(dir, variantName(m.id, scale))));
  let done = models.length - todo.length;
  writeStatus({ total: models.length, done, running: true, current: null });

  for (const m of todo) {
    writeStatus({ total: models.length, done, running: true, current: m.id });
    const tmp = join(dir, `.${m.id}@${scale}.tmp.png`);
    const dst = join(dir, variantName(m.id, scale));
    try {
      // generateVariantAt composes the model's own passes for scales it can't reach
      // natively; at ×4 it delegates straight to generateVariant.
      // Pad by KIND so the Studio's previews are the same pixels the build ships.
      generateVariantAt(srcAbs, tmp, m, pic.alpha, bins, scale, layerPadFor(pic.kind));
      renameSync(tmp, dst);
      done++;
    } catch (e) {
      writeStatus({ total: models.length, done, running: false, current: m.id, error: String(e.message || e) });
      console.error(`FAILED ${m.id}: ${e.message || e}`);
      process.exit(1);
    }
  }
  writeStatus({ total: models.length, done, running: false, current: null });
  console.log(`done ${hash} (${done}/${models.length})`);
}

main();
