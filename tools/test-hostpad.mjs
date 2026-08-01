/**
 * UI test: the native-host controller bridge (src/platform/hostGamepad.ts).
 *
 * On Xbox, WebView2's own Gamepad API reports no controller inside a UWP app, so the
 * native shell reads the pad and posts snapshots into the page, where they are
 * republished through navigator.getGamepads(). This probe fakes that host — a
 * `chrome.webview` object and the injected `window.__ffPad` state the shell maintains —
 * and verifies the whole chain still drives the game: injected state -> getGamepads ->
 * pollPad() -> the controller UI.
 */
import { withApp, appReady } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  // The bridge only installs itself when it detects the WebView2 host, and that check
  // runs during boot — so the fake host must exist before the page loads. Install it and
  // reload, which is exactly the situation inside the real WebView2 shell.
  await p.addInitScript(() => {
    window.chrome = window.chrome || {};
    window.chrome.webview = { addEventListener() {}, removeEventListener() {}, postMessage() {} };
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await appReady(p);

  const hasBridge = await p.evaluate(() => typeof navigator.getGamepads === 'function');
  expect(hasBridge, 'navigator.getGamepads exists');

  // Standard Gamepad layout: 4 axes, 17 buttons. Menu is index 9.
  const neutral = () => ({ t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) });

  const seen = await p.evaluate((pad) => {
    window.__ffPad = pad;
    const gp = navigator.getGamepads ? navigator.getGamepads() : [];
    const first = Array.from(gp).find((g) => g && g.id && /native host bridge/.test(g.id));
    return first ? { id: first.id, axes: first.axes.length, buttons: first.buttons.length } : null;
  }, neutral());

  expect(seen !== null, `injected pad is published through getGamepads (${JSON.stringify(seen)})`);
  if (seen) {
    expect(seen.axes === 4, 'pad reports 4 axes');
    expect(seen.buttons === 17, 'pad reports 17 buttons');
  }

  // A pressed button must surface as pressed on the republished pad.
  const pressed = await p.evaluate(() => {
    const b = new Array(17).fill(0);
    b[9] = 1; // Menu
    window.__ffPad = { t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: b };
    const gp = Array.from(navigator.getGamepads()).find((g) => g && /native host bridge/.test(g.id));
    return gp ? gp.buttons[9].pressed : null;
  });
  expect(pressed === true, 'a pressed button is visible to the game');

  // End to end: Menu opens the controller Options overlay, exactly as a real pad does.
  await p.waitForTimeout(300);
  const optionsOpen = await p.evaluate(() => {
    const el = document.getElementById('pad-options');
    return !!el && !el.hidden;
  });
  expect(optionsOpen, 'Menu opened the Options overlay through the bridge');

  // Releasing must be seen too, otherwise the game would latch a held button.
  await p.evaluate(() => {
    window.__ffPad = { t: 'pad', connected: true, axes: [0, 0, 0, 0], buttons: new Array(17).fill(0) };
  });
  const released = await p.evaluate(() => {
    const gp = Array.from(navigator.getGamepads()).find((g) => g && /native host bridge/.test(g.id));
    return gp ? gp.buttons[9].pressed : null;
  });
  expect(released === false, 'releasing the button is visible to the game');

  // A disconnected controller must not leave a phantom pad behind.
  const gone = await p.evaluate(() => {
    window.__ffPad = { t: 'pad', connected: false, axes: [0, 0, 0, 0], buttons: [] };
    return Array.from(navigator.getGamepads()).filter((g) => g && /native host bridge/.test(g.id)).length;
  });
  expect(gone === 0, 'a disconnected pad disappears from getGamepads');
});
