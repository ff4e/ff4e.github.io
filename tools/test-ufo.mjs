/** UI probe: UFO (room 22). Runs many ticks without error; confirms item 15
 *  (dlouha) exists (the intro/remark logic reads its Y). */
import { waitRoom, waitTicks, withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.evaluate(() => window.__ff.enterRoomAwait(22));
  await waitRoom(p, 0);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'UFO has an active script');
  expect(await p.evaluate(() => window.__ff.itemState(15) !== null), 'UFO item 15 (dlouha) exists');
  const start = await p.evaluate(() => window.__ff.count());
  await waitTicks(p, start, 40);
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 40, `UFO Programky ran ${advanced} ticks without error`);
  console.log('UFO dlouha:', JSON.stringify(await p.evaluate(() => window.__ff.itemState(15))));
});
