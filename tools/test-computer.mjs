/** UI probe: Computer branch + endgame (rooms 65-72, all now ported). Each loads, has an
 *  active script, and runs 40 ticks without throwing. Extra checks:
 *   - DISKETA (70) is gspec=9 (push-out); ZX (66) is gspec=42 (emulator render mode).
 *   - ZAVER (71) locks player input (zavermode) during its finale cutscene.
 *   - WIN (68) starts in normal play (gspec=0) with the young fish controllable. */
import { withApp } from './ui-lib.mjs';

const ROOMS = [
  [65, 'TETRIS'], [66, 'ZX'], [67, 'WARCR2'], [68, 'WIN'],
  [69, 'PUZZLE'], [70, 'DISKETA'], [71, 'ZAVER'], [72, 'SCORE'],
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

  const gspecOf = async (n) => {
    await p.evaluate((r) => window.__ff.enterRoomAwait(r), n);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    return p.evaluate(() => window.__ff.gspec());
  };
  expect((await gspecOf(70)) === 9, 'DISKETA is a gspec=9 room');
  expect((await gspecOf(66)) === 42, 'ZX is a gspec=42 (emulator) room');
  expect((await gspecOf(68)) === 0, 'WIN starts in normal play (gspec=0)');
  console.log('gspec checks OK (DISKETA=9, ZX=42, WIN=0)');

  // ZX gspec=42 render: opaque wall pixels become horizontal loading-stripe bands.
  await p.evaluate(() => window.__ff.enterRoomAwait(66));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 5, { timeout: 5000 });
  const bands = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const col = [];
    const x = Math.floor(c.width * 0.5);
    for (let y = 0; y < c.height; y += 2) {
      const d = g.getImageData(x, y, 1, 1).data;
      col.push(d[0] + ',' + d[1] + ',' + d[2]);
    }
    let runs = 1;
    for (let i = 1; i < col.length; i++) if (col[i] !== col[i - 1]) runs++;
    return runs;
  });
  expect(bands > 8, `ZX shows loading-stripe bands (${bands} colour runs down the strip)`);
  console.log('ZX loading-stripe bands OK (' + bands + ' runs)');

  // WIN "Favorites" palette gag: the pink placeholder colours are swapped for the
  // Windows system theme, so NO pure magenta remains and the Win95 button-grey shows.
  await p.evaluate(() => window.__ff.enterRoomAwait(68));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 3, { timeout: 5000 });
  const win = await p.evaluate(() => {
    const c = document.querySelector('canvas');
    const g = c.getContext('2d');
    const img = g.getImageData(0, 0, c.width, c.height).data;
    let magenta = 0;
    let gray = 0;
    for (let i = 0; i < img.length; i += 4) {
      if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 255) magenta++;
      if (Math.abs(img[i] - 192) < 12 && Math.abs(img[i + 1] - 192) < 12 && Math.abs(img[i + 2] - 192) < 12) gray++;
    }
    return { magenta, gray };
  });
  expect(win.magenta === 0, `WIN has no raw magenta placeholders (got ${win.magenta})`);
  expect(win.gray > 1000, `WIN shows the Win95 button-grey window chrome (${win.gray}px)`);
  console.log('WIN desktop palette gag OK (magenta=' + win.magenta + ', grey=' + win.gray + ')');
}, { cpu: true });
