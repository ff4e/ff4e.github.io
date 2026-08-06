/**
 * UI test: the enhanced subtitle overlay is repainted only when its image would
 * actually change — never once per rendered frame.
 *
 * The overlay used to re-shape and re-stroke every glyph on EVERY rendered frame, at
 * 60-120fps, to produce a byte-identical image most of the time. With a long line on
 * screen that cost enough main-thread time to drop frames (measured on a 6x-throttled
 * CPU: 120 → 76fps, median frame time 8.3 → 16.2ms).
 *
 * Now it repaints only when the image changes. The wave-in and the line scroll are
 * interpolated between logic ticks on a fixed step grid (SUB_SUBSTEPS = 5, i.e. 62.5
 * animation updates/s) — so an animating line costs a bounded number of repaints per
 * tick regardless of the display's refresh rate, and a settled line costs none.
 *
 * The assertions are RATIOS (repaints per logic tick, repaints vs rendered frames),
 * not milliseconds, so they hold on any machine — but both sides are sampled over
 * wall-clock windows, so this probe runs exclusively (see run-ui-tests.mjs).
 */
import { selectRoom, withApp } from './ui-lib.mjs';

const SUBSTEPS = 5; // must match SUB_SUBSTEPS in src/render/subtitles.ts

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
  await p.waitForFunction(() => window.__ff.subFontReady());
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
  // Guard against a vacuous pass: every ratio below is trivially satisfiable if the
  // game clock did not advance during the window.
  expect(waving.ticks >= 5, `wave: the game clock really advanced (${waving.ticks} logic ticks)`);
  expect(waving.paints > 0, `wave: the overlay is being repainted (${waving.paints})`);
  expect(
    waving.frames >= waving.ticks * 2,
    `wave: the loop really is painting faster than the logic tick (${waving.frames} frames / ${waving.ticks} ticks)`,
  );
  // The animation really is sub-tick: more repaints than logic ticks.
  expect(
    waving.paints > waving.ticks,
    `wave: animates between logic ticks (${waving.paints} repaints / ${waving.ticks} ticks)`,
  );
  // …but bounded by the step grid, not by the display's refresh rate. The sampling
  // window straddles a partial tick at each end, hence the +2.
  const bound = (waving.ticks + 2) * SUBSTEPS;
  expect(
    waving.paints <= bound,
    `wave: at most ${SUBSTEPS} repaints per logic tick (${waving.paints} repaints, bound ${bound}, over ${waving.frames} frames)`,
  );
  // On a display that outruns the animation grid, that bound must also be a real
  // saving over repainting every frame. (Guarded so the assertion is not vacuous on
  // a slow/60Hz host, where the frame rate itself is below the grid.)
  expect(
    waving.frames < bound || waving.paints < waving.frames,
    `wave: fewer repaints than rendered frames (${waving.paints} / ${waving.frames})`,
  );

  // A settled line (wave finished, scrolled to its resting row) is a static image:
  // it must cost NOTHING per frame.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), 'Watch out for the crab.');
  // Wait on the actual state, not on a guessed timeout: the wave-in and the scroll
  // to cilys take a different number of ticks for every line.
  await p.waitForFunction(() => !window.__ff.subsAnimating());
  const settled = await sample(p, 800);
  expect(settled.frames > 10, `settled: frames really were rendered (${settled.frames})`);
  expect(settled.ticks > 5, `settled: the game really was ticking (${settled.ticks})`);
  expect(
    settled.paints === 0,
    `settled: a static line is repainted zero times (${settled.paints} repaints over ${settled.frames} frames)`,
  );
  expect(await p.evaluate(() => window.__ff.subsActive()), 'settled: the line is still on screen');
}, { cpu: true });
