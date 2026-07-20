/**
 * UI test: movement smoothness. Holding a direction must glide the fish continuously —
 * no stationary stalls between cells, no position jumps at the acceleration tier changes.
 * Uses the render-position harness (__ff.smoothOn()/smoothLog()), which records the
 * active fish's interpolated on-screen position every rendered frame. We then check the
 * per-frame motion during the sustained part of a hold:
 *   - no run of >=2 near-stationary frames (would be a stutter / "square by square"),
 *   - no single-frame jump bigger than ~half a cell (would be a teleport at a tier change).
 */
import { withApp } from './ui-lib.mjs';

const FSIZE = 15;

await withApp(async ({ p, expect }) => {
  const key = (type, code) =>
    p.evaluate(({ t, c }) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })), {
      t: type,
      c: code,
    });

  await p.evaluate(() => window.__ff.enterRoomAwait(30)); // RECYCLED — open water
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });

  await p.evaluate(() => window.__ff.smoothOn());
  await key('keydown', 'KeyK'); // down through open water
  await p.waitForTimeout(1600); // long enough to accelerate through all tiers
  await key('keyup', 'KeyK');
  await p.waitForTimeout(300);

  const log = await p.evaluate(() => window.__ff.smoothLog());
  expect(log.length > 40, `captured render frames (${log.length})`);

  // Per-frame vertical deltas, then trim the leading (pre-move) and trailing (post-keyup)
  // idle so we assess only the sustained hold.
  const d = [];
  for (let i = 1; i < log.length; i++) d.push(log[i].y - log[i - 1].y);
  let a = 0;
  let z = d.length;
  while (a < z && Math.abs(d[a]) < 0.1) a++;
  while (z > a && Math.abs(d[z - 1]) < 0.1) z--;
  const mid = d.slice(a, z);
  expect(mid.length > 20, `sustained-hold frames (${mid.length})`);

  // No stall runs mid-hold.
  let worstStall = 0;
  let run = 0;
  for (const dy of mid) {
    if (Math.abs(dy) < 0.1) run++;
    else {
      worstStall = Math.max(worstStall, run);
      run = 0;
    }
  }
  worstStall = Math.max(worstStall, run);
  expect(worstStall < 2, `no mid-hold stalls — the fish never freezes between cells (worst run ${worstStall} frames)`);

  // No teleport jumps at the acceleration tier changes.
  const worstJump = mid.reduce((m, dy) => Math.max(m, Math.abs(dy)), 0);
  expect(worstJump < FSIZE / 2, `no teleport jumps — every frame advances < half a cell (worst ${worstJump.toFixed(2)}px)`);

  // The motion actually accelerates: later frames move faster than the first tier.
  const first = mid.slice(0, 10).reduce((s, x) => s + Math.abs(x), 0) / 10;
  const last = mid.slice(-10).reduce((s, x) => s + Math.abs(x), 0) / 10;
  expect(last > first * 1.5, `sustained holding accelerates (${first.toFixed(2)} -> ${last.toFixed(2)} px/frame)`);
});
