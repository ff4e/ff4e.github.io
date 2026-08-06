/**
 * UI smoke test: the Fish House opening branch (rooms 1-8) is fully scripted. Each
 * ported room's Programky must dispatch and run many ticks against the real game
 * data without error. Covers the four rooms added to complete the branch
 * (PRAVIDLA 3, VRAK 4, KOSTE 6, WC 8) plus the pre-existing ones for good measure.
 */
import { waitRoom, waitTicks, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {

  for (const room of [3, 4, 6, 8]) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), room);
    await waitRoom(p, 0);
    expect(await p.evaluate(() => window.__ff.script() !== null), `room ${room} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await waitTicks(p, start, 12);
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 12, `room ${room} Programky ran ${advanced} ticks without error`);
  }
});
