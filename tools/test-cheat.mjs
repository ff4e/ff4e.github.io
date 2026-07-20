/**
 * UI test: the xwemaketherules cheat (URoom.pas:24666). Invoked in a room it marks
 * the room completed-via-cheat, records it in the progression, and returns to the
 * map — which then unlocks the next room.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '7'); // UTES (Fish House room index 6 -> global 7)
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => {
    localStorage.removeItem('ff.solved');
    localStorage.removeItem('ff.cheated');
  });
  await p.waitForTimeout(200);

  // Type the cheat string; it should solve the room and return to the map.
  await p.evaluate(() => window.__ff.cheat());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'cheat returns to the map');
  expect(await p.evaluate(() => window.__ff.cheatedRooms().includes(7)), 'room 7 recorded as cheat-solved');

  // The cheated room counts as solved for the map (its node is clickable / branch open).
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(150);
  expect((await p.evaluate(() => window.__ff.mapHit(292, 315))) === 7, 'cheated room 7 node present on the map');

  // Also reachable via the keyboard cheat-string detector: type it while in a room.
  await p.evaluate(() => window.__ff.enterRoom(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  for (const ch of 'xwemaketherules') await p.keyboard.press(ch);
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.cheatedRooms().includes(1)), 'typed cheat solved room 1');

  // xscore easter egg: typing it (here from the map) opens the hidden SCORE bonus room
  // (room 72) — the only way in, since SCORE is never on the map or the finale.
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 });
  for (const ch of 'xscore') await p.keyboard.press(ch);
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect((await p.$eval('#room', (el) => el.value)) === '72', 'xscore opens the SCORE room (72)');
  expect((await p.evaluate(() => window.__ff.zaverMode())) === false, 'SCORE is not the ZAVER finale cutscene');
});
