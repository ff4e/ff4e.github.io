/**
 * UI test: the developer bar's Room, Renderer and Graphics pickers stay in sync with reality.
 *  - The game opens on the world map, so the Room picker starts on "map" (not a room).
 *  - Entering a room selects that room; pressing Escape back to the map re-selects "map".
 *  - The Renderer picker defaults to WebGL and reflects the live backend.
 *  - The Graphics picker defaults to enhanced, follows the E hotkey cycle, and drives setGraphics on change.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.screen, { timeout: 8000 });
  const roomVal = () => p.$eval('#room', (el) => el.value);
  const rendVal = () => p.$eval('#renderer', (el) => el.value);
  const gfxVal = () => p.$eval('#graphics', (el) => el.value);

  // Boot: opens on the map, so the Room picker shows "map", not a stale room.
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'boots on the world map');
  expect((await roomVal()) === 'map', `Room picker starts on "map" (got "${await roomVal()}")`);

  // Renderer defaults to WebGL.
  expect((await rendVal()) === 'webgl', `Renderer picker defaults to WebGL (got "${await rendVal()}")`);
  expect((await p.evaluate(() => window.__ff.renderer())) === 'webgl', 'renderer backend is webgl by default');

  // Graphics picker defaults to enhanced and matches the live level.
  expect((await gfxVal()) === 'enhanced', `Graphics picker defaults to enhanced (got "${await gfxVal()}")`);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'graphics level is enhanced by default');

  // The E hotkey cycles classic → enhanced → ai → classic, and the picker mirrors it.
  await p.keyboard.press('e'); // enhanced -> ai
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'ai', 'E cycles enhanced -> ai');
  expect((await gfxVal()) === 'ai', `Graphics picker mirrors the E hotkey (got "${await gfxVal()}")`);
  await p.keyboard.press('e'); // ai -> classic
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'classic', 'E cycles ai -> classic');
  await p.keyboard.press('e'); // classic -> enhanced (back to default)
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'E cycles classic -> enhanced');

  // Changing the picker drives the graphics level.
  await p.evaluate(() => {
    const sel = document.getElementById('graphics');
    sel.value = 'ai';
    sel.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'ai', 'Graphics picker change sets the level to ai');
  // Restore the default so this test leaves no persisted side effect for others.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));

  // Entering a room selects it in the picker.
  await p.evaluate(() => window.__ff.enterRoomAwait(12));
  await p.waitForFunction(() => window.__ff.screen() === 'room', { timeout: 5000 });
  expect((await roomVal()) === '12', `Room picker follows into room 12 (got "${await roomVal()}")`);

  // Escape back to the map re-syncs the picker to "map".
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect((await roomVal()) === 'map', `Room picker returns to "map" after Escape (got "${await roomVal()}")`);
});
