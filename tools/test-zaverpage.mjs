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
import { budget, observed, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  const bootDocument = await p.evaluate(() => performance.timeOrigin);
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  // withApp enables the dev pane BEFORE boot. Reloading to enable it again can abort
  // the lazy AI-map response body: hasMap means the faithful map exists, not that its
  // AI art has arrived. Keep this document through the whole win/return flow.

  await p.evaluate(() => window.__ff.enterRoomAwait(71));
  await p.waitForFunction(() => window.__ff.roomNum() === 71);
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'ZAVER is running');

  // Wait for the engine to settle, then drive a genuine win.
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  await p.evaluate(() => window.__ff.winRoom());

  // The win countdown lapses, returnFromRoom runs, and the page comes up.
  const shown = await observed(
    p.waitForFunction(() => window.__ff.legImage() === 9, null, { timeout: budget(15000) }),
  );
  expect(shown, `ZAVER ends on story page 9 (got ${await p.evaluate(() => window.__ff.legImage())})`);
  expect((await p.evaluate(() => window.__ff.screen())) === 'legimage', 'the story page is the active screen');

  // Dismissing it returns to the map, not into another room.
  await p.keyboard.press('Escape');
  const toMap = await observed(
    p.waitForFunction(() => window.__ff.screen() === 'map'),
  );
  expect(toMap, 'dismissing the page returns to the world map');
  // screen === 'map' changes on dismissal; mapPresented waits for the selected tier's
  // art to finish loading and an actual map frame to reach the canvas.
  await p.waitForFunction(() => window.__ff.mapPresented(), null, { timeout: budget(15000) });
  expect(
    (await p.evaluate(() => performance.timeOrigin)) === bootDocument,
    'the win/return flow keeps the booted document without cancelling startup assets',
  );
});
