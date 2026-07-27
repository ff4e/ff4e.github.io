/**
 * Present-filter guard (GAP 7): the room byte-exact parity suite reads the offscreen
 * FBO via readback(), so it CANNOT catch a LINEAR-filter leak from the cutscene's
 * smooth present into a subsequent crisp room present. This drives GlScreen's
 * present() directly (via __ff.glPresentFilterProbe): render a 2px black→white step,
 * upscale-present it to 16px three times reading the CANVAS back each time —
 *   crisp (NEAREST, no interpolated greys) -> smooth (LINEAR, greys) -> crisp again.
 * The final crisp pass proves the smooth present did not leave the filter LINEAR.
 *
 * Runs its own headless Chromium with ANGLE; skips (pass) without WebGL2.
 */
import { gotoApp, launchBrowser, waitRoom } from './ui-lib.mjs';


const b = await launchBrowser({ gl: true });
const p = await b.newPage({ viewport: { width: 1000, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => { try { const o = JSON.parse(localStorage.getItem('ff.options') || '{}'); o.introSeen = true; localStorage.setItem('ff.options', JSON.stringify(o)); } catch {} });
await gotoApp(p);
await p.waitForFunction(() => window.__ff && window.__ff.count);
await p.evaluate(() => window.__ff.enterRoomAwait(6));
await waitRoom(p, 10);

const res = await p.evaluate(() => window.__ff.glPresentFilterProbe());
if (!res || res.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  process.exit(0);
}

let ok = true;
// A crisp NEAREST upscale of a 2-colour step has NO intermediate greys; a LINEAR
// upscale interpolates across the boundary, producing several.
if (res.crisp1 !== 0) { ok = false; console.log(`  FAIL: first crisp present had ${res.crisp1} interpolated pixels (expected NEAREST/0)`); }
else console.log('  OK   crisp present (smooth=false) is NEAREST — no interpolation');
if (res.smooth <= 0) { ok = false; console.log(`  FAIL: smooth present had ${res.smooth} interpolated pixels (expected LINEAR/>0)`); }
else console.log(`  OK   smooth present (smooth=true) is LINEAR — ${res.smooth} interpolated pixels`);
if (res.crisp2 !== 0) { ok = false; console.log(`  FAIL: crisp present AFTER a smooth present had ${res.crisp2} interpolated pixels — LINEAR filter leaked`); }
else console.log('  OK   crisp present after smooth is NEAREST again — no filter leak');

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
