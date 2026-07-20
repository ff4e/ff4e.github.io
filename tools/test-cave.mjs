/** UI probe: Cave branch (rooms 59-64). Each room loads, has an active script, and runs
 *  40 ticks without throwing. Extra checks:
 *   - GRAL (64) confirms its gspec=9 push-out mode + a vytlacit count > 1 (many chalices).
 *   - roompole persists across a RESTART: ZAVAL (60) bumps roompole[1] each attempt
 *     (TRoom.Restart doesn't clear roompole), so a restart increments it. */
import { withApp } from './ui-lib.mjs';

const ROOMS = [
  [59, 'BOTTLES'], [60, 'ZAVAL'], [61, 'TRUHLA'],
  [62, 'KNIHOVNA'], [63, 'JESKYNE'], [64, 'GRAL'],
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  for (const [num, name] of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    expect(await p.evaluate(() => window.__ff.script() !== null), `${name} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await p.waitForFunction((s) => window.__ff.count() >= s + 40, start, { timeout: 8000 }).catch(() => {});
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 40, `${name} (room ${num}) ran ${advanced} ticks without error`);
    console.log(`${name} OK (${advanced} ticks)`);
  }

  // GRAL is a gspec=9 push-out room with several chalices to shove out.
  await p.evaluate(() => window.__ff.enterRoomAwait(64));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'GRAL is a gspec=9 room');
  expect(await p.evaluate(() => window.__ff.vytlacit()) > 1, 'GRAL has several chalices to push out');
  console.log('GRAL gspec=9 OK (vytlacit=' + (await p.evaluate(() => window.__ff.vytlacit())) + ')');

  // roompole persistence across restart: ZAVAL sets roompole[1] = roompole[1]+1 each
  // attempt (pokus>1). Enter fresh (roompole[1]=0), then restart → it increments.
  await p.evaluate(() => window.__ff.enterRoomAwait(60));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  const before = await p.evaluate(() => window.__ff.roompole(1));
  await p.evaluate(() => window.__ff.restart());
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() >= 0, { timeout: 5000 });
  const after = await p.evaluate(() => window.__ff.roompole(1));
  expect(after > before, `ZAVAL roompole[1] persists+increments across restart (${before} -> ${after})`);
  console.log(`roompole persistence OK (${before} -> ${after})`);
});
