/**
 * UI test: a phone boots the game like everyone else.
 *
 * This probe is the inverse of the one it replaces. `test-desktop-only.mjs` asserted that
 * a phone was REFUSED before any art was fetched, back when the port had only the
 * original's keyboard and mouse schemes. The touch scheme exists now, the refusal is gone
 * (Martin's decision, 2026-08-28), and what needs watching is the opposite invariant: a
 * phone-shaped context reaches a booted game, with no notice, no override and nothing
 * left in the page that could ever put a phone back behind a wall.
 *
 * Worth a browser rather than a unit test, and for the same reason the refusal was: the
 * rule is read from `matchMedia` and `screen` in a real page, and the failure this is
 * insuring against — something reintroduced at BOOT time that stops a phone — cannot be
 * seen anywhere else. `test/deviceGate.test.ts` pins the classification itself in node.
 *
 * Playwright's emulation is what makes it real rather than a stub: `hasTouch`/`isMobile`
 * and the emulated screen make Chromium answer the same `any-pointer` queries and report
 * the same `screen` dimensions the corresponding device would, so the page runs against
 * device-shaped inputs rather than against a mock.
 *
 * Three contexts run here: phone, tablet and desktop — every class `deviceClass` can
 * return, all of them expected to boot. A touchscreen LAPTOP is deliberately absent:
 * Chromium's `hasTouch` REPLACES the emulated pointer rather than adding to it, so such a
 * context still reports `(any-pointer: coarse)` with no fine pointer — indistinguishable
 * from a tablet — and asserting on it would only be asserting on the emulator. That row
 * is covered where it can be covered honestly, against the media queries themselves, in
 * the unit test.
 *
 * It does not use `withApp`, which boots one desktop page and hands back a fixture; this
 * probe needs several differently-emulated contexts.
 */
import { chromium } from 'playwright';
import { exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const URL = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * Load the app in an emulated device and report how far it got.
 *
 * The wait ends on either terminal state — booted, or the boot-failed overlay — so it
 * always finishes on a positive signal rather than using a timeout as its answer.
 * `#fatal` is in there because `appReady` treats it as terminal too: without it a genuine
 * boot failure would burn the full backstop and be reported as "timed out" instead of
 * "the app failed to boot".
 */
async function visit(contextOpts) {
  const b = await chromium.launch();
  const ctx = await b.newContext(contextOpts);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  let releaseScripts;
  const scriptsReady = new Promise((resolve) => { releaseScripts = resolve; });
  try {
    p.setDefaultTimeout(WAIT_BACKSTOP);
    await p.route('**/*', async (route) => {
      if (route.request().resourceType() === 'script') await scriptsReady;
      await route.continue();
    });
    await p.goto(URL, { waitUntil: 'commit' });
    await p.locator('#loading .spinner').waitFor({ state: 'visible' });
    const startup = await p.evaluate(() => {
      const loading = document.getElementById('loading');
      const spinner = loading.querySelector('.spinner');
      const rect = spinner.getBoundingClientRect();
      return {
        text: loading.innerText.trim(),
        visibleChildren: [...loading.children].filter((el) => el.getClientRects().length > 0).length,
        spinning: getComputedStyle(spinner).animationName === 'spin',
        centered: Math.abs(rect.x + rect.width / 2 - innerWidth / 2) <= 1 &&
          Math.abs(rect.y + rect.height / 2 - innerHeight / 2) <= 1,
        accessible: loading.getAttribute('role') === 'status' && loading.getAttribute('aria-label') === 'Loading',
      };
    });
    releaseScripts();
    await p.waitForFunction(
      () => window.__ff !== undefined || document.getElementById('fatal')?.hidden === false,
    );
    const dom = await p.evaluate(() => ({
      booted: window.__ff !== undefined,
      fatal: document.getElementById('fatal')?.hidden === false,
      // Only meaningful when `fatal` is set: the element carries default copy from
      // index.html at all times, so reporting it unconditionally would print a boot
      // failure message next to a healthy boot.
      fatalMsg:
        document.getElementById('fatal')?.hidden === false
          ? (document.getElementById('fatal-msg')?.textContent?.trim() ?? '')
          : '',
      loadingHidden: document.getElementById('loading')?.hasAttribute('hidden') === true,
      stageVisible: (() => {
        const s = document.querySelector('.stage');
        return s !== null && getComputedStyle(s).display !== 'none';
      })(),
      // The two removed walls, checked as ABSENT MARKUP rather than as "not shown": a
      // hidden overlay left in the page is one line of code away from being shown again,
      // and this probe is the only thing watching for that.
      noticeEl: document.getElementById('unsupported') !== null,
      rotateEl: document.getElementById('rotate') !== null,
      // Their document flags, for the same reason — the stylesheet used to hide the whole
      // stage off `data-unsupported`, so a stray write would be invisible except here.
      blocked: document.documentElement.dataset.unsupported === '1',
      rotateFlag: document.documentElement.dataset.rotate ?? '',
      // The rule's two inputs, read back from the page: proof the emulation really did
      // present the device shape this case claims to be testing.
      fine: matchMedia('(any-pointer: fine)').matches,
      coarse: matchMedia('(any-pointer: coarse)').matches,
      shortSide: Math.min(screen.width, screen.height),
      // Touch mode is what replaced the refusal, so a phone that boots WITHOUT it would
      // be the worst outcome of all: admitted, and then handed 9px sliders. Read from
      // the document flag `touchMode.ts` writes, the way the touch probes read it.
      touch: document.documentElement.hasAttribute('data-touch'),
      phone: document.documentElement.hasAttribute('data-phone'),
      startText: document.getElementById('intro-start').textContent,
    }));
    let skipText = null;
    let skippedToMap = false;
    if (dom.booted) {
      const activate = async (selector) => {
        if (contextOpts.hasTouch) await p.locator(selector).tap();
        else await p.locator(selector).click();
      };
      await activate('#intro-start');
      await p.locator('#intro-hint').waitFor({ state: 'visible' });
      skipText = await p.locator('#intro-hint').innerText();
      for (let movie = 0; movie < 2; movie++) {
        await p.waitForFunction(() => {
          const video = document.getElementById('intro-video');
          return !video.paused && video.currentTime > 0;
        });
        await activate('#intro-video');
      }
      await p.waitForFunction(() => window.__ff.screen() === 'map');
      skippedToMap = await p.evaluate(() => window.__ff.introSeen() && !window.__ff.introPlaying());
    }
    let undoUnchanged = null;
    if (dom.booted && !dom.phone) {
      // Keep the first-run boot checks above; use a playable session for this negative control.
      await p.evaluate(() => localStorage.setItem('ff.options', JSON.stringify({ introSeen: true })));
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__ff);
      await p.evaluate(async () => {
        window.__ff.setGraphics('classic');
        await window.__ff.enterRoomAwait(5);
      });
      await p.waitForFunction(() => window.__ff.roomNum() === 5 && !window.__ff.roomLoading() &&
        !window.__ff.roomAudioPending() && !window.__ff.roomPreloadPending() &&
        window.__ff.roomAudioReady() && window.__ff.phase() === 'idle');
      const moves = await p.evaluate(() => {
        const n = window.__ff.moves();
        window.__ff.press('big', window.__ff.state().big.facingRight ? 3 : 4);
        return n;
      });
      await p.waitForFunction((n) => window.__ff.moves() === n + 1 && window.__ff.phase() === 'idle', moves);
      undoUnchanged = await p.evaluate(() => window.__ff.state().active === 'big' &&
        window.__ff.undo() && window.__ff.state().active === 'little');
    }
    return { ...dom, startup, skipText, skippedToMap, errs, undoUnchanged };
  } finally {
    releaseScripts();
    await b.close();
  }
}

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

/** An iPhone 15-ish: touch-only, phone-sized, and held the "wrong" way round. */
const PHONE = {
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
};

try {
  // ── A phone. The case this probe exists for: it used to be the one refused device.
  const phone = await visit(PHONE);
  expect(
    !phone.fine && phone.coarse && phone.shortSide <= 430,
    `phone: emulated as a real phone would report (fine=${phone.fine} coarse=${phone.coarse} short=${phone.shortSide})`,
  );
  expect(phone.booted && !phone.fatal, `phone: the game booted (fatal: ${phone.fatalMsg})`);
  expect(phone.stageVisible, 'phone: the stage is visible');
  expect(phone.loadingHidden, 'phone: the loading splash was dismissed, not left spinning');
  expect(phone.touch === true, `phone: touch mode is on (${phone.touch})`);
  expect(phone.phone === true, 'phone: the phone-only presentation gate is on');
  expect(!phone.noticeEl, 'phone: there is no refusal notice in the page at all');
  expect(!phone.blocked, 'phone: the document is not marked unsupported');
  expect(phone.errs.length === 0, `phone: no page errors (${phone.errs.join('; ')})`);

  // ── The same phone turned the other way. Held upright it is showing a landscape
  // screen, which is exactly the case the old prompt covered the game for; held sideways
  // it is the one five rooms wanted turned back. Both simply play now — how the device is
  // held is the player's business.
  const landscape = await visit({
    ...PHONE,
    viewport: { width: 844, height: 390 },
    screen: { width: 390, height: 844 },
  });
  expect(
    landscape.booted && !landscape.fatal,
    `sideways phone: the game booted (fatal: ${landscape.fatalMsg})`,
  );
  expect(!phone.rotateEl, 'upright phone: there is no "turn your phone" overlay in the page');
  expect(
    phone.rotateFlag === '',
    `upright phone: nothing asks for a rotation (${phone.rotateFlag})`,
  );
  expect(!landscape.rotateEl, 'sideways phone: no "turn your phone" overlay either');
  expect(
    landscape.rotateFlag === '',
    `sideways phone: nothing asks for a rotation (${landscape.rotateFlag})`,
  );
  expect(landscape.stageVisible, 'sideways phone: the stage is visible');
  expect(
    landscape.errs.length === 0,
    `sideways phone: no page errors (${landscape.errs.join('; ')})`,
  );

  // ── A tablet: touch-only exactly like the phone, but big enough that it was never
  // refused. Kept so the size signal still has an end-to-end witness on both sides.
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
  expect(tablet.booted && !tablet.fatal, `tablet: the game booted (fatal: ${tablet.fatalMsg})`);
  expect(tablet.touch === true, `tablet: touch mode is on (${tablet.touch})`);
  expect(tablet.phone === false, 'tablet: the phone-only presentation gate is off');
  expect(tablet.undoUnchanged === true, 'tablet: existing Undo selection is unchanged by the phone policy');

  // ── A desktop: the mouse-and-keyboard game is the thing none of this may cost.
  const desktop = await visit({ viewport: { width: 1200, height: 640 } });
  expect(desktop.fine, `desktop: reports a fine pointer (${desktop.fine})`);
  expect(desktop.booted && !desktop.fatal, `desktop: the game booted (fatal: ${desktop.fatalMsg})`);
  expect(desktop.stageVisible, 'desktop: the stage is visible');
  expect(desktop.touch === false, `desktop: touch mode is off (${desktop.touch})`);
  expect(desktop.phone === false, 'desktop: the phone-only presentation gate is off');
  expect(desktop.undoUnchanged === true, 'desktop: existing Undo selection is unchanged by the phone policy');
  for (const [name, result, touch] of [
    ['phone', phone, true], ['sideways phone', landscape, true],
    ['tablet', tablet, true], ['desktop', desktop, false],
  ]) {
    expect(result.startup.text === '' && result.startup.visibleChildren === 1,
      `${name}: initial loading has only the spinner, with no visible text`);
    expect(result.startup.spinning && result.startup.centered,
      `${name}: the initial spinner animates in the center of the viewport`);
    expect(result.startup.accessible, `${name}: spinner-only loading retains an accessible status`);
    expect(result.startText === (touch ? '▶ Tap to start' : '▶ Click to start'),
      `${name}: the start button matches the input device`);
    expect(result.skipText === (touch ? 'Tap to skip' : 'click / Esc to skip'),
      `${name}: the skip hint matches the input device`);
    expect(result.skippedToMap, `${name}: real start and skip gestures still reach the map`);
  }
} catch (e) {
  ok = false;
  console.log('  FAIL threw: ' + (e?.message ?? e));
}

console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
