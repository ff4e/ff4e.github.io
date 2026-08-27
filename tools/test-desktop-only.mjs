/**
 * UI test: the game refuses to run on a phone, and still runs everywhere else.
 *
 * This is the only end-to-end check of the gate. The unit tests pin the rule in
 * isolation (test/deviceGate.test.ts), but only a real browser can show the refusal
 * happening BEFORE the game boots — which is the whole point, because a phone must not
 * spend a download on art it can never use.
 *
 * It is also the only check of the "Continue anyway" override end to end, and for the
 * same reason: the unit tests cover whether the override is ACTIVE, but only a browser
 * can show the button being clicked, the reload happening and the game booting on the
 * far side of it. The button is DOM the node suite has no environment for.
 *
 * Playwright's emulation is what makes it real rather than a stub: `hasTouch`/`isMobile`
 * and the emulated screen make Chromium answer the same `any-pointer` queries and report
 * the same `screen` dimensions the corresponding device would, so the page runs the rule
 * against device-shaped inputs rather than against a mock.
 *
 * Four contexts run here: phone (refused), phone that continues anyway (allowed), tablet
 * (allowed — the deliberate carve-out), desktop (allowed). A touchscreen LAPTOP is
 * deliberately absent: Chromium's `hasTouch` REPLACES the emulated pointer rather than
 * adding to it, so such a context still reports `(any-pointer: coarse)` with no fine
 * pointer — indistinguishable from a tablet — and asserting on it would only be asserting
 * on the emulator. That row is covered where it can be covered honestly, against the
 * media queries themselves, in the unit test.
 *
 * It does not use `withApp`, which boots one desktop page and hands back a fixture; this
 * probe needs several differently-emulated contexts and must tolerate a page that never
 * finishes booting.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const URL = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * Does this request fetch something the refusal is meant to save?
 *
 * Deliberately an ALLOWLIST of what a blocked page may legitimately request — the
 * document, the dev server's own module/HMR traffic, and the built bundle — with
 * everything else on the origin counted as payload. An earlier denylist of asset
 * directories missed `/cover.webp`, `/fonts/` and `/restored/`, so a leak of those would
 * have passed silently; enumerating what is allowed cannot rot the same way, because a
 * new asset directory is caught by default rather than by being remembered.
 */
function isPayload(u) {
  let p;
  try {
    p = new URL(u);
  } catch {
    return false;
  }
  if (p.origin !== new URL(URL).origin) return false; // third-party: not our art
  const path = p.pathname;
  if (path === '/' || path === '/index.html') return false; // the document itself
  if (path.startsWith('/@vite/') || path.startsWith('/@fs/') || path.startsWith('/@id/')) {
    return false; // dev-server plumbing (HMR client, fs passthrough)
  }
  if (path.startsWith('/src/') || path.startsWith('/node_modules/')) return false; // TS modules
  if (path.startsWith('/assets/')) return false; // the production bundle
  if (path === '/favicon.ico' || path === '/apple-touch-icon.png') return false;
  return true;
}

/**
 * Load the app in an emulated device and report what the gate did.
 *
 * The wait ends on ANY of the three terminal states — booted, refused, or the boot-failed
 * overlay — so it always finishes on a positive signal rather than using a timeout as its
 * answer. `#fatal` is in there because `appReady` treats it as terminal too: without it a
 * genuine boot failure would burn the full backstop and be reported as "timed out"
 * instead of "the app failed to boot".
 */
async function visit(contextOpts, opts = {}) {
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
      () =>
        window.__ff !== undefined ||
        document.documentElement.dataset.unsupported === '1' ||
        document.getElementById('fatal')?.hidden === false,
    );
    // The override, taken the way a player takes it: click the button, ride the reload
    // it performs, and wait for the SECOND load to reach a terminal state. Everything
    // reported below is then about the continued page, not the refused one.
    if (opts.continueAnyway) {
      await p.click('#unsupported-continue');
      await p.waitForFunction(
        () =>
          window.__ff !== undefined ||
          document.getElementById('fatal')?.hidden === false ||
          // Still refused after the reload: a terminal state too, and the failure this
          // case exists to catch. Without it the probe would time out instead of saying
          // what went wrong.
          (document.documentElement.dataset.unsupported === '1' &&
            location.search.includes('phone=1')),
      );
    }
    const dom = await p.evaluate(() => ({
      blocked: document.documentElement.dataset.unsupported === '1',
      booted: window.__ff !== undefined,
      fatal: document.getElementById('fatal')?.hidden === false,
      // Only meaningful when `fatal` is set: the element carries default copy from
      // index.html at all times, so reporting it unconditionally would print a boot
      // failure message next to a healthy boot.
      fatalMsg:
        document.getElementById('fatal')?.hidden === false
          ? (document.getElementById('fatal-msg')?.textContent?.trim() ?? '')
          : '',
      noticeShown: document.getElementById('unsupported')?.hasAttribute('hidden') === false,
      loadingHidden: document.getElementById('loading')?.hasAttribute('hidden') === true,
      stageVisible: (() => {
        const s = document.querySelector('.stage');
        return s !== null && getComputedStyle(s).display !== 'none';
      })(),
      // The rule's two inputs, read back from the page: proof the emulation really did
      // present the device shape this case claims to be testing.
      fine: matchMedia('(any-pointer: fine)').matches,
      coarse: matchMedia('(any-pointer: coarse)').matches,
      shortSide: Math.min(screen.width, screen.height),
      // The override's two carriers, read back: the URL parameter that got this load
      // admitted, and the stored flag that will admit the next one without it.
      search: location.search,
      stored: (() => {
        try {
          return localStorage.getItem('ff.phoneOverride');
        } catch {
          return null;
        }
      })(),
      continueShown: document.getElementById('unsupported-continue') !== null,
    }));
    return { ...dom, errs, payload: reqs.filter(isPayload) };
  } finally {
    await b.close();
  }
}

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

/** One phone, used twice: refused, then continuing anyway. Identical inputs both times. */
const PHONE = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

try {
  // ── A phone: touch-only, phone-sized. The one case that must be refused.
  const phone = await visit(PHONE);
  expect(
    !phone.fine && phone.coarse && phone.shortSide <= 430,
    `phone: emulated as a real phone would report (fine=${phone.fine} coarse=${phone.coarse} short=${phone.shortSide})`,
  );
  expect(phone.blocked, 'phone: the document is marked unsupported');
  expect(phone.noticeShown, 'phone: the refusal notice is on screen');
  expect(phone.loadingHidden, 'phone: the loading splash was dismissed, not left spinning');
  expect(!phone.stageVisible, 'phone: the game stage is not shown behind the notice');
  expect(!phone.booted, 'phone: the game never booted');
  expect(!phone.fatal, 'phone: refused cleanly, not via the boot-failure overlay');
  expect(
    phone.payload.length === 0,
    `phone: nothing but the document and the bundle was fetched (leaked: ${phone.payload.slice(0, 5).join(', ') || 'none'})`,
  );
  // A refusal is a normal outcome, not a crash: the never-settling await in main.ts
  // exists precisely so that stopping the module raises nothing.
  expect(phone.errs.length === 0, `phone: no page errors (${phone.errs.join('; ')})`);
  expect(phone.continueShown, 'phone: the refusal offers a way to continue anyway');

  // ── The same phone, taking the override. The refusal is no longer absolute: the touch
  // scheme is being built, and this is what makes it testable on real hardware. Asserted
  // as a full boot, because a button that leaves the player on the notice — or on a
  // half-started page — would be worse than no button.
  const continued = await visit(PHONE, { continueAnyway: true });
  expect(
    continued.coarse && continued.shortSide <= 430,
    `continue: still emulated as a phone (coarse=${continued.coarse} short=${continued.shortSide})`,
  );
  expect(!continued.blocked, 'continue: the document is no longer marked unsupported');
  expect(!continued.noticeShown, 'continue: the refusal notice is gone');
  expect(
    continued.booted && !continued.fatal,
    `continue: the game booted on a phone (fatal: ${continued.fatalMsg})`,
  );
  expect(continued.stageVisible, 'continue: the stage is visible');
  expect(
    continued.search.includes('phone=1'),
    `continue: the reload carries the override in the URL (${continued.search})`,
  );
  expect(
    continued.stored === '1',
    `continue: the choice is remembered for the next visit (${continued.stored})`,
  );
  expect(continued.errs.length === 0, `continue: no page errors (${continued.errs.join('; ')})`);

  // ── A tablet: touch-only exactly like the phone, but big enough. This is the
  // deliberate carve-out, so it is asserted as ALLOWED — if the size signal were ever
  // dropped, the pointer signal alone would refuse this and the case would fail.
  const tablet = await visit({
    viewport: { width: 820, height: 1180 },
    screen: { width: 820, height: 1180 },
    hasTouch: true,
    isMobile: true,
  });
  expect(
    !tablet.fine && tablet.coarse,
    `tablet: touch-only, exactly like the phone (fine=${tablet.fine} coarse=${tablet.coarse})`,
  );
  expect(tablet.shortSide > 600, `tablet: reports a tablet-sized screen (${tablet.shortSide})`);
  expect(!tablet.blocked, 'tablet: allowed — size is what separates it from the phone');
  expect(tablet.booted && !tablet.fatal, `tablet: the game booted (fatal: ${tablet.fatalMsg})`);

  // ── A desktop: the gate must not cost anyone their game.
  const desktop = await visit({ viewport: { width: 1200, height: 640 } });
  expect(desktop.fine, `desktop: reports a fine pointer (${desktop.fine})`);
  expect(!desktop.blocked, 'desktop: not marked unsupported');
  expect(desktop.booted && !desktop.fatal, `desktop: the game booted (fatal: ${desktop.fatalMsg})`);
  expect(desktop.stageVisible, 'desktop: the stage is visible');
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
