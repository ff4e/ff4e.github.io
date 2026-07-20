/** UI probe: SLOUPY (room 23, colonnade). Runs many ticks so the wave state
 *  machines fire (writing afaze across items 9..50) without error; confirms the
 *  row/statue/figure items exist and malar(7)=little, velkar(8)=big. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(23));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'SLOUPY has an active script');
  for (const i of [9, 26, 27, 50, 52, 53])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `SLOUPY item ${i} exists`);
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 200, start, { timeout: 20000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 200, `SLOUPY Programky ran ${advanced} ticks without error`);
  const m = await p.evaluate(() => {
    const st = window.__ff.state(), a = window.__ff.itemState(7), b = window.__ff.itemState(8);
    return { little: st.little, big: st.big, malar: {x:a.x,y:a.y}, velkar: {x:b.x,y:b.y} };
  });
  expect(m.malar.x === m.little.x && m.malar.y === m.little.y, `malar(7)=little (${JSON.stringify(m)})`);
  expect(m.velkar.x === m.big.x && m.velkar.y === m.big.y, `velkar(8)=big (${JSON.stringify(m)})`);
  console.log('SLOUPY OK:', JSON.stringify(m));
});
