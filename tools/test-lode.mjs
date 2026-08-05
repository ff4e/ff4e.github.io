/** UI probe: LODE (room 19) — the gspec=9 "push a god out" room (URoom.pas:7930).
 *  Verifies it runs clean, gspec=9 + vytlacit=1 are set, and that shoving buh2 to
 *  the room edge marks room 19 solved (Spec9 -> host exit-slide -> win). */
import { budget, waitRoom, waitTicks, withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: budget(5000) });
  await p.evaluate(() => window.__ff.enterRoomAwait(19));
  await waitRoom(p, 3);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'LODE has an active script');
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'LODE is a gspec=9 room');
  expect(await p.evaluate(() => window.__ff.vytlacit()) === 1, 'LODE vytlacit=1');
  // A save written before gspec:=9 was restored recorded gspec=0. Loading it must NOT
  // downgrade the room back to "fish may exit" (script.ts applySnapshot).
  await p.evaluate(() => window.__ff.save());
  await p.evaluate(() => {
    const k = Object.keys(localStorage).find((x) => x.startsWith('ff.save.'));
    if (!k) return;
    const o = JSON.parse(localStorage.getItem(k));
    if (!o.vars) return;
    o.vars.gspec = 0;
    localStorage.setItem(k, JSON.stringify(o));
  });
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading(), null, { timeout: budget(10000) }).catch(() => {});
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'a stale gspec=0 save does not re-break LODE');
  // Run a bit so the gods' battleship theatre ticks without error.
  const start = await p.evaluate(() => window.__ff.count());
  await waitTicks(p, start, 40);
  expect((await p.evaluate(() => window.__ff.count())) - start >= 40, 'LODE ran 40 ticks without error');
  // Push buh2 (item 1, the 6x6 god) to the left edge -> Spec9 marks it -> host slides + wins.
  await p.evaluate(() => window.__ff.moveItem(1, 0, window.__ff.itemState(1).y));
  await p.waitForFunction(() => window.__ff.solvedRooms().includes(19), null, { timeout: budget(5000) });
  expect(await p.evaluate(() => window.__ff.solvedRooms().includes(19)), 'pushing a god out wins the room');
  console.log('LODE OK: gspec=9 push-out win verified');
});
