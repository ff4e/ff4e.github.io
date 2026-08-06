/**
 * UI smoke test: the Ship Wrecks branch (rooms 9-19). Each ported room's
 * Programky must dispatch and run many ticks against the real game data without
 * error. Rooms are added here as they are ported; ZRC (9) is the first, and it
 * exercises the new `xicht` (facial-expression) engine primitive.
 */
import { waitRoom, waitTicks, withApp } from './ui-lib.mjs';

const PORTED = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; // all Ship Wrecks rooms (9-19).

await withApp(async ({ p, expect }) => {

  for (const room of PORTED) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), room);
    await waitRoom(p, 0);
    expect(await p.evaluate(() => window.__ff.script() !== null), `room ${room} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await waitTicks(p, start, 12);
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 12, `room ${room} Programky ran ${advanced} ticks without error`);
  }
});
