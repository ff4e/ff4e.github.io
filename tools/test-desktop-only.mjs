/**
 * UI test: the game refuses to run on a phone or a tablet, and still runs everywhere else.
 *
 * This is the only end-to-end check of the gate. The unit tests cover the rule in
 * isolation (test/deviceGate.test.ts), but only a real browser can show the refusal
 * happening BEFORE the game boots — which is the whole point, because a phone must not
 * spend a download on art it can never use.
 *
 * Playwright's emulation is what makes it real rather than a stub: `hasTouch`/`isMobile`
 * make Chromium answer the `any-pointer` media queries exactly as the corresponding
 * device would, so the page runs the same rule a real phone runs.
 *
 * It does not use `withApp`, which boots one desktop page and hands back a fixture; this
 * probe needs four differently-emulated contexts and must tolerate a page that never
 * finishes booting.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const URL = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;
/**
 * Art the refusal is meant to save: rooms, panel, upscales, voices.
 *
 * `/src/` is excluded because the dev server serves the TypeScript modules from
 * `src/data/…`, which the bare directory names match too — counting those would report
 * a working gate as leaking nine assets.
 */
const ART = (u) => !u.includes('/src/') && /\/(data|enhanced|enhanced-ai|sound)\//.test(u);

/**
 * Load the app in an emulated device and report what the gate did.
 *
 * The wait is for EITHER outcome — booted, or refused — so it always ends on a positive
 * signal and never uses a timeout as its answer. Waiting only for `window.__ff` and
 * reading a timeout as "blocked" would have been a wait whose expiry is the assertion:
 * every real regression (a gate that hangs, a boot that stalls) would report as a pass.
 */
async function visit(contextOpts) {
  const b = await chromium.launch();
  const ctx = await b.newContext(contextOpts);
  const p = await ctx.newPage();
  const reqs = [];
  const errs = [];
  p.on('request', (r) => reqs.push(r.url()));
  p.on('pageerror', (e) => errs.push(e.message));
  try {
    p.setDefaultTimeout(WAIT_BACKSTOP);
    await p.goto(URL, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(
      () => window.__ff !== undefined || document.documentElement.dataset.unsupported === '1',
    );
    const booted = await p.evaluate(() => window.__ff !== undefined);
    const dom = await p.evaluate(() => ({
      blocked: document.documentElement.dataset.unsupported === '1',
      noticeShown: document.getElementById('unsupported')?.hasAttribute('hidden') === false,
      loadingHidden: document.getElementById('loading')?.hasAttribute('hidden') === true,
      stageVisible: (() => {
        const s = document.querySelector('.stage');
        return s !== null && getComputedStyle(s).display !== 'none';
      })(),
    }));
    return { ...dom, booted, errs, art: reqs.filter(ART).length };
  } finally {
    await b.close();
  }
}

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

try {
  // ── A phone: touch, no mouse.
  const phone = await visit({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  expect(phone.blocked, 'phone: the document is marked unsupported');
  expect(phone.noticeShown, 'phone: the refusal notice is on screen');
  expect(phone.loadingHidden, 'phone: the loading splash was dismissed, not left spinning');
  expect(!phone.stageVisible, 'phone: the game stage is not shown behind the notice');
  expect(!phone.booted, 'phone: the game never booted');
  expect(phone.art === 0, `phone: no game art was fetched (saw ${phone.art} asset requests)`);
  // A refusal is a normal outcome, not a crash: the never-settling await in main.ts
  // exists precisely so that stopping the module raises nothing.
  expect(phone.errs.length === 0, `phone: no page errors (${phone.errs.join('; ')})`);

  // ── A tablet: same shape, desktop-sized. Viewport must not be what decides it.
  const tablet = await visit({
    viewport: { width: 1024, height: 1366 },
    hasTouch: true,
    isMobile: true,
  });
  expect(tablet.blocked, 'tablet: blocked despite a desktop-sized viewport');
  expect(!tablet.booted, 'tablet: the game never booted');
  expect(tablet.art === 0, `tablet: no game art was fetched (saw ${tablet.art})`);

  // ── A desktop: the gate must not cost anyone their game.
  const desktop = await visit({ viewport: { width: 1200, height: 640 } });
  expect(!desktop.blocked, 'desktop: not marked unsupported');
  expect(desktop.booted, 'desktop: the game booted normally');
  expect(desktop.stageVisible, 'desktop: the stage is visible');

  // The touchscreen laptop — touch AND a mouse, the case a user-agent check gets wrong —
  // is NOT checked here, deliberately. Chromium's `hasTouch` REPLACES the emulated
  // pointer rather than adding to it: a context with `hasTouch: true` and no mobile flag
  // still reports `(any-pointer: coarse)` and no fine pointer, i.e. a tablet. Asserting
  // on it would only be asserting on the emulator. That row is covered where it can be
  // covered honestly, against the media queries themselves, in test/deviceGate.test.ts.
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
