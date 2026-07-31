/**
 * Focused algo-comparison gallery for ROOM 1 (PRVNI) — "which upscaler for the
 * room art". Unlike build-room-matrix.mjs, every AI column here goes through the
 * SHIPPED PADDING PIPELINE (tools/build-room-ai.mjs buildSprite): alpha assets get
 * a transparent ring, are upscaled (colour + matte passes), then cropped back — so
 * the comparison reflects exactly what the game will render (no frame-edge rim
 * artifact). Opaque layers (the p.png background) get a direct AI pass.
 *
 * Columns: original (NN ×4) · animevideov3 (current room hero) · General WDN
 * (world-map tournament winner) · 4x NMKD-Siax · 4x Nomos8kSC · 4x LSDIR
 * · x4plus-anime  — the favorites discussed so far.
 *
 * Output: tools/room-algo/ (img/ + index.html). Serve with python3 -m http.server.
 * Run: REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan node tools/build-room-algo.mjs [ROOM]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-algo');
const imgDir = join(outDir, 'img');
const ROOM = process.argv[2] || 'PRVNI';
const SCALE = 4;
// Same transparent margin the shipped generator uses (build-room-ai.mjs).
const SPRITE_PAD = Number(process.env.SPRITE_PAD || 12);

// ---- shell helpers -------------------------------------------------------
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
function hasAlpha(png) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=pix_fmt', '-of', 'csv=p=0', png], { encoding: 'utf8' });
  return r.stdout.trim().includes('rgba') || r.stdout.trim().includes('ya') || r.stdout.includes('pal8');
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
function upscaleFile(inPng, outPng, model, binp) {
  run(`AI ${model} x${SCALE}`, binp, ['-i', inPng, '-o', outPng, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(dirname(binp), 'models')]);
}
function nn4(src, dst) {
  run('nn x4', 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`, dst]);
}
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---- padding pipeline (mirrors build-room-ai.mjs) ------------------------
function bleedAlpha(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] >= 128) {
      out[i * 4] = rgba[i * 4]; out[i * 4 + 1] = rgba[i * 4 + 1]; out[i * 4 + 2] = rgba[i * 4 + 2];
      known[i] = 1;
    }
  }
  let anyKnown = known.some((v) => v === 1);
  if (!anyKnown) { for (let i = 0; i < w * h; i++) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = 107; } }
  const maxPasses = w + h;
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
function alphaToGrey(rgba, w, h) {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3];
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = a; out[i * 4 + 3] = 255;
  }
  return out;
}
function padTransparent(rgba, w, h, pad) {
  const W = w + 2 * pad, H = h + 2 * pad;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = ((y + pad) * W + (x + pad)) * 4;
      out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = rgba[s + 3];
    }
  }
  return { rgba: out, w: W, h: H };
}
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
/** Matted-sprite upscale WITH the transparent-ring padding trick. */
function buildSprite(srcPng, dstPng, model, binp) {
  const { w, h } = probe(srcPng);
  const work = mkdtempSync(join(tmpdir(), 'roomalgo-'));
  try {
    const src0 = decodeRgba(srcPng, w, h, work, 'src');
    const { rgba: src, w: pw, h: ph } = padTransparent(src0, w, h, SPRITE_PAD);
    const colPng = join(work, 'col.png');
    encodeRgba(bleedAlpha(src, pw, ph), pw, ph, work, 'col', colPng);
    const colAi = join(work, 'col_ai.png');
    upscaleFile(colPng, colAi, model, binp);
    const pow = pw * SCALE, poh = ph * SCALE;
    const col = decodeRgba(colAi, pow, poh, work, 'colai');
    const mPng = join(work, 'matte.png');
    encodeRgba(alphaToGrey(src, pw, ph), pw, ph, work, 'matte', mPng);
    const mAi = join(work, 'matte_ai.png');
    upscaleFile(mPng, mAi, model, binp);
    const matte = decodeRgba(mAi, pow, poh, work, 'matteai');
    const padded = new Uint8Array(pow * poh * 4);
    for (let i = 0; i < pow * poh; i++) {
      padded[i * 4] = col[i * 4]; padded[i * 4 + 1] = col[i * 4 + 1]; padded[i * 4 + 2] = col[i * 4 + 2];
      padded[i * 4 + 3] = Math.round(smoothstep(0.12, 0.6, matte[i * 4] / 255) * 255);
    }
    const ow = w * SCALE, oh = h * SCALE;
    const out = cropRgba(padded, pow, SPRITE_PAD * SCALE, SPRITE_PAD * SCALE, ow, oh);
    encodeRgba(out, ow, oh, work, 'out', dstPng);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ---- assets + models -----------------------------------------------------
function assets() {
  const r = (p) => join(enhancedDir, ROOM, p);
  const f = (p) => join(enhancedDir, '_fish', p);
  return [
    ['bg', 'Background layer (p.png) — opaque, direct pass', r('p.png'), [0.5, 0.55]],
    ['wall', 'Wall layer (w.png) — padded', r('w.png'), [0.76, 0.30]],
    ['obj_stul', 'Object · table (stul.png) — padded', r('obj/stul.png'), [0.5, 0.5]],
    ['obj_zidle_v', 'Object · chair (zidle_v.png) — padded', r('obj/zidle_v.png'), [0.5, 0.5]],
    ['fish_b_swim', 'Big fish · body swim — padded', f('big/right/body_swam_02.png'), [0.558, 0.5]],
    ['fish_b_head', 'Big fish · head smile — padded', f('big/right/head_smile.png'), [0.842, 0.5]],
    ['fish_s_rest', 'Small fish · body rest — padded', f('small/right/body_rest_00.png'), [0.5, 0.5]],
    ['fish_s_head', 'Small fish · head smile — padded', f('small/right/head_smile.png'), [0.844, 0.5]],
  ].filter(([, , p]) => { if (!existsSync(p)) console.warn(`skip missing ${p}`); return existsSync(p); });
}
// [id, label, model|null] — null model = original NN reference.
const COLS = [
  { id: 'orig', label: 'original (native ×4)', model: null },
  { id: 'av3', label: 'animevideov3 (current)', model: 'realesr-animevideov3-x4', hero: true },
  { id: 'gen_wdn', label: 'General WDN (map winner)', model: 'RealESRGAN_General_WDN_x4_v3' },
  { id: 'siax', label: '4x NMKD-Siax', model: '4x_NMKD-Siax_200k' },
  { id: 'nomos', label: '4x Nomos8kSC', model: '4xNomos8kSC' },
  { id: 'lsdir', label: '4x LSDIR', model: '4xLSDIR' },
  { id: 'anime', label: 'x4plus-anime', model: 'realesrgan-x4plus-anime' },
];

function main() {
  const binp = requireBin();
  const models = join(dirname(binp), 'models');
  for (const c of COLS) {
    if (c.model && !existsSync(join(models, `${c.model}.param`))) {
      console.error(`Missing model ${c.model}.param in ${models}`); process.exit(1);
    }
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const list = assets();
  const manifest = [];
  for (const [key, label, srcPath, focus] of list) {
    const alpha = hasAlpha(srcPath);
    console.log(`\n== ${key} (${label}) ${alpha ? '[alpha→padded]' : '[opaque→direct]'} ==`);
    for (const col of COLS) {
      const dst = join(imgDir, `${key}_${col.id}.png`);
      if (!col.model) { nn4(srcPath, dst); continue; }
      if (alpha) buildSprite(srcPath, dst, col.model, binp);
      else upscaleFile(srcPath, dst, col.model, binp);
    }
    manifest.push({ key, label, focus, alpha, files: Object.fromEntries(COLS.map((c) => [c.id, `img/${key}_${c.id}.png`])) });
  }
  writeFileSync(join(outDir, 'index.html'), renderHtml(ROOM, manifest));
  console.log(`\nDone. Serve: cd tools/room-algo && python3 -m http.server 8107`);
}

function renderHtml(room, manifest) {
  const data = JSON.stringify(manifest);
  const cols = JSON.stringify(COLS.map(({ id, label, hero }) => ({ id, label, hero: !!hero })));
  const n = COLS.length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room ${room} — algo comparison (padded)</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 5; background: #232329; padding: 12px 18px; border-bottom: 1px solid #35353c; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .ctrls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .ctrls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .asset { padding: 16px 18px; border-bottom: 1px solid #2c2c33; }
  .asset h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #b9c4d0; }
  .row { display: grid; grid-template-columns: repeat(${n}, minmax(var(--tile, 300px), 1fr)); gap: 12px; }
  .tile { background: #111114; border: 1px solid #33333a; border-radius: 6px; overflow: hidden; }
  .tile.hero { border-color: #4b7bd6; box-shadow: 0 0 0 1px #4b7bd6 inset; }
  .tile .cap { padding: 5px 8px; font-size: 12px; color: #cfd6dd; background: #26262c; border-bottom: 1px solid #33333a; white-space: nowrap; }
  .tile.hero .cap { color: #cfe0ff; background: #23324c; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 420px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; max-width: 1100px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>Room <b>${room}</b> — upscaler comparison · ×4 · ${n}-way · <span style="color:#8fd694">padding trick applied</span></h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="160" max="700" step="20" value="300"> <span id="tval">300px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">Every AI column runs the <b>shipped padding pipeline</b> (transparent ring → colour+matte upscale → crop) for the alpha assets (wall, objects, fish), so the fish borders match what the game renders. The opaque background gets a direct pass. <b style="color:#cfe0ff">animevideov3</b> is the current room hero; <b>General WDN</b> won the world-map tournament; Siax / Nomos8kSC / LSDIR are the illustration-focused ESRGAN models. Scroll a tile to pan.</div>
</header>
<main id="main"></main>
<script>
const DATA = ${data};
const COLS = ${cols};
const state = { zoom: 2, tile: 300 };
function render() {
  const main = document.getElementById('main'); main.innerHTML = '';
  document.documentElement.style.setProperty('--tile', state.tile + 'px');
  document.documentElement.style.setProperty('--vh', Math.round(state.tile * 1.3) + 'px');
  for (const asset of DATA) {
    const sec = document.createElement('section'); sec.className = 'asset';
    const h = document.createElement('h2'); h.textContent = asset.label; sec.append(h);
    const row = document.createElement('div'); row.className = 'row';
    for (const col of COLS) {
      const t = document.createElement('div'); t.className = 'tile' + (col.hero ? ' hero' : '');
      const c = document.createElement('div'); c.className = 'cap'; c.textContent = col.label;
      const vp = document.createElement('div'); vp.className = 'viewport';
      vp.dataset.fx = asset.focus[0]; vp.dataset.fy = asset.focus[1];
      const img = document.createElement('img'); img.src = asset.files[col.id]; img.loading = 'lazy';
      img.dataset.mult = state.zoom;
      t.append(c, vp); vp.append(img); row.append(t);
    }
    sec.append(row); main.append(sec);
  }
  applyZoom();
}
function applyZoom() {
  for (const img of document.querySelectorAll('.tile img')) {
    img.onload = () => sizeImg(img); if (img.complete) sizeImg(img);
  }
}
function sizeImg(img) {
  img.style.width = (img.naturalWidth * parseFloat(img.dataset.mult)) + 'px';
  const vp = img.parentElement;
  if (vp && !vp.dataset.panned) { vp.dataset.panned = '1'; requestAnimationFrame(() => repan(vp)); }
}
function repan(vp) {
  const img = vp.querySelector('img'); if (!img) return;
  const fx = parseFloat(vp.dataset.fx), fy = parseFloat(vp.dataset.fy);
  vp.scrollLeft = Math.max(0, img.offsetWidth * fx - vp.clientWidth / 2);
  vp.scrollTop = Math.max(0, img.offsetHeight * fy - vp.clientHeight / 2);
}
document.getElementById('zoom').oninput = (e) => {
  state.zoom = parseFloat(e.target.value);
  document.getElementById('zval').textContent = state.zoom + '×';
  for (const img of document.querySelectorAll('.tile img')) { img.dataset.mult = state.zoom; sizeImg(img); }
  requestAnimationFrame(() => document.querySelectorAll('.viewport').forEach(repan));
};
document.getElementById('tile').oninput = (e) => {
  state.tile = +e.target.value;
  document.getElementById('tval').textContent = state.tile + 'px';
  document.documentElement.style.setProperty('--tile', state.tile + 'px');
  document.documentElement.style.setProperty('--vh', Math.round(state.tile * 1.3) + 'px');
};
document.getElementById('smooth').onchange = (e) => {
  document.documentElement.style.setProperty('--smooth', e.target.checked ? 'auto' : 'pixelated');
};
document.documentElement.style.setProperty('--smooth', 'pixelated');
render();
</script>
</body></html>`;
}

main();
