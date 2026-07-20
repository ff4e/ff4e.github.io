/**
 * UI test: the fixed-timestep game clock and dialogue pacing. `count` must advance
 * at the original ~12.5 game-ticks/sec (80ms/tick, the TRoom.Jedeme wall-clock
 * loop), NOT the 60fps render rate; and PRVNI's opening lines must be spaced by
 * several ticks, not fire instantly.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '1'); // PRVNI
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // Measure the tick rate over 3 real seconds.
  const c0 = await p.evaluate(() => window.__ff.count());
  const t0 = Date.now();
  await p.waitForTimeout(3000);
  const rate = ((await p.evaluate(() => window.__ff.count())) - c0) / ((Date.now() - t0) / 1000);
  console.log(`  tick rate: ${rate.toFixed(2)}/s`);
  // Allow headroom for headless-under-load slowdown, but it must be far below 60fps.
  expect(rate > 8 && rate < 16, `tick rate ~12.5 (got ${rate.toFixed(2)}), not the 60fps render rate`);

  // PRVNI's opening lines must be spaced by several ticks each.
  const lines = [];
  let seen = 0;
  for (let i = 0; i < 120; i++) {
    const n = await p.evaluate(() => window.__ff.lines());
    if (n > seen) {
      lines.push(await p.evaluate(() => window.__ff.lastLine()));
      seen = n;
    }
    await p.waitForTimeout(100);
  }
  expect(lines.length >= 3, `several dialogue lines fired (${lines.length})`);
  if (lines.length >= 2) {
    const gaps = lines.slice(1).map((l, i) => l.count - lines[i].count);
    console.log('  inter-line gaps (ticks):', gaps.join(', '));
    expect(gaps.every((g) => g >= 3), `lines are spaced by >=3 ticks (gaps ${gaps.join(',')})`);
  }
});
