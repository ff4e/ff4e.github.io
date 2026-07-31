/**
 * UI test: ZAVER (room 71, the endgame) closes on its story page.
 *
 * 009.$dv — the medals and the congratulation letter from ŠÉF — is the ninth story page
 * and the only one no leg win can reach: legs 1..8 map to 001..008, and branches 0 and 9
 * have no depth-15 room at all. The original shows it when ZAVER is LAUNCHED (its
 * Hloubka=16 branch); this port shows it when the finale ENDS, which is a deliberate
 * deviation recorded in returnFromRoom.
 *
 * Drives the real win path (engine.triggerWin -> onWin -> the auto-return countdown ->
 * returnFromRoom) rather than calling showLegImage directly, so it asserts the WIRING.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 15000 });
  // devWinRoom is armed only while the dev pane is enabled.
  await p.evaluate(() => localStorage.setItem('ff.devEnabled', '1'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 15000 });

  await p.evaluate(() => window.__ff.enterRoomAwait(71));
  await p.waitForFunction(() => window.__ff.roomNum() === 71, { timeout: 20000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'ZAVER is running');

  // Wait for the engine to settle, then drive a genuine win.
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 30000 });
  await p.evaluate(() => window.__ff.winRoom());

  // The win countdown lapses, returnFromRoom runs, and the page comes up.
  const shown = await p
    .waitForFunction(() => window.__ff.legImage() === 9, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  expect(shown, `ZAVER ends on story page 9 (got ${await p.evaluate(() => window.__ff.legImage())})`);
  expect((await p.evaluate(() => window.__ff.screen())) === 'legimage', 'the story page is the active screen');

  // Dismissing it returns to the map, not into another room.
  await p.keyboard.press('Escape');
  const toMap = await p
    .waitForFunction(() => window.__ff.screen() === 'map', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  expect(toMap, 'dismissing the page returns to the world map');
});
