/**
 * P3 WebGL robustness regressions (playtest bugs, 2026-07-09):
 *   1. Starting DIRECTLY in WebGL mode (persisted ff.renderer=webgl) must keep
 *      the layout intact — #screen sized as the flow anchor, so the control
 *      #panel stays visible to the right and #info sits below the stage (not
 *      crossing the frame). The bug: #screen was only sized on the CPU path, so
 *      a fresh WebGL boot left it 300×150 and the GL overlay swamped the panel.
 *   2. A WebGL context loss must auto-fall back to the CPU compositor (no white
 *      canvas). Context loss fires an event and makes GL calls silently no-op —
 *      it does NOT throw — so the per-frame try/catch never caught it; a
 *      webglcontextlost listener now disables the GPU backend for the session.
 *
 * Runs its own headless Chromium with ANGLE; skips (pass) without WebGL2.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';

const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1500, height: 900 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
// Boot straight into WebGL — the exact state that broke the layout.
await p.addInitScript(() => {
  try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {}
  localStorage.setItem('ff.renderer', 'webgl');
  localStorage.setItem('ff.graphics', 'classic');
  // Enable the dev pane so the tuning chrome (controls + #info) is visible for the
  // layout assertions below (panel to the right, #info below the stage) — the chrome
  // is display:none for players until Ctrl+Alt+D.
  localStorage.setItem('ff.devEnabled', '1');
});
await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate(() => window.__ff.enterRoomAwait(6)); // KOSTE (a large room)
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 25, { timeout: 8000 });
await p.waitForTimeout(150);

if (!(await p.evaluate(() => window.__ff.glActive()))) {
  console.log('  SKIP: WebGL2 not active in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;

// --- Check 1: layout intact on a fresh WebGL boot ---
const layout = await p.evaluate(() => {
  const gl = document.getElementById('screen-gl').getBoundingClientRect();
  const panel = document.getElementById('panel');
  const pr = panel && panel.getBoundingClientRect();
  const info = document.getElementById('info').getBoundingClientRect();
  const stage = document.querySelector('.stage').getBoundingClientRect();
  return {
    panelVisible: !!pr && pr.width > 10 && pr.height > 10,
    panelRightOfGl: !!pr && pr.left >= gl.right - 4, // no overlap with the game
    infoBelowStage: info.top >= stage.bottom - 4,     // HUD not crossing the frame
    glTall: gl.height > 200,                          // GL canvas actually sized
  };
});
if (!layout.panelVisible) { ok = false; console.log('  FAIL: control panel not visible in WebGL mode'); }
if (!layout.panelRightOfGl) { ok = false; console.log('  FAIL: panel overlapped by the GL canvas'); }
if (!layout.infoBelowStage) { ok = false; console.log('  FAIL: #info crosses the game frame'); }
if (!layout.glTall) { ok = false; console.log('  FAIL: GL canvas collapsed (anchor not sized)'); }

// --- Check 2: ESC to the map must hide the WebGL room overlay ---
// (playtest bug: room stayed visible over the menu because #screen-gl kept
//  showing the last GPU frame on top of the 2D map.)
await p.keyboard.press('Escape');
await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 4000 }).catch(() => {});
await p.waitForTimeout(120);
const onMap = await p.evaluate(() => ({
  screen: window.__ff.screen(),
  glHidden: document.getElementById('screen-gl').style.display === 'none',
  glActive: window.__ff.glActive(),
}));
if (onMap.screen !== 'map') { ok = false; console.log(`  FAIL: ESC did not reach the map (screen=${onMap.screen})`); }
if (!onMap.glHidden) { ok = false; console.log('  FAIL: #screen-gl still visible on the map (room shows over the menu)'); }
if (onMap.glActive) { ok = false; console.log('  FAIL: glActive true on the map'); }
// Re-enter a room so the GL overlay is active again for the context-loss check.
await p.evaluate(() => window.__ff.enterRoomAwait(6));
await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 25, { timeout: 8000 });
await p.waitForTimeout(120);
if (!(await p.evaluate(() => window.__ff.glActive()))) { ok = false; console.log('  FAIL: WebGL not active after re-entering the room'); }

// --- Check 3: context loss auto-falls back to CPU (no white screen) ---
await p.evaluate(() => {
  const gl = document.getElementById('screen-gl').getContext('webgl2');
  const ext = gl && gl.getExtension('WEBGL_lose_context');
  if (ext) ext.loseContext();
});
// Wait for the fallback to actually take effect: the CPU draw branch hides
// #screen-gl and repaints #screen. glActive() flips false immediately when the
// contextlost handler sets glFailed, so wait for the *rendered* result (the GL
// canvas hidden by draw()'s CPU branch), which guarantees a CPU frame ran.
await p.waitForFunction(() => document.getElementById('screen-gl').style.display === 'none', null, { timeout: 4000 }).catch(() => {});
const after = await p.evaluate(() => {
  const c = document.getElementById('screen');
  const g = c.getContext('2d');
  const d = g.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return {
    glActive: window.__ff.glActive(),
    glHidden: document.getElementById('screen-gl').style.display === 'none',
    px: [...d],
  };
});
if (after.glActive) { ok = false; console.log('  FAIL: still glActive after context loss (no fallback)'); }
if (!after.glHidden) { ok = false; console.log('  FAIL: GL canvas still shown after context loss'); }
const [r, g, bl, a] = after.px;
const blank = a !== 255 || (r === 255 && g === 255 && bl === 255) || (r === 0 && g === 0 && bl === 0);
if (blank) { ok = false; console.log(`  FAIL: CPU canvas blank/white after fallback (px=${after.px})`); }

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(`  layout-on-webgl-boot + context-loss fallback: ${ok ? 'OK' : 'see failures'}`);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
