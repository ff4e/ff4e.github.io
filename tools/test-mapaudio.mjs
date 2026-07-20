/**
 * UI test: the map/room audio lifecycle (faithful KillSnd + zrus_dialogy +
 * SpustHudbu). The map plays the menu music; entering a room switches to the room
 * track; leaving to the map kills all voices, clears the dialogue queue, and
 * restores the menu music.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 8000 });
  await p.mouse.click(450, 600); // a gesture to unlock the AudioContext
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.music() === 'menu', { timeout: 20000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'menu', 'map plays the menu music');

  // Enter PRVNI (cHud=4 -> rybky04): room music replaces the menu music.
  await p.evaluate(() => window.__ff.enterRoom(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.music() === 'rybky04', { timeout: 20000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.music())) === 'rybky04', 'room plays its own track');

  // Let PRVNI queue its opening dialogue.
  await p.waitForFunction(() => window.__ff.voicePlaying() || window.__ff.script()?.dialog, { timeout: 15000 }).catch(() => {});

  // Leave to the map: voices killed, dialogue queue cleared, menu music restored.
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(300);
  expect(!(await p.evaluate(() => window.__ff.voicePlaying())), 'voices killed on leaving');
  expect(!(await p.evaluate(() => window.__ff.script()?.dialog)), 'dialogue queue cleared on leaving');
  expect((await p.evaluate(() => window.__ff.music())) === 'menu', 'menu music restored on the map');
});
