/**
 * Regression test for the WebGL mouse-input bug: the stacked #screen-gl present
 * canvas must NOT intercept pointer events, or clicking a fish does nothing in
 * WebGL mode (the mouse listeners live on #screen underneath). This asserts both
 * the layering (elementFromPoint over the stage returns #screen, not #screen-gl)
 * and the behaviour (a real click selects a fish while renderer=webgl).
 *
 * Runs its own headless Chromium with ANGLE; skips (pass) without WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const ROOM = 6; // KOSTE — two fish, normal room
const FSIZE = 15; // native cell size (render/renderRoom.ts)

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1200, height: 720 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate((n) => window.__ff.enterRoomAwait(n), ROOM);
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 20, { timeout: 8000 });

await p.evaluate(() => window.__ff.setRenderer('webgl'));
await p.waitForTimeout(300);
if (!(await p.evaluate(() => window.__ff.glActive()))) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;

// 1. Layering: the element under a point over the stage must be #screen (the input
//    surface), never #screen-gl (display-only, pointer-events:none).
const layer = await p.evaluate(() => {
  const cv = document.getElementById('screen');
  const r = cv.getBoundingClientRect();
  const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  const gl = document.getElementById('screen-gl');
  return { topId: el?.id ?? el?.tagName, glDisplay: getComputedStyle(gl).display, glPE: getComputedStyle(gl).pointerEvents };
});
if (layer.glDisplay !== 'block') { ok = false; console.log(`  FAIL: #screen-gl not displayed in webgl mode (${layer.glDisplay})`); }
if (layer.glPE !== 'none') { ok = false; console.log(`  FAIL: #screen-gl pointer-events=${layer.glPE} (expected none)`); }
if (layer.topId !== 'screen') { ok = false; console.log(`  FAIL: elementFromPoint over stage = ${layer.topId} (expected screen)`); }
else console.log(`  OK   stage pointer target is #screen (gl display=block, pointer-events=none)`);

// 2. Behaviour: a REAL click (hit-tested, not dispatchEvent) on the inactive fish's
//    cell must select it — proving the click reached the game through #screen.
const other = await p.evaluate(() => (window.__ff.state().active === 'little' ? 'big' : 'little'));
const target = await p.evaluate((which) => {
  const c = window.__ff.fishCell(which);
  if (!c) return null;
  const cv = document.getElementById('screen');
  const r = cv.getBoundingClientRect();
  return { c, left: r.left, top: r.top, rw: r.width, rh: r.height, cw: cv.width, ch: cv.height };
}, other);
if (!target) { ok = false; console.log('  FAIL: could not locate the inactive fish cell'); }
else {
  const nx = (target.c.x + 0.5) * FSIZE;
  const ny = (target.c.y + 0.5) * FSIZE;
  const cx = target.left + nx * (target.rw / target.cw);
  const cy = target.top + ny * (target.rh / target.ch);
  await p.mouse.click(cx, cy);
  await p.waitForTimeout(150);
  const active = await p.evaluate(() => window.__ff.state().active);
  if (active !== other) { ok = false; console.log(`  FAIL: click on ${other} fish did not select it (active=${active})`); }
  else console.log(`  OK   real click selected the ${other} fish in webgl mode`);
}

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
