/** UI probe: SPUNT (room 29) — the gspec=9 "push the cork out" room. Verifies it
 *  runs clean, gspec=9 + vytlacit=1 are set, the decor items exist, and the
 *  cork-push-out WIN fires (pushing the cork to the edge marks room 29 solved). */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(29));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 3, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'SPUNT has an active script');
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'SPUNT is a gspec=9 room');
  expect(await p.evaluate(() => window.__ff.vytlacit()) === 1, 'SPUNT vytlacit=1');
  for (const i of [1, 7, 11, 12, 16, 17, 18, 19])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `SPUNT item ${i} exists`);
  // Run a bit to exercise the decor/dialogue without error.
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 7000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.count())) - start >= 40, 'SPUNT ran 40 ticks without error');
  // Push the cork (item 1) to the left edge -> Spec9 marks it -> host slides + wins.
  await p.evaluate(() => window.__ff.moveItem(1, 0, window.__ff.itemState(1).y));
  await p.waitForFunction(() => window.__ff.solvedRooms().includes(29), null, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.solvedRooms().includes(29)), 'pushing the cork out wins the room');
  console.log('SPUNT OK: gspec=9 push-out win verified');
});
