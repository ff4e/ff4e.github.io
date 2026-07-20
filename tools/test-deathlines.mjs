/**
 * UI test: the death-commentary flow + faithful death model. Killing one fish
 * (a) does NOT auto-restart — the survivor keeps playing (control switches to it),
 * and (b) makes the survivor speak a "smrt-*" line (loaded from the global x02
 * bank). Killing both fish DOES auto-restart once the skeletons disintegrate.
 */
import { withApp, idle } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // The global x02 death-commentary bank loaded (subtitles + voices).
  expect((await p.evaluate(() => window.__ff.deathBank())) > 0, 'x02 death-line subtitle bank loaded');
  expect(await p.evaluate(() => window.__ff.audioHas('smrt-m-1')), 'x02 death-line voices loaded');

  async function enter(roomNum) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), roomNum);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    await idle(p);
  }

  // Room 1 (PRVNI) is Depth 1, where the survivor always comments.
  await enter(1);
  expect((await p.evaluate(() => window.__ff.roomDepth())) === 1, 'room 1 is Depth 1');

  // Kill the big fish: control passes to the little fish, and the room does NOT
  // auto-restart (the survivor keeps playing).
  const before = await p.evaluate(() => window.__ff.lines());
  await p.evaluate(() => window.__ff.killFish('big'));
  expect(await p.evaluate(() => window.__ff.state().active) === 'little', 'control passes to the surviving fish');
  await p.waitForTimeout(2000);
  expect(await p.evaluate(() => window.__ff.screen()) === 'room', 'a lone death does not auto-return to the map');
  expect(await p.evaluate(() => window.__ff.state().little) !== null, 'the surviving little fish is still in play');

  // A death-commentary line is spoken (the room may add its own line too; over the
  // window at least one line fires).
  await p.waitForFunction((b) => window.__ff.lines() > b, before, { timeout: 6000 }).catch(() => {});
  expect((await p.evaluate(() => window.__ff.lines())) > before, 'the survivor speaks after the partner dies');

  // Once the skeleton fully disintegrates, the fish must NOT be drawn again (the
  // "fish reappears" bug). Sample the big fish's canvas region while alive, then
  // again after full erosion, and require it to have changed substantially.
  await enter(1);
  const fsize = await p.evaluate(() => window.__ff.fsize());
  const region = async () => {
    const b = await p.evaluate(() => window.__ff.state().big);
    return p.evaluate(
      ({ b, fsize }) => {
        const c = document.querySelector('canvas');
        const g = c.getContext('2d');
        const x = b.x * fsize;
        const y = b.y * fsize;
        const w = 4 * fsize;
        const h = 2 * fsize;
        return Array.from(g.getImageData(x, y, w, h).data);
      },
      { b, fsize },
    );
  };
  const alivePixels = await region();
  await p.evaluate(() => window.__ff.killFish('big'));
  // Wait out the disintegration (rozpad 400 @ 30/tick ~= 14 ticks, plus clear).
  await p.waitForTimeout(2500);
  const gonePixels = await region();
  let diff = 0;
  for (let i = 0; i < alivePixels.length; i += 4) {
    if (
      Math.abs(alivePixels[i] - gonePixels[i]) > 16 ||
      Math.abs(alivePixels[i + 1] - gonePixels[i + 1]) > 16 ||
      Math.abs(alivePixels[i + 2] - gonePixels[i + 2]) > 16
    )
      diff++;
  }
  const frac = diff / (alivePixels.length / 4);
  expect(frac > 0.2, `the disintegrated fish is not redrawn (region changed ${(frac * 100).toFixed(0)}%)`);

  // Killing the second fish DOES auto-restart (both dead → fresh attempt).
  await enter(1);
  await p.evaluate(() => window.__ff.killFish('little'));
  await p.evaluate(() => window.__ff.killFish('big'));
  await p.waitForFunction(() => window.__ff.count() < 5, null, { timeout: 6000 }).catch(() => {});
  const restarted = await p.evaluate(() => window.__ff.count() < 20 && window.__ff.screen() === 'room');
  expect(restarted, 'both fish dead auto-restarts the room');
}, { cpu: true });
