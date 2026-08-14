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

  // ── the DOM line must be the size the canvas draws it ──
  //
  // Every other geometry check compares one DOM measurement against another (ai against
  // enhanced, in test-aisubs), so an error common to EVERY DOM line cancels out and
  // passes. That is not hypothetical: the fit-to-room step measured the line's
  // full-width container instead of its text, so the shrink fired on every line and drew
  // all of them ~5% small — invisible to a ratio, and it just read as "the text looks a
  // bit off". The only oracle that can see it is the other renderer, same tier, same
  // line, same units. Done here rather than in test-aisubs because this probe injects a
  // known line into a wide room, so neither wrapping nor the room's own chatter is in
  // the measurement.
  //
  // Not pixel parity: the browser shapes and rasterises this text, so a fraction of a
  // percent is expected and fine. 5% is not.
  const lineWidthCss = (which) =>
    p.evaluate((w) => {
      const c = document.getElementById('subs');
      const frame = c.getBoundingClientRect();
      if (w === 'dom') {
        let x0 = 1e9, x1 = -1;
        for (const sp of document.getElementById('domsubs')?.querySelectorAll('span') ?? []) {
          const r = sp.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right);
        }
        return { w: x1 - x0, cx: (x0 + x1) / 2 - frame.left, frameW: frame.width };
      }
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9, x1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] > 40) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
          }
        }
      }
      const k = frame.width / c.width; // backing store -> CSS px
      return { w: (x1 - x0) * k, cx: ((x0 + x1) / 2) * k, frameW: frame.width };
    }, which);

  for (const tier of ['enhanced', 'ai']) {
    const seen = {};
    for (const which of ['canvas', 'dom']) {
      await p.evaluate((t) => window.__ff.setGraphics(t), tier);
      await p.evaluate((w) => window.__ff.setSubRenderer(w), which);
      await p.evaluate(() => window.__ff.clearSubtitles());
      await tickSleep(p, 2);
      await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
      await tickSleep(p, 20); // let the wave finish: this is the resting line
      seen[which] = await lineWidthCss(which);
    }
    const ratio = seen.dom.w / seen.canvas.w;
    expect(
      Math.abs(ratio - 1) < 0.04,
      `[${tier}] the DOM line is the width the canvas draws it ` +
        `(${seen.dom.w.toFixed(1)}px vs ${seen.canvas.w.toFixed(1)}px, ratio ${ratio.toFixed(3)})`,
    );
    expect(
      Math.abs(seen.dom.cx - seen.canvas.cx) < 0.02 * seen.dom.frameW,
      `[${tier}] the DOM line is centred where the canvas centres it ` +
        `(${seen.dom.cx.toFixed(1)}px vs ${seen.canvas.cx.toFixed(1)}px of ${seen.dom.frameW.toFixed(0)}px)`,
    );
  }

  // Restore the default so this probe leaves no persisted choice behind for others.
  await p.evaluate(() => window.__ff.setSubRenderer('auto'));

  // Leaving the ROOM with a line still up must take the DOM text down. Nothing in the
  // non-room draw branches clears it — they wipe the canvas overlay, which is a
  // different element — so a line survived onto the world map, painted over it. The
  // guard covers the help page, a cutscene and a room load by the same condition; the
  // map is the one a player actually walks into.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await tickSleep(p, 3);
  await p.evaluate(() => window.__ff.pushSubtitle('Careful, fish!', 'M'));
  await tickSleep(p, 5);
  expect((await domLines(p)) > 0, 'ai: a line is up before leaving the room');
  await p.keyboard.press('Escape');
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  // Wait for the condition rather than sleeping a fixed time: the clear happens in the
  // draw path, and on a loaded machine the next frame is not owed within any particular
  // number of milliseconds (a fixed wait here failed under full-suite contention). A
  // genuine regression still fails — the wait times out — which was verified by
  // reverting the fix and watching this assertion go red.
  await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) === 0);
  expect((await domLines(p)) === 0, 'leaving the room takes the DOM subtitle off the map');
}, { cpu: true });
