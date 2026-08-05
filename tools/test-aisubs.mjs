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
 * This asserts an absolute FLOOR per tier — repaints and loop rAF ticks both well above
 * the 12.5Hz logic rate — rather than comparing the two tiers to each other. A tier ratio
 * looks like the sharper check and is not: `ai` costs about twice the CPU of `enhanced`,
 * so under contention it legitimately drops to ~0.6 of it while `enhanced` stays at 60/s,
 * and the comparison fails on a correct build. See the note above the mechanism block.
 *
 * It also pins the `ai` tier's SMALLER subtitle (`aiSubScale`): the overlay draws in
 * native game pixels in every tier, which sizes the text for 1998 bitmap art and reads
 * far too heavy over the AI upscale. That is a pure presentation transform — the engine's
 * line positions are shared with the faithful bitmap path and must not move — so it is
 * checked on the rendered INK rather than on any internal number.
 */
import { budget, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), null, { timeout: budget(15000) });

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
    await p.waitForFunction(() => window.__ff.roomNum() === 1, null, { timeout: budget(15000) });
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: budget(15000) });
    // Wait until the room is genuinely IDLE first. While the fish are still falling
    // into place, roomAnimating() keeps the loop on rAF on its own and masks the bug
    // entirely — the throttle only engages once nothing else is moving.
    await p.waitForFunction(() => window.__ff.phase() === 'idle', null, { timeout: budget(20000) });
    await p.evaluate(() => window.__ff.talk('little'));
    await p.waitForFunction(() => window.__ff.subsActive(), null, { timeout: budget(8000) });
    // Sample the throttle DECISION as well as the rates. `loopThrottleOk()` is false
    // exactly while a vector line is waving in (main.ts), and `onTimer` says whether the
    // loop actually rescheduled itself off requestAnimationFrame — so this is the bug
    // itself, as a boolean, with no wall clock in it.
    const a = await p.evaluate(() => ({
      n: window.__ff.subPaints(), r: window.__rafs, t: performance.now(),
      throttleOk: window.__ff.throttleInfo().throttleOk, onTimer: window.__ff.throttleInfo().onTimer,
    }));
    await new Promise((r) => setTimeout(r, 1500));
    const b = await p.evaluate(() => ({ n: window.__ff.subPaints(), r: window.__rafs, t: performance.now(), active: window.__ff.subsActive() }));
    const secs = (b.t - a.t) / 1000;
    return { fps: (b.n - a.n) / secs, raf: (b.r - a.r) / secs, active: b.active, throttleOk: a.throttleOk, onTimer: a.onTimer };
  };

  /**
   * The overlay must occupy exactly the room's on-screen box.
   *
   * It is a separate DOM layer, so its size comes from its own calculation rather than
   * from the room canvas — and that calculation used to run off `canvas.width`, which is
   * NATIVE in enhanced but xSCALE in ai. The ai overlay came out 595px against a 435px
   * room (and 1607px against 595px in `fill`): invisible, because the text is positioned
   * in native coordinates from a shared origin, but a backing store up to 2.7x wider than
   * needed, cleared and composited on every subtitle frame.
   */
  const overlayBox = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: budget(15000) });
    return p.evaluate(() => {
      const c = document.querySelector('#screen');
      const s = document.querySelector('#subs');
      return { room: c.style.width, sub: s ? s.style.width : null, subBacking: s ? s.width : 0, backing: c.width };
    });
  };

  const enh = await measure('enhanced');
  const ai = await measure('ai');

  for (const tier of ['enhanced', 'ai']) {
    const b = await overlayBox(tier);
    expect(b.sub === b.room, `[${tier}] the subtitle overlay matches the room box (room ${b.room}, subs ${b.sub}, room backing ${b.backing})`);
  }

  expect(enh.active, 'the enhanced line is still on screen for the whole sample');
  expect(ai.active, 'the ai line is still on screen for the whole sample');
  // ── The decisive check, and it is not a rate ──
  //
  // The regression was `loopThrottleOk()` returning true in the `ai` tier while a vector
  // line was still waving in, which sends the loop to the 80ms idle timer instead of rAF.
  // Both halves of that are observable directly: the decision (`throttleOk`) and its
  // consequence (`onTimer`). Neither depends on how fast the machine happens to be, so
  // this holds on a machine under any load — which is the whole point, because every
  // wall-clock form of this check has been measured flaking on a correct build.
  expect(
    enh.throttleOk === false && enh.onTimer === false,
    `enhanced keeps the loop on rAF while the line settles (throttleOk=${enh.throttleOk}, onTimer=${enh.onTimer})`,
  );
  expect(
    ai.throttleOk === false && ai.onTimer === false,
    `ai keeps the loop on rAF while the line settles (throttleOk=${ai.throttleOk}, onTimer=${ai.onTimer})`,
  );
  // The rates are kept only as a liveness floor — "something is still being drawn" —
  // deliberately far below any healthy value. They used to be 20/s and 30/s, which is a
  // demand for a healthy frame rate from a machine the suite does not control: measured
  // on a CORRECT build they read 14.3/s and 29.6/s under contention and failed. Throttled,
  // the loop is on a timer and these collapse to ~0, so a floor of 5 separates the two
  // states with room to spare; the booleans above are what actually decides.
  expect(enh.fps > 5, `enhanced subtitles are being drawn (${enh.fps.toFixed(1)}/s)`);
  expect(ai.fps > 5, `ai subtitles are being drawn (${ai.fps.toFixed(1)}/s)`);
  expect(enh.raf > 5, `enhanced keeps taking rAF callbacks (${enh.raf.toFixed(1)}/s)`);
  expect(ai.raf > 5, `ai keeps taking rAF callbacks (${ai.raf.toFixed(1)}/s)`);
  // The cross-tier ratio (ai.fps / enh.fps > 0.7) used to be asserted here and was
  // REMOVED, because it conflated two claims and only one of them is a requirement.
  //
  // What it was written to catch is the throttle bug — and the two floors above catch
  // that outright: throttled, `fps` collapses to the 12.5Hz logic rate and `raf` to ~0.
  // What it ALSO demanded is that the `ai` tier be as cheap per frame as `enhanced`,
  // which it is not and was never meant to be: `ai` composites an xS FBO and costs
  // roughly twice the CPU. Measured on a correct build, the ratio reads 0.81-0.83 cold
  // and alone, 0.59-0.66 in the 8-way pool, and 0.24 on a machine still hot from a
  // previous probe — against a bound of 0.7. In every one of those failures `enhanced`
  // was still at a full 59.9/s, so this was not a slow machine being misread: it was the
  // ai tier honestly failing to match a tier that costs half as much.
  //
  // Note that also rules out the obvious rescue of gating the assertion on the control
  // tier being healthy — the control WAS healthy every time it failed.
  //
  // It sat in EXCLUSIVE and flaked anyway (3/9, then 1/5 idle and 2/3 loaded here). The
  // lane guarantees no other probe, not a cool machine, and it runs last — after the
  // pool has held all ten cores for five minutes.

  // ── the MECHANISM behind the smoothness, asserted directly ──
  //
  // What protects the subtitle is `waterOwesRepaint` capping the ×S room repaint at
  // `waterAnimMs` while the loop runs at the full paint rate for the overlay's sake —
  // and that contract is not wall-clock at all, so it can be asserted exactly. Without
  // the cap this counted ~60 repaints/s; the cap is what brought the cross-tier
  // smoothness back from 0.60 to ~0.95 when it was introduced.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => window.__ff.talk('little'));
  await p.waitForFunction(() => window.__ff.subsActive(), null, { timeout: budget(8000) });
  const capWindowMs = 1500;
  const r0 = await p.evaluate(() => ({ n: window.__ff.throttleInfo().roomPaints, t: performance.now() }));
  await new Promise((r) => setTimeout(r, capWindowMs));
  const r1 = await p.evaluate(() => ({ n: window.__ff.throttleInfo().roomPaints, t: performance.now() }));
  const waterMs = await p.evaluate(() => window.__ff.waterAnimMs());
  const elapsed = r1.t - r0.t;
  // Ceiling = the water's own rate, plus the 12.5Hz logic tick (which repaints on its
  // own via the signature and does not align with it), plus slack for the boundaries.
  const ceiling = Math.ceil(elapsed / waterMs) + Math.ceil(elapsed / 80) + 4;
  expect(
    r1.n - r0.n <= ceiling,
    `[ai] room repaints stay capped while a subtitle animates (${r1.n - r0.n} in ${Math.round(elapsed)}ms, ceiling ${ceiling})`,
  );
  // …and the water is genuinely still animating underneath it — this is the other half
  // of the trade, and the reason the suppression that used to live here was removed.
  expect(r1.n - r0.n >= 8, `[ai] the room keeps animating under a subtitle (${r1.n - r0.n} repaints)`);

  // ── the ai tier draws the SAME line smaller, anchored to the same bottom edge ──
  //
  // Measured on the overlay's own ink, not on the scale constant: that way a transform
  // applied about the wrong origin (text drifting up the screen, or off-centre) fails
  // here, which a check on the number could not see. The line is frozen at a fixed tick
  // via the deterministic subtitle probe so both tiers are compared at the identical
  // wave phase — sampling live would compare different moments of the wave-in.
  const inkBox = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: budget(15000) });
    await p.waitForFunction(() => window.__ff.subsActive(), null, { timeout: budget(8000) });
    await p.waitForTimeout(400);
    return p.evaluate(() => {
      const c = document.getElementById('subs');
      const g = c.getContext('2d', { willReadFrequently: true });
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          if (d[(y * c.width + x) * 4 + 3] > 40) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      return { w: x1 - x0, h: y1 - y0, bottom: c.height - y1, cx: (x0 + x1) / 2 / c.width, ink: x1 >= 0 };
    });
  };

  await p.evaluate(() => window.__ff.talk('little'));
  await p.waitForFunction(() => window.__ff.subsActive(), null, { timeout: budget(8000) });
  await p.waitForTimeout(2200); // let the wave finish so the ink is the settled line
  const enhInk = await inkBox('enhanced');
  const aiInk = await inkBox('ai');
  const want = await p.evaluate(() => window.__ff.subScale());
  if (!enhInk.ink || !aiInk.ink) {
    expect(false, 'a subtitle line is inked on the overlay in both tiers');
  } else {
    const wRatio = aiInk.w / enhInk.w;
    // Generous band: glyph hinting and the stroke width do not scale perfectly linearly.
    expect(
      Math.abs(wRatio - want) < 0.12,
      `[ai] the subtitle is drawn at ~${want} of the faithful size (width ratio ${wRatio.toFixed(2)}, ` +
        `${aiInk.w}px vs ${enhInk.w}px)`,
    );
    // Anchored: same bottom edge, still centred. A transform about the wrong origin
    // scales the text correctly and puts it in the wrong place.
    expect(
      Math.abs(aiInk.bottom - enhInk.bottom) < enhInk.h,
      `[ai] the subtitle still sits on the same bottom edge (${aiInk.bottom}px vs ${enhInk.bottom}px from the bottom)`,
    );
    expect(
      Math.abs(aiInk.cx - enhInk.cx) < 0.04,
      `[ai] the subtitle is still centred (centre ${aiInk.cx.toFixed(3)} vs ${enhInk.cx.toFixed(3)} of the overlay)`,
    );
  }
}, { gl: true });
