/**
 * Stage the LEG STORY PAGES into the Upscaler Studio.
 *
 * After finishing a leg the game shows a full-screen story page (zobraz_obrazek,
 * UMain.pas:831) — `public/data/Menu/00N.$dv`, a plain 8-bit BMP despite the extension.
 * There are nine, one per leg, the last of which leads into the ZAVER finale.
 *
 * They are converted to plain RGBA PNGs under `public/enhanced/_story/`, from where they
 * flow through the ENTIRE existing pipeline for free — indexing, per-model generation,
 * the Compare popup, per-picture picks and the build — exactly like a room background.
 * Mirrors stage-ui.mjs / stage-menu.mjs.
 *
 * These pages are fully opaque (they are full-screen artwork, not sprites), so there is
 * no colour key to bleed and no alpha to bake: a straight palette->RGB expansion is the
 * whole job.
 *
 * NOTE 005.$dv is 641x481, not 640x480 like the other eight — an off-by-one in the
 * original asset. It is staged at its true size rather than cropped, so the upscale is
 * of the real artwork; the runtime already scales each page to the screen box.
 *
 * Idempotent: only rewrites a PNG when the bytes differ, so the Studio's content-hash
 * index and its generated variants stay stable across runs.
 *
 * Usage: node tools/studio/stage-story.mjs [--force]
 * Then rebuild the index (delete tools/studio/index.json or restart the server).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseBmp } from '../lib/mapsrc.mjs';

const studioDir = dirname(fileURLToPath(import.meta.url));
const root = join(studioDir, '..', '..');
const menuDir = join(root, 'public', 'data', 'Menu');
const outDir = join(root, 'public', 'enhanced', '_story');

const FORCE = process.argv.includes('--force');

/** The nine leg pages, in leg order (001.$dv = leg 1). */
const PAGES = Array.from({ length: 9 }, (_, i) => ({
  src: `00${i + 1}.$dv`,
  out: `leg${i + 1}.png`,
}));

/** Encode RGBA to PNG via ffmpeg (same dependency the rest of the tooling uses). */
function encodePng(rgba, w, h, dst) {
  const work = mkdtempSync(join(tmpdir(), 'story-'));
  try {
    const raw = join(work, 'in.rgba');
    writeFileSync(raw, Buffer.from(rgba));
    const r = spawnSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-i', raw,
      // Drop the (fully opaque) alpha channel: these are LAYERS, not sprites. Staging
      // them RGBA made the index flag them alpha, which routes the build through the
      // sprite pipeline (matting//contour) and ships a redundant alpha plane.
      '-pix_fmt', 'rgb24',
      '-frames:v', '1', dst,
    ]);
    if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr?.toString().slice(0, 200)}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** True if `dst` already holds exactly these bytes (so the content hash won't move). */
function unchanged(dst, bytes) {
  if (FORCE || !existsSync(dst)) return false;
  const cur = readFileSync(dst);
  return cur.length === bytes.length && cur.equals(Buffer.from(bytes));
}

mkdirSync(outDir, { recursive: true });
let wrote = 0, skipped = 0;
for (const p of PAGES) {
  const srcAbs = join(menuDir, p.src);
  if (!existsSync(srcAbs)) {
    console.warn(`  ! ${p.src} missing, skipping`);
    continue;
  }
  const bmp = parseBmp(new Uint8Array(readFileSync(srcAbs)));
  const rgba = new Uint8Array(bmp.w * bmp.h * 4);
  for (let i = 0; i < bmp.pixels.length; i++) {
    const c = bmp.palette[bmp.pixels[i]];
    const o = i * 4;
    rgba[o] = c ? c.r : 0;
    rgba[o + 1] = c ? c.g : 0;
    rgba[o + 2] = c ? c.b : 0;
    rgba[o + 3] = 255;
  }
  const dst = join(outDir, p.out);
  // Encode to a temp first so the "did it change?" test compares real PNG bytes.
  const tmp = `${dst}.tmp.png`;
  encodePng(rgba, bmp.w, bmp.h, tmp);
  const bytes = readFileSync(tmp);
  if (unchanged(dst, bytes)) {
    rmSync(tmp, { force: true });
    skipped++;
    continue;
  }
  writeFileSync(dst, bytes);
  rmSync(tmp, { force: true });
  console.log(`  ${p.out}  ${bmp.w}x${bmp.h}`);
  wrote++;
}
console.log(`_story: ${wrote} written, ${skipped} unchanged → public/enhanced/_story`);
