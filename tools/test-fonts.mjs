/**
 * Bundled subtitle fonts (GAP 5): the OFL fonts must load, the default must be
 * Mulish Medium, the choice must persist by NAME, and a stale/unknown saved name
 * must fall back to index 0 (never leave the game with no valid font). Cycling must
 * wrap and persist. Uses real FontFace loading so it can't run under vitest.
 *
 * Not WebGL-dependent, but lives here (tools/test-*.mjs) because it needs a real
 * browser document + document.fonts.
 */
import { chromium } from 'playwright';

const PORT = process.env.FF_UI_PORT ?? '5173';

const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let ok = true;
const fail = (msg) => { ok = false; console.log(`  FAIL ${msg}`); };

async function freshPage(subfont) {
  const p = await b.newPage({ viewport: { width: 900, height: 640 } });
  p.on('pageerror', (e) => fail('PE:' + e.message));
  await p.addInitScript((sf) => {
    try {
      const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
      o.introSeen = true;
      localStorage.setItem('ff.options', JSON.stringify(o));
      if (sf === null) localStorage.removeItem('ff.subfont');
      else localStorage.setItem('ff.subfont', sf);
    } catch {}
  }, subfont ?? null);
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ff && window.__ff.count);
  // Fonts load asynchronously at startup; wait for subFontReady.
  await p.waitForFunction(() => window.__ff.subFontReady && window.__ff.subFontReady(), { timeout: 8000 }).catch(() => {});
  return p;
}

// 1. Default (no saved value): Mulish Medium, index 0, fonts actually loaded.
{
  const p = await freshPage(null);
  const sf = await p.evaluate(() => window.__ff.subFont());
  if (sf.idx !== 0 || sf.name !== 'Mulish Medium') fail(`default font = ${JSON.stringify(sf)} (expected idx 0 Mulish Medium)`);
  else console.log('  OK   default is Mulish Medium (idx 0)');
  const ready = await p.evaluate(() => window.__ff.subFontReady());
  const loaded = await p.evaluate(() => document.fonts.check('16px Mulish'));
  if (!ready) fail('subFontReady is false (no bundled font loaded)');
  else if (!loaded) fail('document.fonts.check("16px Mulish") is false (Mulish did not load)');
  else console.log('  OK   subFontReady=true and Mulish is loaded');
  await p.close();
}

// 2. Persistence by name: a saved candidate name resolves to its index.
{
  const p = await freshPage('Manrope Medium');
  const sf = await p.evaluate(() => window.__ff.subFont());
  if (sf.idx !== 1 || sf.name !== 'Manrope Medium') fail(`persisted font = ${JSON.stringify(sf)} (expected idx 1 Manrope Medium)`);
  else console.log('  OK   saved name "Manrope Medium" -> idx 1');
  await p.close();
}

// 3. Stale/unknown saved name falls back to index 0 (the important robustness case).
{
  const p = await freshPage('NoSuchFontXYZ');
  const sf = await p.evaluate(() => window.__ff.subFont());
  if (sf.idx !== 0) fail(`stale saved name -> idx ${sf.idx} (expected 0 fallback)`);
  else console.log('  OK   stale saved name falls back to idx 0');
  await p.close();
}

// 4. Cycling wraps back to 0 and persists the new choice.
{
  const p = await freshPage(null);
  const n = await p.evaluate(() => window.__ff.subFontList().length);
  await p.evaluate(() => window.__ff.cycleSubFont(true)); // 0 -> 1
  const afterOne = await p.evaluate(() => ({ idx: window.__ff.subFont().idx, saved: localStorage.getItem('ff.subfont') }));
  if (afterOne.idx !== 1) fail(`cycle once -> idx ${afterOne.idx} (expected 1)`);
  else if (afterOne.saved !== 'Manrope Medium') fail(`cycle did not persist by name (ff.subfont=${afterOne.saved})`);
  else console.log('  OK   cycle advances and persists by name');
  for (let i = 1; i < n; i++) await p.evaluate(() => window.__ff.cycleSubFont(true)); // wrap back to 0
  const wrapped = await p.evaluate(() => window.__ff.subFont().idx);
  if (wrapped !== 0) fail(`cycling ${n} times did not wrap to 0 (idx ${wrapped})`);
  else console.log(`  OK   cycling ${n} candidates wraps back to idx 0`);
  await p.close();
}

console.log(ok ? 'PASS' : 'FAIL');
await b.close();
process.exit(ok ? 0 : 1);
