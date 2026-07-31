/**
 * Wide model-matrix gallery for the room AI-upscale decision — the "try many algos /
 * parameters" experiment. Extends build-room-gallery.mjs with the publicly-recommended
 * ESRGAN-family ncnn models (from OpenModelDB / the upscayl/custom-models pack), all of
 * which load in the existing realesrgan-ncnn-vulkan binary via -n <name> -m models.
 *
 * Columns (fixed order), grouped by purpose:
 *   original (native ×4 nearest)
 *   — reference candidates —
 *   denoise light → x4plus (current hero) · animevideov3 · x4plus-anime
 *   — tunable built-in denoise (RealESRGAN General v3) —
 *   General v3 (dn 0) · General ⊕ WDN 50% (dn ~.5) · General WDN (dn 1)
 *   — illustration / detail ESRGAN models —
 *   4x_NMKD-Siax_200k · 4xNomos8kSC · 4xLSDIR · 4xHFA2k (anime)
 *
 * Every source is flattened onto neutral grey first so RGBA sprites/fish don't leak the
 * green color-key through nlmeans/AI. Output: tools/room-matrix/ (img/ + index.html).
 * Run: REALESRGAN_NCNN=… node tools/build-room-matrix.mjs [ROOM]
 * Requires the extra models present in <binDir>/models: RealESRGAN_General_x4_v3,
 * RealESRGAN_General_WDN_x4_v3, 4x_NMKD-Siax_200k, 4xNomos8kSC, 4xLSDIR, 4xHFA2k.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-matrix');
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
    ['fish_s_rest', 'Small fish · body rest', f('small/right/body_rest_00.png'), [0.5, 0.5]],
    ['fish_s_head', 'Small fish · head smile', f('small/right/head_smile.png'), [0.844, 0.5]],
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
// Blend `top` over `bottom` at opacity w (both same-size pngs).
function blend(bottom, top, dst, w) {
  run(`blend ${w}`, 'ffmpeg', ['-y', '-v', 'error', '-i', bottom, '-i', top,
    '-filter_complex', `[0][1]blend=all_mode=normal:all_opacity=${w}`, '-frames:v', '1', dst]);
}

// Each column: id, label, group, hero?, and make(ctx) producing img/<key>_<id>.png.
// ctx = { prep, clean, work, key, binp, out(id) }
const COLS = [
  { id: 'orig', label: 'original (native ×4)', group: 'reference', make: (c) => nn4(c.prep, c.out('orig')) },
  { id: 'clean_x4', label: 'denoise → x4plus', group: 'reference', hero: true, make: (c) => aiScale(c.clean, c.out('clean_x4'), 'realesrgan-x4plus', c.binp) },
  { id: 'av3', label: 'animevideov3', group: 'reference', make: (c) => aiScale(c.prep, c.out('av3'), 'realesr-animevideov3-x4', c.binp) },
  { id: 'anime', label: 'x4plus-anime', group: 'reference', make: (c) => aiScale(c.prep, c.out('anime'), 'realesrgan-x4plus-anime', c.binp) },
  { id: 'gen', label: 'General v3 (dn 0)', group: 'General v3 · tunable denoise', make: (c) => aiScale(c.prep, c.out('gen'), 'RealESRGAN_General_x4_v3', c.binp) },
  { id: 'gen_wdn50', label: 'General ⊕ WDN 50%', group: 'General v3 · tunable denoise', make: (c) => blend(c.out('gen'), c.out('gen_wdn'), c.out('gen_wdn50'), 0.5) },
  { id: 'gen_wdn', label: 'General WDN (dn 1)', group: 'General v3 · tunable denoise', make: (c) => aiScale(c.prep, c.out('gen_wdn'), 'RealESRGAN_General_WDN_x4_v3', c.binp) },
  { id: 'siax', label: '4x NMKD-Siax', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('siax'), '4x_NMKD-Siax_200k', c.binp) },
  { id: 'nomos', label: '4x Nomos8kSC', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('nomos'), '4xNomos8kSC', c.binp) },
  { id: 'lsdir', label: '4x LSDIR', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('lsdir'), '4xLSDIR', c.binp) },
  { id: 'hfa2k', label: '4x HFA2k (anime)', group: 'illustration / detail ESRGAN', make: (c) => aiScale(c.prep, c.out('hfa2k'), '4xHFA2k', c.binp) },
];
// gen_wdn50 depends on gen + gen_wdn; ensure ordering produces both before the blend.
const MAKE_ORDER = ['orig', 'clean_x4', 'av3', 'anime', 'gen', 'gen_wdn', 'gen_wdn50', 'siax', 'nomos', 'lsdir', 'hfa2k'];

function main() {
  const binp = requireBin('REALESRGAN_NCNN', 'Set it to realesrgan-ncnn-vulkan (folder must hold ./models).');
  const models = join(dirname(binp), 'models');
  for (const m of ['RealESRGAN_General_x4_v3', 'RealESRGAN_General_WDN_x4_v3', '4x_NMKD-Siax_200k', '4xNomos8kSC', '4xLSDIR', '4xHFA2k']) {
    if (!existsSync(join(models, `${m}.param`))) { console.error(`Missing model ${m}.param in ${models}`); process.exit(1); }
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = join(outDir, '_work'); mkdirSync(work, { recursive: true });
  const list = assets();
  const manifest = [];
  const byId = Object.fromEntries(COLS.map((c) => [c.id, c]));
  for (const [key, label, srcPath, focus] of list) {
    console.log(`\n== ${key} (${label}) ==`);
    const prep = join(work, `${key}_prep.png`);
    flatten(srcPath, prep);
    const clean = join(work, `${key}_clean.png`);
    nlmeans(prep, clean, 3);
    const ctx = { prep, clean, work, key, binp, out: (id) => join(imgDir, `${key}_${id}.png`) };
    for (const id of MAKE_ORDER) byId[id].make(ctx);
    manifest.push({ key, label, focus, files: Object.fromEntries(COLS.map((c) => [c.id, `img/${key}_${c.id}.png`])) });
  }
  rmSync(work, { recursive: true, force: true });
  writeFileSync(join(outDir, 'index.html'), renderHtml(ROOM, manifest));
  console.log(`\nDone. Serve tools/room-matrix/ (cd tools/room-matrix && python3 -m http.server).`);
}

function renderHtml(room, manifest) {
  const data = JSON.stringify(manifest);
  const cols = JSON.stringify(COLS.map(({ id, label, group, hero }) => ({ id, label, group, hero: !!hero })));
  const n = COLS.length;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room upscale matrix — ${room}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #1b1b1f; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 5; background: #232329; padding: 12px 18px; border-bottom: 1px solid #35353c; }
  h1 { font-size: 16px; margin: 0 0 8px; }
  .ctrls { display: flex; flex-wrap: wrap; gap: 14px 22px; align-items: center; }
  .ctrls label { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .asset { padding: 16px 18px; border-bottom: 1px solid #2c2c33; }
  .asset h2 { font-size: 14px; font-weight: 600; margin: 0 0 10px; color: #b9c4d0; }
  .row { display: grid; grid-template-columns: repeat(${n}, minmax(var(--tile, 280px), 1fr)); gap: 12px; }
  .tile { background: #111114; border: 1px solid #33333a; border-radius: 6px; overflow: hidden; }
  .tile.hero { border-color: #4b7bd6; box-shadow: 0 0 0 1px #4b7bd6 inset; }
  .tile .cap { padding: 5px 8px; font-size: 12px; color: #cfd6dd; background: #26262c; border-bottom: 1px solid #33333a; white-space: nowrap; }
  .tile.hero .cap { color: #cfe0ff; background: #23324c; }
  .tile .grp { font-size: 10px; color: #7f8894; text-transform: uppercase; letter-spacing: .4px; padding: 2px 8px 0; }
  .tile .viewport { overflow: auto; max-height: var(--vh, 400px); background:
      repeating-conic-gradient(#2a2a30 0% 25%, #202026 0% 50%) 50% / 20px 20px; }
  .tile img { display: block; image-rendering: var(--smooth, auto); }
  .hint { color: #8a929b; font-size: 12px; margin-top: 4px; max-width: 1100px; }
  input[type=range] { vertical-align: middle; }
</style></head>
<body>
<header>
  <h1>Room upscale <b>matrix</b> — ${room} · ×4 · ${n}-way</h1>
  <div class="ctrls">
    <label>Zoom <input id="zoom" type="range" min="1" max="8" step="0.5" value="2"> <span id="zval">2×</span></label>
    <label>Tile <input id="tile" type="range" min="160" max="700" step="20" value="280"> <span id="tval">280px</span></label>
    <label><input id="smooth" type="checkbox"> smooth zoom</label>
  </div>
  <div class="hint">Public recommendation for this hand-painted (not pixel-art) low-res art is the <b>ESRGAN family + denoise</b> — not pixel scalers (xBRZ/HQx). Groups: <b>reference</b> (prior picks) · <b style="color:#cfe0ff">General v3 tunable denoise</b> (blend General↔WDN to dial grain out) · <b>illustration/detail ESRGAN</b> models (Siax, Nomos8kSC, LSDIR general; HFA2k anime). Sources flattened onto grey. Scroll a tile to pan.</div>
</header>
<main id="main"></main>
<script>
const DATA = ${data};
const COLS = ${cols};
const state = { zoom: 2, tile: 280 };
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
