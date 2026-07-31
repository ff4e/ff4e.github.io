/**
 * Large 5-column upscale gallery for the room AI-upscale decision. Columns, fixed order:
 *   denoise light → x4plus | animevideov3 (soft) | x4plus (sharp) | x4plus-anime (plastic) | original
 * across a broad asset set (layers, objects, and shared fish bodies + heads + a motion pose).
 *
 * "denoise light → x4plus" = nlmeans(s=3) on the source to strip the native grain, then
 * Real-ESRGAN x4plus — the front-runner (smooth edges, kept texture, no grain-raster).
 * "original" = the native source, nearest-scaled ×4 (honest low-res reference).
 * Every source is flattened onto neutral grey first so RGBA sprites/fish don't leak the
 * green color-key through nlmeans/AI. Output: tools/room-gallery/ (img/ + index.html).
 * Run: REALESRGAN_NCNN=… node tools/build-room-gallery.mjs [ROOM]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-gallery');
const imgDir = join(outDir, 'img');
const ROOM = process.argv[2] || 'PRVNI';
const SCALE = 4;
const GREY = '0x6b5a44';

// [key, label, srcPath, focus]
function assets() {
  const r = (p) => join(enhancedDir, ROOM, p);
  const f = (p) => join(enhancedDir, '_fish', p);
  return [
    ['bg', 'Background layer (p.png)', r('p.png'), [0.5, 0.55]],
    ['wall', 'Wall layer (w.png)', r('w.png'), [0.76, 0.30]],
    ['obj_stul', 'Object · table (stul.png)', r('obj/stul.png'), [0.5, 0.5]],
    ['obj_zidle_v', 'Object · chair (zidle_v.png)', r('obj/zidle_v.png'), [0.5, 0.5]],
    ['obj_zidle_m', 'Object · small chair (zidle_m.png)', r('obj/zidle_m.png'), [0.5, 0.5]],
    ['obj_polstar', 'Object · polstar (polstar.png)', r('obj/polstar.png'), [0.5, 0.5]],
    ['fish_s_rest', 'Small fish · body rest', f('small/right/body_rest_00.png'), [0.5, 0.5]],
    ['fish_s_swim', 'Small fish · body swim', f('small/right/body_swam_02.png'), [0.567, 0.5]],
    ['fish_s_head', 'Small fish · head smile', f('small/right/head_smile.png'), [0.844, 0.5]],
    ['fish_b_rest', 'Big fish · body rest', f('big/right/body_rest_00.png'), [0.5, 0.5]],
    ['fish_b_swim', 'Big fish · body swim', f('big/right/body_swam_02.png'), [0.558, 0.5]],
    ['fish_b_head', 'Big fish · head smile', f('big/right/head_smile.png'), [0.842, 0.5]],
  ].filter(([, , p]) => { if (!existsSync(p)) console.warn(`skip missing ${p}`); return existsSync(p); });
}

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error(`FAILED ${label} (${cmd} exit ${r.status})`); process.exit(1); }
}
function requireBin(env, hint) {
  const p = process.env[env];
  if (!p || !existsSync(p)) { console.error(`${env} not set/found. ${hint}`); process.exit(1); }
  return p;
}
function flatten(src, dst) {
  run('flatten', 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${GREY}:s=16x16`,
    '-i', src, '-filter_complex', '[0][1]scale2ref[bg][fg];[bg][fg]overlay=0:0:format=auto', '-frames:v', '1', dst]);
}
function nn4(src, dst) {
  run('nn x4', 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `scale=iw*${SCALE}:ih*${SCALE}:flags=neighbor`, dst]);
}
function nlmeans(src, dst, s) {
  run(`nlmeans ${s}`, 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `nlmeans=s=${s}:p=7:r=15`, dst]);
}
function aiScale(src, dst, model, binp) {
  const binDir = dirname(binp);
  run(`AI ${model}`, binp, ['-i', src, '-o', dst, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(binDir, 'models')]);
}

// Fixed column order requested by Martin.
const COLS = [
  { id: 'clean_x4', label: 'denoise light → x4plus' },
  { id: 'av3', label: 'animevideov3 (soft)' },
  { id: 'x4', label: 'x4plus (sharp)' },
  { id: 'anime', label: 'x4plus-anime (plastic)' },
  { id: 'orig', label: 'original' },
];

function main() {
  const binp = requireBin('REALESRGAN_NCNN', 'Set it to realesrgan-ncnn-vulkan (folder must hold ./models).');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = join(outDir, '_work'); mkdirSync(work, { recursive: true });
  const list = assets();
  const manifest = [];
  for (const [key, label, srcPath, focus] of list) {
    console.log(`\n== ${key} (${label}) ==`);
    const prep = join(work, `${key}_prep.png`);
    flatten(srcPath, prep);
    const clean = join(work, `${key}_clean.png`);
    nlmeans(prep, clean, 3);
    const out = (id) => join(imgDir, `${key}_${id}.png`);
    aiScale(clean, out('clean_x4'), 'realesrgan-x4plus', binp);
    aiScale(prep, out('av3'), 'realesr-animevideov3-x4', binp);
    aiScale(prep, out('x4'), 'realesrgan-x4plus', binp);
    aiScale(prep, out('anime'), 'realesrgan-x4plus-anime', binp);
    nn4(prep, out('orig'));
    manifest.push({ key, label, focus, files: Object.fromEntries(COLS.map((c) => [c.id, `img/${key}_${c.id}.png`])) });
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(join(outDir, 'index.html'), renderHtml(ROOM, manifest));
  console.log(`\nDone. Serve tools/room-gallery/ (cd tools/room-gallery && python3 -m http.server).`);
}

function renderHtml(room, manifest) {
  const data = JSON.stringify(manifest);
  const cols = JSON.stringify(COLS);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room upscale gallery — ${room}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 5; background: #232329; padding: 12px 18px; border-bottom: 1px solid #35353c; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .ctrls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .ctrls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .asset { padding: 16px 18px; border-bottom: 1px solid #2c2c33; }
  .asset h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #b9c4d0; }
  .row { display: grid; grid-template-columns: repeat(5, minmax(var(--tile, 300px), 1fr)); gap: 12px; }
  .tile { background: #111114; border: 1px solid #33333a; border-radius: 6px; overflow: hidden; }
  .tile.hero { border-color: #4b7bd6; box-shadow: 0 0 0 1px #4b7bd6 inset; }
  .tile .cap { padding: 5px 8px; font-size: 12px; color: #cfd6dd; background: #26262c; border-bottom: 1px solid #33333a; white-space: nowrap; }
  .tile.hero .cap { color: #cfe0ff; background: #23324c; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 420px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>Room upscale <b>gallery</b> — ${room} · ×4 · 5-way</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="180" max="700" step="20" value="300"> <span id="tval">300px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">Columns: <b style="color:#cfe0ff">denoise light → x4plus</b> · animevideov3 (soft) · x4plus (sharp) · x4plus-anime (plastic) · original (native ×4 nearest). Scroll a tile to pan; tiles open on content. All sources flattened onto grey (no green key).</div>
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
      const t = document.createElement('div'); t.className = 'tile' + (col.id === 'clean_x4' ? ' hero' : '');
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
