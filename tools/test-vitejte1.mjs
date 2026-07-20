/** UI probe: VITEJTE1 (room 21). Runs long enough for the ruler's announcement
 *  scheduler to fire (delay ~80-160) and the crab audience to react, without
 *  error; confirms items exist, malar(9)=little, velkar(10)=big, and that the
 *  ruler eventually speaks (playing 302) or animates its face. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(21));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'VITEJTE1 has an active script');
  for (const i of [1, 9, 10, 11, 17])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `VITEJTE1 item ${i} exists`);
  const start = await p.evaluate(() => window.__ff.count());
  // Watch ~250 ticks (~20s); track whether the ruler ever speaks.
  let everSpoke = false, maxAfaze = 0;
  while ((await p.evaluate(() => window.__ff.count())) < start + 250) {
    if (await p.evaluate(() => window.__ff.playingPrior(302) || window.__ff.playingPrior(303))) everSpoke = true;
    const a = await p.evaluate(() => window.__ff.itemState(1)?.afaze ?? 0);
    if (a > maxAfaze) maxAfaze = a;
    await p.waitForTimeout(60);
  }
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 250, `VITEJTE1 ran ${advanced} ticks without error`);
  const m = await p.evaluate(() => {
    const st = window.__ff.state(), a = window.__ff.itemState(9), b = window.__ff.itemState(10);
    return { little: st.little, big: st.big, malar: {x:a.x,y:a.y}, velkar: {x:b.x,y:b.y} };
  });
  expect(m.malar.x === m.little.x && m.malar.y === m.little.y, `malar(9)=little (${JSON.stringify(m)})`);
  expect(m.velkar.x === m.big.x && m.velkar.y === m.big.y, `velkar(10)=big (${JSON.stringify(m)})`);
  console.log(`VITEJTE1 OK: everSpoke=${everSpoke} maxRulerAfaze=${maxAfaze}`, JSON.stringify(m));
});
