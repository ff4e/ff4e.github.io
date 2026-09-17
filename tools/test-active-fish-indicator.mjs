/**
 * Normal phone-browser boot, including DevTools-style device changes after load.
 * Lifecycle holds live in activeFishIndicator.test.ts; CSS owns corner placement.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appReady, exitProbe, launchBrowser, WAIT_BACKSTOP } from './ui-lib.mjs';

const browser = await launchBrowser();
const base = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;
const evidence = process.env.FF_FISH_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const errors = [];
let passed = false;
const cases = [
  { name: 'compact-portrait', width: 402, height: 874, insets: [62, 0, 34, 0] },
  { name: 'compact-left', width: 874, height: 402, insets: [0, 0, 21, 62] },
  { name: 'compact-right', width: 874, height: 402, insets: [0, 62, 21, 0] },
  { name: 'notch-portrait', width: 390, height: 844, insets: [47, 0, 34, 0] },
  { name: 'notch-left', width: 844, height: 390, insets: [0, 0, 21, 47] },
  { name: 'notch-right', width: 844, height: 390, insets: [0, 47, 21, 0] },
  { name: 'small-portrait', width: 320, height: 568, insets: [20, 0, 0, 0] },
  { name: 'small-landscape', width: 568, height: 320, insets: [0, 0, 0, 0] },
  { name: 'unknown-housing', width: 402, height: 874, insets: [80, 0, 34, 0] },
];
try {
  const context = await browser.newContext({
    viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 },
    hasTouch: true, isMobile: true, deviceScaleFactor: 2,
  });
  const p = await context.newPage();
  p.setDefaultTimeout(WAIT_BACKSTOP);
  p.on('pageerror', e => errors.push(e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await p.addInitScript(() => {
    localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
    localStorage.setItem('ff.graphics', 'classic');
    localStorage.setItem('ff.renderer', 'cpu');
  });
  await p.goto(base, { waitUntil: 'domcontentloaded' });
  await appReady(p);
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await p.waitForFunction(() => !window.__ff.roomLoading() && document.getElementById('loading').hidden);
  const badge = p.locator('#active-fish-indicator');
  await badge.waitFor({ state: 'visible' });
  assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('data-native-menu')),
    true, 'phone browser uses the new skin without preview hooks');
  assert.equal(await p.locator('#phone-map svg').getAttribute('data-menu-icon'), 'map',
    'phone browser uses the new icons');
  const waitFish = (which) => p.waitForFunction((which) => {
    const badge = document.getElementById('active-fish-indicator');
    return !badge.hidden && badge.dataset.fish === which;
  }, which);
  const save = async (name) => {
    if (evidence) await p.screenshot({ path: join(evidence, `${name}.png`) });
  };
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await badge.waitFor({ state: 'visible' });
  for (const c of cases) {
    await p.setViewportSize({ width: c.width, height: c.height });
    await p.evaluate((insets) => {
      ['top', 'right', 'bottom', 'left'].forEach((side, i) =>
        document.documentElement.style.setProperty(`--sa-${side}`, `${insets[i]}px`));
    }, c.insets);
    const caption = 'The active fish stays in the free corner while this longer caption wraps.';
    const previous = await p.evaluate((text) => {
      window.previousFishCaptionGlyph = document.querySelector('#domsubs .subtitle-glyph');
      window.__ff.clearSubtitles();
      window.__ff.pushSubtitle(text, 'M');
      return window.__ff.throttleInfo().loops;
    }, caption);
    await p.waitForFunction(({ ink, previous }) => window.__ff.throttleInfo().loops > previous &&
      !window.previousFishCaptionGlyph?.isConnected &&
      [...document.querySelectorAll('#domsubs .subtitle-glyph')]
        .map(g => g.lastElementChild.textContent).join('').includes(ink),
    { ink: caption.replaceAll(' ', ''), previous });
    const g = await badge.evaluate((el) => {
      const rect = node => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height };
      };
      const image = el.querySelector('img:not([hidden])');
      const map = document.getElementById('phone-map');
      const undo = document.getElementById('phone-undo');
      const appearance = node => {
        const style = getComputedStyle(node);
        return Object.fromEntries([
          'width', 'height', 'padding', 'boxSizing', 'backgroundColor', 'borderColor',
          'borderWidth', 'borderStyle', 'borderRadius', 'boxShadow', 'display', 'alignItems', 'justifyContent',
        ].map(key => [key, style[key]]));
      };
      return {
        badge: rect(el), picture: rect(image),
        map: rect(map), undo: rect(undo), buttonIcon: rect(undo.querySelector('svg')),
        badgeStyle: appearance(el), buttonStyle: appearance(undo),
        captions: rect(document.getElementById('domsubs')),
        controls: [...document.querySelectorAll('#phone-controls > button')].map(rect),
        loaded: image.complete && image.naturalWidth > 0,
        hit: !!document.elementFromPoint(rect(el).x + 28, rect(el).y + 28)?.closest('#active-fish-indicator'),
        connector: getComputedStyle(el, '::before').content,
        label: el.getAttribute('aria-label'),
      };
    });
    assert(g.loaded && g.label.includes('Active fish:'), `${c.name}: actual picture and accessible name`);
    assert.deepEqual(g.badgeStyle, g.buttonStyle, `${c.name}: reuse the corner button size and native skin`);
    assert.equal(g.badge.x, g.map.x, `${c.name}: left edge aligns with Map`);
    assert.equal(g.badge.y, g.undo.y, `${c.name}: bottom row aligns with Undo`);
    assert.equal(g.picture.w, g.buttonIcon.w, `${c.name}: picture shares the corner icon width`);
    assert.equal(g.picture.h, g.buttonIcon.h, `${c.name}: picture shares the corner icon height`);
    assert(g.badge.x >= 0 && g.badge.y >= 0 && g.badge.right <= c.width && g.badge.bottom <= c.height,
      `${c.name}: badge on screen`);
    assert.equal(g.connector, 'none', `${c.name}: no housing connector`);
    assert(c.height > c.width
      ? g.captions.bottom + 8 <= g.badge.y
      : g.badge.right + 8 <= g.captions.x,
    `${c.name}: captions keep an 8px gap above the button row or inside the side gutter`);
    assert(g.controls.every(r => g.badge.right <= r.x || g.badge.x >= r.right ||
      g.badge.bottom <= r.y || g.badge.y >= r.bottom), `${c.name}: badge must not cover a control`);
    assert.equal(g.hit, false, `${c.name}: badge must not intercept gestures`);
    await save(c.name);
  }
  await p.setViewportSize({ width: 874, height: 402 });
  await p.evaluate(() => {
    document.documentElement.style.setProperty('--sa-top', '0px');
    document.documentElement.style.setProperty('--sa-left', '62px');
    window.__ff.clearSubtitles();
  });
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const before = await p.evaluate(() => window.__ff.state().active);
  const target = await badge.boundingBox();
  assert(target, 'indicator is visible for the tap-through check');
  await p.touchscreen.tap(target.x + target.width / 2, target.y + target.height / 2);
  await waitFish(before === 'little' ? 'big' : 'little');
  const pictureA = await p.locator('#active-fish-indicator img:not([hidden])').screenshot();
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  await p.touchscreen.tap(440, 170);
  await waitFish(before);
  const pictureB = await p.locator('#active-fish-indicator img:not([hidden])').screenshot();
  assert(!pictureA.equals(pictureB), 'switching fish must visibly change the picture');
  await p.click('#phone-more');
  await badge.waitFor({ state: 'hidden' });
  await p.click('#phone-menu [data-region="16"]');
  await badge.waitFor({ state: 'hidden' });
  await p.click('#topt-close');
  await badge.waitFor({ state: 'visible' });

  // The existing engine hook drives the real animated handover, not a badge setter.
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  await p.evaluate(() => window.__ff.forceExit('little', 3));
  await p.waitForFunction(() => window.__ff.state().venku.little);
  await waitFish('big');
  await save('remaining-big-fish');
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitFish('little');
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const moves = await p.evaluate(() => window.__ff.moves());
  await p.keyboard.press('ArrowLeft');
  await p.waitForFunction((moves) => window.__ff.moves() > moves && window.__ff.phase() === 'idle', moves);
  await p.keyboard.press('Space');
  await waitFish('big');
  await p.waitForFunction(() => window.__ff.canUndo());
  assert.equal(await p.evaluate(() => window.__ff.undo()), true, 'Undo is accepted after the selection animation settles');
  await waitFish('little');
  await p.click('#phone-map');
  await badge.waitFor({ state: 'hidden' });

  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 }, screen: { width: 1280, height: 800 },
  });
  const d = await desktop.newPage();
  d.setDefaultTimeout(WAIT_BACKSTOP);
  d.on('pageerror', e => errors.push(e.message));
  await d.addInitScript(() => {
    localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
    localStorage.setItem('ff.graphics', 'classic');
    localStorage.setItem('ff.renderer', 'cpu');
  });
  await d.goto(base, { waitUntil: 'domcontentloaded' });
  await appReady(d);
  await d.evaluate(() => window.__ff.enterRoomAwait(7));
  assert.equal(await d.evaluate(() => document.documentElement.hasAttribute('data-native-menu')),
    false, 'normal desktop keeps the original panel appearance');
  assert.equal(await d.locator('#active-fish-indicator').count(), 0, 'desktop has no phone badge');
  const cdp = await desktop.newCDPSession(d);
  // These are browser device-emulation signals, not app hooks or a native-host mock.
  for (let i = 0; i < 2; i++) {
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 402, height: 874, deviceScaleFactor: 1, mobile: true, screenWidth: 402, screenHeight: 874,
    });
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    await d.locator('#active-fish-indicator').waitFor({ state: 'visible' });
    assert.equal(await d.evaluate(() => document.documentElement.hasAttribute('data-native-menu')), true,
      'enabling phone emulation after boot activates the new skin');
    assert.equal(await d.locator('#phone-map svg').getAttribute('data-menu-icon'), 'map');
    assert.equal(await d.locator('#active-fish-indicator').count(), 1, 'mode changes never duplicate the badge');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await d.waitForFunction(() => !document.documentElement.hasAttribute('data-touch') &&
      !document.documentElement.hasAttribute('data-native-menu'));
    await d.locator('#active-fish-indicator').waitFor({ state: 'hidden' });
  }
  await desktop.close();

  assert.deepEqual(errors, [], 'page must not report errors');
  console.log('  ok   browser defaults, live phone/desktop emulation, 9 corner layouts, taps, exit, Undo and menus');
  await context.close();
  passed = true;
} catch (e) {
  console.error(e.stack ?? e.message);
} finally {
  await browser.close();
}
exitProbe(passed ? 0 : 1);
