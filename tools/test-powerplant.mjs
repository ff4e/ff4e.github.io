/** UI probe: Power Plant branch (rooms 52-58). Each room loads, has an active script,
 *  and runs 40 ticks without throwing. Extra checks:
 *   - POHON (58) confirms its gspec=9 push-out mode.
 *   - CHODBA (56) starts LIT (gspec 0); toggling gspec to 2 makes a guard dog glow
 *     (spec=2) — the darkness renderer's cue.
 *   - MOTOR (54) recenters on stop; undo keeps its live wobble; other screens stay put. */
import { idle, tickSleep, waitRoom, waitTicks, withApp } from './ui-lib.mjs';

const ROOMS = [
  [52, 'REAKTOR'], [53, 'PAPRSKY'], [54, 'MOTOR'], [55, 'STEEL'],
  [56, 'CHODBA'], [57, 'BANKA'], [58, 'POHON'],
];

await withApp(async ({ p, expect }) => {
  for (const [num, name] of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await waitRoom(p, 0);
    expect(await p.evaluate(() => window.__ff.script() !== null), `${name} has an active script`);
    const start = await p.evaluate(() => window.__ff.count());
    await waitTicks(p, start, 40);
    const advanced = (await p.evaluate(() => window.__ff.count())) - start;
    expect(advanced >= 40, `${name} (room ${num}) ran ${advanced} ticks without error`);
    console.log(`${name} OK (${advanced} ticks)`);
  }

  // POHON is a gspec=9 push-out room.
  await p.evaluate(() => window.__ff.enterRoomAwait(58));
  await waitRoom(p, 0);
  expect(await p.evaluate(() => window.__ff.gspec()) === 9, 'POHON is a gspec=9 room');

  // CHODBA darkness: starts lit; forcing gspec=2 makes the right dog glow (spec=2).
  await p.evaluate(() => window.__ff.enterRoomAwait(56));
  await waitRoom(p, 0);
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
  await waitTicks(p, t0, 3);
  const dog = await p.evaluate(() => window.__ff.itemState(1)); // rightpes = item 1
  expect(dog && dog.spec === 2, `CHODBA dog glows (spec=2) in the dark, got spec=${dog && dog.spec}`);

  // ...and the whole background (borders/scenery) goes near-black — the corner pixel
  // must be much darker than while lit (VyplnMistnost darkness fill).
  const darkPx = await p.evaluate(sampleCorner);
  expect(darkPx.sum < litPx.sum, `CHODBA border darkens (lit sum=${litPx.sum} -> dark sum=${darkPx.sum})`);
  expect(darkPx.sum <= 60, `CHODBA border is near-black in the dark (sum=${darkPx.sum})`);
  console.log(`CHODBA darkness OK (dog spec=${dog && dog.spec}, corner ${litPx.sum} -> ${darkPx.sum})`);

  // The reference solution immediately after the key starts the motor. Loading it
  // avoids paying for 80 live moves and still gives undo a real, replayable position.
  const motorOn = 'LLLIIIIIIIIILJJKKKKKJIIIIIIIJIIIJIJKJJJIJJJLLLLKKLKKKJKJJJJJJAAAAAAAAAWWAAWWWWAWWWJ';
  // An idle CPU room wakes on an 80 ms timer; browser rAFs alone do not prove it painted.
  async function waitPaint() {
    const loops = await p.evaluate(() => window.__ff.throttleInfo().loops);
    await p.waitForFunction(n => window.__ff.throttleInfo().loops > n, loops);
  }
  await p.evaluate(() => window.__ff.enterRoomAwait(54));
  await waitRoom(p, 0);
  for (const backend of ['cpu', 'webgl']) {
    await idle(p);
    await p.evaluate(({ rec, backend }) => {
      window.__ff.setRenderer(backend);
      localStorage.setItem('ff.save.54', rec);
      window.__ff.load();
    }, { rec: motorOn, backend });
    await p.waitForFunction(() => !window.__ff.loading() && window.__ff.undoDepth() === 1);
    await p.waitForFunction(() => window.__ff.screenOffset().y < 0);
    await waitPaint();
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('#screen-gl')).display !== 'none') === (backend === 'webgl'),
      `MOTOR is actually drawn by ${backend}`);

    // Two genuine moves with the motor still running, then two immediate undos.
    for (let i = 1; i <= 2; i++) {
      await p.waitForFunction(() => window.__ff.busy('little') === 0 && window.__ff.phase() === 'idle');
      await p.evaluate(() => window.__ff.press('little', 3));
      await p.waitForFunction(depth => window.__ff.undoDepth() === depth && window.__ff.canUndo(), i + 1);
    }
    // Deliberately far from the banked phase: restoring the snapshot's circle angle
    // would be a visible jump, even if the transient zero-offset frame were fixed.
    await p.evaluate(() => window.__ff.setRoompole(0, 20));
    await tickSleep(p, 1);
    for (let i = 0; i < 2; i++) {
      const undo = await p.evaluate(() => {
        const before = window.__ff.screenOffset();
        const phase = window.__ff.roompole(0);
        const record = window.__ff.record();
        const accepted = window.__ff.undo();
        return {
          before, phase, accepted,
          after: window.__ff.screenOffset(),
          nextPhase: window.__ff.roompole(0),
          shortened: window.__ff.record().length < record.length,
        };
      });
      expect(undo.accepted && undo.shortened, `${backend}: undo really takes back a move`);
      expect(undo.nextPhase === undo.phase && undo.before.x === undo.after.x && undo.before.y === undo.after.y,
        `${backend}: undo preserves the live shake, without a flash to center`);
      await waitPaint();
      expect(await p.evaluate(() => window.__ff.canvasTransform().includes('translate(')),
        `${backend}: the painted room stays displaced while the motor runs`);
    }
    expect(await p.evaluate(rec => window.__ff.record() === rec, motorOn), `${backend}: both moves were undone`);

    const key = await p.evaluate(() => window.__ff.itemState(1));
    await p.evaluate(({ x, y }) => window.__ff.moveItem(1, x - 1, y), key);
    await tickSleep(p, 1);
    await waitPaint();
    expect(await p.evaluate(() => {
      const off = window.__ff.screenOffset();
      return off.x === 0 && off.y === 0 && window.__ff.canvasTransform() === '';
    }), `${backend}: stopping the motor recenters the room`);

    await p.evaluate(({ x, y }) => window.__ff.moveItem(1, x, y), key);
    await p.waitForFunction(() => window.__ff.screenOffset().y < 0);
    await p.evaluate(() => window.__ff.panelAction(23));
    await p.waitForFunction(() => window.__ff.helpOpen());
    await waitPaint();
    expect(await p.evaluate(() => ['#screen', '#screen-gl'].every(id => document.querySelector(id).style.transform === '')),
      `${backend}: help does not inherit the room offset`);
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !window.__ff.helpOpen() && window.__ff.canvasTransform() !== '');

    await p.evaluate(() => window.__ff.showMap());
    await waitPaint();
    expect(await p.evaluate(() => window.__ff.screen() === 'map'
      && ['#screen', '#screen-gl'].every(id => document.querySelector(id).style.transform === '')),
      `${backend}: the map does not inherit the room offset`);
    await p.evaluate(() => window.__ff.enterRoomAwait(54));
    await waitRoom(p, 0);
    expect(await p.evaluate(() => window.__ff.canvasTransform() === ''), `${backend}: a fresh room is centered`);
  }
}, { cpu: true });
