/**
 * UI probe: ZDVIZ2 (room 28, second City elevator room). Verifies the ported
 * Programky runs many ticks without error, and confirms malar (7) = little fish,
 * velkar (8) = big fish (the painters; original look_at only works for the fish).
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(28));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'ZDVIZ2 has an active script');

  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 30, start, { timeout: 6000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 30, `ZDVIZ2 Programky ran ${advanced} ticks without error`);

  const match = await p.evaluate(() => {
    const st = window.__ff.state();
    const m = window.__ff.itemState(7); // malar
    const v = window.__ff.itemState(8); // velkar
    return {
      little: st.little, big: st.big,
      malar: m ? { x: m.x, y: m.y } : null,
      velkar: v ? { x: v.x, y: v.y } : null,
    };
  });
  expect(match.malar && match.little && match.malar.x === match.little.x && match.malar.y === match.little.y,
    `malar(7) is the little fish (malar=${JSON.stringify(match.malar)} little=${JSON.stringify(match.little)})`);
  expect(match.velkar && match.big && match.velkar.x === match.big.x && match.velkar.y === match.big.y,
    `velkar(8) is the big fish (velkar=${JSON.stringify(match.velkar)} big=${JSON.stringify(match.big)})`);
  console.log('ZDVIZ2 OK:', JSON.stringify(match));
});
