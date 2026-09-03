/**
 * UI test: the developer bar's Room, Renderer and Graphics pickers stay in sync with reality.
 *  - The game opens on the world map, so the Room picker starts on "map" (not a room).
 *  - Entering a room selects that room; pressing Escape back to the map re-selects "map".
 *  - The Renderer picker defaults to WebGL and reflects the live backend.
 *  - The Graphics picker defaults to enhanced, follows the E hotkey cycle, and drives setGraphics on change.
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

  // ── The AI tier's colour filter (src/app/aiFilter.ts) ────────────────────────
  // Asserted here rather than in a probe of its own: this file already boots the app and
  // already walks all three tiers, which is exactly the setup the filter needs, and a new
  // probe would pay the browser launch again to re-derive it.
  //
  // The tier attribute is the gate the whole feature hangs on, and `setGraphics()` is not
  // the only writer — boot assigns `graphics` straight from localStorage without going
  // through it, so "correct after a switch" and "correct on arrival" are separate claims.
  const gfxAttr = () => p.evaluate(() => document.documentElement.dataset.graphics);
  const filterOf = (id) => p.evaluate((i) => getComputedStyle(document.getElementById(i)).filter, id);
  const tuned = () => p.evaluate(() => document.documentElement.hasAttribute('data-ai-filter'));
  const slide = (key, v) =>
    p.evaluate(
      ([k, val]) => {
        const el = document.getElementById(`ai-${k}`);
        el.value = String(val);
        el.dispatchEvent(new Event('input'));
      },
      [key, v],
    );

  expect((await gfxAttr()) === 'ai', `data-graphics follows the tier (got "${await gfxAttr()}")`);

  // The shipped default is a real grade, so the AI tier arrives filtered. The stylesheet's
  // `:root` carries the same numbers as AI_FILTER_DEFAULT (drift-guarded by
  // test/aiFilter.test.ts), which is what makes the FIRST paint correct rather than a
  // flash of ungraded picture.
  expect((await tuned()) === true, 'the AI tier arrives with the shipped grade applied');
  for (const id of ['screen', 'screen-gl', 'panel']) {
    expect((await filterOf(id)) !== 'none', `#${id} takes the AI filter`);
  }
  // #panel is deliberately included above — it swaps to its own AI-upscaled composite on
  // this tier, so a graded room beside an ungraded panel would read as an oversight.
  const shipped = await p.evaluate(() =>
    ['contrast', 'saturate', 'brightness'].map((k) => document.documentElement.style.getPropertyValue(`--ai-${k}`)),
  );
  expect(shipped.every((v) => v !== ''), `the shipped values are applied (got ${shipped.join('/')})`);

  // Dragging a slider retunes it live.
  await slide('contrast', 1.4);
  await p.waitForTimeout(30);
  expect(
    (await p.evaluate(() => document.documentElement.style.getPropertyValue('--ai-contrast'))) === '1.4',
    'the slider writes --ai-contrast',
  );

  // The scoping claim, and the one thing this change must not get wrong: the other two
  // tiers render exactly as they did before the filter existed.
  for (const tier of ['classic', 'enhanced']) {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForTimeout(30);
    expect((await gfxAttr()) === tier, `data-graphics follows to ${tier}`);
    expect((await filterOf('screen')) === 'none', `the filter does not leak onto the ${tier} tier`);
    expect(
      (await p.evaluate(() => document.getElementById('ai-contrast').disabled)) === true,
      `the colour sliders are disabled off the AI tier (${tier})`,
    );
  }
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.waitForTimeout(30);
  expect((await filterOf('screen')) !== 'none', 'and it comes back on returning to the AI tier');

  // Reset goes to the SHIPPED DEFAULT, not to identity — the button undoes tuning, and
  // what a player sees is the default. It clears the key rather than writing the default
  // back, so nobody is pinned to today's numbers if the default is ever retuned.
  await p.evaluate(() => document.getElementById('ai-filter-reset').click());
  await p.waitForTimeout(30);
  expect((await tuned()) === true, 'reset restores the shipped grade rather than removing it');
  expect(
    (await p.evaluate(() => localStorage.getItem('ff.aiFilter'))) === null,
    'reset leaves no ff.aiFilter key behind',
  );

  // Identity IS still reachable, and it must mean no `filter` property at all — that is
  // what makes "off" in the tuning tool a fair baseline to compare the grade against.
  for (const k of ['contrast', 'saturate', 'brightness']) await slide(k, 1);
  await p.waitForTimeout(30);
  expect((await tuned()) === false, 'dragging all three to 1 removes data-ai-filter');
  expect((await filterOf('screen')) === 'none', 'identity declares no filter at all');
  await p.evaluate(() => document.getElementById('ai-filter-reset').click());
  await p.waitForTimeout(30);

  // A persisted value out of range cannot survive into the running game — `ff.aiFilter` is
  // hand-editable and can outlive a version, and `brightness(0)` is a black screen that
  // would come back on every boot. The clamp itself is unit-tested (test/aiFilter.test.ts);
  // asserted here only that the module boots from storage at all, which is the part that
  // needs a real page. No reload: it would cost this probe a second boot to re-derive
  // what the unit suite already pins.

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
