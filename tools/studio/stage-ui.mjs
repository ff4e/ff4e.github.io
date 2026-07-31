/**
 * Stage the CONTROL PANEL and CREDITS source art into the Upscaler Studio.
 *
 * Both live in `public/data/Menu` in engine-specific formats the Studio cannot
 * index (`panel.ffp`, palette BMPs), so they are converted to plain RGBA PNGs under
 * `public/enhanced/_panel/` and `public/enhanced/_credits/`. From there they flow
 * through the ENTIRE existing pipeline for free — indexing, per-model generation,
 * the Compare popup, per-picture picks and the build — exactly like a room sprite.
 * Mirrors stage-menu.mjs.
 *
 * panel.ffp holds SIXTEEN 155x395 colour variants of one panel plus a 17x17 slider
 * handle. Names are index-based (img00..img15) because render/hud.ts addresses them
 * by index (SEDY=0 … SCROLL_MAX=15) and the runtime compositor reloads them the same
 * way — a "nicer" naming scheme would just add a mapping to get wrong. Measured
 * transparency (do not assume, it differs per image):
 *   img00..img05  the four colour variants + the two options frames — FULLY OPAQUE.
 *   img06..img15  the scroll-animation frames, overlaid by Pruhl with colour key 254.
 *   cudl          the slider handle, colour key = its own top-left pixel (magenta 34).
 *
 * Credits are two BMPs sharing the STATIC image's palette (UMain.pas:1171): a 640x480
 * frame whose transparent window (its bottom-right pixel's index) reveals a tall
 * scrolling strip. Baking that window into alpha turns the original's per-row index
 * test into ordinary alpha compositing, which survives upscaling; a colour key would
 * not, because interpolation invents colours near the key.
 *
 * Keyed pixels get their RGB bled from neighbouring art before the alpha is applied,
 * so the upscaler never sees a colour->key boundary (same trick as the map/room art).
 *
 * Idempotent: only rewrites a PNG when the bytes differ, so the Studio's content-hash
 * index and its generated variants stay stable across runs.
 *
 * Usage: node tools/studio/stage-ui.mjs [--force]
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
const enhancedDir = join(root, 'public', 'enhanced');

// panel.ffp geometry — must match src/data/ffp.ts.
const PANEL_W = 155;
const PANEL_H = 395;
const PANEL_IMAGES = 16;
const CUDL_SIZE = 17;
const PANEL_PAD = 254;          // FillChar value for short rows (Uovl.pas:564)
const SCROLL_MIN = 6;           // first scroll frame; below this the images are opaque

/**
 * Parse panel.ffp: 16 panel images, the cudl sprite, then a 256-entry palette stored
 * **B,G,R** (Uovl.pas:527,578,584-588) — reading it as RGB swaps red and blue, which
 * shows up as an orange panel turning blue. Mirrors src/data/ffp.ts exactly, including
 * the different row-fill values (254 for panels, 0 for the cudl sprite).
 */
function parseFfp(buf) {
  let o = 0;
  const readRows = (w, h, fill) => {
    const px = new Uint8Array(w * h).fill(fill);
    for (let row = 0; row < h; row++) {
      const len = buf[o++];
      for (let col = 0; col < len && col < w; col++) px[row * w + col] = buf[o + col];
      o += len;
    }
    return px;
  };
  const images = [];
  for (let i = 0; i < PANEL_IMAGES; i++) images.push(readRows(PANEL_W, PANEL_H, PANEL_PAD));
  const cudl = readRows(CUDL_SIZE, CUDL_SIZE, 0);
  const pal = buf.subarray(o, o + 768);
  const palette = [];
  for (let i = 0; i < 256; i++) palette.push({ b: pal[i * 3], g: pal[i * 3 + 1], r: pal[i * 3 + 2] });
  return { images, cudl, palette };
}

/**
 * Indexed pixels -> RGBA. When `key` is a number those pixels become alpha 0, and the
 * RGB underneath is bled from the surrounding art first so no colour->key edge exists.
 */
function toRgba(pixels, w, h, palette, key = null) {
  const out = new Uint8Array(w * h * 4);
  const src = key === null ? pixels : bleedKey(pixels, w, h, key, Math.max(w, h));
  for (let i = 0; i < w * h; i++) {
    const c = palette[src[i]] || { r: 0, g: 0, b: 0 };
    out[i * 4] = c.r; out[i * 4 + 1] = c.g; out[i * 4 + 2] = c.b;
    out[i * 4 + 3] = key !== null && pixels[i] === key ? 0 : 255;
  }
  return out;
}

function encodePng(rgba, w, h, dst, opaque) {
  const work = mkdtempSync(join(tmpdir(), 'uistage-'));
  try {
    const raw = join(work, 'a.rgba');
    writeFileSync(raw, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
    // Opaque art is written as RGB so the Studio indexes it as such and uses the direct
    // upscale path; the padded matte-sprite path is only correct for keyed art.
    const r = spawnSync('ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba',
      '-video_size', `${w}x${h}`, '-i', raw, '-pix_fmt', opaque ? 'rgb24' : 'rgba', dst],
      { stdio: ['ignore', 'ignore', 'pipe'] });
    if (r.status !== 0) throw new Error(`ffmpeg encode failed: ${r.stderr?.toString().slice(0, 200)}`);
  } finally { rmSync(work, { recursive: true, force: true }); }
}

const force = process.argv.includes('--force');
let wrote = 0, same = 0;

function emit(dir, name, rgba, w, h, opaque) {
  mkdirSync(dir, { recursive: true });
  const dst = join(dir, `${name}.png`);
  const tmp = `${dst}.tmp.png`;
  encodePng(rgba, w, h, tmp, opaque);
  const next = readFileSync(tmp);
  if (!force && existsSync(dst) && Buffer.compare(next, readFileSync(dst)) === 0) {
    rmSync(tmp, { force: true }); same++; return;
  }
  writeFileSync(dst, next); rmSync(tmp, { force: true });
  console.log(`  ${name}.png  ${w}x${h}  ${opaque ? 'opaque' : 'keyed'}`);
  wrote++;
}

// ---- control panel + options (panel.ffp) ---------------------------------
const ffpPath = join(menuDir, 'panel.ffp');
if (!existsSync(ffpPath)) {
  console.warn('  ! missing panel.ffp');
} else {
  const { images, cudl, palette } = parseFfp(readFileSync(ffpPath));
  const outDir = join(enhancedDir, '_panel');
  // The scroll frames' key is the bottom-left pixel of the LAST frame (Uovl.pas Pruhl).
  const scrollKey = images[PANEL_IMAGES - 1][(PANEL_H - 1) * PANEL_W];
  for (let i = 0; i < PANEL_IMAGES; i++) {
    const keyed = i >= SCROLL_MIN;
    const name = `img${String(i).padStart(2, '0')}`;
    emit(outDir, name, toRgba(images[i], PANEL_W, PANEL_H, palette, keyed ? scrollKey : null),
      PANEL_W, PANEL_H, !keyed);
  }
  emit(outDir, 'cudl', toRgba(cudl, CUDL_SIZE, CUDL_SIZE, palette, cudl[0]), CUDL_SIZE, CUDL_SIZE, false);
}

// ---- credits (CredStat1 + CredMov) ---------------------------------------
const statPath = join(menuDir, 'CredStat1.BMP');
// Prefer the strip with the web-port card prepended (tools/build-credits-port.py) so
// the AI tier shows the same credits as the faithful one; fall back to the original.
const portPath = join(menuDir, 'CredMov_port.BMP');
const movPath = existsSync(portPath) ? portPath : join(menuDir, 'CredMov.BMP');
if (!existsSync(statPath) || !existsSync(movPath)) {
  console.warn('  ! missing CredStat1.BMP / CredMov.BMP');
} else {
  const stat = parseBmp(readFileSync(statPath));
  const mov = parseBmp(readFileSync(movPath));
  console.log(`  credits strip: ${movPath.endsWith('_port.BMP') ? 'CredMov_port.BMP (with web-port card)' : 'CredMov.BMP'} ${mov.w}x${mov.h}`);
  const outDir = join(enhancedDir, '_credits');
  // transp = the static frame's BOTTOM-RIGHT pixel (UMain.pas:1179-1181).
  const transp = stat.pixels[stat.w * stat.h - 1];
  emit(outDir, 'stat', toRgba(stat.pixels, stat.w, stat.h, stat.palette, transp), stat.w, stat.h, false);
  // The scroll strip is drawn through the STATIC image's palette, not its own.
  emit(outDir, 'mov', toRgba(mov.pixels, mov.w, mov.h, stat.palette, null), mov.w, mov.h, true);
}

console.log(`UI art staged → enhanced/_panel + _credits: ${wrote} written, ${same} unchanged`);
