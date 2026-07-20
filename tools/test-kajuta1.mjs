/** UI probe: KAJUTA1 (room 45) gspec=3/4 screen-shove easter egg. Armed (gspec=3), a
 *  blocked big-fish push against the left border slides the view (screenShoveX<0) and
 *  sets gspec=4 — mirroring the original moving the OS window. */
import { withApp } from './ui-lib.mjs';

const DIR_LEFT = 3; // Dir.left

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(45));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });

  expect(await p.evaluate(() => window.__ff.screenShove()) === 0, 'shove starts at 0');

  // Park the big fish (velkar=9) hard against the left border and arm the easter egg.
  const cell = await p.evaluate(() => window.__ff.fishCell('big'));
  await p.evaluate((y) => window.__ff.moveItem(9, 0, y), cell.y);
  await p.evaluate(() => window.__ff.setGspec(3));

  // Pushing left into the border must slide the view and flip gspec to 4.
  const out = await p.evaluate((d) => window.__ff.bigPush(d), DIR_LEFT);
  expect(out.result === 'blocked', `push blocked by the wall (got ${out.result})`);
  expect(out.gspec === 4, `gspec armed to 4 (got ${out.gspec})`);
  expect(out.shove < 0, `view slid left (screenShoveX=${out.shove})`);
  console.log('KAJUTA1 shove:', JSON.stringify(out));
});
