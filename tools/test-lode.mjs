/** UI probe: LODE (room 19) — the gspec=9 "push a god out" room (URoom.pas:7930).
 *  Verifies it runs clean, gspec=9 + vytlacit=1 are set, and that shoving buh2 to
 *  the room edge marks room 19 solved (Spec9 -> host exit-slide -> win). */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(19));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 3, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'LODE has an active script');
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'LODE is a gspec=9 room');
  expect(await p.evaluate(() => window.__ff.vytlacit()) === 1, 'LODE vytlacit=1');
  // Run a bit so the gods' battleship theatre ticks without error.
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 7000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.count())) - start >= 40, 'LODE ran 40 ticks without error');
  // Push buh2 (item 1, the 6x6 god) to the left edge -> Spec9 marks it -> host slides + wins.
  await p.evaluate(() => window.__ff.moveItem(1, 0, window.__ff.itemState(1).y));
  await p.waitForFunction(() => window.__ff.solvedRooms().includes(19), null, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.solvedRooms().includes(19)), 'pushing a god out wins the room');
  console.log('LODE OK: gspec=9 push-out win verified');
});
