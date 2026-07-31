/**
 * Stage the MENU / world-map source art into the Upscaler Studio.
 *
 * The Studio indexes `public/enhanced/**` PNGs, but the menu art lives in
 * `public/data/Menu` as palette BMPs (see tools/build-map-ai.mjs, which is what
 * currently produces the shipped `*_ai.webp|png`). This converts each of those
 * BMPs into a plain RGBA PNG under `public/enhanced/_menu/` so it flows through
 * the ENTIRE existing Studio pipeline for free — indexing, per-model generation,
 * the Compare popup and per-picture picks — exactly like a room sprite.
 *
 * Two kinds, matching build-map-ai.mjs:
 *   layer  — full-frame opaque art (mapa-0/1, krokomer, ikonky) → RGB, alpha 255.
 *   sprite — colour-keyed art (n0..n4 room balls). The native key is the TOP-LEFT
 *            pixel's palette index (Vykul); keyed pixels become alpha 0 and their
 *            RGB is bled from the neighbouring art so the upscaler never sees a
 *            colour↔key boundary (the Studio's own sprite path then re-mattes it).
 *
 * Idempotent: only rewrites a PNG when the produced bytes differ, so the Studio's
 * content-hash index and its generated variants stay stable across runs.
 *
 * Usage: node tools/studio/stage-menu.mjs [--force]
 * Then rebuild the index (delete tools/studio/index.json or restart the server).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseBmp, bleedKey } from '../lib/mapsrc.mjs';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const menuDir = join(root, 'public', 'data', 'Menu');
const outDir = join(root, 'public', 'enhanced', '_menu');

/** Mirrors tools/build-map-ai.mjs ASSETS (the art the `ai` tier actually uses). */
const ASSETS = [
  { name: 'mapa-0', src: 'mapa-0.BMP', kind: 'layer' },
  { name: 'mapa-1', src: 'mapa-1.BMP', kind: 'layer' },
  { name: 'krokomer', src: 'krokomer.BMP', kind: 'layer' },
  { name: 'ikonky', src: 'ikonky.BMP', kind: 'layer' },
  { name: 'n0', src: 'n0.BMP', kind: 'sprite' },
  { name: 'n1', src: 'n1.BMP', kind: 'sprite' },
  { name: 'n2', src: 'n2.BMP', kind: 'sprite' },
  { name: 'n3', src: 'n3.BMP', kind: 'sprite' },
  { name: 'n4', src: 'n4.BMP', kind: 'sprite' },
];

function encodePng(rgba, w, h, dst, opaque) {
  const work = mkdtempSync(join(tmpdir(), 'menustage-'));
  try {
    const raw = join(work, 'a.rgba');
    writeFileSync(raw, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    // Layers are written as RGB (no alpha channel) so the Studio indexes them as
    // opaque and sends them down the direct upscale path instead of the padded
    // matte-sprite path, which is only correct/needed for keyed sprites.
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-video_size', `${w}x${h}`, '-i', raw, '-pix_fmt', opaque ? 'rgb24' : 'rgba', dst],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr?.toString().slice(0, 200)}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

function toRgba(a) {
  const { w, h, pixels, palette } = parseBmp(readFileSync(join(menuDir, a.src)));
  const out = new Uint8Array(w * h * 4);
  if (a.kind === 'sprite') {
    const key = pixels[0]; // Vykul: top-left pixel is the transparent colour
    // Bleed the surrounding art over the keyed area first (same trick the map/room
    // builders use) so no colour↔key edge survives into the upscaler.
    const bled = bleedKey(pixels, w, h, key, Math.max(w, h));
    for (let i = 0; i < w * h; i++) {
      const c = palette[bled[i]];
      out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b;
      out[i * 4 + 3] = pixels[i] === key ? 0 : 255;
    }
  } else {
    for (let i = 0; i < w * h; i++) {
      const c = palette[pixels[i]];
      out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b; out[i * 4 + 3] = 255;
    }
  }
  return { rgba: out, w, h };
}

const force = process.argv.includes('--force');
mkdirSync(outDir, { recursive: true });
let wrote = 0, same = 0;
for (const a of ASSETS) {
  const srcAbs = join(menuDir, a.src);
  if (!existsSync(srcAbs)) { console.warn(`  ! missing ${a.src}`); continue; }
  const dst = join(outDir, `${a.name}.png`);
  const { rgba, w, h } = toRgba(a);
  const tmp = `${dst}.tmp.png`;
  encodePng(rgba, w, h, tmp, a.kind === 'layer');
  const next = readFileSync(tmp);
  if (!force && existsSync(dst) && Buffer.compare(next, readFileSync(dst)) === 0) {
    rmSync(tmp, { force: true }); same++; continue; // keep the hash stable
  }
  writeFileSync(dst, next); rmSync(tmp, { force: true });
  console.log(`  ${a.name}.png  ${w}x${h}  ${a.kind}`);
  wrote++;
}
console.log(`Menu staged → ${outDir}: ${wrote} written, ${same} unchanged`);
