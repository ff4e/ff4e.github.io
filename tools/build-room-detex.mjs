/**
 * "De-raster" experiment for room upscaling. Diagnosis (see the raster-probe crop):
 * the native enhanced (FFNG) art carries a fine per-pixel SPECKLE/grain. Real-ESRGAN
 * animevideov3 turns that grain into a reticulated "raster/mesh" artifact; x4plus
 * renders it as brush texture (good) but aliases hard edges (stairs); x4plus-anime
 * dissolves it into flat plastic (smooth but texture-less). Martin wants anime's
 * smooth, grid-free surface WITH texture kept.
 *
 * Two lines of attack, both tested here on the texture-heavy opaque layers (bg, wall):
 *   1. Denoise the grain at the SOURCE, then upscale — a clean input means x4plus
 *      keeps painterly texture without a grain-raster, and av3 has no grain to
 *      reticulate. (nlmeans light/strong → x4plus / av3.)
 *   2. Blend x4plus-anime (smooth, grid-free base) with x4plus (texture) — reintroduce
 *      painterly detail onto the plastic base. (cheap ffmpeg blend, no AI re-run.)
 *
 * Reuses baselines already produced by build-room-compare.mjs (copies anime/av3/x4plus
 * from tools/room-compare/img). Needs REALESRGAN_NCNN for the denoise→upscale variants.
 * Output: tools/room-detex/ (img/ + index.html). Serve like the other pages.
 * Run: REALESRGAN_NCNN=… node tools/build-room-detex.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-detex');
const imgDir = join(outDir, 'img');
const ROOM = process.argv[2] || 'PRVNI';
const SCALE = 4;
const GREY = '0x6b5a44'; // neutral wall-tone; flatten RGBA layers onto it so the whole
                          // pipeline is opaque (nlmeans/AI can't leak the green color-key).

// Texture-bearing layers/sprites. All are flattened onto grey first, so RGBA (wall, obj)
// no longer floods green when denoised. References are regenerated from the same prepped
// source for a fair background match.
const ASSETS = [
  ['bg', 'Background layer (p.png)', join(enhancedDir, ROOM, 'p.png'), [0.5, 0.55]],
  ['wall', 'Wall layer (w.png)', join(enhancedDir, ROOM, 'w.png'), [0.76, 0.30]],
  ['obj_stul', 'Object · table (stul.png)', join(enhancedDir, ROOM, 'obj/stul.png'), [0.5, 0.5]],
];

function run(label, cmd, args) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) { console.error(`FAILED ${label} (${cmd} exit ${r.status})`); process.exit(1); }
}
function requireBin(env, hint) {
  const p = process.env[env];
  if (!p || !existsSync(p)) { console.error(`${env} not set/found. ${hint}`); process.exit(1); }
  return p;
}
function nlmeans(src, dst, s) {
  run(`nlmeans ${s}`, 'ffmpeg', ['-y', '-v', 'error', '-i', src, '-vf', `nlmeans=s=${s}:p=7:r=15`, dst]);
}
/** Flatten (possibly-RGBA) source onto neutral grey → opaque PNG at native res. */
function flatten(src, dst) {
  run('flatten', 'ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${GREY}:s=16x16`,
    '-i', src, '-filter_complex', '[0][1]scale2ref[bg][fg];[bg][fg]overlay=0:0:format=auto',
    '-frames:v', '1', dst]);
}
function aiScale(src, dst, model, binp) {
  const binDir = dirname(binp);
  run(`AI ${model}`, binp, ['-i', src, '-o', dst, '-n', model, '-s', String(SCALE), '-f', 'png', '-m', join(binDir, 'models')]);
}
function blend(a, b, wa, dst) {
  run(`blend ${wa}`, 'ffmpeg', ['-y', '-v', 'error', '-i', a, '-i', b,
    '-filter_complex', `[1][0]scale2ref=iw:ih[bb][aa];[aa][bb]blend=all_expr='A*${wa}+B*${1 - wa}'`, dst]);
}

function main() {
  const binp = requireBin('REALESRGAN_NCNN', 'Set it to realesrgan-ncnn-vulkan (folder must hold ./models).');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = join(outDir, '_work'); mkdirSync(work, { recursive: true });
  const manifest = [];
  for (const [key, label, srcPath, focus] of ASSETS) {
    if (!existsSync(srcPath)) { console.warn(`skip ${key} (missing ${srcPath})`); continue; }
    console.log(`\n== ${key} (${label}) ==`);
    const variants = [];
    const emit = (id, lab, file) => variants.push({ id, label: lab, file: `img/${basename(file)}` });

    // Flatten onto grey once — everything downstream is opaque, so no green color-key leak.
    const prep = join(work, `${key}_prep.png`);
    flatten(srcPath, prep);

    // Baseline references regenerated from the SAME prepped source (fair background).
    const refAnime = join(imgDir, `${key}_av3.png`);
    const refX4 = join(imgDir, `${key}_x4.png`);
    const refAnime2 = join(imgDir, `${key}_anime.png`);
    aiScale(prep, refAnime, 'realesr-animevideov3-x4', binp); emit('av3', 'av3 (raster, ref)', refAnime);
    aiScale(prep, refX4, 'realesrgan-x4plus', binp); emit('x4', 'x4plus (texture+stairs, ref)', refX4);
    aiScale(prep, refAnime2, 'realesrgan-x4plus-anime', binp); emit('anime', 'x4plus-anime (plastic, ref)', refAnime2);

    // 1. Denoise the native grain, then upscale.
    for (const [s, tag] of [[3, 'light'], [8, 'strong']]) {
      const clean = join(work, `${key}_clean_${tag}.png`);
      nlmeans(prep, clean, s);
      const x4o = join(imgDir, `${key}_clean${tag}_x4.png`);
      aiScale(clean, x4o, 'realesrgan-x4plus', binp);
      emit(`clean${tag}_x4`, `denoise ${tag} → x4plus`, x4o);
    }
    // av3 on the light-cleaned source (kills the raster since grain is gone).
    {
      const clean = join(work, `${key}_clean_light.png`);
      const av3o = join(imgDir, `${key}_cleanlight_av3.png`);
      aiScale(clean, av3o, 'realesr-animevideov3-x4', binp);
      emit('cleanlight_av3', 'denoise light → av3', av3o);
    }

    // 2. Blend smooth anime base + x4plus texture (from the regenerated refs).
    for (const wa of [0.65, 0.5]) {
      const o = join(imgDir, `${key}_animeX4_${Math.round(wa * 100)}.png`);
      blend(refAnime2, refX4, wa, o);
      emit(`animeX4_${Math.round(wa * 100)}`, `anime ⊕ x4plus (${Math.round(wa * 100)}/${Math.round((1 - wa) * 100)})`, o);
    }
    manifest.push({ key, label, focus, variants });
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(join(outDir, 'index.html'), renderHtml(ROOM, manifest));
  console.log(`\nDone. Serve tools/room-detex/ (cd tools/room-detex && python3 -m http.server).`);
}

function renderHtml(room, manifest) {
  const data = JSON.stringify(manifest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room upscale de-raster — ${room}</title>
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
  <h1>Room upscale <b>de-raster</b> — ${room} · kill the grain, keep texture (×4)</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="3"> <span id="zval">3×</span></label>
    <label>Tile <input id="tile" type="range" min="200" max="700" step="20" value="340"> <span id="tval">340px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">First 3 = references (av3 raster / x4plus texture+stairs / anime plastic). Then: denoise-source→upscale, and anime⊕x4plus blends. Goal: smooth &amp; grid-free like anime but with texture. Scroll to pan.</div>
</header>
<main id="main"></main>
<script>
const DATA = ${data};
const state = { zoom: 3, tile: 340 };
function render() {
  const main = document.getElementById('main'); main.innerHTML = '';
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
    img.onload = () => sizeImg(img); if (img.complete) sizeImg(img);
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
