/**
 * WebGL background parity: for every normal (gspec=0) room, the GPU background
 * shader (Kresli2 wall over the wobbled bg, palette-LUT coloured) must match the
 * CPU background within a tiny tolerance. gspec=2 darkness (fillIndex) / gspec=42
 * ZX (blitZX) use a different background path than the Kresli2 shader this
 * bg-only probe checks, so they're skipped here — both are on the GPU and covered
 * byte-exact by test-gl-room.mjs.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; if the
 * environment has no WebGL2 it skips (pass), so CI without a GPU still passes.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const MAX_OVER_PCT = 0.5; // < 0.5% of channels may differ by > 2 (sin-precision scanline shifts)

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);

let ok = true;
let tested = 0, skipped = 0, worstOver = 0, worstRoom = 0;

// Capability check on the first room.
await p.evaluate(() => window.__ff.enterRoomAwait(3));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
const cap = await p.evaluate(() => window.__ff.glBgParity());
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

for (let num = 1; num <= 72; num++) {
  try {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
    if ((await p.evaluate(() => window.__ff.gspec())) !== 0) { skipped++; continue; } // ZX/darkness: P3.3
    const r = await p.evaluate(() => window.__ff.glBgParity());
    if (!r || !r.webgl) { skipped++; continue; }
    if (r.dimMismatch) { ok = false; console.log(`  FAIL room ${num}: dim mismatch`); continue; }
    tested++;
    if (r.overPct > worstOver) { worstOver = r.overPct; worstRoom = num; }
    if (r.overPct > MAX_OVER_PCT) { ok = false; console.log(`  FAIL room ${num}: overPct=${r.overPct.toFixed(3)}% max=${r.max}`); }
  } catch (e) { ok = false; console.log(`  FAIL room ${num}: ${String(e).slice(0, 60)}`); }
}
if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(`  gspec=0 rooms tested=${tested} skipped(gspec!=0)=${skipped} worstOverPct=${worstOver.toFixed(3)}% (room ${worstRoom})`);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
