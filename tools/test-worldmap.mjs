/**
 * UI test: the world map with the faithful Resena progression. Only reachable
 * nodes are clickable; branch rooms unlock strictly in order; solving a feeder
 * room opens the next branch; clicking a reachable node enters the room.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 8000 });
  await p.evaluate(() => localStorage.removeItem('ff.solved'));
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(300);
  expect(await p.evaluate(() => window.__ff.hasMap()), 'world-map assets loaded');
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'on the map screen');

  const hit = (x, y) => p.evaluate(({ x, y }) => window.__ff.mapHit(x, y), { x, y });

  // Nothing solved: only room 1 is reachable; room 2/8 hidden; Ship Wrecks locked.
  expect((await hit(320, 121)) === 1, 'Fish House room 1 is reachable/clickable');
  expect((await hit(329, 153)) === 0, 'Fish House room 2 hidden until room 1 solved');
  expect((await hit(314, 338)) === 0, 'Fish House room 8 hidden');
  expect((await hit(340, 228)) === 0, 'Ship Wrecks (room 9) locked');
  expect((await hit(5, 5)) === 0, 'empty space misses');

  // Solve room 1 -> room 2 becomes reachable (strict order).
  await p.evaluate(() => window.__ff.markSolved(1));
  await p.waitForTimeout(120);
  expect((await hit(329, 153)) === 2, 'room 2 reachable after room 1 solved');
  expect((await hit(320, 189)) === 0, 'room 3 still hidden (needs room 2)');

  // Solve rooms up to the feeder (room 4) -> Ship Wrecks opens.
  await p.evaluate(() => [2, 3, 4].forEach((n) => window.__ff.markSolved(n)));
  await p.waitForTimeout(120);
  expect((await hit(340, 228)) === 9, 'Ship Wrecks room 9 reachable after feeder (room 4) solved');
  expect((await hit(381, 224)) === 0, 'Ship Wrecks room 10 hidden until room 9 solved');

  // Entering a reachable room from the map switches screens.
  await p.evaluate(() => window.__ff.enterRoom(7));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'entered a room from the map');
});
