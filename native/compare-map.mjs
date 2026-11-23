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
// src/render/surface2d.ts); they are reported, and held to APPROX_LIMIT so a broken path
// still fails. Exits non-zero on any exact case that differs, any approximate case past its
// limit, and any native failure.
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
const CASES = only.length ? MAP_CASES.filter((c) => only.includes(c.name)) : MAP_CASES;
/** How far an approximate case may drift: a share of differing pixels, and a per-channel Δ. */
const APPROX_LIMIT = { pct: 2, max: 48 };
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
  const ok = c.exact ? d.max === 0 : d.pct <= APPROX_LIMIT.pct && d.max <= APPROX_LIMIT.max;
  if (!ok) bad.push(c.name);
  if (d.max > 0 || args.includes('--keep')) {
    writeFileSync(join(OUT, `${c.name}-native.png`), encodePng(new Uint8Array(natPx), w, h));
    writeFileSync(join(OUT, `${c.name}-canvas.png`), encodePng(new Uint8Array(refPx), w, h));
    if (d.max > 0) writeFileSync(join(OUT, `${c.name}-diff.png`), encodePng(d.vis, w, h));
  }
  console.log(`${c.name.padEnd(15)} ${c.exact ? 'exact ' : 'approx'} max Δ ${String(d.max).padStart(3)}  differing px ${d.differing} ` +
    `(${d.pct.toFixed(3)}%)  PSNR ${d.psnr === Infinity ? '∞' : d.psnr.toFixed(1) + ' dB'}  ${ok ? 'ok' : 'FAIL'}  — ${c.what}`);
}
await browser.close();
await server.close();
const exact = CASES.filter((c) => c.exact);
console.log(`map: ${exact.filter((c) => !bad.includes(c.name)).length}/${exact.length} exact cases byte-identical, ` +
  `${CASES.length - exact.length} approximate within limits: ${CASES.filter((c) => !c.exact && !bad.includes(c.name)).length}`);
if (bad.length) console.log(`FAILED: ${bad.join(', ')}`);
process.exitCode = bad.length ? 1 : 0;
