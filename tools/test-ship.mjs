/** UI probe: Silver's Ship branch (rooms 45-51). Each room loads, has an active script,
 *  and runs 40 ticks without throwing. MAPA (51) confirms its gspec=9 push-out mode. */
import { withApp } from './ui-lib.mjs';

const ROOMS = [
  [45, 'KAJUTA1'], [46, 'TRUP'], [47, 'DELA'], [48, 'KUCHYNE'],
  [49, 'KAJUTA2'], [50, 'VLADOVA'], [51, 'MAPA'],
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  for (const [num, name] of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    expect(await p.evaluate(() => window.__ff.script() !== null), `${name} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await p.waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 7000 }).catch(() => {});
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 40, `${name} (room ${num}) ran ${advanced} ticks without error`);
    console.log(`${name} OK (${advanced} ticks)`);
  }
  await p.evaluate(() => window.__ff.enterRoomAwait(51));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'MAPA is a gspec=9 room');
});
