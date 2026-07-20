/**
 * Determinism test for record / restart / save / load. Drives UTES via the __ff
 * hooks: make moves, then Restart (Backspace / panel restart, TRoom.Restart) ->
 * must return to the exact initial posHash with an empty record and a bumped
 * attempt (pokus). Then save mid-game, make more moves, load -> must return to
 * the saved posHash. (The 1998 game has no single-move undo: Backspace = Restart.)
 * Launched with autoplay allowed so the game clock runs headless.
 */
import { chromium } from 'playwright';
const DIR = { up: 1, down: 2, left: 3, right: 4 };
const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage({ viewport: { width: 1600, height: 620 } });
const errs = [];
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
p.on('pageerror', (e) => errs.push('PE:' + e.message));
await p.addInitScript(() => { try { localStorage.setItem('ff.devEnabled', '1'); } catch {} }); // enable dev pane (room dropdown)
await p.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' });
await p.selectOption('#room', '7'); // UTES
await p.waitForFunction(() => window.__ff && window.__ff.posHash, { timeout: 5000 });
await p.evaluate(() => window.__ff.load && localStorage.removeItem('ff.save.7'));
await p.waitForTimeout(300);

async function idle() {
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });
}
async function press(w, d) {
  await p.evaluate(({ w, d }) => window.__ff.press(w, d), { w, d });
  await idle();
  await p.waitForTimeout(30);
}
const hash = () => p.evaluate(() => window.__ff.posHash());
const moves = () => p.evaluate(() => window.__ff.moves());
const pokus = () => p.evaluate(() => window.__ff.script()?.pokus ?? 0);

// --- 1) Restart returns to the exact initial state and counts a new attempt ---
const h0 = await hash();
const k0 = await pokus();
const seq = [['little', 'left'], ['little', 'left'], ['big', 'right'], ['big', 'right'], ['little', 'down']];
for (const [w, d] of seq) await press(w, DIR[d]);
const m1 = await moves();
const h1 = await hash();
console.log(`after ${seq.length} presses: moves=${m1}, changed=${h1 !== h0}`);
await p.evaluate(() => window.__ff.restart());
await idle();
await p.waitForTimeout(30);
const hEnd = await hash();
const mEnd = await moves();
const kEnd = await pokus();
console.log(`after restart: moves=${mEnd}, matches initial=${hEnd === h0}, pokus ${k0}->${kEnd}`);

// --- 2) save / more moves / load round-trip ---
for (const [w, d] of [['little', 'left'], ['big', 'right']]) await press(w, DIR[d]);
const hSave = await hash();
const mSave = await moves();
await p.evaluate(() => window.__ff.save());
for (const [w, d] of [['little', 'down'], ['little', 'left'], ['big', 'right']]) await press(w, DIR[d]);
const hAfter = await hash();
await p.evaluate(() => window.__ff.load());
// Load is a fast-forward animation (loadmode); wait for it to finish before hashing.
await p.waitForFunction(() => !window.__ff.loading(), { timeout: 5000 });
await idle();
const hLoad = await hash();
const mLoad = await moves();
console.log(`save@moves=${mSave}; moved away (changed=${hAfter !== hSave}); load restores=${hLoad === hSave} moves=${mLoad}`);

const pass =
  h1 !== h0 &&
  hEnd === h0 &&
  mEnd === 0 &&
  kEnd === k0 + 1 &&
  hLoad === hSave &&
  mLoad === mSave &&
  errs.length === 0;
console.log('errors:', errs.length ? errs : 'none');
console.log(pass ? '\nALL PASS' : '\nFAIL');
await b.close();
process.exit(pass ? 0 : 1);
