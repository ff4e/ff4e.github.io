/**
 * Wide model-matrix gallery for the WORLD-MAP AI-upscale decision — the map counterpart of
 * build-room-matrix.mjs. Compares the publicly-recommended ESRGAN-family ncnn models on the
 * map's own component art (the 8-bit palette BMPs in public/data/Menu), decoded byte-exactly
 * like the game (tools/lib/mapsrc.mjs) so colours match the runtime.
 *
 * Columns (fixed order), grouped by purpose:
 *   original (native ×4 nearest)
 *   — reference candidates —
 *   x4plus (CURRENT map pick) · animevideov3 · x4plus-anime
 *   — tunable built-in denoise (RealESRGAN General v3) —
 *   General v3 (dn 0) · General ⊕ WDN 50% · General WDN (dn 1)
 *   — illustration / detail ESRGAN models —
 *   4x NMKD-Siax · 4x Nomos8kSC · 4x LSDIR · 4x HFA2k (anime)
 *
 * The map base layers (mapa-0/mapa-1) are the big hand-painted illustrations this is really
 * about; the node ball (n2) and record-panel art (krokomer/ikonky) are included too. The
 * node sprite's colour-key is edge-bled before upscale (no key fringe); the rest are opaque.
 *
 * Output: tools/map-matrix/ (img/ + index.html). Serve: cd tools/map-matrix && python3 -m http.server 8104
 * Run: REALESRGAN_NCNN=… node tools/build-map-matrix.mjs [asset ...]   (default: all below)
 * Requires the extra models in <binDir>/models: RealESRGAN_General_x4_v3,
 * RealESRGAN_General_WDN_x4_v3, 4x_NMKD-Siax_200k, 4xNomos8kSC, 4xLSDIR, 4xHFA2k.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBmp, indicesToRgb24, bleedKey } from './lib/mapsrc.mjs';
import { SCALE, COLS, run, requireBin, requireModels, generate } from './lib/upscalers.mjs';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const menuDir = join(root, 'public', 'data', 'Menu');
const outDir = join(toolsDir, 'map-matrix');
const imgDir = join(outDir, 'img');

// [key, label, srcFile, kind, focus, crop?]. kind 'layer' = opaque; 'sprite' = colour-keyed
// (top-left key). crop = [x,y,w,h] in NATIVE pixels (base layers are cropped to detail-heavy
// regions so the 11-way row stays sharp + light instead of 11× full 2560×1920 tiles).
const ALL_ASSETS = [
  ['wreck', 'Base · wreck + skull (mapa-1 crop)', 'mapa-1.BMP', 'layer', [0.5, 0.5], [372, 6, 262, 210]],
  ['center', 'Base · centre nodes + seabed (mapa-1 crop)', 'mapa-1.BMP', 'layer', [0.5, 0.5], [176, 150, 262, 200]],
  ['crab', 'Base · crab + CREDITS text (mapa-1 crop)', 'mapa-1.BMP', 'layer', [0.5, 0.5], [8, 260, 240, 214]],
  ['node', 'Room node ball (n2)', 'n2.BMP', 'sprite', [0.5, 0.5], null],
  ['krokomer', 'Record panel (krokomer)', 'krokomer.BMP', 'layer', [0.5, 0.4], null],
  ['ikonky', 'Panel icons (ikonky)', 'ikonky.BMP', 'layer', [0.5, 0.5], null],
];

/** Encode a raw RGB24 buffer to a PNG. */
function rgb24ToPng(rgb, w, h, work, tag) {
  const raw = join(work, `${tag}.rgb`);
  const png = join(work, `${tag}.png`);
  writeFileSync(raw, rgb);
  run(`encode ${tag}`, 'ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo', '-pixel_format', 'rgb24',
    '-video_size', `${w}x${h}`, '-i', raw, png]);
  return png;
}

/** Crop an index buffer to [x,y,w,h] (native px), clamped to the source bounds. */
function cropIndices(pixels, w, h, [cx, cy, cw, ch]) {
  const x0 = Math.max(0, Math.min(cx, w - 1));
  const y0 = Math.max(0, Math.min(cy, h - 1));
  const ww = Math.max(1, Math.min(cw, w - x0));
  const hh = Math.max(1, Math.min(ch, h - y0));
  const out = new Uint8Array(ww * hh);
  for (let y = 0; y < hh; y++) out.set(pixels.subarray((y0 + y) * w + x0, (y0 + y) * w + x0 + ww), y * ww);
  return { pixels: out, w: ww, h: hh };
}

/** Decode the map BMP to an opaque RGB24 PNG the models can consume (key-bled for sprites). */
function prepAsset(srcFile, kind, work, key, crop) {
  const bmp = parseBmp(new Uint8Array(readFileSync(join(menuDir, srcFile))));
  let { pixels, w, h } = bmp;
  if (kind === 'sprite') {
    const k = bmp.pixels[0]; // Vykul: top-left pixel is the transparent colour-key
    pixels = bleedKey(bmp.pixels, w, h, k, Math.max(2, Math.ceil(6 / SCALE)));
  }
  if (crop) ({ pixels, w, h } = cropIndices(pixels, w, h, crop));
  return rgb24ToPng(indicesToRgb24(pixels, bmp.palette, w, h), w, h, work, key);
}

function main() {
  const binp = requireBin('REALESRGAN_NCNN', 'Set it to realesrgan-ncnn-vulkan (folder must hold ./models).');
  requireModels(binp);
  const which = process.argv.slice(2);
  const list = ALL_ASSETS.filter(([k]) => !which.length || which.includes(k))
    .filter(([, , f]) => { const ok = existsSync(join(menuDir, f)); if (!ok) console.warn(`skip missing ${f}`); return ok; });
  if (!list.length) { console.error('no assets to build'); process.exit(1); }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'mapmatrix-'));
  const manifest = [];
  try {
    for (const [key, label, srcFile, kind, focus, crop] of list) {
      console.log(`\n== ${key} (${label}) ==`);
      const prep = prepAsset(srcFile, kind, work, key, crop);
      const ctx = { prep, binp, out: (id) => join(imgDir, `${key}_${id}.png`) };
      generate(ctx);
      manifest.push({ key, label, focus, files: Object.fromEntries(COLS.map((c) => [c.id, `img/${key}_${c.id}.png`])) });
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  writeFileSync(join(outDir, 'index.html'), renderHtml(manifest));
  console.log(`\nDone. Serve tools/map-matrix/ (cd tools/map-matrix && python3 -m http.server 8104).`);
}

function renderHtml(manifest) {
  const data = JSON.stringify(manifest);
  const cols = JSON.stringify(COLS.map(({ id, label, group, hero }) => ({ id, label, group, hero: !!hero })));
  const n = COLS.length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>World-map upscale matrix</title>
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
  .tile .grp { font-size: 10px; color: #7f8894; text-transform: uppercase; letter-spacing: .4px; padding: 2px 8px 0; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 420px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; max-width: 1200px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>World-map upscale <b>matrix</b> — ×4 · ${n}-way</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="160" max="760" step="20" value="300"> <span id="tval">300px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">The map is hand-painted (not pixel-art) → the public/OpenModelDB recommendation is the <b>ESRGAN family + denoise</b>. Current shipped map pick is <b style="color:#cfe0ff">x4plus</b> (hero, highlighted). Groups: <b>reference</b> · <b>General v3 tunable denoise</b> (blend General↔WDN to dial grain) · <b>illustration/detail ESRGAN</b> (Siax, Nomos8kSC, LSDIR general; HFA2k anime). Base layers are the big painted illustration; node ball is colour-key-bled. Scroll a tile to pan.</div>
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
    let lastGroup = null;
    for (const col of COLS) {
      const t = document.createElement('div'); t.className = 'tile' + (col.hero ? ' hero' : '');
      if (col.group !== lastGroup) { const g = document.createElement('div'); g.className = 'grp'; g.textContent = col.group; t.append(g); lastGroup = col.group; }
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
