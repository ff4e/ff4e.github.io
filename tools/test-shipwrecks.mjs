/**
 * UI smoke test: the Ship Wrecks branch (rooms 9-19). Each ported room's
 * Programky must dispatch and run many ticks against the real game data without
 * error. Rooms are added here as they are ported; ZRC (9) is the first, and it
 * exercises the new `xicht` (facial-expression) engine primitive.
 */
import { withApp } from './ui-lib.mjs';

const PORTED = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]; // all Ship Wrecks rooms (9-19).

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  for (const room of PORTED) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), room);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    expect(await p.evaluate(() => window.__ff.script() !== null), `room ${room} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await p.waitForFunction((s) => window.__ff.count() >= s + 12, start, { timeout: 5000 }).catch(() => {});
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 12, `room ${room} Programky ran ${advanced} ticks without error`);
  }
});
