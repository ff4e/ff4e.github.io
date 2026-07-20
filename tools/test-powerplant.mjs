/** UI probe: Power Plant branch (rooms 52-58). Each room loads, has an active script,
 *  and runs 40 ticks without throwing. Extra checks:
 *   - POHON (58) confirms its gspec=9 push-out mode.
 *   - CHODBA (56) starts LIT (gspec 0); toggling gspec to 2 makes a guard dog glow
 *     (spec=2) — the darkness renderer's cue.
 *   - MOTOR (54) exposes a live screenOffset (the circular screen wobble hook). */
import { withApp } from './ui-lib.mjs';

const ROOMS = [
  [52, 'REAKTOR'], [53, 'PAPRSKY'], [54, 'MOTOR'], [55, 'STEEL'],
  [56, 'CHODBA'], [57, 'BANKA'], [58, 'POHON'],
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

  // POHON is a gspec=9 push-out room.
  await p.evaluate(() => window.__ff.enterRoomAwait(58));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'POHON is a gspec=9 room');

  // CHODBA darkness: starts lit; forcing gspec=2 makes the right dog glow (spec=2).
  await p.evaluate(() => window.__ff.enterRoomAwait(56));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.gspec()) === 0, 'CHODBA starts lit (gspec 0)');

  // Sample a border pixel while lit — the wall/scenery is colourful there.
  const sampleCorner = () => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const d = g.getImageData(4, 4, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], sum: d[0] + d[1] + d[2] };
  };
  const litPx = await p.evaluate(sampleCorner);

  await p.evaluate(() => window.__ff.setGspec(2));
  const t0 = await p.evaluate(() => window.__ff.count());
  await p.waitForFunction((s) => window.__ff.count() >= s + 3, t0, { timeout: 4000 }).catch(() => {});
  const dog = await p.evaluate(() => window.__ff.itemState(1)); // rightpes = item 1
  expect(dog && dog.spec === 2, `CHODBA dog glows (spec=2) in the dark, got spec=${dog && dog.spec}`);

  // ...and the whole background (borders/scenery) goes near-black — the corner pixel
  // must be much darker than while lit (VyplnMistnost darkness fill).
  const darkPx = await p.evaluate(sampleCorner);
  expect(darkPx.sum < litPx.sum, `CHODBA border darkens (lit sum=${litPx.sum} -> dark sum=${darkPx.sum})`);
  expect(darkPx.sum <= 60, `CHODBA border is near-black in the dark (sum=${darkPx.sum})`);
  console.log(`CHODBA darkness OK (dog spec=${dog && dog.spec}, corner ${litPx.sum} -> ${darkPx.sum})`);

  // MOTOR exposes a screenOffset hook (the circular wobble).
  await p.evaluate(() => window.__ff.enterRoomAwait(54));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  const off = await p.evaluate(() => window.__ff.screenOffset());
  expect(off && typeof off.x === 'number' && typeof off.y === 'number', 'MOTOR exposes a screenOffset');
  console.log('MOTOR screenOffset OK (' + off.x + ',' + off.y + ')');
}, { cpu: true });
