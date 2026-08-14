/**
 * UI test: the developer bar's Room, Renderer, Graphics and Subtitles pickers stay in sync with reality.
 *  - The game opens on the world map, so the Room picker starts on "map" (not a room).
 *  - Entering a room selects that room; pressing Escape back to the map re-selects "map".
 *  - The Renderer picker defaults to WebGL and reflects the live backend.
 *  - The Graphics picker defaults to enhanced, follows the E hotkey cycle, and drives setGraphics on change.
 *  - The Subtitles picker and __ff.setSubRenderer drive each other, so they cannot disagree.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.screen);
  const roomVal = () => p.$eval('#room', (el) => el.value);
  const rendVal = () => p.$eval('#renderer', (el) => el.value);
  const gfxVal = () => p.$eval('#graphics', (el) => el.value);

  // Boot: opens on the map, so the Room picker shows "map", not a stale room.
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'boots on the world map');
  expect((await roomVal()) === 'map', `Room picker starts on "map" (got "${await roomVal()}")`);

  // Renderer defaults to WebGL.
  expect((await rendVal()) === 'webgl', `Renderer picker defaults to WebGL (got "${await rendVal()}")`);
  expect((await p.evaluate(() => window.__ff.renderer())) === 'webgl', 'renderer backend is webgl by default');

  // Graphics picker defaults to the AI tier and matches the live level.
  expect((await gfxVal()) === 'ai', `Graphics picker defaults to ai (got "${await gfxVal()}")`);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'ai', 'graphics level is ai by default');

  // The E hotkey cycles classic → enhanced → ai → classic, and the picker mirrors it.
  await p.keyboard.press('e'); // ai -> classic
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'classic', 'E cycles ai -> classic');
  expect((await gfxVal()) === 'classic', `Graphics picker mirrors the E hotkey (got "${await gfxVal()}")`);
  await p.keyboard.press('e'); // classic -> enhanced
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'E cycles classic -> enhanced');
  await p.keyboard.press('e'); // enhanced -> ai (back to default)
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.graphics())) === 'ai', 'E cycles enhanced -> ai');

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

  // The Subtitles picker and __ff.setSubRenderer are two doors onto one switch, so the
  // risk worth pinning is that they DISAGREE — a picker reading 'canvas' while the DOM
  // renderer is live is a lie told to whoever is comparing the two side by side. Both
  // directions, because only one of them is a listener. It shows the PREFERENCE, not the
  // resolved renderer: 'auto' is the shipped default and resolves by art tier.
  const subVal = () => p.$eval('#subrenderer', (el) => el.value);
  expect((await subVal()) === 'auto', `Subtitles picker defaults to auto (got "${await subVal()}")`);
  await p.evaluate(() => {
    const sel = document.getElementById('subrenderer');
    sel.value = 'dom';
    sel.dispatchEvent(new Event('change'));
  });
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.subRenderer())) === 'dom', 'Subtitles picker change selects the DOM renderer');
  await p.evaluate(() => window.__ff.setSubRenderer('canvas'));
  await p.waitForTimeout(50);
  expect((await subVal()) === 'canvas', `the Subtitles picker mirrors __ff.setSubRenderer (got "${await subVal()}")`);
  // Restore the default so this test leaves no persisted side effect for others.
  await p.evaluate(() => window.__ff.setSubRenderer('auto'));
  await p.waitForTimeout(50);
  expect((await subVal()) === 'auto', 'the picker returns to auto');

  // Modifier chords must NOT reach the single-key dev toggles. Cmd/Ctrl+R is the one
  // that hurt: it toggled the renderer and persisted it, so the backend flipped
  // CPU/WebGL on every keyboard reload, while the toolbar reload button — which fires
  // no keydown — left it alone. Cmd+P, Cmd+E, Cmd+F and Cmd+G were the same class.
  const renderer0 = await p.evaluate(() => window.__ff.renderer());
  const graphics0 = await p.evaluate(() => window.__ff.graphics());
  const saver0 = await p.evaluate(() => localStorage.getItem('ff.renderOnDirty'));
  for (const chord of ['Meta+r', 'Control+r', 'Meta+e', 'Control+e', 'Meta+p', 'Alt+r']) {
    await p.keyboard.press(chord);
    await p.waitForTimeout(30);
  }
  expect(
    (await p.evaluate(() => window.__ff.renderer())) === renderer0,
    `Cmd/Ctrl/Alt+R leaves the renderer alone (was ${renderer0})`,
  );
  expect((await rendVal()) === renderer0, 'the Renderer picker is untouched by modifier chords');
  expect(
    (await p.evaluate(() => window.__ff.graphics())) === graphics0,
    `Cmd/Ctrl+E leaves the graphics level alone (was ${graphics0})`,
  );
  expect(
    (await p.evaluate(() => localStorage.getItem('ff.renderOnDirty'))) === saver0,
    'Cmd+P leaves the idle-FPS saver alone',
  );

  // ...but the BARE key still works. (Shift stays a legal dev modifier — Shift+F walks
  // the subtitle fonts backwards — so the guard blocks only Meta/Ctrl/Alt.)
  await p.keyboard.press('r');
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.renderer())) !== renderer0, 'a BARE r still toggles the renderer');
  await p.keyboard.press('r');
  await p.waitForTimeout(50);
  expect((await p.evaluate(() => window.__ff.renderer())) === renderer0, 'and a second bare r toggles it back');

  // Entering a room selects it in the picker.
  await p.evaluate(() => window.__ff.enterRoomAwait(12));
  await p.waitForFunction(() => window.__ff.screen() === 'room');
  expect((await roomVal()) === '12', `Room picker follows into room 12 (got "${await roomVal()}")`);

  // Escape back to the map re-syncs the picker to "map".
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  expect((await roomVal()) === 'map', `Room picker returns to "map" after Escape (got "${await roomVal()}")`);
});
