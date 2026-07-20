/**
 * UI test: the developer bar's Room and Renderer pickers stay in sync with reality.
 *  - The game opens on the world map, so the Room picker starts on "map" (not a room).
 *  - Entering a room selects that room; pressing Escape back to the map re-selects "map".
 *  - The Renderer picker defaults to WebGL and reflects the live backend.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.screen, { timeout: 8000 });
  const roomVal = () => p.$eval('#room', (el) => el.value);
  const rendVal = () => p.$eval('#renderer', (el) => el.value);

  // Boot: opens on the map, so the Room picker shows "map", not a stale room.
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'boots on the world map');
  expect((await roomVal()) === 'map', `Room picker starts on "map" (got "${await roomVal()}")`);

  // Renderer defaults to WebGL.
  expect((await rendVal()) === 'webgl', `Renderer picker defaults to WebGL (got "${await rendVal()}")`);
  expect((await p.evaluate(() => window.__ff.renderer())) === 'webgl', 'renderer backend is webgl by default');

  // Entering a room selects it in the picker.
  await p.evaluate(() => window.__ff.enterRoomAwait(12));
  await p.waitForFunction(() => window.__ff.screen() === 'room', { timeout: 5000 });
  expect((await roomVal()) === '12', `Room picker follows into room 12 (got "${await roomVal()}")`);

  // Escape back to the map re-syncs the picker to "map".
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect((await roomVal()) === 'map', `Room picker returns to "map" after Escape (got "${await roomVal()}")`);
});
