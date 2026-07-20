/**
 * WebGL runtime-switch integration: flip the renderer to WebGL at runtime and
 * verify the GPU backend actually presents on normal/mirror/elevator AND the ZX
 * room (every room is GPU-active now), and toggles cleanly back to CPU — all with
 * no page errors. Complements the byte-exact parity tests (test-gl-room.mjs);
 * this checks the wiring, not the pixels.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; skips (pass)
 * if the environment has no WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);

// Force classic art + WebGL backend at runtime.
await p.evaluate(() => { window.__ff.setGraphics('classic'); window.__ff.setRenderer('webgl'); });

// Capability check: enter a normal room and confirm WebGL2 is usable.
await p.evaluate(() => window.__ff.enterRoomAwait(3));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
const cap = await p.evaluate(() => window.__ff.glRoomParity());
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;
// (room, expectGlActive) — 3 normal, 9 mirror (ZRC), 20 elevator (ZDVIZ1) present on GPU;
// All rooms now present on the GPU, including 66 ZX (its random band width is
// re-seeded only for the byte-exact test; the live render is GPU). 3 normal,
// 9 mirror (ZRC), 20 elevator (ZDVIZ1), 66 ZX (Spectrum bands) — all GPU-active.
const cases = [[3, true], [9, true], [20, true], [66, true]];
for (const [num, wantGl] of cases) {
  await p.evaluate((n) => window.__ff.setRenderer('webgl'), num);
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
  // Wait for the backend/fallback to settle to the expected state (deterministic,
  // no fixed sleep) — a frame must render and set glActive first.
  const settled = await p.waitForFunction((want) => window.__ff.glActive() === want, wantGl, { timeout: 4000 }).then(() => true).catch(() => false);
  const gl = await p.evaluate(() => window.__ff.glActive());
  if (!settled || gl !== wantGl) { ok = false; console.log(`  FAIL room ${num}: glActive=${gl} want=${wantGl}`); }
}

// Toggle back to CPU: the GL canvas must go inactive.
await p.evaluate(() => { window.__ff.setRenderer('cpu'); window.__ff.enterRoomAwait(3); });
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
const wentCpu = await p.waitForFunction(() => window.__ff.glActive() === false, null, { timeout: 4000 }).then(() => true).catch(() => false);
if (!wentCpu) { ok = false; console.log('  FAIL: glActive still true after switching to CPU'); }

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(`  runtime switch: ${ok ? 'CPU<->WebGL OK (all rooms GPU, incl. ZX), clean toggle, no errors' : 'see failures'}`);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
