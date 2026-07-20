/** UI probe: DIRY (room 24). Runs many ticks so the ruler face machine + octopus
 *  animate and the announcement scheduler fires without error; confirms the
 *  vladce/xichtik/chobot items exist and malar(22)=little, velkar(23)=big. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(24));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'DIRY has an active script');
  for (const i of [5, 8, 20, 22, 23])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `DIRY item ${i} exists`);
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 120, start, { timeout: 15000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 120, `DIRY Programky ran ${advanced} ticks without error`);
  const m = await p.evaluate(() => {
    const st = window.__ff.state(), a = window.__ff.itemState(22), b = window.__ff.itemState(23);
    return { little: st.little, big: st.big, malar: {x:a.x,y:a.y}, velkar: {x:b.x,y:b.y} };
  });
  expect(m.malar.x === m.little.x && m.malar.y === m.little.y, `malar(22)=little (${JSON.stringify(m)})`);
  expect(m.velkar.x === m.big.x && m.velkar.y === m.big.y, `velkar(23)=big (${JSON.stringify(m)})`);
  console.log('DIRY OK:', JSON.stringify(m));
});
