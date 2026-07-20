/**
 * Stage the shared enhanced FISH sprites (Phase 3b). Unlike per-room objects the
 * two fish live in images/fishes/{small,big}/{left,right}/ (bodies, pre-mirrored)
 * + images/fishes/{small,big}/heads/{left,right}/ (full-frame head overlays).
 *
 * Copies them to public/enhanced/_fish/<size>/<facing>/ (heads flattened in
 * alongside bodies — bodies start "body_", heads "head_") and writes a manifest
 * listing the files so the runtime can load them once.
 *
 *   FF_ENHANCED_DIR=/path/to/fillets-ng/images npm run stage-enhanced-fish
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const IMAGES_DIR =
  process.env.FF_ENHANCED_DIR ??
  '/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images';
const OUT_ROOT = join(ROOT, 'public', 'enhanced', '_fish');

const SIZES = ['small', 'big'] as const;
const FACINGS = ['left', 'right'] as const;

const manifest: Record<string, Record<string, string[]>> = {};
let total = 0;

for (const size of SIZES) {
  manifest[size] = {};
  for (const facing of FACINGS) {
    const bodyDir = join(IMAGES_DIR, 'fishes', size, facing);
    const headDir = join(IMAGES_DIR, 'fishes', size, 'heads', facing);
    const outDir = join(OUT_ROOT, size, facing);
    mkdirSync(outDir, { recursive: true });
    const files: string[] = [];
    for (const [src, prefix] of [
      [bodyDir, 'body_'],
      [headDir, 'head_'],
    ] as const) {
      if (!existsSync(src)) continue;
      for (const f of readdirSync(src)) {
        if (!f.endsWith('.png') || !f.startsWith(prefix)) continue;
        writeFileSync(join(outDir, f), readFileSync(join(src, f)));
        files.push(f);
        total++;
      }
    }
    manifest[size]![facing] = files.sort();
  }
}

writeFileSync(join(OUT_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 0) + '\n');
console.log(`Staged ${total} fish sprite files to ${OUT_ROOT}.`);
