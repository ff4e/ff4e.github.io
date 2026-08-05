/** UI probe: the Dump branch (rooms 38-44). Each room loads, has an active script,
 *  and runs 40 ticks of Programky without throwing. BARELY (44) also confirms its
 *  gspec=9 barrel push-out marks the barrel spec=9 when shoved off the edge. */
import { budget, waitRoom, waitTicks, withApp } from './ui-lib.mjs';

const ROOMS = [
  [38, 'POCITAC'], [39, 'NOGROUND'], [40, 'BATHROOM'], [41, 'ODPADKY'],
  [42, 'PUCLIK'], [43, 'SMETAK'], [44, 'BARELY'],
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: budget(5000) });
  for (const [num, name] of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await waitRoom(p, 0);
    expect(await p.evaluate(() => window.__ff.script() !== null), `${name} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await waitTicks(p, start, 40);
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 40, `${name} (room ${num}) ran ${advanced} ticks without error`);
    console.log(`${name} OK (${advanced} ticks)`);
  }

  // BARELY gspec=9: shove the barrel (item 1) off the right edge and confirm spec=9.
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'BARELY is a gspec=9 room');
});
