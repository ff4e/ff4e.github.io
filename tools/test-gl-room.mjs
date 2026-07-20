/**
 * P3 WebGL room parity: render every room through the shared compositor
 * (renderRoomInto → GlScreen) on the GPU vs the CPU and assert a byte-exact
 * match. All rooms (including gspec=42 ZX, seeded deterministically in the probe)
 * are on the GPU now.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; if the
 * environment has no WebGL2 it skips (pass), so CI without a GPU still passes.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
// Full-room classic render is byte-exact vs the CPU oracle: items/fish/effects/
// mirror/ropes/ZX bands are all integer, and the background wobble has matched
// the CPU to the pixel at every tested count. So the gate is max===0 (a single
// wrong pixel fails). overPct is kept only as a diagnostic. (If the FP32-sin
// background wobble ever shifts a scanline — never observed — that would surface
// here as a real, investigate-worthy divergence, not be silently tolerated.)

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);

let ok = true;
let tested = 0, skipped = 0, unsupported = 0, worstOver = 0, worstRoom = 0, worstMax = 0;
const unsupportedRooms = [];

// Capability check on the first room.
await p.evaluate(() => window.__ff.enterRoomAwait(3));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 15, { timeout: 8000 });
const cap = await p.evaluate(() => window.__ff.glRoomParity());
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
    const r = await p.evaluate(() => window.__ff.glRoomParity());
    if (!r || !r.webgl) { skipped++; continue; }
    if (r.unsupported) { ok = false; unsupported++; unsupportedRooms.push(num); console.log(`  FAIL room ${num}: unexpectedly unsupported on GPU`); continue; }
    if (r.dimMismatch) { ok = false; console.log(`  FAIL room ${num}: dim mismatch`); continue; }
    tested++;
    if (r.overPct > worstOver) { worstOver = r.overPct; worstRoom = num; worstMax = r.max; }
    if (r.max !== 0) { ok = false; console.log(`  FAIL room ${num}: max=${r.max} overPct=${r.overPct.toFixed(3)}% (expected byte-exact max=0)`); }
  } catch (e) { ok = false; console.log(`  FAIL room ${num}: ${String(e).slice(0, 60)}`); }
}
if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(`  full-GPU rooms tested=${tested} unsupported=${unsupported}${unsupported ? ' [' + unsupportedRooms.join(',') + ']' : ''} skipped=${skipped} worstMax=${worstMax} worstOverPct=${worstOver.toFixed(3)}% (room ${worstRoom})`);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
