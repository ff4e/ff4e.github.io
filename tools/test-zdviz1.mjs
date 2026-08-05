/**
 * UI probe: ZDVIZ1 (room 20, first City room). Verifies the ported Programky
 * dispatches and runs many ticks without error, and confirms the port's fish are
 * at the item indices the script assumes — malar (6) = little fish, velkar (7) =
 * big fish (the original look_at only works for the fish, so the painters must BE
 * the fish; see zdviz1.ts).
 */
import { budget, waitRoom, waitTicks, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: budget(5000) });
  await p.evaluate(() => window.__ff.enterRoomAwait(20));
  await waitRoom(p, 0);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'ZDVIZ1 has an active script');

  const start = await p.evaluate(() => window.__ff.count());
  await waitTicks(p, start, 30);
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 30, `ZDVIZ1 Programky ran ${advanced} ticks without error`);
  // ...and the script survived them. `advanced` alone only says the CLOCK moved;
  // a Programka that threw itself off the dispatch list would leave it moving.
  expect(await p.evaluate(() => window.__ff.script() !== null), 'ZDVIZ1 script still active after 30 ticks');

  const match = await p.evaluate(() => {
    const st = window.__ff.state();
    const m = window.__ff.itemState(6); // malar
    const v = window.__ff.itemState(7); // velkar
    return {
      little: st.little,
      big: st.big,
      malar: m ? { x: m.x, y: m.y } : null,
      velkar: v ? { x: v.x, y: v.y } : null,
    };
  });
  expect(
    match.malar && match.little && match.malar.x === match.little.x && match.malar.y === match.little.y,
    `malar(6) is the little fish (malar=${JSON.stringify(match.malar)} little=${JSON.stringify(match.little)})`,
  );
  expect(
    match.velkar && match.big && match.velkar.x === match.big.x && match.velkar.y === match.big.y,
    `velkar(7) is the big fish (velkar=${JSON.stringify(match.velkar)} big=${JSON.stringify(match.big)})`,
  );
  console.log('ZDVIZ1 OK:', JSON.stringify(match));
});
