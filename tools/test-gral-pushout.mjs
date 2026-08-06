/**
 * UI probe: GRAL (#64) survives a push-out.
 *
 * The player-visible bug this guards: shoving a chalice off the edge left the item
 * parked at (-100,-100) but still in the physics, so the next gravity pass indexed
 * the occupancy grid far out of bounds and threw *inside the render loop*. The loop
 * reschedules at the END of each frame, so the throw stopped it dead — the room froze
 * a moment after the item slid out, idle and unresponsive.
 *
 * A unit test can only see the exception; only a probe can see the loop die. So this
 * drives the real room through the real input path and then checks the game clock is
 * still advancing (plus the usual zero-page-errors assertion in withApp).
 *
 * The move string shoves chalice 38 (at (1,11)) into the left wall with the little
 * fish. GRAL has 25 chalices, so the room is NOT won by it and play continues — which
 * is exactly why GRAL hung where LODE/SPUNT (vytlacit=1, room won and left at once)
 * did not.
 */
import { idle, selectRoom, tickSleep, waitTicks, withApp } from './ui-lib.mjs';

const DIR = { up: 1, down: 2, left: 3, right: 4 };
const PUSH_38 = 'RRUUURRRUUUUUULLLULUUUURRURRUURRRUUUULLLLLLLL';
const DIR_OF = { L: DIR.left, R: DIR.right, U: DIR.up, D: DIR.down };
const CHALICE = 38;

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 64);
  await tickSleep(p, 2);
  expect((await p.evaluate(() => window.__ff.gspec())) === 9, 'GRAL is a gspec=9 push-out room');
  const chalices = await p.evaluate(() => window.__ff.vytlacit());
  expect(chalices > 1, `GRAL has several chalices to push out (${chalices})`);

  const press = async (which, dir) => {
    await p.evaluate(({ w, d }) => window.__ff.press(w, d), { w: which, d: dir });
    await idle(p);
  };

  await idle(p);
  for (const ch of PUSH_38) await press('little', DIR_OF[ch]);
  const at = await p.evaluate((i) => window.__ff.itemState(i), CHALICE);
  expect(at.x === 0, `the chalice was shoved to the left wall (x=${at.x})`);

  // The exit-slide (stav_ven) runs for fazi_ven frames, then odstran_vytlacene
  // removes the item: spec=11, parked at (-100,-100).
  await p.waitForFunction((i) => window.__ff.itemState(i).spec === 11, CHALICE);
  const gone = await p.evaluate((i) => window.__ff.itemState(i), CHALICE);
  expect(gone.x === -100 && gone.y === -100, 'the pushed-out chalice was parked off-room');
  const left = await p.evaluate(() => window.__ff.vytlacit());
  expect(left === chalices - 1, `vytlacit dropped by one (${chalices} -> ${left})`);

  // THE REGRESSION: the loop must still be running, and the room must still accept
  // moves. Pre-fix the next gravity pass threw and the tab froze right here.
  await tickSleep(p, 10);
  await idle(p);
  await press('little', DIR.right);
  await press('little', DIR.right);
  await press('little', DIR.down);

  const before = await p.evaluate(() => window.__ff.count());
  await waitTicks(p, before, 20);
  const advanced = (await p.evaluate(() => window.__ff.count())) - before;
  expect(advanced >= 20, `the game loop still runs after the push-out (${advanced} ticks)`);
  console.log(`GRAL push-out OK (vytlacit ${chalices} -> ${left}, ${advanced} ticks after)`);
}, { graphics: 'classic' });
