/**
 * Native skin: paired geometry on the SAME live controls, browser isolation,
 * native-input operation, focus and reduced motion. No simulator claim: the
 * native-menu controller is enabled explicitly, without mocking a Capacitor bridge.
 * FF_NATIVE_EVIDENCE saves comparison screenshots.
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { appReady, launchBrowser, exitProbe, WAIT_BACKSTOP } from './ui-lib.mjs';

const browser = await launchBrowser();
const base = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;
const evidence = process.env.FF_NATIVE_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const results = [];
const errors = [];
const native = (p, on) => p.evaluate((on) => {
  const svgs = [...document.querySelectorAll('.tbtn svg')];
  window.nativeMenuOriginalSvgs ??= svgs.map(svg => svg.innerHTML);
  if (on) {
    window.__ff.previewNativeMenu();
  } else {
    document.documentElement.removeAttribute('data-native-menu');
    svgs.forEach((svg, i) => {
      svg.innerHTML = window.nativeMenuOriginalSvgs[i];
      delete svg.dataset.menuIcon;
    });
  }
}, on);
const geometry = (p) => p.evaluate(() => [...document.querySelectorAll(
  '#phone-controls, #phone-controls *, #touchbar, #touchbar *, .stage, #stagebox, #touchopts, #touchopts *',
)].filter(el => !(el instanceof SVGElement) || el.tagName.toLowerCase() === 'svg').map((el) => {
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    element: el.id || el.getAttribute('data-region') || el.tagName,
    x: r.x, y: r.y, w: r.width, h: r.height,
    scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
    fontSize: s.fontSize, lineHeight: s.lineHeight, gap: s.gap, padding: s.padding, margin: s.margin,
    pointerEvents: s.pointerEvents, touchAction: s.touchAction,
  };
}));
const save = async (p, name) => {
  if (evidence) await p.screenshot({ path: join(evidence, `${name}.png`) });
};
async function pair(p, name) {
  // The tablet's edge decision and stage resize can span several throttled frames.
  await p.evaluate(() => { window.nativeMenuLayoutSample = { key: '', since: performance.now() }; });
  await p.waitForFunction(() => {
    const key = [...document.querySelectorAll('#phone-controls, #touchbar, .stage, #stagebox, #touchopts')]
      .map((el) => JSON.stringify(el.getBoundingClientRect())).join();
    const sample = window.nativeMenuLayoutSample;
    if (key !== sample.key) {
      sample.key = key;
      sample.since = performance.now();
    }
    return performance.now() - sample.since >= 180;
  });
  await native(p, false);
  const before = await geometry(p);
  await save(p, `${name}-before`);
  await native(p, true);
  const after = await geometry(p);
  assert.deepEqual(after, before, `${name}: skin changed layout or hit behavior`);
  await save(p, `${name}-after`);
  results.push({ name, elements: after.length, geometryIdentical: true });
}
const cases = [
  { name: 'phone-portrait', phone: true, width: 393, height: 852, insets: [62, 0, 34, 0] },
  { name: 'phone-landscape-left', phone: true, width: 852, height: 393, insets: [0, 0, 21, 62] },
  { name: 'phone-landscape-right', phone: true, width: 852, height: 393, insets: [0, 62, 21, 0] },
  { name: 'phone-small-portrait', phone: true, width: 375, height: 667, insets: [20, 0, 0, 0] },
  { name: 'phone-short-landscape', phone: true, width: 667, height: 375, insets: [0, 44, 21, 0] },
  { name: 'tablet-portrait', phone: false, width: 834, height: 1194, insets: [24, 0, 20, 0] },
  { name: 'tablet-landscape', phone: false, width: 1194, height: 834, insets: [24, 0, 20, 0] },
];
let passed = false;
try {
  for (const phone of [true, false]) {
    const context = await browser.newContext({
      viewport: phone ? { width: 393, height: 852 } : { width: 834, height: 1194 },
      screen: phone ? { width: 393, height: 852 } : { width: 834, height: 1194 },
      hasTouch: true, isMobile: true, deviceScaleFactor: 1,
    });
    const p = await context.newPage();
    p.setDefaultTimeout(WAIT_BACKSTOP);
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.addInitScript(() => {
      localStorage.setItem('ff.options', JSON.stringify({ introSeen: true }));
      localStorage.setItem('ff.graphics', 'classic');
      localStorage.setItem('ff.renderer', 'cpu');
    });
    await p.goto(base, { waitUntil: 'domcontentloaded' });
    await appReady(p);
    assert.equal(await p.evaluate(() => document.documentElement.hasAttribute('data-native-menu')),
      false, 'a browser must not activate the native skin');
    await p.evaluate(() => window.__ff.enterRoomAwait(7));
    await p.waitForFunction(() => !window.__ff.roomLoading() && document.getElementById('loading').hidden);
    await p.waitForFunction((phone) => !document.getElementById(phone ? 'phone-controls' : 'touchbar').hidden, phone);
    // Pure paint must remain scoped even after CSS bundling. Keyframes are not selectors.
    assert.equal(await p.evaluate(() => {
      const walk = (rules) => [...rules].every((rule) => {
        if (rule instanceof CSSStyleRule) {
          return !rule.cssText.includes('native-menu/stone') || rule.selectorText.includes('[data-native-menu]');
        }
        return rule instanceof CSSMediaRule ? walk(rule.cssRules) : true;
      });
      return [...document.styleSheets].every((sheet) => walk(sheet.cssRules));
    }), true, 'stone rules must stay native-only');
    for (const c of cases.filter((c) => c.phone === phone)) {
      await p.setViewportSize({ width: c.width, height: c.height });
      await p.evaluate((insets) => {
        ['top', 'right', 'bottom', 'left'].forEach((side, i) =>
          document.documentElement.style.setProperty(`--sa-${side}`, `${insets[i]}px`));
      }, c.insets);
      await p.waitForFunction(() => {
        const g = window.__ff.roomGeom();
        return g && Math.abs(document.getElementById('screen').clientWidth - g.cssW) <= 1;
      });
      await pair(p, `${c.name}-controls`);
      if (phone) {
        await p.click('#phone-more');
        await pair(p, `${c.name}-menu`);
        await p.click('#phone-menu [data-region="16"]');
      } else {
        await p.click('#touchbar [data-region="16"]');
      }
      await p.waitForFunction((phone) => !document.getElementById('touchopts').hidden &&
        (!phone || document.getElementById('phone-controls').hidden), phone);
      await pair(p, `${c.name}-options`);
      const end = await p.locator('#topt-close').boundingBox();
      assert(end && end.y >= 0 && end.y + end.height <= c.height, `${c.name}: Done must stay reachable`);
      await native(p, false);
      const originalPixels = await p.locator('#touchopts').screenshot();
      await native(p, true);
      assert.equal(await p.locator('#touchopts').evaluate((el) =>
        getComputedStyle(el).backgroundImage.includes('stone')), true, 'native texture applied');
      const nativePixels = await p.locator('#touchopts').screenshot();
      assert(!originalPixels.equals(nativePixels), 'the skin must visibly change Options');
      await native(p, false);
      assert(originalPixels.equals(await p.locator('#touchopts').screenshot()),
        'removing the native skin must restore browser pixels exactly');
      await native(p, true);
      assert.equal(await p.locator('#topt-close').evaluate((el) => getComputedStyle(el).borderColor),
        'rgb(121, 101, 55)', 'Done uses the selected C accent, not the browser teal border');
      const range = await p.locator('#topt-effect').boundingBox();
      assert(range, 'volume range must be visible');
      await p.locator('#topt-effect').evaluate((el) => {
        el.value = '0';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await p.evaluate(() => window.__ff.volumes().effect), 0, 'range starts away from the tap');
      await p.touchscreen.tap(range.x + range.width / 2, range.y + range.height / 2);
      assert.equal(await p.evaluate(() => window.__ff.volumes().effect), 6, 'native range taps still dispatch');
      await p.locator('#touchopts input[value="en"]').check();
      assert.equal(await p.evaluate(() => window.__ff.subtitleMode()), 'en', 'native radios still dispatch');
      const resting = await p.locator('#topt-close').evaluate((el) => getComputedStyle(el).boxShadow);
      await p.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
      await p.mouse.down();
      assert.notEqual(await p.locator('#topt-close').evaluate((el) => getComputedStyle(el).boxShadow),
        resting, 'Done has a visible pressed state');
      await p.mouse.move(1, 1);
      await p.mouse.up();
      await p.keyboard.press('Tab');
      await p.locator('#topt-close').focus();
      assert.equal(await p.locator('#topt-close').evaluate((el) =>
        getComputedStyle(el).outlineStyle), 'solid', 'keyboard focus stays visible');
      await p.keyboard.press('Enter');
      await p.waitForFunction(() => document.getElementById('touchopts').hidden);
      await p.waitForFunction((phone) => !document.getElementById(phone ? 'phone-controls' : 'touchbar').hidden, phone);
      console.log(`  ok   ${c.name}: identical geometry, browser pixels, input and focus`);
    }
    await p.emulateMedia({ reducedMotion: 'reduce' });
    const control = phone ? '#phone-map' : '#touchbar .tbtn';
    const hint = p.locator(control).first();
    await hint.evaluate((el) => el.classList.add('dialogue-hint-pulse'));
    assert.equal(await hint.evaluate((el) => getComputedStyle(el).animationName), 'none',
      'reduced motion keeps the tutorial cue still');
    assert.equal(await hint.evaluate((el) => {
      const symbol = getComputedStyle(el.querySelector('svg')).color;
      return getComputedStyle(el).boxShadow.includes(symbol);
    }), true, 'reduced-motion cue uses the room symbol color on phone and tablet');
    await hint.evaluate(el => el.classList.remove('dialogue-hint-pulse'));
    await p.emulateMedia({ reducedMotion: 'no-preference' });
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    const paletteFor = async (num) => {
      await p.evaluate(n => window.__ff.enterRoomAwait(n), num);
      await p.waitForFunction(n => document.documentElement.dataset.nativeMenuRoom === String(n) &&
        document.documentElement.dataset.nativeMenuTier === 'ai', num);
      return p.evaluate(() => ({
        hue: document.documentElement.dataset.nativeMenuHue,
        symbol: getComputedStyle(document.querySelector('#phone-map svg')).color,
        glass: getComputedStyle(document.getElementById('phone-map')).backgroundColor,
      }));
    };
    const warm = await paletteFor(6);
    assert.equal(warm.hue, '33');
    assert.equal(warm.symbol, 'rgb(225, 188, 142)');
    const cool = await paletteFor(44);
    assert.equal(cool.hue, '146');
    assert.equal(cool.symbol, 'rgb(142, 225, 178)');
    assert(cool.glass.endsWith(', 0.45)'), 'glass stays translucent');
    assert.deepEqual(await paletteFor(6), warm, 'room palette is stable on revisits');
    await p.emulateMedia({ forcedColors: 'active' });
    assert.notEqual(await p.locator('#phone-map svg').evaluate(el => getComputedStyle(el).color),
      warm.symbol, 'high-contrast mode replaces decorative ink with system colors');
    await context.close();
  }
  assert.deepEqual(errors, [], 'browser errors');
  if (evidence) writeFileSync(join(evidence, 'geometry.json'), JSON.stringify(results, null, 2) + '\n');
  passed = true;
} catch (e) {
  console.log('  FAIL', e.stack ?? e);
  if (errors.length) console.log('  console errors:', errors);
} finally {
  await browser.close();
}
console.log(passed ? 'PASS' : 'FAIL');
exitProbe(passed ? 0 : 1);
