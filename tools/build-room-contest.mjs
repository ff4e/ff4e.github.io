/**
 * FULL-ROOM upscaler tournament — the room analog of build-map-contest.mjs. For each
 * candidate model it composes the WHOLE room the way the game assembles it — background
 * (p.png, opaque, direct pass) + wall (w.png) + every object sprite from objects.json,
 * each placed at its cell (obj.x·FSIZE, obj.y·FSIZE) — so you judge the assembled scene,
 * not isolated asset tiles. Alpha layers (wall + objects) run the SHIPPED PADDING
 * PIPELINE (transparent ring → colour+matte upscale → crop) so borders match the game.
 *
 * Then a single-elimination bracket (blind by default): judge two full rooms at a time,
 * winner advances. Fish are omitted (shared across algos; their own contest is the fish
 * pages) — this compares the room ART upscaler.
 *
 * Output: tools/room-contest/ (img/<id>.webp + index.html). Serve with python3 -m http.server.
 * Run: REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan node tools/build-room-contest.mjs [ROOM]
 * Requires cwebp on PATH and the extra models in <binDir>/models.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const enhancedDir = join(root, 'public', 'enhanced');
const outDir = join(toolsDir, 'room-contest');
const imgDir = join(outDir, 'img');
const ROOM = process.argv[2] || 'PRVNI';
const SCALE = 4;
const FSIZE = 15; // native cell size (src/render/renderRoom.ts)
const SPRITE_PAD = Number(process.env.SPRITE_PAD || 12);
const WEBP_Q = process.env.WEBP_Q || '90';

// Contestants (reuse the map model set; orig/reference excluded — a tournament of AI models).
// av3 = current room hero; gen_wdn = world-map tournament winner.
const CONTESTANTS = [
  { id: 'x4plus', label: 'x4plus', group: 'reference', model: 'realesrgan-x4plus' },
  { id: 'av3', label: 'animevideov3 (current room)', group: 'reference', model: 'realesr-animevideov3-x4' },
  { id: 'anime', label: 'x4plus-anime', group: 'reference', model: 'realesrgan-x4plus-anime' },
  { id: 'gen', label: 'General v3 (dn 0)', group: 'General v3', model: 'RealESRGAN_General_x4_v3' },
  { id: 'gen_wdn', label: 'General WDN (map winner)', group: 'General v3', model: 'RealESRGAN_General_WDN_x4_v3' },
  { id: 'siax', label: '4x NMKD-Siax', group: 'illustration ESRGAN', model: '4x_NMKD-Siax_200k' },
  { id: 'nomos', label: '4x Nomos8kSC', group: 'illustration ESRGAN', model: '4xNomos8kSC' },
  { id: 'lsdir', label: '4x LSDIR', group: 'illustration ESRGAN', model: '4xLSDIR' },
  { id: 'hfa2k', label: '4x HFA2k (anime)', group: 'illustration ESRGAN', model: '4xHFA2k' },
];

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
function smoothstep(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// ---- padding pipeline (mirrors build-room-ai.mjs buildSprite) ------------
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
/** Matted-sprite upscale WITH the transparent-ring padding trick. Returns {rgba,w,h} at ×4. */
function buildSprite(srcPng, model, binp, work) {
  const { w, h } = probe(srcPng);
  const src0 = decodeRgba(srcPng, w, h, work, 'sp_src');
  const { rgba: src, w: pw, h: ph } = padTransparent(src0, w, h, SPRITE_PAD);
  const colPng = join(work, 'sp_col.png');
  encodeRgba(bleedAlpha(src, pw, ph), pw, ph, work, 'sp_col', colPng);
  const colAi = join(work, 'sp_col_ai.png');
  upscaleFile(colPng, colAi, model, binp);
  const pow = pw * SCALE, poh = ph * SCALE;
  const col = decodeRgba(colAi, pow, poh, work, 'sp_colai');
  const mPng = join(work, 'sp_matte.png');
  encodeRgba(alphaToGrey(src, pw, ph), pw, ph, work, 'sp_matte', mPng);
  const mAi = join(work, 'sp_matte_ai.png');
  upscaleFile(mPng, mAi, model, binp);
  const matte = decodeRgba(mAi, pow, poh, work, 'sp_matteai');
  const padded = new Uint8Array(pow * poh * 4);
  for (let i = 0; i < pow * poh; i++) {
    padded[i * 4] = col[i * 4]; padded[i * 4 + 1] = col[i * 4 + 1]; padded[i * 4 + 2] = col[i * 4 + 2];
    padded[i * 4 + 3] = Math.round(smoothstep(0.12, 0.6, matte[i * 4] / 255) * 255);
  }
  const ow = w * SCALE, oh = h * SCALE;
  const out = cropRgba(padded, pow, SPRITE_PAD * SCALE, SPRITE_PAD * SCALE, ow, oh);
  return { rgba: out, w: ow, h: oh };
}
/** Opaque upscale → returns {rgba,w,h}. */
function buildLayer(srcPng, model, binp, work) {
  const outPng = join(work, 'layer_ai.png');
  upscaleFile(srcPng, outPng, model, binp);
  const { w, h } = probe(outPng);
  return { rgba: decodeRgba(outPng, w, h, work, 'layerai'), w, h };
}
/** Alpha-over `spr` onto opaque `base` (base a=255) at top-left (dx,dy), clipped. */
function compositeOver(base, W, H, spr) {
  const { rgba: s, w: sw, h: sh, dx, dy } = spr;
  for (let y = 0; y < sh; y++) {
    const by = y + dy; if (by < 0 || by >= H) continue;
    for (let x = 0; x < sw; x++) {
      const bx = x + dx; if (bx < 0 || bx >= W) continue;
      const si = (y * sw + x) * 4, bi = (by * W + bx) * 4;
      const fa = s[si + 3] / 255; if (fa <= 0) continue;
      base[bi] = Math.round(s[si] * fa + base[bi] * (1 - fa));
      base[bi + 1] = Math.round(s[si + 1] * fa + base[bi + 1] * (1 - fa));
      base[bi + 2] = Math.round(s[si + 2] * fa + base[bi + 2] * (1 - fa));
      base[bi + 3] = 255;
    }
  }
}

// ---- compose one full room for a model -----------------------------------
function composeRoom(model, binp, objects, dstWebp) {
  const rdir = join(enhancedDir, ROOM);
  const work = mkdtempSync(join(tmpdir(), 'roomcontest-'));
  try {
    // Background (opaque) — direct pass — is the base canvas.
    const bg = buildLayer(join(rdir, 'p.png'), model, binp, work);
    const W = bg.w, H = bg.h;
    const base = bg.rgba;
    // Wall over background (has a doorway hole → alpha → padded).
    const wallSrc = join(rdir, 'w.png');
    if (existsSync(wallSrc)) {
      const wall = hasAlpha(wallSrc) ? buildSprite(wallSrc, model, binp, work) : buildLayer(wallSrc, model, binp, work);
      compositeOver(base, W, H, { ...wall, dx: 0, dy: 0 });
    }
    // Objects at their cell positions (frame 0), padded.
    for (const obj of objects) {
      const frame = obj.frames && obj.frames[0];
      if (!frame) continue;
      const src = join(rdir, 'obj', frame);
      if (!existsSync(src)) { console.warn(`  skip missing object ${frame}`); continue; }
      const spr = hasAlpha(src) ? buildSprite(src, model, binp, work) : buildLayer(src, model, binp, work);
      compositeOver(base, W, H, { ...spr, dx: obj.x * FSIZE * SCALE, dy: obj.y * FSIZE * SCALE });
    }
    const composed = join(work, 'room.png');
    encodeRgba(base, W, H, work, 'room', composed);
    run(`webp ${model}`, 'cwebp', ['-quiet', '-q', WEBP_Q, composed, '-o', dstWebp]);
    return { w: W, h: H };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main() {
  const binp = requireBin();
  const models = join(dirname(binp), 'models');
  for (const c of CONTESTANTS) {
    if (!existsSync(join(models, `${c.model}.param`))) { console.error(`Missing model ${c.model}.param in ${models}`); process.exit(1); }
  }
  if (spawnSync('cwebp', ['-version'], { encoding: 'utf8' }).status !== 0) { console.error('cwebp (libwebp) not found on PATH.'); process.exit(1); }
  const objPath = join(enhancedDir, ROOM, 'objects.json');
  const objects = existsSync(objPath) ? (JSON.parse(readFileSync(objPath, 'utf8')).objects || []) : [];
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  let dims = { w: 0, h: 0 };
  for (const c of CONTESTANTS) {
    console.log(`\n== compose ${ROOM} · ${c.id} (${c.model}) ==`);
    dims = composeRoom(c.model, binp, objects, join(imgDir, `${c.id}.webp`));
    console.log(`  ${c.id}: ${(statSync(join(imgDir, `${c.id}.webp`)).size / 1e3).toFixed(0)} KB  ${dims.w}×${dims.h}`);
  }
  const manifest = CONTESTANTS.map((c) => ({ id: c.id, label: c.label, group: c.group, src: `img/${c.id}.webp` }));
  writeFileSync(join(outDir, 'index.html'), renderHtml(manifest, ROOM, dims.w, dims.h));
  console.log(`\nDone (${ROOM}, ${dims.w}×${dims.h}). Serve: cd tools/room-contest && python3 -m http.server 8108`);
}

function renderHtml(manifest, room, ow, oh) {
  const data = JSON.stringify(manifest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Room ${room} — upscaler tournament</title>
<style>
  :root { color-scheme: dark; --gap: 14px; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.4 system-ui, sans-serif; background: #16161a; color: #e8e8ea; }
  header { position: sticky; top: 0; z-index: 6; background: #232329; padding: 10px 16px; border-bottom: 1px solid #35353c; display: flex; flex-wrap: wrap; gap: 10px 20px; align-items: center; }
  header h1 { font-size: 15px; margin: 0; font-weight: 600; }
  header .round { font-size: 13px; color: #a7b4c4; }
  header .round b { color: #cfe0ff; }
  header .spacer { flex: 1; }
  header label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; color: #c3c9d1; }
  header button { font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 5px; border: 1px solid #3c4658; background: #2b333f; color: #dfe6ef; cursor: pointer; }
  header button:hover { background: #343d4c; }
  .arena { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); padding: var(--gap); align-items: start; }
  .panel { background: #101014; border: 2px solid #33333a; border-radius: 8px; overflow: hidden; display: flex; flex-direction: column; }
  .panel.left  { --accent: #d68a4b; }
  .panel.right { --accent: #4b8fd6; }
  .panel .bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 10px; background: #1c1c22; border-bottom: 1px solid #33333a; }
  .panel .who { font-size: 13px; font-weight: 600; color: var(--accent); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .panel .pick { font: inherit; font-size: 13px; font-weight: 600; padding: 5px 12px; border-radius: 6px; border: 1px solid var(--accent); background: transparent; color: var(--accent); cursor: pointer; white-space: nowrap; }
  .panel .pick:hover { background: var(--accent); color: #0c0c0f; }
  .viewport { overflow: auto; background: repeating-conic-gradient(#26262c 0% 25%, #1d1d22 0% 50%) 50% / 22px 22px; max-height: calc(100vh - 150px); cursor: crosshair; }
  .viewport img { display: block; image-rendering: var(--smooth, auto); }
  .foot { padding: 8px 16px 20px; color: #8a929b; font-size: 12px; }
  .bracket { padding: 4px 16px 24px; }
  .bracket h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .5px; color: #7f8894; margin: 12px 0 6px; }
  .bracket ol { margin: 0; padding-left: 20px; }
  .bracket li { margin: 2px 0; color: #b6bdc6; }
  .bracket li .w { color: #7fd08a; font-weight: 600; }
  .bracket li .l { color: #79828d; text-decoration: line-through; }
  .champ { text-align: center; padding: 30px 16px; }
  .champ .medal { font-size: 40px; }
  .champ .name { font-size: 22px; font-weight: 700; color: #ffd76a; margin: 6px 0 2px; }
  .champ img { max-width: min(100%, 1100px); margin: 14px auto 0; display: block; border: 2px solid #ffd76a55; border-radius: 8px; }
  kbd { background: #2b2b32; border: 1px solid #3c3c45; border-bottom-width: 2px; border-radius: 4px; padding: 0 5px; font: 12px ui-monospace, monospace; }
</style></head>
<body>
<header>
  <h1>Room <b>${room}</b> upscaler <b>tournament</b></h1>
  <span class="round" id="round"></span>
  <span class="spacer"></span>
  <label>Zoom <input id="zoom" type="range" min="0.25" max="4" step="0.05" value="0.75"> <span id="zval">75%</span></label>
  <label><input id="blind" type="checkbox" checked> blind (hide names)</label>
  <label><input id="smooth" type="checkbox" checked> smooth</label>
  <button id="undo">↶ Undo</button>
  <button id="reset">Reset</button>
</header>
<main id="main"></main>
<div class="foot">Room: ${room} · ${ow}×${oh} (bg + wall + objects, padded). Pick with <kbd>←</kbd>/<kbd>→</kbd> or click a room / its button. Both rooms zoom &amp; pan together — scroll either one. Single-elimination: winner advances, loser is out.</div>
<script>
const MODELS = ${data};
const OW = ${ow}, OH = ${oh};
const KEY = 'room-contest:' + MODELS.map(m=>m.id).join(',') + ':${room}';

function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }

let state = load();
if (!state) { state = { seed: shuffle(MODELS.map(m=>m.id)), picks: [] }; save(state); }
const byId = Object.fromEntries(MODELS.map(m=>[m.id,m]));

function simulate(seed, picks){
  let round = seed.slice();
  let pi = 0;
  const rounds = [];
  let current = null;
  while (round.length > 1){
    const size = round.length;
    const name = size===2 ? 'Final' : size<=4 ? 'Semi-finals' : size<=8 ? 'Quarter-finals' : ('Round of '+size);
    const rec = { name, matches: [] };
    const next = [];
    let i = 0;
    if (size % 2 === 1){ next.push(round[0]); rec.matches.push({ bye: round[0] }); i = 1; }
    for (; i < round.length; i += 2){
      const a = round[i], b = round[i+1];
      if (pi < picks.length){
        const w = picks[pi++] === b ? b : a;
        next.push(w);
        rec.matches.push({ a, b, winner: w });
      } else if (!current){
        current = { a, b, roundSize: size, roundName: name };
        rec.matches.push({ a, b, winner: null });
        next.push(null);
      } else {
        rec.matches.push({ a, b, winner: null, future: true });
      }
    }
    rounds.push(rec);
    if (current) return { done:false, current, rounds };
    round = next;
  }
  return { done:true, champion: round[0], rounds };
}

let zoom = 0.75, syncing = false;
function applyZoom(){
  document.getElementById('zval').textContent = Math.round(zoom*100)+'%';
  for (const img of document.querySelectorAll('.viewport img')) img.style.width = (OW*zoom)+'px';
}
function syncScroll(from){
  if (syncing) return; syncing = true;
  const vps = [...document.querySelectorAll('.viewport')];
  for (const vp of vps){ if (vp!==from){ vp.scrollLeft = from.scrollLeft; vp.scrollTop = from.scrollTop; } }
  syncing = false;
}

function pick(id){
  const sim = simulate(state.seed, state.picks);
  if (sim.done) return;
  if (id !== sim.current.a && id !== sim.current.b) return;
  state.picks.push(id); save(state);
  render();
}

function render(){
  const sim = simulate(state.seed, state.picks);
  const main = document.getElementById('main');
  const roundEl = document.getElementById('round');
  main.innerHTML = '';
  if (sim.done){
    roundEl.innerHTML = '<b>Champion crowned</b>';
    const m = byId[sim.champion];
    const div = document.createElement('div'); div.className = 'champ';
    div.innerHTML = '<div class="medal">🏆</div><div class="name">'+m.label+'</div><div style="color:#9aa3ad">('+m.group+')</div>' +
      '<img src="'+m.src+'" alt="champion room">';
    main.append(div);
    renderBracket(sim, true);
    return;
  }
  const { a, b, roundName } = sim.current;
  const cur = sim.rounds[sim.rounds.length-1];
  const played = cur.matches.filter(x=>x.winner).length;
  roundEl.innerHTML = '<b>'+roundName+'</b> · match '+(played+1)+' · '+sim.current.roundSize+' left';
  const arena = document.createElement('div'); arena.className = 'arena';
  arena.append(panel('left', byId[a]), panel('right', byId[b]));
  main.append(arena);
  renderBracket(sim, false);
  applyZoom();
  hookScroll();
}

function panel(side, m){
  const p = document.createElement('div'); p.className = 'panel '+side;
  const bar = document.createElement('div'); bar.className = 'bar';
  const who = document.createElement('div'); who.className = 'who';
  who.textContent = document.getElementById('blind').checked ? (side==='left'?'Room A':'Room B') : m.label;
  const btn = document.createElement('button'); btn.className = 'pick';
  btn.textContent = (side==='left'?'◀ ':'')+'This one'+(side==='right'?' ▶':'');
  btn.onclick = () => pick(m.id);
  bar.append(who, btn);
  const vp = document.createElement('div'); vp.className = 'viewport';
  const img = document.createElement('img'); img.src = m.src; img.alt = side+' room'; img.draggable = false;
  img.onclick = () => pick(m.id);
  vp.append(img);
  p.append(bar, vp);
  return p;
}

function hookScroll(){
  const vps = [...document.querySelectorAll('.viewport')];
  for (const vp of vps) vp.addEventListener('scroll', () => syncScroll(vp));
}

function renderBracket(sim, done){
  const wrap = document.createElement('div'); wrap.className = 'bracket';
  for (const r of sim.rounds){
    const anyResolved = r.matches.some(x=>x.winner) || r.matches.some(x=>x.bye);
    if (!anyResolved && !done) continue;
    const h = document.createElement('h3'); h.textContent = r.name; wrap.append(h);
    const ol = document.createElement('ol');
    for (const mt of r.matches){
      const li = document.createElement('li');
      const nm = (id) => document.getElementById('blind').checked && !done ? '···' : (byId[id]?byId[id].label:id);
      if (mt.bye){ li.innerHTML = '<span class="w">'+nm(mt.bye)+'</span> <em style="color:#79828d">(bye)</em>'; }
      else if (mt.winner){ const l = mt.winner===mt.a?mt.b:mt.a; li.innerHTML = '<span class="w">'+nm(mt.winner)+'</span> def. <span class="l">'+nm(l)+'</span>'; }
      else { li.innerHTML = '<span style="color:#cfe0ff">'+nm(mt.a)+'</span> vs <span style="color:#cfe0ff">'+nm(mt.b)+'</span>' + (mt.future?'':' <em style="color:#ffd76a">← now</em>'); }
      ol.append(li);
    }
    wrap.append(ol);
  }
  document.getElementById('main').append(wrap);
}

document.getElementById('zoom').oninput = (e)=>{ zoom = parseFloat(e.target.value); applyZoom(); };
document.getElementById('blind').onchange = ()=> render();
document.getElementById('smooth').onchange = (e)=> document.documentElement.style.setProperty('--smooth', e.target.checked?'auto':'pixelated');
document.getElementById('undo').onclick = ()=>{ if (state.picks.length){ state.picks.pop(); save(state); render(); } };
document.getElementById('reset').onclick = ()=>{ if (confirm('Reset the tournament with a fresh random draw?')){ state = { seed: shuffle(MODELS.map(m=>m.id)), picks: [] }; save(state); render(); } };
document.addEventListener('keydown', (e)=>{
  const sim = simulate(state.seed, state.picks);
  if (sim.done) return;
  if (e.key === 'ArrowLeft') pick(sim.current.a);
  else if (e.key === 'ArrowRight') pick(sim.current.b);
});
document.documentElement.style.setProperty('--smooth', 'auto');
render();
</script>
</body></html>`;
}

main();
