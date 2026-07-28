/**
 * UI test: the enhanced subtitle overlay is repainted only when its image would
 * actually change — never once per rendered frame.
 *
 * The wave-in offset (PisStringF) is a function of the LOGIC TICK (12.5/s), not of
 * the frame, so at 60-120fps the overlay used to re-shape and re-stroke every glyph
 * to produce a byte-identical image ~5-10x per tick. With a long line on screen that
 * cost enough main-thread time to drop frames (measured on a 6x-throttled CPU: 120 →
 * 83fps, mean frame time 8.3 → 12.0ms). The repaint gate removes it.
 *
 * The assertions are RATIOS (repaints per logic tick, repaints vs rendered frames),
 * not milliseconds, so they hold on any machine — but both sides are sampled over
 * wall-clock windows, so this probe runs exclusively (see run-ui-tests.mjs).
 */
import { selectRoom, withApp } from './ui-lib.mjs';

const LONG = 'Careful now, the whole cavern is about to collapse on top of us both!';
const LONG2 = 'Stop shoving me around, you overgrown sardine, I can see it perfectly well!';

/** Sample rendered frames, logic ticks and overlay repaints over `ms`. */
async function sample(p, ms) {
  return p.evaluate(
    (dur) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        const paints0 = window.__ff.subPaints();
        const count0 = window.__ff.count();
        let frames = 0;
        const step = (t) => {
          frames++;
          if (t - t0 >= dur) {
            resolve({
              ms: t - t0,
              frames,
              ticks: window.__ff.count() - count0,
              paints: window.__ff.subPaints() - paints0,
            });
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    ms,
  );
}

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => window.__ff.subFontReady(), { timeout: 20000 });
  // Turn the idle saver off so the room really does repaint on every rAF: that is
  // the situation the gate has to survive (it is also what happens with the saver
  // on whenever the fish is moving).
  await p.evaluate(() => window.__ff.setRenderOnDirty(false));
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.waitForTimeout(200);

  // Nothing on screen: the overlay is not touched at all.
  const idle = await sample(p, 700);
  expect(idle.paints === 0, `idle: no subtitle, no overlay repaints (${idle.paints})`);

  // A stack of lines, mid-wave and scrolling — the busiest the overlay ever gets.
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LONG);
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LONG2);
  const waving = await sample(p, 1500);
  expect(waving.paints > 0, `wave: the overlay is being repainted (${waving.paints})`);
  expect(
    waving.frames >= waving.ticks * 2,
    `wave: the loop really is painting faster than the logic tick (${waving.frames} frames / ${waving.ticks} ticks)`,
  );
  // The core invariant: at most one overlay repaint per logic tick, however many
  // frames are rendered in between (+2 for the ticks straddling the two window
  // edges — still an order of magnitude below the frame count).
  expect(
    waving.paints <= waving.ticks + 2,
    `wave: at most one repaint per logic tick (${waving.paints} repaints / ${waving.ticks} ticks over ${waving.frames} frames)`,
  );

  // A settled line (wave finished, scrolled to its resting row) is a static image:
  // it must cost NOTHING per frame.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), 'Watch out for the crab.');
  await p.waitForTimeout(1600); // wave-in done (~13 ticks) and scrolled to cilys
  const settled = await sample(p, 800);
  expect(settled.frames > 10, `settled: frames really were rendered (${settled.frames})`);
  expect(settled.ticks > 5, `settled: the game really was ticking (${settled.ticks})`);
  expect(
    settled.paints === 0,
    `settled: a static line is repainted zero times (${settled.paints} repaints over ${settled.frames} frames)`,
  );
  expect(await p.evaluate(() => window.__ff.subsActive()), 'settled: the line is still on screen');
}, { cpu: true });
