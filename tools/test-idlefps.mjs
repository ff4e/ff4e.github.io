/**
 * UI test: the render loop drops to the idle timer (low FPS) when a room is settled,
 * and does NOT get stranded at the full display refresh (120fps on ProMotion) after
 * the window loses focus while a movement key is held. Also covers the cutscene, which
 * paints on the same timer for the same reason.
 *
 * Regression: losing focus (alt-tab) never delivers the keyup for a held key, so
 * heldState stayed "held" — the fish kept swimming and, because loopThrottleOk needs
 * heldState===0, the loop spun on rAF forever until a room restart cleared it.
 */
import { observed, tickBudget, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.throttleInfo);
  await p.evaluate(() => window.__ff.enterRoomAwait(12));
  await p.waitForFunction(() => window.__ff.screen() === 'room');

  // A settled room throttles to the idle timer (the low, ~12.5fps wake rate).
  await p.waitForFunction(() => window.__ff.throttleInfo().throttleOk === true);
  expect(await p.evaluate(() => window.__ff.throttleInfo().throttleOk), 'a settled room idle-throttles');

  // Holding a movement key legitimately keeps the loop at full rate.
  await p.keyboard.down('KeyL');
  await p
    .waitForFunction(() => window.__ff.throttleInfo().heldState !== 0)
    .catch(() => {});
  const held = await p.evaluate(() => window.__ff.throttleInfo());
  expect(held.heldState !== 0, 'the held key is registered');
  expect(held.throttleOk === false, 'the loop runs at full rate while a key is held');

  // The window loses focus with the key still down (the keyup is never delivered).
  await p.evaluate(() => window.dispatchEvent(new Event('blur')));
  await p
    .waitForFunction(() => window.__ff.throttleInfo().heldState === 0 && window.__ff.throttleInfo().throttleOk)
    .catch(() => {});
  const after = await p.evaluate(() => window.__ff.throttleInfo());
  expect(after.heldState === 0, `the held key is dropped on blur (heldState=${after.heldState})`);
  expect(after.throttleOk === true, 'the loop drops back to the idle timer after blur');

  await p.keyboard.up('KeyL').catch(() => {});

  // Hiding the tab must also drop a held key (same stranded-rAF hazard).
  await p.keyboard.down('KeyJ');
  await p
    .waitForFunction(() => window.__ff.throttleInfo().heldState !== 0)
    .catch(() => {});
  expect(await p.evaluate(() => window.__ff.throttleInfo().heldState !== 0), 'second held key registered');
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p
    .waitForFunction(() => window.__ff.throttleInfo().heldState === 0)
    .catch(() => {});
  expect(
    await p.evaluate(() => window.__ff.throttleInfo().heldState === 0),
    'the held key is dropped when the tab is hidden',
  );
  await p.keyboard.up('KeyJ').catch(() => {});

  // ── the cutscene ──
  //
  // A cutscene advances in logicTick and its picture is a pure function of per-tick
  // state, so painting it faster than the 80ms tick only duplicates frames. It used to
  // be excluded from the saver outright, which on a ProMotion display meant 119 loop
  // iterations per second driving a 12.5fps animation — 9.5 paints per frame, 8.5 of
  // them identical.
  //
  // Asserted as a RATIO of loop iterations to game ticks rather than as an fps number,
  // because an fps bound is a statement about the machine: this suite's flakes are
  // load-driven and a loaded box would drift under any threshold picked here. The ratio
  // is bounded by the wake period against the tick period (40ms vs 80ms = 2), and load
  // can only push it DOWN — so a generous ceiling cannot flake, and only a genuine
  // regression to the full display rate (~9.5) can break it.
  // The section above left `document.hidden` overridden to true. Only the JS property was
  // faked (the headless page is really visible, so rAF was never throttled), but leaving
  // a lie about visibility in place under a test that measures the frame loop is asking
  // for a confusing failure later.
  await p.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
  await p.waitForFunction(() => window.__ff.screen() === 'room');
  await p.evaluate(() => window.__ff.startCutscene());
  await p.waitForFunction(() => window.__ff.cutsceneActive());
  // The wait IS the assertion: on the regression `throttleOk` simply never becomes true.
  expect(
    await observed(p.waitForFunction(() => window.__ff.throttleInfo().throttleOk === true)),
    'a cutscene idle-throttles instead of holding the full display rate',
  );

  const paced = await p.evaluate(async (deadlineMs) => {
    const t0 = window.__ff.count();
    const l0 = window.__ff.throttleInfo().loops;
    // Bounded by wall clock as well as by tick count. The `ticks >= 12` assertion below
    // exists to catch a throttle that STALLED the tick — and in exactly that failure the
    // tick count never arrives and `cutsceneActive()` stays true, so an unbounded loop
    // would hang to the runner's SIGTERM instead of failing fast with the sentence that
    // explains it. Same reason ui-lib budgets every game-time wait.
    const until = performance.now() + deadlineMs;
    await new Promise((res) => {
      const step = () => {
        if (window.__ff.count() - t0 >= 12 || !window.__ff.cutsceneActive()) return res();
        if (performance.now() > until) return res();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    return {
      ticks: window.__ff.count() - t0,
      loops: window.__ff.throttleInfo().loops - l0,
      onTimer: window.__ff.throttleInfo().onTimer,
    };
  }, tickBudget(12));
  expect(paced.onTimer, 'the cutscene is paced by the idle timer, not requestAnimationFrame');
  // The animation must still ADVANCE — a throttle that stalled the tick would also
  // satisfy a "few loops" bound, so the two are asserted together.
  expect(paced.ticks >= 12, `the cutscene keeps advancing while throttled (${paced.ticks} ticks)`);
  expect(
    paced.loops / paced.ticks < 4,
    `the cutscene paints ~once or twice per tick, not once per refresh (${(paced.loops / paced.ticks).toFixed(1)} loops/tick)`,
  );
  await p.evaluate(() => window.__ff.skipCutscene());
});
