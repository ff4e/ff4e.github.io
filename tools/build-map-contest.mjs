/**
 * FULL-map upscaler tournament — the "contest" page. Generates the whole lit world map
 * (mapa-1, 640×480 → 2560×1920) with each candidate model, then emits a self-contained
 * single-elimination bracket where you judge two full maps at a time (blind by default)
 * and pick a winner, chess-knockout style, until one model is crowned.
 *
 * Contestants = the AI models from lib/upscalers.mjs (the native-nearest `orig` reference is
 * excluded — it isn't a real candidate). Images are encoded to high-quality WebP so the page
 * stays light despite full-resolution maps.
 *
 * Output: tools/map-contest/ (img/<id>.webp + index.html).
 * Serve:  cd tools/map-contest && python3 -m http.server 8105
 * Run:    REALESRGAN_NCNN=… node tools/build-map-contest.mjs [base]     base = mapa-1 (default) | mapa-0
 * Requires the extra models in <binDir>/models (see lib/upscalers.mjs EXTRA_MODELS).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBmp, indicesToRgb24 } from './lib/mapsrc.mjs';
import { COLS, run, requireBin, requireModels, generate } from './lib/upscalers.mjs';

const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);
const menuDir = join(root, 'public', 'data', 'Menu');
const outDir = join(toolsDir, 'map-contest');
const imgDir = join(outDir, 'img');
const WEBP_Q = String(process.env.WEBP_Q || 94);

// The native-nearest reference isn't a real candidate — everything else competes.
const CONTESTANTS = COLS.filter((c) => c.id !== 'orig');

/** Decode a map BMP to a full-frame opaque RGB24 PNG (byte-exact palette). */
function baseToPng(bmpFile, work) {
  const bmp = parseBmp(new Uint8Array(readFileSync(join(menuDir, bmpFile))));
  const raw = join(work, 'base.rgb');
  const png = join(work, 'base.png');
  writeFileSync(raw, indicesToRgb24(bmp.pixels, bmp.palette, bmp.w, bmp.h));
  run(`encode base (${bmp.w}x${bmp.h})`, 'ffmpeg', ['-y', '-v', 'error', '-f', 'rawvideo',
    '-pixel_format', 'rgb24', '-video_size', `${bmp.w}x${bmp.h}`, '-i', raw, png]);
  return { png, w: bmp.w, h: bmp.h };
}

function main() {
  const base = process.argv[2] || 'mapa-1';
  const bmpFile = `${base}.BMP`;
  if (!existsSync(join(menuDir, bmpFile))) { console.error(`no such base ${bmpFile} in ${menuDir}`); process.exit(1); }
  const binp = requireBin('REALESRGAN_NCNN', 'Set it to realesrgan-ncnn-vulkan (folder must hold ./models).');
  requireModels(binp);
  const cwebp = spawnSync('cwebp', ['-version'], { encoding: 'utf8' });
  if (cwebp.status !== 0) { console.error('cwebp (libwebp) not found on PATH — required to encode the full-map WebPs.'); process.exit(1); }

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(imgDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'mapcontest-'));
  try {
    const { png: prep, w, h } = baseToPng(bmpFile, work);
    // Generate every candidate as PNG in the work dir, then encode each to a light WebP.
    const ctx = { prep, binp, out: (id) => join(work, `${id}.png`) };
    generate(ctx, CONTESTANTS.map((c) => c.id));
    for (const c of CONTESTANTS) {
      const dst = join(imgDir, `${c.id}.webp`);
      run(`webp ${c.id}`, 'cwebp', ['-quiet', '-q', WEBP_Q, ctx.out(c.id), '-o', dst]);
      console.log(`  ${c.id}: ${(statSync(dst).size / 1e3).toFixed(0)} KB`);
    }
    const manifest = CONTESTANTS.map((c) => ({ id: c.id, label: c.label, group: c.group, src: `img/${c.id}.webp` }));
    writeFileSync(join(outDir, 'index.html'), renderHtml(manifest, base, w * 4, h * 4));
    console.log(`\nDone (${base}, ${w * 4}×${h * 4}). Serve tools/map-contest/ (cd tools/map-contest && python3 -m http.server 8105).`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function renderHtml(manifest, base, ow, oh) {
  const data = JSON.stringify(manifest);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>World-map upscaler tournament</title>
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
  <h1>World-map upscaler <b>tournament</b></h1>
  <span class="round" id="round"></span>
  <span class="spacer"></span>
  <label>Zoom <input id="zoom" type="range" min="0.25" max="3" step="0.05" value="0.5"> <span id="zval">50%</span></label>
  <label><input id="blind" type="checkbox" checked> blind (hide names)</label>
  <label><input id="smooth" type="checkbox" checked> smooth</label>
  <button id="undo">↶ Undo</button>
  <button id="reset">Reset</button>
</header>
<main id="main"></main>
<div class="foot">Base: ${base} · ${ow}×${oh}. Pick with <kbd>←</kbd>/<kbd>→</kbd> or click a map / its button. Both maps zoom &amp; pan together — scroll either one. Single-elimination: winner advances, loser is out.</div>
<script>
const MODELS = ${data};
const OW = ${ow}, OH = ${oh};
const KEY = 'map-contest:' + MODELS.map(m=>m.id).join(',') + ':${base}';

function shuffle(a){ a=a.slice(); for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; }
function load(){ try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } }
function save(s){ localStorage.setItem(KEY, JSON.stringify(s)); }

let state = load();
if (!state) { state = { seed: shuffle(MODELS.map(m=>m.id)), picks: [] }; save(state); }
const byId = Object.fromEntries(MODELS.map(m=>[m.id,m]));

// Replay the knockout from (seed, picks). Odd round → first entrant gets a bye that round.
// Returns { done, champion, current:{a,b,roundSize}, rounds:[{name,matches:[{a,b,winner,bye}]}] }.
function simulate(seed, picks){
  let round = seed.slice();
  let pi = 0;
  const rounds = [];
  let current = null;
  let roundNum = 1;
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
        // don't advance; leave the rest of this round unresolved
        next.push(null); // placeholder for the pending winner
      } else {
        rec.matches.push({ a, b, winner: null, future: true });
      }
    }
    rounds.push(rec);
    if (current) return { done:false, current, rounds };
    round = next;
    roundNum++;
  }
  return { done:true, champion: round[0], rounds };
}

// ---- shared zoom/pan across the two viewports ----
let zoom = 0.5, syncing = false;
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
      '<img src="'+m.src+'" alt="champion map">';
    main.append(div);
    renderBracket(sim, true);
    return;
  }
  const { a, b, roundName } = sim.current;
  // matches played in this round so far
  const cur = sim.rounds[sim.rounds.length-1];
  const played = cur.matches.filter(x=>x.winner).length;
  const real = cur.matches.filter(x=>x.a).length + (cur.matches.some(x=>x.bye)?0:0);
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
  who.textContent = document.getElementById('blind').checked ? (side==='left'?'Map A':'Map B') : m.label;
  const btn = document.createElement('button'); btn.className = 'pick';
  btn.textContent = (side==='left'?'◀ ':'')+'This one'+(side==='right'?' ▶':'');
  btn.onclick = () => pick(m.id);
  bar.append(who, btn);
  const vp = document.createElement('div'); vp.className = 'viewport';
  const img = document.createElement('img'); img.src = m.src; img.alt = side+' map'; img.draggable = false;
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
