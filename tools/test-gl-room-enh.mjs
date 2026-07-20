/**
 * WebGL enhanced-art parity: render each room through the ENHANCED (FFNG
 * truecolor) art source on GPU vs CPU and assert a byte-exact match. FFNG object
 * and fish sprites use hard 0/255 alpha, so the GL alpha blend reproduces the CPU
 * integer blend exactly (no rounding). Every room composites on the GPU.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; skips (pass)
 * if the environment has no WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
// Enhanced full-room render is byte-exact vs the CPU oracle too (FFNG sprites use
// hard 0/255 alpha, so the GL blend reproduces the CPU integer blend exactly).
// Gate is max===0; overPct is a diagnostic only.

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate(() => { window.__ff.setGraphics('enhanced'); window.__ff.setRenderer('webgl'); });

await p.evaluate(() => window.__ff.enterRoomAwait(3));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
// Ensure the FFNG masters actually load — else this whole suite would silently
// compare classic-fallback CPU vs classic-fallback GPU and prove nothing about
// the enhanced path. Room 3 (PRVNI) has truecolor art; require it to engage.
await p.waitForFunction(() => window.__ff.enhancedActive(), { timeout: 10000 }).catch(() => {});
const cap = await p.evaluate(() => window.__ff.glEnhParity());
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}
if (!(await p.evaluate(() => window.__ff.enhancedActive()))) {
  console.log('  FAIL: enhanced (FFNG) art did not engage on room 3 — cannot validate the enhanced GPU path');
  console.log('FAIL');
  await b.close();
  process.exit(1);
}

let ok = true;
let tested = 0, enhRooms = 0, unsupported = 0, worstOver = 0, worstRoom = 0, worstMax = 0;
for (let num = 1; num <= 72; num++) {
  try {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
    // Give the enhanced masters time to decode (or settle as classic fallback).
    await p.waitForFunction(() => window.__ff.enhancedLoaded() || window.__ff.count() > 40, { timeout: 6000 }).catch(() => {});
    const r = await p.evaluate(() => window.__ff.glEnhParity());
    if (!r || !r.webgl) continue;
    if (r.unsupported) { ok = false; unsupported++; console.log(`  FAIL room ${num}: unexpectedly unsupported on GPU`); continue; }
    if (r.dimMismatch) { ok = false; console.log(`  FAIL room ${num}: dim mismatch`); continue; }
    tested++;
    if (r.enh) enhRooms++;
    if (r.overPct > worstOver) { worstOver = r.overPct; worstRoom = num; worstMax = r.max; }
    if (r.max !== 0) { ok = false; console.log(`  FAIL room ${num}: max=${r.max} overPct=${r.overPct.toFixed(3)}% enh=${r.enh} (expected byte-exact max=0)`); }
  } catch (e) { ok = false; console.log(`  FAIL room ${num}: ${String(e).slice(0, 60)}`); }
}
// Guard against a silent regression where the FFNG masters stop loading and the
// whole sweep degrades to classic-vs-classic: require most rooms to have engaged
// truecolor (a handful legitimately have no enhanced art, e.g. SCORE).
if (enhRooms < 50) { ok = false; console.log(`  FAIL: only ${enhRooms} rooms engaged truecolor art (expected >= 50) — enhanced path under-tested`); }
if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(`  enhanced rooms tested=${tested} (truecolor-engaged=${enhRooms}) unsupported=${unsupported} worstMax=${worstMax} worstOverPct=${worstOver.toFixed(3)}% (room ${worstRoom})`);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
