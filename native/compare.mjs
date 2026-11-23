// Native-vs-browser parity for the spike: renders the same scene (native/js/scene.ts)
// through the browser's real WebGL backend (GlAiScreen) and through the native host
// (SDL GPU / Metal), and diffs the two ×S composites.
//
//   node --import tsx native/compare.mjs [--rooms 1,3,10 | --all] [--out dir] [--keep]
//
// Needs native/build/game.js and the host binary (see native/README.md).
//
// Exits non-zero on any differing frame, and on any room that fails natively unless it is
// a KNOWN_GAP. A known gap that starts rendering fails too, so the list cannot go stale.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/render/png.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const ROOMS = args.includes('--all')
  ? Array.from({ length: 72 }, (_, i) => i + 1)
  : opt('--rooms', '1').split(',').filter(Boolean).map(Number);
// Rooms the spike cannot render natively yet (native/README.md, "What the spike does not do
// yet"): 66 throws on backgroundZx; 9, 68 and 72 reach a path in src/render/roomAi.ts that
// builds a canvas through the DOM ("document is not defined").
const KNOWN_GAPS = new Set([9, 66, 68, 72]);
const OUT = opt('--out', join(here, 'build', 'compare'));
const HOST = join(here, 'build', 'cmake', 'ff4e-native');
const BUNDLE = join(here, 'build', 'game.js');
mkdirSync(OUT, { recursive: true });

// Each case is one scene state; both sides derive it from the same deterministic code.
const CASES = [
  { name: 'still', probe: true, still: true, alpha: 0 },          // every primitive except the wave
  { name: 'wobble', probe: true, alpha: 0.37 },                   // + the per-fragment water
  { name: 'played', replay: 240, alpha: 0.5 },                    // after 240 ticks of the recorded solution
];

// No watcher and no HMR: an edit during a long sweep must not reload the reference page.
const server = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${url}native/reference.html`);
await page.waitForFunction(() => typeof window.__ref === 'function', null, { timeout: 60000 });

function diff(a, b, w, h) {
  let max = 0, differing = 0, sq = 0;
  const vis = new Uint8Array(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    let m = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(a[p * 4 + c] - b[p * 4 + c]);
      sq += d * d;
      if (d > m) m = d;
    }
    if (m > 0) differing++;
    if (m > max) max = m;
    const v = Math.min(255, m * 32);
    vis[p * 4] = v; vis[p * 4 + 1] = v; vis[p * 4 + 2] = v; vis[p * 4 + 3] = 255;
  }
  const mse = sq / (w * h * 3);
  return { max, differing, pct: (100 * differing) / (w * h), psnr: mse === 0 ? Infinity : 10 * Math.log10((255 * 255) / mse), vis };
}

let worst = 0;
const tally = { identical: 0, differing: 0, failed: 0 };
const unexpected = new Set(); // a differing frame, or a native failure outside KNOWN_GAPS
const failed = new Set();     // any case of the room did not render natively
for (const room of ROOMS) {
  for (const c of CASES) {
    const ref = await page.evaluate((o) => window.__ref(o), { room, ...c });
    const refPx = Buffer.from(ref.b64, 'base64');
    const raw = join(OUT, `${room}-${c.name}.rgba`);
    const flags = ['--root', join(repo, 'public'), '--room', String(room), '--headless', '--out', raw, '--alpha', String(c.alpha ?? 0)];
    if (c.probe) flags.push('--probe');
    if (c.still) flags.push('--still');
    if (c.replay) flags.push('--replay', String(c.replay));
    try {
      execFileSync(HOST, [BUNDLE, ...flags], { stdio: 'pipe' });
    } catch (e) {
      const why = String(e.stdout ?? '') + String(e.stderr ?? '');
      console.log(`#${String(room).padEnd(2)} ${ref.jmeno.padEnd(9)} ${c.name.padEnd(7)} NATIVE FAILED: ${(why.match(/spike: [^\n]*|Error: [^\n]*/) ?? [why.trim().split('\n').pop()])[0]}`);
      worst = Math.max(worst, 999);
      tally.failed++;
      failed.add(room);
      if (!KNOWN_GAPS.has(room)) unexpected.add(room);
      continue;
    }
    const nat = readFileSync(raw);
    rmSync(raw);
    const w = nat.readUInt32LE(0), h = nat.readUInt32LE(4);
    const natPx = nat.subarray(8);
    if (w !== ref.w || h !== ref.h) { console.log(`#${room} ${c.name}: SIZE MISMATCH native ${w}x${h} vs webgl ${ref.w}x${ref.h}`); worst = 999; tally.differing++; unexpected.add(room); continue; }
    const d = diff(natPx, refPx, w, h);
    worst = Math.max(worst, d.max);
    tally[d.max === 0 ? 'identical' : 'differing']++;
    if (d.max > 0) unexpected.add(room);
    // Images only where they are evidence: a differing frame, or everything with --keep.
    if (d.max > 0 || args.includes('--keep')) {
      writeFileSync(join(OUT, `${room}-${c.name}-native.png`), encodePng(new Uint8Array(natPx), w, h));
      writeFileSync(join(OUT, `${room}-${c.name}-webgl.png`), encodePng(new Uint8Array(refPx), w, h));
      if (d.max > 0) writeFileSync(join(OUT, `${room}-${c.name}-diff.png`), encodePng(d.vis, w, h));
    }
    console.log(`#${String(room).padEnd(2)} ${ref.jmeno.padEnd(9)} ${c.name.padEnd(7)} ${w}x${h} tick ${String(ref.count).padStart(3)}  ` +
      `max Δ ${d.max}  differing px ${d.differing} (${d.pct.toFixed(3)}%)  PSNR ${d.psnr === Infinity ? '∞' : d.psnr.toFixed(1) + ' dB'}`);
  }
}
await browser.close();
await server.close();
console.log(`frames: ${tally.identical} identical, ${tally.differing} differing, ${tally.failed} not renderable natively`);
console.log(worst === 0 ? 'IDENTICAL: native and WebGL composites match byte for byte' : `worst max Δ = ${worst}`);
const clean = (r) => !failed.has(r) && !unexpected.has(r);
console.log(`rooms: ${ROOMS.filter(clean).length}/${ROOMS.length} byte-identical in every case`);
const healed = ROOMS.filter((r) => KNOWN_GAPS.has(r) && clean(r));
if (unexpected.size) console.log(`REGRESSION in room(s) ${[...unexpected].join(', ')}`);
if (healed.length) console.log(`known gap(s) ${healed.join(', ')} now render identically: remove them from KNOWN_GAPS`);
process.exitCode = unexpected.size || healed.length ? 1 : 0;
