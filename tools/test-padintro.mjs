/**
 * UI test: a controller must be able to get past the first-run intro splash.
 *
 * On first run the intro shows a gated "click to start" splash, and `skip()` is a
 * deliberate no-op there (a stray click must not abandon the intro). The start button
 * was reachable only by clicking it, so on a console — where there is no pointer — a
 * gamepad could never leave the very first screen. Regression test for that dead end.
 */
import { withApp, appReady } from './ui-lib.mjs';

await withApp(
  async ({ p, expect }) => {
    // Fake the WebView2 host and reload, so the native-host pad bridge installs exactly
    // as it does on the console.
    await p.addInitScript(() => {
      window.chrome = window.chrome || {};
      window.chrome.webview = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
    });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await appReady(p);

    const splash = await p.evaluate(() => {
      const btn = document.getElementById('intro-start');
      return { present: !!btn, visible: !!btn && !btn.hidden };
    });
    expect(splash.present, 'intro start button exists');
    expect(splash.visible, 'first run shows the gated start splash');

    // Press A on the bridged pad — the console's only way to interact here.
    await p.evaluate(() => {
      const b = new Array(17).fill(0);
      b[0] = 1; // A
      window.__ffPad = { t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: b };
    });
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      window.__ffPad = { t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
    });
    await p.waitForTimeout(200);

    const after = await p.evaluate(() => {
      const btn = document.getElementById('intro-start');
      return { splashGone: !btn || btn.hidden };
    });
    expect(after.splashGone, 'A dismissed the start splash (controller is not stuck)');

    // And the player actually reaches something interactive: either the movie is
    // playing, or it was blocked/skipped and we landed on the map. Never stuck.
    await p.waitForTimeout(1500);
    const reachable = await p.evaluate(() => {
      const layer = document.getElementById('intro-layer');
      const introUp = !!layer && !layer.hidden;
      const canvas = document.getElementById('screen');
      return { introUp, canvasVisible: !!canvas && canvas.offsetParent !== null };
    });
    expect(
      reachable.introUp || reachable.canvasVisible,
      `progressed past the splash (intro playing=${reachable.introUp}, game visible=${reachable.canvasVisible})`,
    );
  },
  { firstRun: true },
);
