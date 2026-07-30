/**
 * UI test: subtitles animate at the full frame rate in the `ai` tier, not just `enhanced`.
 *
 * The vector subtitle overlay waves each glyph in over ~1.5s, which happens BETWEEN
 * logic ticks. The loop therefore has to stay at the display refresh rate while a line
 * is settling, instead of idle-throttling to the 12.5fps logic rate.
 *
 * That rule was written as `graphics === 'enhanced'` in two places (the idle-throttle
 * decision and the overlay-only repaint branch), which silently excluded the `ai` tier
 * even though it uses exactly the same vector overlay. The result was subtitles that
 * animated at 12.5fps in `ai` and 60+fps in `enhanced` — measured at 19.2 against 39.9
 * overlay repaints/sec — with nothing logged and every unit test green.
 *
 * This asserts the two tiers are within a reasonable factor of each other, rather than
 * pinning an absolute fps that would be machine- and headless-dependent.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 15000 });

  // Count the LOOP's own rAF callbacks. When the idle throttle engages, the loop
  // reschedules itself with setTimeout instead of requestAnimationFrame, so the rAF
  // rate collapses to ~0 — a far crisper signal than the overlay repaint rate, which
  // other optimisations can partially prop up.
  await p.evaluate(() => {
    const orig = window.requestAnimationFrame.bind(window);
    window.__rafs = 0;
    window.requestAnimationFrame = (cb) => orig((t) => { window.__rafs++; return cb(t); });
  });

  /** Overlay repaints AND loop rAF ticks per second while a line is waving in. */
  const measure = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await p.waitForFunction(() => window.__ff.roomNum() === 1, { timeout: 15000 });
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: 15000 });
    // Wait until the room is genuinely IDLE first. While the fish are still falling
    // into place, roomAnimating() keeps the loop on rAF on its own and masks the bug
    // entirely — the throttle only engages once nothing else is moving.
    await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 20000 });
    await p.evaluate(() => window.__ff.talk('little'));
    await p.waitForFunction(() => window.__ff.subsActive(), { timeout: 8000 });
    const a = await p.evaluate(() => ({ n: window.__ff.subPaints(), r: window.__rafs, t: performance.now() }));
    await new Promise((r) => setTimeout(r, 1500));
    const b = await p.evaluate(() => ({ n: window.__ff.subPaints(), r: window.__rafs, t: performance.now(), active: window.__ff.subsActive() }));
    const secs = (b.t - a.t) / 1000;
    return { fps: (b.n - a.n) / secs, raf: (b.r - a.r) / secs, active: b.active };
  };

  const enh = await measure('enhanced');
  const ai = await measure('ai');

  expect(enh.active, 'the enhanced line is still on screen for the whole sample');
  expect(ai.active, 'the ai line is still on screen for the whole sample');
  // Both tiers must animate well above the 12.5fps logic rate — that is the exact
  // symptom of the idle throttle wrongly engaging.
  expect(enh.fps > 20, `enhanced subtitles animate above the logic rate (${enh.fps.toFixed(1)}/s)`);
  expect(ai.fps > 20, `ai subtitles animate above the logic rate (${ai.fps.toFixed(1)}/s)`);
  // The decisive one: while a line is settling the loop must be on requestAnimationFrame
  // in BOTH tiers. Idle-throttled, it reschedules on a timer and this collapses to ~0.
  expect(enh.raf > 30, `enhanced stays on rAF while the line settles (${enh.raf.toFixed(1)}/s)`);
  expect(ai.raf > 30, `ai stays on rAF while the line settles (${ai.raf.toFixed(1)}/s)`);
  const ratio = ai.fps / enh.fps;
  expect(ratio > 0.7, `ai subtitle smoothness is comparable to enhanced (ratio ${ratio.toFixed(2)}, ai ${ai.fps.toFixed(1)}/s vs enhanced ${enh.fps.toFixed(1)}/s)`);
}, { gl: true });
