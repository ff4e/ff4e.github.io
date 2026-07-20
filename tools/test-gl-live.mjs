/**
 * P3 WebGL LIVE-state parity: the resting-pose room parity tests never exercise
 * several GPU shader paths. This drives them and asserts byte-exact GPU-vs-CPU:
 *   - non-resting fish frames (swim body + head overlay → FISH_FS split)
 *   - fishing hooks (setIndex line/glyph + caught-fish composite)
 *   - a dead fish's disintegrating skeleton (DISINT_FS randpole dither)
 *   - baked classic subtitles (setIndex text) drawn into the GPU target
 * via __ff.glLiveParity (classic art), after setting up each scenario.
 *
 * Runs its own headless Chromium with ANGLE; skips (pass) without WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const ROOM = 6; // KOSTE — two fish, several items, normal (gspec=0)

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate(() => window.__ff.setGraphics('classic'));

await p.evaluate((n) => window.__ff.enterRoomAwait(n), ROOM);
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 20, { timeout: 8000 });
const cap = await p.evaluate(() => window.__ff.glLiveParity());
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;
const check = (label, r) => {
  if (!r || !r.webgl) { ok = false; console.log(`  FAIL ${label}: no webgl result`); return; }
  if (r.unsupported || r.dimMismatch) { ok = false; console.log(`  FAIL ${label}: ${JSON.stringify(r)}`); return; }
  if (r.max !== 0) { ok = false; console.log(`  FAIL ${label}: max=${r.max} overPct=${r.overPct.toFixed(3)}% (expected byte-exact)`); }
  else console.log(`  OK   ${label}: byte-exact (${r.w}x${r.h})`);
};

// 1. Non-resting fish frames (glLiveParity always uses swim body + head).
check('fish swim+head', await p.evaluate(() => window.__ff.glLiveParity()));

// 2. Fishing hook (line/glyph via setIndex).
await p.evaluate(() => window.__ff.spawnHook());
await p.waitForTimeout(50);
check('fishing hook', await p.evaluate(() => window.__ff.glLiveParity()));

// 3. Baked classic subtitle (setIndex text into the GPU target).
await p.evaluate(() => window.__ff.pushSubtitle('Test subtitle line for GPU parity', '@'));
await p.waitForTimeout(50);
check('baked subtitle', await p.evaluate(() => window.__ff.glLiveParity()));

// 4. Dead fish disintegrate (skeleton dither via DISINT_FS).
await p.evaluate(() => window.__ff.killFish('little'));
await p.waitForTimeout(50);
check('disintegrate skeleton', await p.evaluate(() => window.__ff.glLiveParity()));

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
