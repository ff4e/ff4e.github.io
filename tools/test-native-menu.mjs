/**
 * Native skin: paired geometry (with explicit phone insets), browser isolation,
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
    control: el.closest('#phone-map, #phone-more, #phone-undo, #phone-menu')?.id ?? null,
    x: r.x, y: r.y, w: r.width, h: r.height,
    scrollWidth: el.scrollWidth, scrollHeight: el.scrollHeight,
    fontSize: s.fontSize, lineHeight: s.lineHeight, gap: s.gap, padding: s.padding, margin: s.margin,
    pointerEvents: s.pointerEvents, touchAction: s.touchAction,
  };
}));
const save = async (p, name) => {
  if (evidence) await p.screenshot({ path: join(evidence, `${name}.png`) });
};
async function pair(p, name, c) {
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
  const insetPortrait = c.phone && c.height > c.width && c.width >= 390;
  const insetLandscape = c.phone && c.width > c.height;
  const oldTop = insetPortrait ? Math.max(8, (c.insets[0] - 56) / 2) : Math.max(16, c.insets[0] + 8);
  const newTop = insetPortrait ? Math.max(24, (c.insets[0] - 56) / 2) : Math.max(24, c.insets[0] + 8);
  const oldBottom = insetPortrait ? 8 : Math.max(16, c.insets[2] + 8);
  const newBottom = insetPortrait ? 24 : Math.max(24, c.insets[2] + 8);
  const side = (floor, inset) => c.height >= 390 ? floor : Math.max(floor, inset + 8);
  const leftShift = insetLandscape ? side(24, c.insets[3]) - side(16, c.insets[3]) : 0;
  const rightShift = insetLandscape ? side(16, c.insets[1]) - side(24, c.insets[1]) : 0;
  const menuShift = insetLandscape
    ? Math.max(side(16, c.insets[1]), c.insets[1] + 8) - Math.max(side(24, c.insets[1]), c.insets[1] + 8) : 0;
  const newMenuTop = Math.max(c.insets[0] + 8, newTop + 64);
  const shifts = {
    'phone-map': { x: leftShift, y: newTop - oldTop },
    'phone-more': { x: rightShift, y: newTop - oldTop },
    'phone-undo': { x: rightShift, y: oldBottom - newBottom },
    'phone-menu': { x: menuShift, y: newMenuTop - Math.max(c.insets[0] + 8, oldTop + 64) },
  };
  const expected = before.map(item => {
    if (!(insetPortrait || insetLandscape) || item.w === 0 || item.h === 0 || !item.control) return item;
    const shift = shifts[item.control];
    // The scrollable menu loses only the space reserved for the larger edge insets.
    const h = item.element === 'phone-menu'
      ? Math.min(item.scrollHeight, c.height - newMenuTop - newBottom - 64) : item.h;
    return { ...item, x: item.x + shift.x, y: item.y + shift.y, h };
  });
  assert.deepEqual(after, expected, `${name}: unexpected layout or hit behavior change`);
  await save(p, `${name}-after`);
  results.push({ name, elements: after.length, geometryMatched: true, insetPortrait, insetLandscape });
}
async function phoneClearance(p, c) {
  const portrait = c.height > c.width;
  if (!c.phone || (portrait && c.width < 390)) return;
  const [map, more, undo] = await p.evaluate(() =>
    ['phone-map', 'phone-more', 'phone-undo'].map(id => {
      const el = document.getElementById(id);
      return { ...el.getBoundingClientRect().toJSON(),
        radius: parseFloat(getComputedStyle(el).borderTopLeftRadius) };
    }));
  // Use the painted native radius, not the browser skin's rounder 14px corners.
  const clearance = (x, y, radius) =>
    64 - Math.hypot(Math.max(0, 64 - x - radius), Math.max(0, 64 - y - radius)) - radius;
  const gaps = [clearance(map.left, map.top, map.radius),
    clearance(c.width - more.right, more.top, more.radius),
    clearance(c.width - undo.right, c.height - undo.bottom, undo.radius)];
  assert(gaps.every(gap => gap >= 8), `${c.name}: rustic corners need 8px of curved-glass clearance: ${gaps}`);
  if (portrait) {
    assert(map.top < Math.max(c.insets[0], 47), `${c.name}: top row must stay beside, not below, the housing`);
    assert(map.right + 8 <= c.width / 2 - 107 && more.left - 8 >= c.width / 2 + 107,
      `${c.name}: preserve 8px beside the modeled 214px housing`);
    assert(undo.left - 8 >= c.width / 2 + 107, `${c.name}: keep Undo beside the home indicator`);
  } else {
    assert(undo.bottom <= c.height - c.insets[2] - 8, `${c.name}: preserve the bottom safe area`);
    for (const side of [1, 3].filter(side => c.insets[side] > 0)) {
      const left = side === 3 ? 0 : c.width - c.insets[1];
      const right = side === 3 ? c.insets[3] : c.width;
      assert([map, more, undo].every(b => b.right + 8 <= left || b.left - 8 >= right ||
        b.bottom + 8 <= c.height / 2 - 100 || b.top - 8 >= c.height / 2 + 100),
      `${c.name}: preserve 8px around the modeled 200px landscape housing`);
    }
  }
  results.push({ name: c.name, curvedGlassClearance: gaps });
}
const cases = [
  { name: 'phone-portrait', phone: true, width: 393, height: 852, insets: [62, 0, 34, 0] },
  { name: 'phone-notch-portrait', phone: true, width: 390, height: 844, insets: [47, 0, 34, 0] },
  { name: 'phone-zero-insets-portrait', phone: true, width: 390, height: 844, insets: [0, 0, 0, 0] },
  { name: 'phone-tall-inset-portrait', phone: true, width: 414, height: 896, insets: [96, 0, 34, 0] },
  { name: 'phone-wide-portrait', phone: true, width: 440, height: 956, insets: [62, 0, 34, 0] },
  { name: 'phone-landscape-left', phone: true, width: 852, height: 393, insets: [0, 0, 21, 62] },
  { name: 'phone-landscape-right', phone: true, width: 852, height: 393, insets: [0, 62, 21, 0] },
  { name: 'phone-notch-landscape', phone: true, width: 844, height: 390, insets: [0, 47, 21, 0] },
  { name: 'phone-zero-insets-landscape', phone: true, width: 852, height: 393, insets: [0, 0, 0, 0] },
  { name: 'phone-small-portrait', phone: true, width: 375, height: 667, insets: [20, 0, 0, 0] },
  { name: 'phone-short-landscape', phone: true, width: 667, height: 375, insets: [0, 44, 21, 0] },
  { name: 'phone-short-landscape-left', phone: true, width: 667, height: 375, insets: [0, 0, 21, 44] },
  { name: 'phone-compact-landscape', phone: true, width: 568, height: 320, insets: [0, 0, 0, 0] },
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
      await pair(p, `${c.name}-controls`, c);
      await phoneClearance(p, c);
      if (phone) {
        await p.click('#phone-more');
        await pair(p, `${c.name}-menu`, c);
        const bounds = await p.evaluate(() => ({
          menu: document.getElementById('phone-menu').getBoundingClientRect().toJSON(),
          more: document.getElementById('phone-more').getBoundingClientRect().toJSON(),
          undo: document.getElementById('phone-undo').getBoundingClientRect().toJSON(),
        }));
        assert(bounds.menu.top >= Math.max(c.insets[0] + 8, bounds.more.bottom + 8) &&
          bounds.menu.bottom <= bounds.undo.top - 8, `${c.name}: overflow clears both corner controls`);
        for (const button of await p.locator('#phone-menu button').all()) await button.tap({ trial: true });
        await p.click('#phone-menu [data-region="16"]');
      } else {
        await p.click('#touchbar [data-region="16"]');
      }
      await p.waitForFunction((phone) => !document.getElementById('touchopts').hidden &&
        (!phone || document.getElementById('phone-controls').hidden), phone);
      await pair(p, `${c.name}-options`, c);
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
      await p.locator('#topt-effect').scrollIntoViewIfNeeded();
      const range = await p.locator('#topt-effect').boundingBox();
      assert(range, 'volume range must be visible');
      await p.locator('#topt-effect').evaluate((el) => {
        el.value = '0';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.equal(await p.evaluate(() => window.__ff.volumes().effect), 0, 'range starts away from the tap');
      await p.touchscreen.tap(range.x + range.width / 2, range.y + range.height / 2);
      assert.equal(await p.evaluate(() => window.__ff.volumes().effect), 6, 'native range taps still dispatch');
      assert.equal(await p.locator('#touchopts input[value="en"]').isChecked(), true,
        'English subtitles are selected on first open and retained on reopen');
      await p.locator('#touchopts input[value="cz"]').check();
      assert.equal(await p.evaluate(() => window.__ff.subtitleMode()), 'cz', 'Czech remains selectable');
      await p.locator('#touchopts input[value="en"]').check();
      assert.equal(await p.evaluate(() => window.__ff.subtitleMode()), 'en', 'native radios still dispatch');
      await p.locator('#topt-close').scrollIntoViewIfNeeded();
      const end = await p.locator('#topt-close').boundingBox();
      assert(end && end.y >= 0 && end.y + end.height <= c.height, `${c.name}: Done must stay reachable`);
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
      console.log(`  ok   ${c.name}: expected geometry, browser pixels, input and focus`);
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
