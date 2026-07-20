/** UI probe: the "First Bizarre Things" branch (rooms 30-37). Each room loads, has
 *  an active script, and runs 40 ticks of Programky without throwing. */
import { withApp } from './ui-lib.mjs';

const ROOMS = [
  [30, 'RECYCLED'],
  [31, 'BLUDISTE'],
  [32, 'NCP'],
  [33, 'MIKRO'],
  [34, 'KORALY'],
  [35, 'KANKAN'],
  [36, 'JEDNICKY'],
  [37, 'ZELVA'],
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  for (const [num, name] of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(
      () => window.__ff.screen() === 'room' && window.__ff.count() > 0,
      { timeout: 5000 },
    );
    expect(await p.evaluate(() => window.__ff.script() !== null), `${name} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await p
      .waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 7000 })
      .catch(() => {});
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 40, `${name} (room ${num}) ran ${advanced} ticks without error`);
    console.log(`${name} OK (${advanced} ticks)`);
  }
});
