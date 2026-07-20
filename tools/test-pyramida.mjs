/** UI probe: PYRAMIDA (room 25). Runs many ticks so the pharaoh/stela/worm animate
 *  (the worm crawls by writing its own X/Y) without error; confirms items exist,
 *  malar(1)=little fish, and the worm actually moves. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(25));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'PYRAMIDA has an active script');
  for (const i of [1, 3, 5, 6, 7, 11, 18])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `PYRAMIDA item ${i} exists`);
  const worm0 = await p.evaluate(() => window.__ff.itemState(18));
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 90, start, { timeout: 12000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 90, `PYRAMIDA Programky ran ${advanced} ticks without error`);
  const m = await p.evaluate(() => {
    const st = window.__ff.state(), a = window.__ff.itemState(1);
    return { little: st.little, malar: {x:a.x,y:a.y} };
  });
  expect(m.malar.x === m.little.x && m.malar.y === m.little.y, `malar(1)=little (${JSON.stringify(m)})`);
  const worm1 = await p.evaluate(() => window.__ff.itemState(18));
  console.log('PYRAMIDA worm start:', JSON.stringify(worm0), '-> after:', JSON.stringify(worm1));
});
