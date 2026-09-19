/**
 * Production marketing/entry contract: readable without JS; no game boot or save
 * writes on paused iOS browsers; other browsers still reach the original game.
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { appReady, exitProbe, launchBrowser, WAIT_BACKSTOP } from './ui-lib.mjs';

const base = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}`;
const evidence = process.env.FF_MARKETING_EVIDENCE;
const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
const gameRequest = (url) => /\/(?:data|enhanced|enhanced-ai|restored)\//.test(url) || /\/assets\/main-[^/]+\.js/.test(url);
const browser = await launchBrowser();
const errors = [];
let ok = true;

async function pageFor(options = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(WAIT_BACKSTOP);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  return { context, page };
}

async function layout(page, name) {
  await page.evaluate(() => Promise.all([...document.images].map((image) => image.decode())));
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    `${name}: no horizontal overflow`);
  assert.equal(await page.locator('h1').count(), 1, `${name}: one main heading`);
  assert.equal(await page.locator('a[href*="apps.apple.com"]').count(), 0,
    `${name}: no premature App Store download link`);
  if (evidence) {
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: join(evidence, `${name}.png`), fullPage: true });
  }
}

try {
  const { context, page } = await pageFor({ viewport: { width: 1440, height: 1000 } });
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  assert.equal((await page.goto(`${base}/about.html`)).status(), 200);
  await page.locator('[data-browser-play]').first().waitFor({ state: 'visible' });
  await layout(page, 'desktop');
  assert(!requests.some(gameRequest), 'the marketing page does not load the game');
  assert(await page.locator('#browser-paused').isHidden(), 'desktop has no blocked notice');
  assert.match(await page.locator('#ios').innerText(), /Currently in testing/);
  assert.match(await page.locator('#project').innerText(), /TypeScript.*WebGL/);
  assert.equal(await page.locator('#project a').getAttribute('href'), 'https://github.com/ff4e/ff4e.github.io');
  assert.equal((await context.request.get(`${base}/privacy.html`)).status(), 200);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip-link').evaluate((el) => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(new URL(page.url()).hash, '#main', 'keyboard skip link works');
  await page.locator('[data-browser-play]').first().click();
  await appReady(page);
  assert.equal(new URL(page.url()).pathname, '/', 'desktop CTA keeps the existing game URL');
  assert.equal(await page.locator('#about-link').getAttribute('href'), '/about.html');
  assert.equal(await page.locator('#about-link').evaluate((el) => el.hidden), false);
  assert(requests.some(gameRequest), 'positive control: game request detector sees an actual boot');
  await context.close();

  for (const [name, userAgent, width, height, platform] of [
    ['iphone', iphone, 390, 844, 'iPhone'],
    ['iphone-landscape', iphone, 844, 390, 'iPhone'],
    ['iphone-chrome', iphone.replace('Version/18.0', 'CriOS/140.0'), 375, 667, 'iPhone'],
    ['ipad', ipad, 820, 1180, 'iPad'],
    ['ipad-desktop-mode', mac, 1024, 768, 'MacIntel'],
  ]) {
    const { context, page } = await pageFor({
      userAgent, viewport: { width, height }, hasTouch: true, isMobile: true,
    });
    await context.addInitScript((platform) => {
      Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
      Object.defineProperty(navigator, 'maxTouchPoints', { value: 5, configurable: true });
      localStorage.setItem('ff.availability-sentinel', 'keep-existing-save');
    }, platform);
    const requests = [];
    page.on('request', (r) => requests.push(r.url()));
    // Old bookmarks and touch overrides must not bypass the availability policy.
    await page.goto(`${base}/?touch=on#saved-room`);
    await page.waitForURL(`${base}/about.html#browser`);
    await page.locator('#browser-paused').waitFor({ state: 'visible' });
    assert.match(await page.locator('#browser-paused').innerText(), /temporarily unavailable/);
    assert.equal(await page.locator('[data-browser-play]:visible').count(), 0);
    assert.equal(await page.evaluate(() => typeof window.__ff), 'undefined');
    assert.deepEqual(await page.evaluate(() => ({ ...localStorage })),
      { 'ff.availability-sentinel': 'keep-existing-save' }, `${name}: saves are untouched`);
    await layout(page, name);
    await page.reload();
    await page.locator('#browser-paused').waitFor({ state: 'visible' });
    assert(!requests.some(gameRequest), `${name}: no game bundle, art, audio or save boot`);
    await context.close();
  }

  for (const [name, userAgent, hasTouch, width, height] of [
    ['mac-browser', mac, false, 1280, 800],
    ['android-browser', android, true, 390, 844],
  ]) {
    const { context, page } = await pageFor({
      userAgent, hasTouch, isMobile: hasTouch, viewport: { width, height },
    });
    await page.goto(`${base}/about.html`);
    await page.locator('[data-browser-play]').first().waitFor({ state: 'visible' });
    await layout(page, name);
    await page.locator('[data-browser-play]').first().click();
    await appReady(page);
    assert.equal(new URL(page.url()).pathname, '/', `${name}: still boots the game`);
    await context.close();
  }

  const noJs = await pageFor({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
  await noJs.page.goto(`${base}/about.html`);
  assert(await noJs.page.locator('h1').isVisible(), 'no-JS project content stays readable');
  assert(await noJs.page.locator('noscript').isVisible(), 'no-JS visitor gets an honest requirement');
  assert.match(await noJs.page.locator('#ios').innerText(), /Not yet available on the App Store/);
  await layout(noJs.page, 'no-javascript-narrow');
  await noJs.context.close();
  assert.deepEqual(errors, [], 'no browser errors');
} catch (error) {
  ok = false;
  console.error(error);
} finally {
  await browser.close();
}
console.log(ok ? 'PASS marketing page and browser availability' : 'FAIL marketing page and browser availability');
exitProbe(ok ? 0 : 1);
