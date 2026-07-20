/** UI probe: SECRET (room 27). Runs many ticks so the balloons/crab/shrimp/krabik
 *  animate + the dialogue scheduler ticks without error; confirms items exist and
 *  scully(6)=little, mulder(7)=big. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(27));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'SECRET has an active script');
  for (const i of [1, 2, 6, 7, 8, 9, 10, 17, 18, 19])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `SECRET item ${i} exists`);
  const start = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 120, start, { timeout: 15000 }).catch(() => {});
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  expect(advanced >= 120, `SECRET Programky ran ${advanced} ticks without error`);
  const m = await p.evaluate(() => {
    const st = window.__ff.state(), a = window.__ff.itemState(6), b = window.__ff.itemState(7);
    return { little: st.little, big: st.big, scully: {x:a.x,y:a.y}, mulder: {x:b.x,y:b.y} };
  });
  expect(m.scully.x === m.little.x && m.scully.y === m.little.y, `scully(6)=little (${JSON.stringify(m)})`);
  expect(m.mulder.x === m.big.x && m.mulder.y === m.big.y, `mulder(7)=big (${JSON.stringify(m)})`);
  console.log('SECRET OK:', JSON.stringify(m));
});
