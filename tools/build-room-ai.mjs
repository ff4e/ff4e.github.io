/**
 * Build AI-upscaled ROOM art for the `ai` graphics level (Phase C).
 *
 * Mirrors tools/build-map-ai.mjs but for the enhanced (FFNG truecolor) ROOM
 * masters, which are already straight-RGBA PNGs (green colour-key behind alpha=0)
 * rather than colour-keyed BMPs. It upscales, per room, with realesr-animevideov3:
 *   p.png            (opaque background layer) -> direct AI upscale (opaque)
 *   w.png            (wall layer, has a doorway hole -> RGBA) -> matted sprite
 *   obj/<frame>.png  (object sprites, RGBA)                    -> matted sprite
 *   objects.json                                               -> copied verbatim
 * and, once (shared across every room), the fish sprite set under _fish/**.
 *
 * WHY the matte pipeline (not a naive AI pass on the RGBA): the transparent
 * region carries the green colour-key in RGB, so a naive upscale blends ball<->key
 * at every edge and leaves an olive fringe (measured edge RGB ~ (89,114,38)). So,
 * per the map tool: (1) COLOUR pass — dilate the solid (a>=128) colour outward to
 * flood the transparent area (the AI then never sees a colour<->key boundary),
 * upscale that; (2) MATTE pass — upscale the alpha channel as a greyscale so the
 * coverage follows the AI's own smooth silhouette; (3) recombine colour+matte with
 * a gentle smoothstep. Opaque layers skip all that.
 *
 * Output: public/enhanced-ai/<ROOM>/ and public/enhanced-ai/_fish/. The runtime
 * loader (main.ts, ai level) fetches these first and falls back to enhanced/.
 *
 *   export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   # dir must hold ./models
 * Usage:
 *   node tools/build-room-ai.mjs PRVNI        # a room's layers + objects (+ fish if absent)
 *   node tools/build-room-ai.mjs --fish       # (re)build only the shared fish set
 *   AI_MODEL=realesr-animevideov3-x4  AI_SCALE=4   (defaults)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const srcRoot = join(root, 'public', 'enhanced');
const outRoot = join(root, 'public', 'enhanced-ai');
const SCALE = Number(process.env.AI_SCALE || 4);
const MODEL = process.env.AI_MODEL || `realesr-animevideov3-x${SCALE}`;
// Transparent margin (source px) added around every alpha sprite before upscaling
// and cropped back after — avoids the upscaler's frame-boundary artifacts on
// sprites that touch their source edge (benefit saturates by ~8px; 12 = safety).
const SPRITE_PAD = Number(process.env.SPRITE_PAD || 12);

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error(`FAILED ${label} (${cmd} exit ${r.status})`); process.exit(1); }
}
function requireBin() {
  const p = process.env.REALESRGAN_NCNN;
  if (!p || !existsSync(p)) { console.error('REALESRGAN_NCNN not set/found (realesrgan-ncnn-vulkan; dir must hold ./models).'); process.exit(1); }
  return p;
}
function probe(png) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  const [w, h] = r.stdout.trim().split(',').map(Number);
  return { w, h };
}
function decodeRgba(png, w, h, work, tag) {
  const raw = join(work, `${tag}.rgba`);
  run(`decode ${tag}`, 'ffmpeg', ['-y', '-v', 'error', '-i', png, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
  const buf = readFileSync(raw);
  if (buf.length !== w * h * 4) { console.error(`decode size mismatch ${tag}: ${buf.length} != ${w * h * 4}`); process.exit(1); }
  return new Uint8Array(buf);
}
function encodeRgba(rgba, w, h, work, tag, dst) {
  const raw = join(work, `${tag}.rgba`);
  writeFileSync(raw, Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  run(`encode ${tag}`, 'ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-video_size', `${w}x${h}`, '-i', raw, dst]);
}
function upscaleFile(inPng, outPng, binp) {
  run(`AI ${MODEL} x${SCALE}`, binp, ['-i', inPng, '-o', outPng, '-n', MODEL, '-s', String(SCALE), '-f', 'png', '-m', join(dirname(binp), 'models')]);
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

/**
 * Flood the transparent region with the nearest SOLID (a>=128) colour so the AI
 * colour pass sees no colour<->key boundary. Iterative 4-neighbour dilation of the
 * solid pixels' RGB; returns an opaque RGBA (a=255 everywhere).
 */
function bleedAlpha(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  const known = new Uint8Array(w * h); // 1 = colour assigned
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    if (a >= 128) {
      out[i * 4] = rgba[i * 4]; out[i * 4 + 1] = rgba[i * 4 + 1]; out[i * 4 + 2] = rgba[i * 4 + 2];
      known[i] = 1;
    }
  }
  // If nothing solid (shouldn't happen), fall back to mid-grey.
  let anyKnown = known.some((v) => v === 1);
  if (!anyKnown) { for (let i = 0; i < w * h; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 107; } }
  const maxPasses = w + h; // enough to reach across the sprite
  for (let pass = 0; pass < maxPasses && anyKnown; pass++) {
    let filledThisPass = 0;
    const snap = known.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (snap[i]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0 && snap[i - 1]) { r += out[(i - 1) * 4]; g += out[(i - 1) * 4 + 1]; b += out[(i - 1) * 4 + 2]; n++; }
        if (x < w - 1 && snap[i + 1]) { r += out[(i + 1) * 4]; g += out[(i + 1) * 4 + 1]; b += out[(i + 1) * 4 + 2]; n++; }
        if (y > 0 && snap[i - w]) { r += out[(i - w) * 4]; g += out[(i - w) * 4 + 1]; b += out[(i - w) * 4 + 2]; n++; }
        if (y < h - 1 && snap[i + w]) { r += out[(i + w) * 4]; g += out[(i + w) * 4 + 1]; b += out[(i + w) * 4 + 2]; n++; }
        if (n > 0) { out[i * 4] = Math.round(r / n); out[i * 4 + 1] = Math.round(g / n); out[i * 4 + 2] = Math.round(b / n); known[i] = 1; filledThisPass++; }
      }
    }
    if (filledThisPass === 0) break;
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = 255;
  return out;
}

/** Greyscale RGBA (r=g=b=alpha, a=255) so the AI upscales the coverage silhouette. */
function alphaToGrey(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = a; out[i * 4 + 3] = 255;
  }
  return out;
}

/** Add a fully-transparent margin of `pad` px on every side (source resolution). */
function padTransparent(rgba, w, h, pad) {
  const W = w + 2 * pad, H = h + 2 * pad;
  const out = new Uint8Array(W * H * 4); // zero-init = transparent black
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((y + pad) * W + (x + pad)) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { rgba: out, w: W, h: H };
}

/** Crop an RGBA buffer to (cx,cy,cw,ch). */
function cropRgba(rgba, w, cx, cy, cw, ch) {
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = ((y + cy) * w + (x + cx)) * 4, d = (y * cw + x) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return out;
}

/**
 * Matted-sprite upscale for an RGBA source with a colour-key behind alpha=0.
 * A transparent margin (SPRITE_PAD) is added before upscaling and cropped back
 * after, so sprites that sit flush against the source frame edge don't pick up
 * the upscaler's boundary artifacts (which showed as a flat-clipped / uneven
 * ink rim). The margin gives the model real context on every side.
 */
function buildSprite(srcPng, dstPng, binp) {
  const { w, h } = probe(srcPng);
  const work = mkdtempSync(join(tmpdir(), 'roomai-'));
  try {
    const src0 = decodeRgba(srcPng, w, h, work, 'src');
    // 0. PAD with a transparent ring so the sprite clears the frame boundary.
    const { rgba: src, w: pw, h: ph } = padTransparent(src0, w, h, SPRITE_PAD);
    // 1. COLOUR pass.
    const colPng = join(work, 'col.png');
    encodeRgba(bleedAlpha(src, pw, ph), pw, ph, work, 'col', colPng);
    const colAi = join(work, 'col_ai.png');
    upscaleFile(colPng, colAi, binp);
    const pow = pw * SCALE, poh = ph * SCALE;
    const col = decodeRgba(colAi, pow, poh, work, 'colai');
    // 2. MATTE pass.
    const mPng = join(work, 'matte.png');
    encodeRgba(alphaToGrey(src, pw, ph), pw, ph, work, 'matte', mPng);
    const mAi = join(work, 'matte_ai.png');
    upscaleFile(mPng, mAi, binp);
    const matte = decodeRgba(mAi, pow, poh, work, 'matteai');
    // 3. Combine (still at padded resolution).
    const padded = new Uint8Array(pow * poh * 4);
    for (let i = 0; i < pow * poh; i++) {
      padded[i * 4] = col[i * 4]; padded[i * 4 + 1] = col[i * 4 + 1]; padded[i * 4 + 2] = col[i * 4 + 2];
      padded[i * 4 + 3] = Math.round(smoothstep(0.12, 0.6, matte[i * 4] / 255) * 255);
    }
    // 4. Crop the margin back off -> exact ow x oh sprite.
    const ow = w * SCALE, oh = h * SCALE;
    const out = cropRgba(padded, pow, SPRITE_PAD * SCALE, SPRITE_PAD * SCALE, ow, oh);
    encodeRgba(out, ow, oh, work, 'out', dstPng);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Opaque-layer upscale (no alpha) — direct AI pass. */
function buildLayer(srcPng, dstPng, binp) {
  upscaleFile(srcPng, dstPng, binp);
}

/** True if the source PNG has any transparent pixel (=> needs the matte pipeline). */
function hasAlpha(png) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  return r.stdout.trim().includes('rgba') || r.stdout.trim().includes('ya') || r.stdout.includes('pal8');
}

function buildRoom(roomName, binp) {
  const srcDir = join(srcRoot, roomName);
  if (!existsSync(srcDir)) { console.error(`No enhanced art for ${roomName} at ${srcDir}`); process.exit(1); }
  const dstDir = join(outRoot, roomName);
  mkdirSync(join(dstDir, 'obj'), { recursive: true });
  // Background + wall layers (+ any animation frames w1/p1…).
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith('.png')) continue;
    const src = join(srcDir, f), dst = join(dstDir, f);
    console.log(`  layer ${f}`);
    if (hasAlpha(src)) buildSprite(src, dst, binp); else buildLayer(src, dst, binp);
  }
  // Object sprites.
  const objSrc = join(srcDir, 'obj');
  if (existsSync(objSrc)) {
    for (const f of readdirSync(objSrc)) {
      if (!f.endsWith('.png')) continue;
      console.log(`  obj ${f}`);
      buildSprite(join(objSrc, f), join(dstDir, 'obj', f), binp);
    }
  }
  // Manifest verbatim.
  const mf = join(srcDir, 'objects.json');
  if (existsSync(mf)) copyFileSync(mf, join(dstDir, 'objects.json'));
  console.log(`Done room ${roomName} -> ${dstDir}`);
}

function buildFish(binp) {
  const fSrc = join(srcRoot, '_fish');
  const fDst = join(outRoot, '_fish');
  if (!existsSync(fSrc)) { console.error(`No fish art at ${fSrc}`); process.exit(1); }
  for (const size of ['small', 'big']) {
    for (const facing of ['left', 'right']) {
      const dir = join(fSrc, size, facing);
      if (!existsSync(dir)) continue;
      mkdirSync(join(fDst, size, facing), { recursive: true });
      for (const f of readdirSync(dir)) {
        if (!f.endsWith('.png')) continue;
        console.log(`  fish ${size}/${facing}/${f}`);
        buildSprite(join(dir, f), join(fDst, size, facing, f), binp);
      }
    }
  }
  const mf = join(fSrc, 'manifest.json');
  if (existsSync(mf)) { mkdirSync(fDst, { recursive: true }); copyFileSync(mf, join(fDst, 'manifest.json')); }
  console.log(`Done fish -> ${fDst}`);
}

function main() {
  const binp = requireBin();
  const args = process.argv.slice(2);
  const fishOnly = args.includes('--fish');
  const rooms = args.filter((a) => !a.startsWith('--'));
  if (fishOnly && rooms.length === 0) { buildFish(binp); return; }
  if (rooms.length === 0) { console.error('Usage: node tools/build-room-ai.mjs <ROOM> | --fish'); process.exit(1); }
  for (const r of rooms) buildRoom(r, binp);
  // Build the shared fish set if it isn't present yet (needed for fish to render).
  if (!existsSync(join(outRoot, '_fish', 'manifest.json'))) { console.log('Fish set absent — building it once…'); buildFish(binp); }
}

main();
