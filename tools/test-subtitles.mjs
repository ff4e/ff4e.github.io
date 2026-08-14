/**
 * UI test: each art tier's subtitles are painted by the renderer that tier chose.
 *  - `ai` paints real DOM text (#domsubs) and leaves the overlay canvas empty.
 *  - `enhanced` paints the crisp overlay canvas (#subs).
 *  - `classic` bakes them into the pixel frame, so the overlay stays empty.
 * Also guards the idle-skip optimisation (the overlay stays empty when no subtitle is
 * showing) and the handover when the TIER changes with a line already on screen — under
 * the default `auto` preference that swaps renderer with no setter called, so whichever
 * renderer is standing down has to take its own text off the screen.
 * Asserts painted-vs-empty, never pixel-exact positions or wave timing, so it is not flaky.
 */
import { selectRoom, tickSleep, withApp } from './ui-lib.mjs';

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

/** How many subtitle lines exist as real DOM text right now. */
async function domLines(p) {
  return p.evaluate(() => document.getElementById('domsubs')?.children.length ?? 0);
}

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES — has both fish
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p
    .waitForFunction(() => window.__ff.enhancedActive && window.__ff.enhancedActive())
    .catch(() => {});
  await tickSleep(p, 3);

  // Idle (no subtitle): the overlay does nothing / stays clear.
  expect((await overlayPixels(p)) === 0, 'enhanced idle: overlay is empty');

  // A subtitle appears on the overlay (not baked into the frame).
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5); // let the wave-in run (it advances on the game tick)
  expect(await p.evaluate(() => window.__ff.subsActive()), 'enhanced: subtitle active');
  expect((await overlayPixels(p)) > 0, 'enhanced: subtitle painted on the #subs overlay');

  // Classic: the overlay is cleared and stays empty; subtitles bake into the frame.
  await p.evaluate(() => window.__ff.setGraphics('classic'));
  await tickSleep(p, 3);
  expect((await overlayPixels(p)) === 0, 'classic: overlay cleared on switch');
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'classic: subtitle active');
  expect((await overlayPixels(p)) === 0, 'classic: overlay stays empty (subs baked into frame)');

  // The ai tier is the one this renderer shipped for: real DOM text, and the overlay
  // canvas left alone. Note the tier is switched with a line ALREADY on screen (the
  // classic one above is still up), which is the handover `auto` makes possible.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 3);
  expect(
    (await p.evaluate(() => window.__ff.subRenderer())) === 'dom',
    'ai: the tier selects the DOM renderer by default (no override set)',
  );
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'ai: subtitle active');
  expect((await domLines(p)) > 0, 'ai: subtitle painted as real DOM text');
  expect((await overlayPixels(p)) === 0, 'ai: the overlay canvas stays empty');

  // Leaving the tier hands back cleanly. This is the defect the handover would cause:
  // nothing calls a renderer setter here, so without the frame path noticing the swap
  // the abandoned DOM text would sit on top of the canvas overlay painting underneath.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await tickSleep(p, 5);
  expect((await domLines(p)) === 0, 'leaving ai mid-line takes the DOM text down');
  expect((await overlayPixels(p)) > 0, 'leaving ai mid-line hands the line back to the overlay');

  // An explicit override outranks the tier, both ways — this is what probes and anyone
  // A/B-ing the two renderers by eye depend on.
  await p.evaluate(() => window.__ff.setSubRenderer('dom'));
  await tickSleep(p, 5);
  expect((await domLines(p)) > 0, "enhanced + 'dom' override: DOM text wins over the tier");
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => window.__ff.setSubRenderer('canvas'));
  await tickSleep(p, 5);
  expect((await domLines(p)) === 0, "ai + 'canvas' override: no DOM text");
  expect((await overlayPixels(p)) > 0, "ai + 'canvas' override: the overlay paints instead");

  // Restore the default so this probe leaves no persisted choice behind for others.
  await p.evaluate(() => window.__ff.setSubRenderer('auto'));
}, { cpu: true });
