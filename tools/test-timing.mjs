/**
 * UI test: the fixed-timestep game clock and dialogue pacing. `count` must advance
 * on the original ~12.5 game-ticks/sec clock (80ms/tick, the TRoom.Jedeme wall-clock
 * loop), NOT the 60fps render rate; and PRVNI's opening lines must be spaced by
 * several ticks, not fire instantly.
 *
 * The measurement is expressed against what the machine actually delivered, not
 * against a fixed floor. `loop()` takes at most ONE logic step per rendered frame and
 * drops any backlog, so the clock's ceiling is `min(elapsed / 80ms, frames rendered)`
 * — by construction, on any machine. A bare "rate > 8" therefore fails on a loaded
 * box for a reason that has nothing to do with the product (observed: 7.93/s under
 * four CPU hogs). Pinning the clock to that ceiling instead is load-independent AND
 * tighter: on an idle machine it demands >= ~9.4 ticks/s where the old floor demanded 8.
 */
import { budget, forTicks, selectRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 1); // PRVNI
  await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: budget(5000) });

  // Measure ticks, elapsed time and RENDERED FRAMES over the same 3-second window.
  const m = await p.evaluate(
    (ms) =>
      new Promise((done) => {
        const c0 = window.__ff.count();
        const t0 = performance.now();
        let frames = 0;
        const step = () => {
          frames++;
          if (performance.now() - t0 >= ms) done({ ticks: window.__ff.count() - c0, ms: performance.now() - t0, frames });
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    3000,
  );
  const rate = (m.ticks / m.ms) * 1000;
  const byClock = m.ms / 80; // the fixed-timestep ceiling
  const ceiling = Math.min(byClock, m.frames); // ...and the one-step-per-frame ceiling
  console.log(`  tick rate: ${rate.toFixed(2)}/s (${m.ticks} ticks, ${m.frames} frames in ${m.ms.toFixed(0)}ms)`);
  expect(
    m.ticks <= byClock + 1,
    `the clock is the 80ms timestep, not the render rate (${m.ticks} ticks, ${m.frames} frames)`,
  );
  expect(
    m.ticks >= ceiling * 0.75,
    `the clock keeps up with the frames it was given (${m.ticks} ticks vs a ceiling of ${ceiling.toFixed(1)})`,
  );

  // PRVNI's opening lines must be spaced by several ticks each. Bounded on GAME time:
  // the pacing being measured is in ticks, so the observation window must be too.
  const lines = [];
  let seen = 0;
  await forTicks(
    p,
    150,
    async () => {
      const n = await p.evaluate(() => window.__ff.lines());
      if (n > seen) {
        lines.push(await p.evaluate(() => window.__ff.lastLine()));
        seen = n;
      }
    },
    100,
  );
  expect(lines.length >= 3, `several dialogue lines fired (${lines.length})`);
  if (lines.length >= 2) {
    const gaps = lines.slice(1).map((l, i) => l.count - lines[i].count);
    console.log('  inter-line gaps (ticks):', gaps.join(', '));
    expect(gaps.every((g) => g >= 3), `lines are spaced by >=3 ticks (gaps ${gaps.join(',')})`);
  }
});
