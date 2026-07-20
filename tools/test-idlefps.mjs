/**
 * UI test: the render loop drops to the idle timer (low FPS) when a room is settled,
 * and does NOT get stranded at the full display refresh (120fps on ProMotion) after
 * the window loses focus while a movement key is held.
 *
 * Regression: losing focus (alt-tab) never delivers the keyup for a held key, so
 * heldState stayed "held" — the fish kept swimming and, because loopThrottleOk needs
 * heldState===0, the loop spun on rAF forever until a room restart cleared it.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.throttleInfo, { timeout: 8000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(12));
  await p.waitForFunction(() => window.__ff.screen() === 'room', { timeout: 5000 });

  // A settled room throttles to the idle timer (the low, ~12.5fps wake rate).
  await p.waitForFunction(() => window.__ff.throttleInfo().throttleOk === true, { timeout: 6000 });
  expect(await p.evaluate(() => window.__ff.throttleInfo().throttleOk), 'a settled room idle-throttles');

  // Holding a movement key legitimately keeps the loop at full rate.
  await p.keyboard.down('KeyL');
  await p.waitForTimeout(250);
  const held = await p.evaluate(() => window.__ff.throttleInfo());
  expect(held.heldState !== 0, 'the held key is registered');
  expect(held.throttleOk === false, 'the loop runs at full rate while a key is held');

  // The window loses focus with the key still down (the keyup is never delivered).
  await p.evaluate(() => window.dispatchEvent(new Event('blur')));
  await p.waitForTimeout(300);
  const after = await p.evaluate(() => window.__ff.throttleInfo());
  expect(after.heldState === 0, `the held key is dropped on blur (heldState=${after.heldState})`);
  expect(after.throttleOk === true, 'the loop drops back to the idle timer after blur');

  await p.keyboard.up('KeyL').catch(() => {});

  // Hiding the tab must also drop a held key (same stranded-rAF hazard).
  await p.keyboard.down('KeyJ');
  await p.waitForTimeout(250);
  expect(await p.evaluate(() => window.__ff.throttleInfo().heldState !== 0), 'second held key registered');
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(300);
  expect(
    await p.evaluate(() => window.__ff.throttleInfo().heldState === 0),
    'the held key is dropped when the tab is hidden',
  );
  await p.keyboard.up('KeyJ').catch(() => {});
});
