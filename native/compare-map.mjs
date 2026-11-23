// Native-vs-browser parity for the world map: paints each case of native/js/mapScene.ts
// through the web's own Surface2D (a 2D canvas, in Chromium, via native/reference.html)
// and through the native GPU Surface2D (native/js/nativeSurface.ts), and diffs the two
// 2560×1920 frames.
//
//   node --import tsx native/compare-map.mjs [--cases fresh,panel] [--out dir] [--keep]
//
// Needs native/build/game.js and the host binary (see native/README.md).
//
// A case marked `exact` must be byte-identical. The others go through paths the interface
// does not promise to reproduce (smoothing, fractional alpha, partial-alpha uploads — see
// src/render/surface2d.ts): they must be byte-identical OUTSIDE the region only that path
// draws (the case's `region`), and inside it within APPROX_LIMIT, set just above what is
// measured, so a real regression in what only those cases draw still fails. Exits non-zero
// on any of that, on an unknown or empty `--cases`, and on any native failure.
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from '../src/render/png.ts';
import { MAP_CASES } from './js/mapScene.ts';
import { diff } from './diffRgba.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const only = opt('--cases', '').split(',').filter(Boolean);
const unknown = only.filter((n) => !MAP_CASES.some((c) => c.name === n));
if (unknown.length || (args.includes('--cases') && !only.length)) {
  console.error(`no such map case(s): ${unknown.join(', ') || '(none given)'}; the cases are ${MAP_CASES.map((c) => c.name).join(', ')}`);
  process.exit(2);
}
const CASES = only.length ? MAP_CASES.filter((c) => only.includes(c.name)) : MAP_CASES;
/**
 * How far an approximate case may drift inside its region: a per-channel Δ, and a share of
 * the FRAME's pixels. Measured worst: Δ1 on 0.215% (panel-zoomed).
 */
const APPROX_LIMIT = { pct: 0.5, max: 2 };
const RUN_TIMEOUT_MS = 60_000;
const OUT = opt('--out', join(here, 'build', 'compare-map'));
const HOST = join(here, 'build', 'cmake', 'ff4e-native');
const BUNDLE = join(here, 'build', 'game.js');
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root: repo, server: { port: 0, host: '127.0.0.1', hmr: false, watch: null }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('page error:', e.message));
await page.goto(`${server.resolvedUrls.local[0]}native/reference.html`);
await page.waitForFunction(() => typeof window.__refMap === 'function', null, { timeout: 60000 });

const bad = [];
for (const c of CASES) {
  const ref = await page.evaluate((n) => window.__refMap(n), c.name);
  const refPx = Buffer.from(ref.b64, 'base64');
  const raw = join(OUT, `${c.name}.rgba`);
  rmSync(raw, { force: true });
  try {
    execFileSync(HOST, [BUNDLE, '--root', join(repo, 'public'), '--headless', '--map-scene', c.name, '--out', raw],
      { stdio: 'pipe', timeout: RUN_TIMEOUT_MS, killSignal: 'SIGKILL' });
  } catch (e) {
    const out = String(e.stdout ?? '') + String(e.stderr ?? '');
    console.log(`${c.name.padEnd(15)} NATIVE FAILED: ${e.code === 'ETIMEDOUT' ? 'timed out' : out.trim().split('\n').slice(-3).join(' | ')}`);
    bad.push(c.name);
    continue;
  }
  const nat = readFileSync(raw);
  rmSync(raw);
  const w = nat.readUInt32LE(0), h = nat.readUInt32LE(4);
  if (nat.length !== 8 + w * h * 4 || w !== ref.w || h !== ref.h) {
    console.log(`${c.name.padEnd(15)} SIZE: native ${w}x${h} (${nat.length} bytes) vs canvas ${ref.w}x${ref.h}`);
    bad.push(c.name);
    continue;
  }
  const natPx = nat.subarray(8);
  const d = diff(natPx, refPx, w, h);
  // Differing pixels outside the approximate region, read off the diff's visualisation.
  const s = w / 640;
  const r = c.region ? { x0: c.region.x * s, y0: c.region.y * s, x1: (c.region.x + c.region.w) * s, y1: (c.region.y + c.region.h) * s } : null;
  let outside = 0;
  for (let p = 0; p < w * h; p++) {
    if (!d.vis[p * 4]) continue;
    const x = p % w, y = (p - x) / w;
    if (!r || x < r.x0 || x >= r.x1 || y < r.y0 || y >= r.y1) outside++;
  }
  const ok = c.exact ? d.max === 0 : outside === 0 && d.pct <= APPROX_LIMIT.pct && d.max <= APPROX_LIMIT.max;
  if (!ok) bad.push(c.name);
  if (d.max > 0 || args.includes('--keep')) {
    writeFileSync(join(OUT, `${c.name}-native.png`), encodePng(new Uint8Array(natPx), w, h));
    writeFileSync(join(OUT, `${c.name}-canvas.png`), encodePng(new Uint8Array(refPx), w, h));
    if (d.max > 0) writeFileSync(join(OUT, `${c.name}-diff.png`), encodePng(d.vis, w, h));
  }
  console.log(`${c.name.padEnd(15)} ${c.exact ? 'exact ' : 'approx'} max Δ ${String(d.max).padStart(3)}  differing px ${d.differing} ` +
    `(${d.pct.toFixed(3)}%${c.exact ? '' : `, ${outside} outside its region`})  PSNR ${d.psnr === Infinity ? '∞' : d.psnr.toFixed(1) + ' dB'}  ${ok ? 'ok' : 'FAIL'}  — ${c.what}`);
}
await browser.close();
await server.close();
const exact = CASES.filter((c) => c.exact);
console.log(`map: ${exact.filter((c) => !bad.includes(c.name)).length}/${exact.length} exact cases byte-identical, ` +
  `${CASES.filter((c) => !c.exact && !bad.includes(c.name)).length}/${CASES.length - exact.length} approximate within limits`);
if (bad.length) console.log(`FAILED: ${bad.join(', ')}`);
process.exitCode = bad.length ? 1 : 0;
