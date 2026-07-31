/**
 * Refinement pass on the room upscale comparison. Martin's read of build-room-compare:
 *   animevideov3 = best overall diagonal anti-aliasing but slightly soft/blurry;
 *   x4plus       = crisp but keeps native aliasing → "stairs" on slanted lines;
 *   x4plus-anime = too plastic.
 * So the sweet spot is animevideov3 with a bit of sharpness recovered — WITHOUT
 * reintroducing the staircase. This tool derives candidates cheaply from the AI
 * outputs already produced by build-room-compare.mjs (no re-running Real-ESRGAN):
 *   av3                    — baseline (animevideov3, ×4)
 *   av3 + unsharp (light)  — gentle luma unsharp mask
 *   av3 + unsharp (medium)
 *   av3 + unsharp (strong)
 *   av3 ⊕ x4plus (70/30)   — mostly-av3 blend that borrows x4plus micro-detail
 *   av3 ⊕ x4plus (50/50)
 * Reads tools/room-compare/img/<key>_realesr-animevideov3-x4.png (+ _realesrgan-x4plus.png)
 * and writes tools/room-refine/ (img/ + index.html). Serve like the compare site.
 * Run: node tools/build-room-refine.mjs   (regenerate build-room-compare.mjs first)
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const srcImgDir = join(toolsDir, 'room-compare', 'img');
const outDir = join(toolsDir, 'room-refine');
const imgDir = join(outDir, 'img');

// Assets to refine — mirror the compare site + carry a focus point for first-view panning.
const ASSETS = [
  ['bg', 'Background layer (p.png)', [0.5, 0.55]],
  ['wall', 'Wall layer (w.png)', [0.32, 0.82]],
  ['obj_stul', 'Object · table (stul.png)', [0.5, 0.5]],
  ['obj_zidle', 'Object · chair (zidle_v.png)', [0.5, 0.5]],
  ['fish_small', 'Shared · small fish (body_rest_00)', [0.5, 0.5]],
  ['fish_big', 'Shared · big fish (body_rest_00)', [0.5, 0.5]],
];

// Derived variants: id, label, ffmpeg recipe. `A` = av3 input, `B` = x4plus input.
const VARIANTS = [
  { id: 'av3', label: 'av3 (baseline)', kind: 'copy' },
  { id: 'av3_usm_light', label: 'av3 + unsharp (light)', kind: 'usm', amount: 0.6 },
  { id: 'av3_usm_med', label: 'av3 + unsharp (medium)', kind: 'usm', amount: 1.0 },
  { id: 'av3_usm_strong', label: 'av3 + unsharp (strong)', kind: 'usm', amount: 1.5 },
  { id: 'av3_x4_7030', label: 'av3 ⊕ x4plus (70/30)', kind: 'blend', a: 0.7 },
  { id: 'av3_x4_5050', label: 'av3 ⊕ x4plus (50/50)', kind: 'blend', a: 0.5 },
];

function run(label, args) {
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error(`FAILED ${label} (exit ${r.status})`); process.exit(1); }
}

function main() {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const manifest = [];
  for (const [key, label, focus] of ASSETS) {
    const av3 = join(srcImgDir, `${key}_realesr-animevideov3-x4.png`);
    const x4 = join(srcImgDir, `${key}_realesrgan-x4plus.png`);
    if (!existsSync(av3)) { console.warn(`skip ${key} (no av3 output — run build-room-compare.mjs first)`); continue; }
    console.log(`\n== ${key} (${label}) ==`);
    const variants = [];
    for (const v of VARIANTS) {
      const out = join(imgDir, `${key}_${v.id}.png`);
      if (v.kind === 'copy') {
        copyFileSync(av3, out);
      } else if (v.kind === 'usm') {
        // Luma-only unsharp mask (5x5), chroma untouched — sharpen edges, keep colour smooth.
        run(`usm ${key} ${v.amount}`, ['-y', '-v', 'error', '-i', av3,
          '-vf', `unsharp=5:5:${v.amount}:5:5:0.0`, out]);
      } else if (v.kind === 'blend') {
        // Weighted blend of av3 (A) and x4plus (B). x4plus may differ 1px in size — scale to A.
        run(`blend ${key} ${v.a}`, ['-y', '-v', 'error', '-i', av3, '-i', x4,
          '-filter_complex',
          `[1][0]scale2ref=iw:ih[b][a];[a][b]blend=all_expr='A*${v.a}+B*${1 - v.a}'`, out]);
      }
      variants.push({ id: v.id, label: v.label, file: `img/${basename(out)}` });
    }
    manifest.push({ key, label, focus, variants });
  }
  writeFileSync(join(outDir, 'index.html'), renderHtml(manifest));
  console.log(`\nDone. Serve tools/room-refine/ (e.g. cd tools/room-refine && python3 -m http.server).`);
}

function renderHtml(manifest) {
  const data = JSON.stringify(manifest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room upscale refine — animevideov3 sharpening</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 5; background: #232329; padding: 12px 18px; border-bottom: 1px solid #35353c; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .ctrls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .ctrls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .asset { padding: 18px; border-bottom: 1px solid #2c2c33; }
  .asset h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #b9c4d0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tile, 320px), 1fr)); gap: 12px; }
  .tile { background: #111114; border: 1px solid #33333a; border-radius: 6px; overflow: hidden; }
  .tile .cap { padding: 5px 8px; font-size: 12px; color: #cfd6dd; background: #26262c; border-bottom: 1px solid #33333a; white-space: nowrap; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 440px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>Room upscale <b>refine</b> — animevideov3 + sharpening / blend (PRVNI, ×4)</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="200" max="700" step="20" value="340"> <span id="tval">340px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">All tiles are animevideov3 (×4) with a sharpness treatment. Goal: recover crispness vs baseline WITHOUT the x4plus staircase on slants. Scroll a tile to pan; tiles open on content.</div>
</header>
<main id="main"></main>
<script>
const DATA = ${data};
const state = { zoom: 2, tile: 340 };

function render() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  document.documentElement.style.setProperty('--tile', state.tile + 'px');
  document.documentElement.style.setProperty('--vh', Math.round(state.tile * 1.3) + 'px');
  for (const asset of DATA) {
    const sec = document.createElement('section'); sec.className = 'asset';
    const h = document.createElement('h2'); h.textContent = asset.label; sec.append(h);
    const grid = document.createElement('div'); grid.className = 'grid';
    for (const v of asset.variants) {
      const t = document.createElement('div'); t.className = 'tile';
      const c = document.createElement('div'); c.className = 'cap'; c.textContent = v.label;
      const vp = document.createElement('div'); vp.className = 'viewport';
      vp.dataset.fx = asset.focus[0]; vp.dataset.fy = asset.focus[1];
      const img = document.createElement('img'); img.src = v.file; img.loading = 'lazy';
      img.dataset.mult = state.zoom;
      t.append(c, vp); vp.append(img); grid.append(t);
    }
    sec.append(grid); main.append(sec);
  }
  applyZoom();
}
function applyZoom() {
  for (const img of document.querySelectorAll('.tile img')) {
    img.onload = () => sizeImg(img);
    if (img.complete) sizeImg(img);
  }
}
function sizeImg(img) {
  img.style.width = (img.naturalWidth * parseFloat(img.dataset.mult)) + 'px';
  const vp = img.parentElement;
  if (vp && !vp.dataset.panned) {
    vp.dataset.panned = '1';
    requestAnimationFrame(() => {
      const fx = parseFloat(vp.dataset.fx), fy = parseFloat(vp.dataset.fy);
      vp.scrollLeft = Math.max(0, img.offsetWidth * fx - vp.clientWidth / 2);
      vp.scrollTop = Math.max(0, img.offsetHeight * fy - vp.clientHeight / 2);
    });
  }
}
document.getElementById('zoom').oninput = (e) => {
  state.zoom = parseFloat(e.target.value);
  document.getElementById('zval').textContent = state.zoom + '×';
  for (const img of document.querySelectorAll('.tile img')) { img.dataset.mult = state.zoom; sizeImg(img); }
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
