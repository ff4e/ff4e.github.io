/**
 * UI test: cas_hry, the play time ZAVER's finale narrates as an hour count
 * (USoutez.pas:263 + 695, consumed at URoom.pas:23472).
 *
 * The original sums, over all rooms, the time spent INSIDE each room, banked when
 * the visit ends and kept in its saved records — so map and menu time never
 * count, the figure survives across sessions, and the room you are currently in
 * has not been added yet. The port used to report wall-clock since page load.
 */
import { waitRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.evaluate(() => localStorage.removeItem('ff.playtime'));
  await p.reload();
  await p.waitForFunction(() => window.__ff && window.__ff.screen);

  expect((await p.evaluate(() => window.__ff.casHry())) === 0, 'a fresh profile has no play time');

  // Time on the MAP must not count.
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(600);
  expect((await p.evaluate(() => window.__ff.casHry())) === 0, 'map time does not count');

  // Time in a room counts, but only once the visit is closed.
  await p.evaluate(() => window.__ff.enterRoomAwait(7));
  await waitRoom(p, 0);
  await p.waitForTimeout(700);
  expect(
    (await p.evaluate(() => window.__ff.casHry())) === 0,
    'the visit in progress is not counted yet (the original banks it on room close)',
  );

  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  const banked = await p.evaluate(() => window.__ff.playTime());
  expect(banked['7'] >= 600, `leaving the room banks its time (got ${banked['7']}ms)`);
  const afterOne = await p.evaluate(() => window.__ff.casHry());
  expect(afterOne > 0, 'cas_hry counts the finished visit');

  // A second room accumulates on top, per room.
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 0);
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  const two = await p.evaluate(() => window.__ff.playTime());
  expect(two['1'] > 0 && two['7'] > 0, 'each room banks its own time');
  expect(
    (await p.evaluate(() => window.__ff.casHry())) > afterOne,
    'cas_hry is the sum over all rooms',
  );

  // ---- the whole point: it survives a session ---------------------------------
  const before = await p.evaluate(() => window.__ff.casHry());
  await p.reload();
  await p.waitForFunction(() => window.__ff && window.__ff.casHry);
  const after = await p.evaluate(() => window.__ff.casHry());
  expect(
    Math.abs(after - before) < 1e-9,
    `play time survives a reload (${before} -> ${after})`,
  );

  // And idle time on the map still does not inflate it.
  await p.waitForTimeout(700);
  expect(
    (await p.evaluate(() => window.__ff.casHry())) === after,
    'sitting on the map after a reload adds nothing',
  );

  console.log('cas_hry OK: per-room banking, map time excluded, cross-session total');
},
  // A load still in flight when this probe navigates rejects as a truncated body, and
  // the name of the asset is now logged (the failure screen is generic — see
  // failAssets). The behaviour is unchanged; only the log line is new, so it is
  // tolerated narrowly rather than by allowing asset failures in general.
  { allowErrors: /asset failed \(\w+\): .*truncated response/ },
);
