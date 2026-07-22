/**
 * UI test: the dev-only on-screen gamepad simulator (src/platform/virtualGamepad.ts).
 * Verifies the widget appears when enabled, that clicking a button / dragging a stick
 * is reflected in navigator.getGamepads() (the synthetic Standard Gamepad), and that a
 * Menu press flows through pollGamepadInput() end-to-end to open the Options overlay.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  // Enable the sim (dev pane is already on via the harness) and reload so boot applies it.
  await p.evaluate(() => localStorage.setItem('ff.simpad', '1'));
  await p.reload({ waitUntil: 'networkidle' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 8000 });

  // Widget present + visible.
  expect(await p.evaluate(() => !!document.getElementById('vg-root')), 'sim widget exists');
  expect(
    await p.evaluate(() => {
      const el = document.getElementById('vg-root');
      return !!el && getComputedStyle(el).display !== 'none';
    }),
    'sim widget visible',
  );

  // navigator.getGamepads() now returns a connected Standard Gamepad.
  expect(
    await p.evaluate(() => {
      const g = navigator.getGamepads()[0];
      return !!g && g.connected && g.mapping === 'standard' && g.buttons.length >= 16 && g.axes.length >= 4;
    }),
    'synthetic Standard Gamepad reported',
  );

  // Clicking the A button flips buttons[0].pressed while held; releases cleanly.
  const readBtn0 = () => p.evaluate(() => navigator.getGamepads()[0].buttons[0].pressed);
  expect((await readBtn0()) === false, 'A starts unpressed');
  await p.locator('#vg-root .vg-a').dispatchEvent('pointerdown', { pointerId: 1 });
  expect((await readBtn0()) === true, 'A pressed on pointerdown');
  await p.locator('#vg-root .vg-a').dispatchEvent('pointerup', { pointerId: 1 });
  expect((await readBtn0()) === false, 'A released on pointerup');

  // Dragging the left stick left sets axis[0] negative (up = -Y convention preserved).
  const axes = await p.evaluate(() => {
    const pad = document.querySelector('#vg-root .vg-stick');
    const r = pad.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    pad.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 2, clientX: cx, clientY: cy, bubbles: true }));
    // push fully left
    pad.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientX: r.left - 40, clientY: cy, bubbles: true }));
    const held = navigator.getGamepads()[0].axes.slice(0, 2);
    pad.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, clientX: r.left - 40, clientY: cy, bubbles: true }));
    const released = navigator.getGamepads()[0].axes.slice(0, 2);
    return { held, released };
  });
  expect(axes.held[0] <= -0.9, `left stick drag sets axis0 negative (got ${axes.held[0]})`);
  expect(Math.abs(axes.released[0]) < 0.01, 'left stick springs back to centre on release');

  // End-to-end: enter a room, then press Menu → the Options overlay opens (proves the
  // synthetic pad is read by pollGamepadInput on the real per-frame path).
  await p.evaluate(() => window.__ff.enterRoom(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 6000 });
  const optHidden = () => p.evaluate(() => document.getElementById('pad-options').hidden);
  expect((await optHidden()) === true, 'Options overlay hidden before Menu');
  // Hold Menu across a few frames so pollGamepadInput sees the rising edge, then release.
  await p.locator('#vg-root .vg-menu').dispatchEvent('pointerdown', { pointerId: 3 });
  await p.waitForTimeout(200);
  await p.locator('#vg-root .vg-menu').dispatchEvent('pointerup', { pointerId: 3 });
  await p.waitForFunction(() => document.getElementById('pad-options').hidden === false, { timeout: 3000 });
  expect((await optHidden()) === false, 'Menu opened the Options overlay via the synthetic pad');
});
