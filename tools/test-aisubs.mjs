/**
 * UI test: subtitles animate at the full frame rate in the `ai` tier, not just `enhanced`.
 *
 * A subtitle waves each glyph in over ~1.5s, which happens BETWEEN logic ticks. The loop
 * therefore has to stay at the display refresh rate while a line is settling, instead of
 * idle-throttling to the 12.5fps logic rate.
 *
 * That rule was written as `graphics === 'enhanced'` in two places (the idle-throttle
 * decision and the subtitle-only branch of the loop), which silently excluded the `ai`
 * tier even though it draws vector subtitles too. The result was subtitles that animated
 * at 12.5fps in `ai` and 60+fps in `enhanced` — with nothing logged and every unit test
 * green.
 *
 * What it asserts is the throttle DECISION, per tier, for the whole of a wave: the loop
 * is never allowed to idle-throttle and never leaves rAF for the idle timer while a line
 * is moving. No rate and no clock: a per-second bound was tried and failed on correct
 * builds, reading anywhere from 14/s to 60/s depending only on how loaded the machine
 * was, and a tick-relative bound fails too — the healthy and broken ranges OVERLAP. See
 * the note beside the assertions.
 *
 * (The overlay-repaint ratio that used to sit here went with the canvas renderer: there
 * is no repaint counter to read any more, because the wave now runs on the compositor.
 * The contract it was really pinning — the loop may not idle-throttle mid-wave — is what
 * is left, and it is the half that caught the original bug.)
 *
 * It also pins the `ai` tier's SMALLER subtitle (`aiSubScale`): subtitles are laid out in
 * native game pixels in every tier, which sizes the text for 1998 bitmap art and reads
 * far too heavy over the AI upscale. That is a pure presentation transform — the engine's
 * line positions are shared with the faithful bitmap path and must not move — so it is
 * checked on the RENDERED TEXT rather than on any internal number, against the same
 * renderer in the other tier so that only `aiSubScale` differs between the two.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());

  /** Sample the loop's throttle decision across a whole wave-in, per tier. */
  const measure = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await p.waitForFunction(() => window.__ff.roomNum() === 1);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    // Wait until the room is genuinely IDLE first. While the fish are still falling
    // into place, roomAnimating() keeps the loop on rAF on its own and masks the bug
    // entirely — the throttle only engages once nothing else is moving.
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    await p.evaluate(() => window.__ff.talk('little'));
    await p.waitForFunction(() => window.__ff.subsActive());
    // Sample ACROSS the wave, not at its start. What is watched:
    //
    //  - `loopThrottleOk()`, the throttle DECISION itself, and `onTimer`, whether the
    //    loop actually left requestAnimationFrame for the idle timer. Sampled at every
    //    frame of the window, because the bug does not have to be present at t=0: a wave
    //    that throttles a third of the way in is still the same defect, and `talk()`
    //    calls `wake()` (main.ts), which clears `idleTimer` and so guarantees
    //    `onTimer === false` for the first frame no matter what the throttle decides.
    //
    // The probe's own rAF chain keeps being delivered even when the game loop leaves rAF,
    // so this sampler still runs (and still reports) in exactly the broken case.
    const w = await p.evaluate(
      (ms) =>
        new Promise((done) => {
          const t0 = performance.now();
          const start = { c: window.__ff.count() };
          let everThrottleOk = false;
          let everOnTimer = false;
          const finish = () => {
            const info = window.__ff.throttleInfo();
            everThrottleOk = everThrottleOk || info.throttleOk;
            everOnTimer = everOnTimer || info.onTimer;
            done({
              ticks: window.__ff.count() - start.c,
              ms: performance.now() - t0,
              active: window.__ff.subsActive(),
              everThrottleOk,
              everOnTimer,
            });
          };
          // Poll on a TIMER, not on rAF: a rAF-driven sampler keeps its own frame chain
          // alive and would sit inside the very scheduling this is trying to observe.
          const step = () => {
            const info = window.__ff.throttleInfo();
            everThrottleOk = everThrottleOk || info.throttleOk;
            everOnTimer = everOnTimer || info.onTimer;
            if (performance.now() - t0 >= ms) finish();
            else setTimeout(step, 16);
          };
          setTimeout(step, 16);
        }),
      1500,
    );
    return w;
  };

  /**
   * The subtitle layer must occupy exactly the room's on-screen box.
   *
   * It sizes itself rather than inheriting the room canvas, and that calculation used to
   * run off `canvas.width` — NATIVE in enhanced but xSCALE in ai, which produced a layer
   * 595px wide against a 435px room. Invisible, because the text is positioned in native
   * coordinates from a shared origin, but wrong, and it moves the text if the origin ever
   * stops being shared.
   */
  const overlayBox = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) > 0);
    return p.evaluate(() => {
      const c = document.querySelector('#screen');
      const s = document.getElementById('domsubs');
      return { room: c.style.width, sub: s ? s.style.width : null, backing: c.width };
    });
  };

  const enh = await measure('enhanced');
  const ai = await measure('ai');

  for (const tier of ['enhanced', 'ai']) {
    const b = await overlayBox(tier);
    expect(b.sub === b.room, `[${tier}] the subtitle layer matches the room box (room ${b.room}, layer ${b.sub}, room backing ${b.backing})`);
  }

  expect(enh.active, 'the enhanced line is still on screen for the whole sample');
  expect(ai.active, 'the ai line is still on screen for the whole sample');
  // ── What is actually asserted, and why none of it is a rate ──
  //
  // Every per-second form of this check has been measured failing on a CORRECT build:
  // repaints read 14/s to 60/s depending only on how busy the machine is. Per-TICK forms
  // fail too, and that is worth recording because it is not obvious: measured on a correct
  // `ai` build the loop ran between 1.4 and 5.3 iterations per logic tick depending on
  // load, while the throttle bug itself reads ~1.8 — the healthy and broken ranges
  // OVERLAP, so no tick-relative bound can separate them here.
  //
  // What does separate them are two things with no clock in them at all.
  for (const [tier, m] of [['enhanced', enh], ['ai', ai]]) {
    // 1. The throttle DECISION, watched for the whole wave rather than sampled once at
    //    the start. `loopThrottleOk()` is false exactly while a vector line is waving in
    //    (main.ts), and `onTimer` says the loop actually left rAF for the idle timer.
    //    Sampled across the window because the bug need not be present at t=0 — a wave
    //    that throttles a third of the way in is the same defect — and because `talk()`
    //    calls `wake()`, which clears `idleTimer` and so guarantees `onTimer === false`
    //    on the first frame no matter what the loop then decides.
    expect(
      m.everThrottleOk === false,
      `[${tier}] the loop is never allowed to idle-throttle while the line waves in`,
    );
    expect(m.everOnTimer === false, `[${tier}] the loop never leaves rAF for the idle timer while the line waves in`);
  }
  // The window has to contain real game time, or a "never happened" assertion passes
  // simply because almost nothing happened in it.
  expect(enh.ticks >= 5 && ai.ticks >= 5, `the sample window covers real game time (enhanced ${enh.ticks} ticks, ai ${ai.ticks} ticks)`);
  // A cross-tier ratio (ai.fps / enh.fps > 0.7) used to stand here. It is gone because it
  // measured the wrong thing: two per-second rates, sampled in different windows, divided.
  // Measured on a CORRECT build it read 0.81-0.83 cold and alone, 0.59-0.66 in the pool
  // and 0.24 on a machine still hot from another probe — while `enhanced` sat at a full
  // 59.9/s throughout. That is not a slow machine being misread; it is the `ai` tier
  // honestly failing to match a tier that costs half as much (it composites a xS FBO),
  // which is not a defect and is not something this suite should require.
  //
  // What replaced it is the throttle DECISION above: it asks the loop to keep its promise
  // in both tiers without asking the two tiers to cost the same, and has no wall clock in
  // it anywhere.

  // ── the MECHANISM behind the smoothness, asserted directly ──
  //
  // What protects the subtitle is `waterOwesRepaint` capping the ×S room repaint at
  // `waterAnimMs` while the loop still runs at the full paint rate for the subtitle's
  // sake — and that contract is not wall-clock at all, so it can be asserted exactly.
  // Without the cap this counted ~60 repaints/s; the cap is what brought the cross-tier
  // smoothness back from 0.60 to ~0.95 when it was introduced.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => window.__ff.talk('little'));
  await p.waitForFunction(() => window.__ff.subsActive());
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
  // The `ai` tier's smaller subtitle is one `scale()` on the container, about its bottom
  // edge, so glyphs, row pitch and wave amplitude shrink together. That is easy to get
  // subtly wrong (scaling the font alone leaves the row pitch and the wave at full size),
  // so it is measured on the rendered text rather than on the scale constant: a transform
  // about the wrong origin scales correctly and puts the line in the wrong place, which a
  // check on the number could not see.
  //
  // The oracle is the same renderer in the OTHER tier, so the only difference between the
  // two measurements is aiSubScale itself. Both are read in CSS pixels against the room's
  // own box.
  const domInk = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    await p.waitForFunction(() => window.__ff.subsActive());
    await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) > 0);
    await p.waitForTimeout(2200); // let the wave settle, so the box is the resting line
    return p.evaluate(() => {
      const frame = document.getElementById('screen').getBoundingClientRect();
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const line of document.getElementById('domsubs').children) {
        // The glyph spans, not the line div: the div is full-width by construction
        // (left:0;right:0;text-align:center), so its box would measure the room.
        for (const sp of line.querySelectorAll('span')) {
          const r = sp.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          x0 = Math.min(x0, r.left); x1 = Math.max(x1, r.right);
          y0 = Math.min(y0, r.top); y1 = Math.max(y1, r.bottom);
        }
      }
      return { w: x1 - x0, h: y1 - y0, bottom: frame.bottom - y1, cx: (x0 + x1) / 2 - frame.left, frameW: frame.width, ink: x1 >= 0 };
    });
  };

  const want = await p.evaluate(() => window.__ff.subScale());
  const enhDom = await domInk('enhanced');
  const aiDom = await domInk('ai');
  expect(enhDom.ink && aiDom.ink, 'a subtitle line is real DOM text in both tiers');
  const domRatio = aiDom.w / enhDom.w;
  expect(
    Math.abs(domRatio - want) < 0.12,
    `[ai/dom] the DOM subtitle is drawn at ~${want} of the faithful size (width ratio ${domRatio.toFixed(2)}, ` +
      `${aiDom.w.toFixed(1)}px vs ${enhDom.w.toFixed(1)}px)`,
  );
  // The row pitch and the wave ride on the same transform, so a scale applied about the
  // wrong origin shows up here as the line drifting off its bottom edge. The target is
  // NOT equality: scaling about the container's bottom edge pulls the line's gap to that
  // edge in by the same factor. Equality with a whole-line-height tolerance, which is
  // what stood here first, would also have admitted a transform-origin of 50% 90%.
  expect(
    Math.abs(aiDom.bottom - want * enhDom.bottom) < 0.35 * enhDom.h,
    `[ai/dom] the DOM subtitle is anchored to the container's bottom edge ` +
      `(${aiDom.bottom.toFixed(1)}px from the bottom, want ~${(want * enhDom.bottom).toFixed(1)}px)`,
  );
  expect(
    Math.abs(aiDom.cx / aiDom.frameW - enhDom.cx / enhDom.frameW) < 0.04,
    `[ai/dom] the DOM subtitle is still centred (centre ${(aiDom.cx / aiDom.frameW).toFixed(3)} vs ${(enhDom.cx / enhDom.frameW).toFixed(3)} of the room)`,
  );
  // NOTE for anyone adding to this block: the width ratio is already asserted against
  // `want` at the top of it. A second `Math.abs(domRatio - want)` check is not a second
  // oracle — it is the same one, printing a second green line. An error common to EVERY
  // line (all of them drawn the same fraction too small) cancels out of a ratio and is
  // not visible here at all; the renderer that used to catch it is gone, and nothing has
  // replaced it.
}, { gl: true });
