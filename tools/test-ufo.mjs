/** UI probe: UFO (room 22). Runs many ticks without error; confirms item 15
 *  (dlouha) exists (the intro/remark logic reads its Y). */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(22));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'UFO has an active script');
  expect(await p.evaluate(() => window.__ff.itemState(15) !== null), 'UFO item 15 (dlouha) exists');
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 7000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 40, `UFO Programky ran ${advanced} ticks without error`);
  console.log('UFO dlouha:', JSON.stringify(await p.evaluate(() => window.__ff.itemState(15))));
});
