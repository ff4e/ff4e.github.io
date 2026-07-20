/**
 * Browser screenshot helper for visual verification of the running host.
 *   node tools/screenshot.mjs <roomNum> <which:dir,which:dir,...> <outPrefix>
 * dir = up|down|left|right ; which = little|big. Drives the host via its
 * __ff debug hook (deterministic, focus-independent) and captures
 * <prefix>-before.png, <prefix>-death.png (if crushed), <prefix>-after.png.
 */
import { chromium } from 'playwright';
const DIR = { up: 1, down: 2, left: 3, right: 4 };
const [, , roomNum = '7', movesArg = '', prefix = 'out/shot'] = process.argv;
const moves = movesArg ? movesArg.split(',').map((m) => { const [w, d] = m.split(':'); return { w, d: DIR[d] }; }) : [];
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1600, height: 620 } });
const errs = []; p.on('console', (m) => m.type() === 'error' && errs.push(m.text())); p.on('pageerror', (e) => errs.push('PE:' + e.message));
await p.addInitScript(() => { try { localStorage.setItem('ff.devEnabled', '1'); } catch {} }); // enable dev pane (room dropdown)
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.selectOption('#room', String(roomNum));
await p.waitForFunction(() => window.__ff && window.__ff.state() && !window.__ff.state().anim, { timeout: 5000 });
const canvas = p.locator('canvas');
await canvas.screenshot({ path: `${prefix}-before.png` });
let died = false;
for (const mv of moves) {
  await p.evaluate(({ w, d }) => window.__ff.press(w, d), mv);
  // wait for the move+settle to resolve (anim ends)
  await p.waitForFunction(() => !window.__ff.state().anim, { timeout: 5000 });
  await p.waitForTimeout(120);
  if ((await p.evaluate(() => window.__ff.state().dead)) && !died) {
    died = true;
    await canvas.screenshot({ path: `${prefix}-death.png` });
  }
}
await p.waitForTimeout(200);
if (!died) await canvas.screenshot({ path: `${prefix}-after.png` });
console.log(`room ${roomNum} moves[${moves.map((m) => m.w + ':' + m.d).join(' ')}] died=${died}`);
console.log('final state:', JSON.stringify(await p.evaluate(() => window.__ff.state())));
console.log('errors:', errs.length ? errs : 'none');
await b.close();
