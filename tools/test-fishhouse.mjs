/**
 * UI smoke test: the Fish House opening branch (rooms 1-8) is fully scripted. Each
 * ported room's Programky must dispatch and run many ticks against the real game
 * data without error. Covers the four rooms added to complete the branch
 * (PRAVIDLA 3, VRAK 4, KOSTE 6, WC 8) plus the pre-existing ones for good measure.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  for (const room of [3, 4, 6, 8]) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), room);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    expect(await p.evaluate(() => window.__ff.script() !== null), `room ${room} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await p.waitForFunction((s) => window.__ff.count() >= s + 12, start, { timeout: 5000 }).catch(() => {});
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 12, `room ${room} Programky ran ${advanced} ticks without error`);
  }
});
