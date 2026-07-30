/**
 * Build a standalone side-by-side comparison of upscaling algorithms on ONE test
 * room's enhanced (FFNG truecolor) art — the exploratory step before committing to
 * an AI room-upscale pipeline. NOT part of the shipped build.
 *
 * Rooms render as a runtime composite of enhanced PNGs (public/enhanced/<ROOM>/):
 *   w.png / p.png   — the painted wall + background layers (opaque)
 *   obj/*.png       — per-room object sprites (RGBA)
 *   _fish/…         — the shared fish body/head sprites (RGBA, used by every room)
 * They are currently drawn native-res and browser-scaled up (soft/blurry at large
 * display sizes). This tool upscales a representative selection x4 with several
 * algorithms so we can eyeball which best suits each art *type* (big painted layer
 * vs small glossy sprite/fish) before wiring a hi-res room render path.
 *
 * Algorithms (all x4):
 *   nearest, bilinear, lanczos      — ffmpeg scale (non-AI baselines; bilinear ≈
 *                                     what the browser does to enhanced art today)
 *   realesr-animevideov3-x4         — AI, soft/faithful (best for the map balls)
 *   realesrgan-x4plus               — AI, sharper/more texture (chosen for the map)
 *   realesrgan-x4plus-anime         — AI, smooth "cel/plastic" look
 *
 * Opaque layers are upscaled directly. RGBA sprites/fish are flattened onto a
 * neutral grey first (alpha-edge quality is a separately-solved concern — see the
 * matte pass in build-map-ai.mjs), so this compares RGB fidelity fairly.
 *
 * Output: tools/room-compare/  (images + index.html). Serve it with
 *   npx vite preview  — or —  (cd tools/room-compare && python3 -m http.server)
 * then open index.html. Regenerate with: REALESRGAN_NCNN=… node tools/build-room-compare.mjs [ROOM]
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-compare');
const imgDir = join(outDir, 'img');

const ROOM = process.argv[2] || 'PRVNI';
const SCALE = 4;
const GREY = '0x6b5a44'; // a mid wall-tone so flattened sprites read naturally

// The AI models (realesrgan-ncnn-vulkan -n names). Non-AI algos use ffmpeg scale.
const AI_MODELS = ['realesr-animevideov3-x4', 'realesrgan-x4plus', 'realesrgan-x4plus-anime'];
const FF_ALGOS = ['neighbor', 'bilinear', 'lanczos']; // ffmpeg scale flags
const ALGO_LABEL = {
  neighbor: 'nearest (blocky)',
  bilinear: 'bilinear (≈ current)',
  lanczos: 'lanczos',
  'realesr-animevideov3-x4': 'AI · animevideov3 (soft)',
  'realesrgan-x4plus': 'AI · x4plus (sharp)',
  'realesrgan-x4plus-anime': 'AI · x4plus-anime (plastic)',
};
const ALGO_ORDER = [...FF_ALGOS, ...AI_MODELS];

// Showcase assets: [key, label, srcPath, opaque?, focus?]
// focus = normalized [fx, fy] point each tile pans to on load, so the first view
// lands on real content (e.g. the wall layer's center is a transparent doorway hole).
function showcase() {
  const r = (p) => join(enhancedDir, ROOM, p);
  const f = (p) => join(enhancedDir, '_fish', p);
  return [
    ['bg', 'Background layer (p.png)', r('p.png'), true, [0.5, 0.55]],
    ['wall', 'Wall layer (w.png)', r('w.png'), true, [0.5, 0.12]],
    ['obj_stul', 'Object · table (stul.png)', r('obj/stul.png'), false, [0.5, 0.5]],
    ['obj_zidle', 'Object · chair (zidle_v.png)', r('obj/zidle_v.png'), false, [0.5, 0.5]],
    ['fish_small', 'Shared · small fish (body_rest_00)', f('small/right/body_rest_00.png'), false, [0.5, 0.5]],
    ['fish_big', 'Shared · big fish (body_rest_00)', f('big/right/body_rest_00.png'), false, [0.5, 0.5]],
  ].filter(([, , p]) => {
    if (!existsSync(p)) console.warn(`skip missing ${p}`);
    return existsSync(p);
  });
}

function run(label, cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'], ...opts });
  if (r.status !== 0) {
    console.error(`FAILED ${label} (${cmd} exit ${r.status})`);
    process.exit(1);
  }
}

function requireBin(env, hint) {
  const p = process.env[env];
  if (!p || !existsSync(p)) {
    console.error(`${env} not set or not found. ${hint}`);
    process.exit(1);
  }
  return p;
}

/** Prepare an opaque source PNG (flatten RGBA onto grey) at native res. */
function prepSource(srcPath, opaque, work, key) {
  if (opaque) return srcPath;
  const flat = join(work, `${key}_src.png`);
  run(`flatten ${key}`, 'ffmpeg',
    ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${GREY}:s=16x16`,
      '-i', srcPath, '-filter_complex',
      '[0][1]scale2ref[bg][fg];[bg][fg]overlay=0:0:format=auto', '-frames:v', '1', flat]);
  return flat;
}

function ffScale(src, dst, flag) {
  run(`ffmpeg ${flag}`, 'ffmpeg',
    ['-y', '-v', 'error', '-i', src,
      '-vf', `scale=iw*${SCALE}:ih*${SCALE}:flags=${flag}`, dst]);
}

function aiScale(src, dst, model, binp) {
  const binDir = dirname(binp);
  run(`AI ${model}`, binp,
    ['-i', src, '-o', dst, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(binDir, 'models')],
    { cwd: binDir });
}

function main() {
  const binp = requireBin('REALESRGAN_NCNN',
    'Set it to realesrgan-ncnn-vulkan (its folder must hold ./models).');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = join(outDir, '_work');
  mkdirSync(work, { recursive: true });

  const assets = showcase();
  const manifest = [];
  for (const [key, label, srcPath, opaque, focus] of assets) {
    console.log(`\n== ${key} (${label}) ==`);
    const src = prepSource(srcPath, opaque, work, key);
    // Also emit the native source (as a "1x" reference the page upscales via CSS).
    const nativeOut = join(imgDir, `${key}_native.png`);
    run('copy native', 'ffmpeg', ['-y', '-v', 'error', '-i', src, nativeOut]);
    const variants = [];
    for (const flag of FF_ALGOS) {
      const out = join(imgDir, `${key}_${flag}.png`);
      ffScale(src, out, flag);
      variants.push({ algo: flag, file: `img/${basename(out)}` });
    }
    for (const model of AI_MODELS) {
      const out = join(imgDir, `${key}_${model}.png`);
      aiScale(src, out, model, binp);
      variants.push({ algo: model, file: `img/${basename(out)}` });
    }
    manifest.push({ key, label, native: `img/${basename(nativeOut)}`, focus: focus || [0.5, 0.5], variants });
  }
  rmSync(work, { recursive: true, force: true });

  writeFileSync(join(outDir, 'index.html'), renderHtml(ROOM, manifest));
  console.log(`\nDone. Open ${join('tools', 'room-compare', 'index.html')} (serve the folder, e.g. \`npx vite preview\` or python3 -m http.server).`);
}

function renderHtml(room, manifest) {
  const labels = JSON.stringify(ALGO_LABEL);
  const order = JSON.stringify(ALGO_ORDER);
  const data = JSON.stringify(manifest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room upscale comparison — ${room}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 5; background: #232329; padding: 12px 18px; border-bottom: 1px solid #35353c; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .ctrls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .ctrls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .asset { padding: 18px; border-bottom: 1px solid #2c2c33; }
  .asset h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #b9c4d0; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--tile, 300px), 1fr)); gap: 12px; }
  .tile { background: #111114; border: 1px solid #33333a; border-radius: 6px; overflow: hidden; }
  .tile .cap { padding: 5px 8px; font-size: 12px; color: #cfd6dd; background: #26262c; border-bottom: 1px solid #33333a; white-space: nowrap; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 420px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>Room upscale comparison — <b>${room}</b> · enhanced (FFNG) art, ×4</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="200" max="700" step="20" value="320"> <span id="tval">320px</span></label>
    <label><input id="smooth" type="checkbox"> smooth native/nearest zoom</label>
    <span id="algos"></span>
  </div>
  <div class="hint">Scroll inside a tile to pan. "native" is the current source shown at the same zoom (CSS-scaled) — the baseline the AI must beat. Toggle algorithms to declutter.</div>
</header>
<main id="main"></main>
<script>
const LABELS = ${labels};
const ORDER = ${order};
const DATA = ${data};
const state = { zoom: 2, tile: 320, algos: new Set(['native', ...ORDER]) };

function algoToggles() {
  const host = document.getElementById('algos');
  const mk = (id, txt) => {
    const l = document.createElement('label');
    const c = document.createElement('input'); c.type = 'checkbox'; c.checked = true; c.dataset.algo = id;
    c.onchange = () => { c.checked ? state.algos.add(id) : state.algos.delete(id); render(); };
    l.append(c, document.createTextNode(' ' + txt)); return l;
  };
  host.append(mk('native', 'native'));
  for (const a of ORDER) host.append(mk(a, LABELS[a] || a));
}

function render() {
  const main = document.getElementById('main');
  main.innerHTML = '';
  document.documentElement.style.setProperty('--tile', state.tile + 'px');
  document.documentElement.style.setProperty('--vh', Math.round(state.tile * 1.3) + 'px');
  for (const asset of DATA) {
    const sec = document.createElement('section'); sec.className = 'asset';
    const h = document.createElement('h2'); h.textContent = asset.label; sec.append(h);
    const grid = document.createElement('div'); grid.className = 'grid';
    const tiles = [];
    if (state.algos.has('native')) tiles.push(['native', 'native (source)', asset.native, true]);
    for (const v of asset.variants) if (state.algos.has(v.algo)) tiles.push([v.algo, LABELS[v.algo] || v.algo, v.file, false]);
    for (const [algo, cap, file, isNative] of tiles) {
      const t = document.createElement('div'); t.className = 'tile';
      const c = document.createElement('div'); c.className = 'cap'; c.textContent = cap;
      const vp = document.createElement('div'); vp.className = 'viewport';
      vp.dataset.fx = asset.focus[0]; vp.dataset.fy = asset.focus[1];
      const img = document.createElement('img'); img.src = file; img.loading = 'lazy';
      // native is a 1× source: multiply CSS zoom by 4 so it matches the ×4 variants' scale.
      img.dataset.mult = isNative ? state.zoom * 4 : state.zoom;
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
  const mult = parseFloat(img.dataset.mult);
  img.style.width = (img.naturalWidth * mult) + 'px';
  // Pan the viewport to the asset's focus point on first sizing.
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
  for (const img of document.querySelectorAll('.tile img')) {
    img.dataset.mult = img.src.includes('_native') ? state.zoom * 4 : state.zoom;
    sizeImg(img);
  }
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
algoToggles();
render();
</script>
</body></html>`;
}

main();
