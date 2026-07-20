/**
 * Briefcase cutscene on WebGL: covers the new GPU indexed-present path and its
 * live controls. Three concerns:
 *   - GAP 2 parity: the cutscene's offscreen FBO (GlScreen.renderIndexed, NEAREST
 *     index → palette LUT) is byte-exact vs a CPU IndexedScreen.toRgba. The LINEAR
 *     present upscale is cosmetic and not part of this comparison.
 *   - GAP 4 layout: #screen, #screen-gl and #subs share one CSS box; #screen-gl is
 *     shown only for the enhanced+webgl (GPU-present) path and hidden for the 2D
 *     fallback (cpu renderer or classic art).
 *   - GAP 3 toggles: R/E/F work live during the cutscene; Escape still skips.
 *
 * Runs its own headless Chromium with ANGLE; skips (pass) without WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';
const KUFRIK = 2; // the briefcase room — its demo is the only cutscene

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1600, height: 1000 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); localStorage.setItem('ff.devEnabled', '1'); } catch {} }); // dev pane on: arms the r/e/f hotkeys this probe presses
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);

await p.evaluate((n) => window.__ff.enterRoomAwait(n), KUFRIK);
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 5, { timeout: 8000 });
await p.evaluate(() => window.__ff.setGraphics('enhanced'));
await p.evaluate(() => window.__ff.setRenderer('webgl'));
await p.waitForTimeout(200);

await p.evaluate(() => window.__ff.startCutscene());
await p.waitForFunction(() => window.__ff.cutsceneActive(), { timeout: 8000 });
await p.waitForTimeout(400); // let a couple of demo frames play

// Capability gate: if WebGL2 is unavailable the parity probe reports {webgl:false}.
const first = await p.evaluate(() => window.__ff.glCutsceneParity());
if (!first || first.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;
const fail = (msg) => { ok = false; console.log(`  FAIL ${msg}`); };

// --- GAP 2: byte-exact cutscene FBO ----------------------------------------
if (first.dimMismatch) fail(`cutscene FBO dim mismatch: ${JSON.stringify(first)}`);
else if (first.max !== 0) fail(`cutscene FBO not byte-exact: max=${first.max} overPct=${first.overPct.toFixed(3)}%`);
else console.log(`  OK   cutscene FBO byte-exact (${first.w}x${first.h})`);

// --- GAP 4: layout invariants ----------------------------------------------
const rects = () => p.evaluate(() => {
  const q = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const disp = (id) => getComputedStyle(document.getElementById(id)).display;
  return { screen: q('screen'), gl: q('screen-gl'), subs: q('subs'), glDisp: disp('screen-gl') };
});
const same = (a, b2) => a.x === b2.x && a.y === b2.y && a.w === b2.w && a.h === b2.h;

let r = await rects();
if (r.glDisp !== 'block') fail(`enhanced+webgl cutscene: #screen-gl display=${r.glDisp} (expected block)`);
else if (!same(r.screen, r.gl) || !same(r.screen, r.subs)) fail(`canvases don't share a box: ${JSON.stringify(r)}`);
else console.log(`  OK   #screen/#screen-gl/#subs share one box, GL shown (${r.gl.w}x${r.gl.h})`);

// --- GAP 3: live toggles ----------------------------------------------------
// R -> cpu: the cutscene must switch to the 2D fallback (GL canvas hidden).
await p.keyboard.press('r');
await p.waitForTimeout(150);
if ((await p.evaluate(() => window.__ff.renderer())) !== 'cpu') fail('R did not switch renderer to cpu during cutscene');
else if (!(await p.evaluate(() => window.__ff.cutsceneActive()))) fail('cutscene ended after pressing R');
else {
  r = await rects();
  if (r.glDisp !== 'none') fail(`cpu cutscene: #screen-gl display=${r.glDisp} (expected none)`);
  else if (!same(r.screen, r.subs)) fail('cpu cutscene: #screen/#subs box drift');
  else console.log('  OK   R -> cpu: 2D fallback, #screen-gl hidden, still playing');
}
await p.keyboard.press('r'); // back to webgl
await p.waitForTimeout(150);

// E -> classic: smooth GPU path needs enhanced, so classic also uses the 2D
// fallback (GL canvas hidden) even in webgl mode.
await p.keyboard.press('e');
await p.waitForTimeout(150);
if ((await p.evaluate(() => window.__ff.graphics())) !== 'classic') fail('E did not switch graphics to classic during cutscene');
else {
  r = await rects();
  if (r.glDisp !== 'none') fail(`classic+webgl cutscene: #screen-gl display=${r.glDisp} (expected none — 2D fallback)`);
  else console.log('  OK   E -> classic: baked-font 2D fallback, #screen-gl hidden');
}
await p.keyboard.press('e'); // back to enhanced
await p.waitForTimeout(150);
r = await rects();
if (r.glDisp !== 'block') fail(`back to enhanced: #screen-gl display=${r.glDisp} (expected block)`);
else console.log('  OK   E -> enhanced: GPU present restored');

// F -> font cycles.
const f0 = await p.evaluate(() => window.__ff.subFont().idx);
await p.keyboard.press('f');
await p.waitForTimeout(100);
const f1 = await p.evaluate(() => window.__ff.subFont().idx);
if (f1 === f0) fail(`F did not cycle the font during cutscene (stayed ${f0})`);
else console.log(`  OK   F -> font cycled (${f0} -> ${f1})`);

// Escape still skips.
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
if (await p.evaluate(() => window.__ff.cutsceneActive())) fail('Escape did not skip the cutscene');
else console.log('  OK   Escape skipped the cutscene');

// After skipping, the room resumes cleanly: no stuck cutscene-sized box; the GL
// canvas (webgl room) still shares #screen's box.
await p.waitForTimeout(200);
r = await rects();
if (!same(r.screen, r.gl)) fail(`after skip: #screen/#screen-gl box drift: ${JSON.stringify(r)}`);
else console.log('  OK   room resumed cleanly after skip');

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
