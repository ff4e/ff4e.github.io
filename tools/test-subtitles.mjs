/**
 * UI test: enhanced subtitles render on the crisp overlay canvas (#subs), while
 * classic keeps baking them into the pixel frame. Also guards the idle-skip
 * optimisation (the overlay stays empty when no subtitle is showing). Asserts
 * painted-vs-empty, never pixel-exact positions or wave timing, so it is not flaky.
 */
import { withApp } from './ui-lib.mjs';

/** Count of non-transparent pixels on the #subs overlay (capped, for speed). */
async function overlayPixels(p) {
  return p.evaluate(() => {
    const c = document.getElementById('subs');
    if (!c || !c.width || !c.height) return 0;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) {
      if (d[i] !== 0 && ++n > 100) break;
    }
    return n;
  });
}

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '7'); // UTES — has both fish
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p
    .waitForFunction(() => window.__ff.enhancedActive && window.__ff.enhancedActive(), { timeout: 12000 })
    .catch(() => {});
  await p.waitForTimeout(200);

  // Idle (no subtitle): the overlay does nothing / stays clear.
  expect((await overlayPixels(p)) === 0, 'enhanced idle: overlay is empty');

  // A subtitle appears on the overlay (not baked into the frame).
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await p.waitForTimeout(400); // let a few frames + the wave-in run
  expect(await p.evaluate(() => window.__ff.subsActive()), 'enhanced: subtitle active');
  expect((await overlayPixels(p)) > 0, 'enhanced: subtitle painted on the #subs overlay');

  // Classic: the overlay is cleared and stays empty; subtitles bake into the frame.
  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await p.waitForTimeout(200);
  expect((await overlayPixels(p)) === 0, 'classic: overlay cleared on switch');
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await p.waitForTimeout(400);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'classic: subtitle active');
  expect((await overlayPixels(p)) === 0, 'classic: overlay stays empty (subs baked into frame)');
}, { cpu: true });
