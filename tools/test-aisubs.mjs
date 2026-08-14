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
 * This asserts, per tier, that the overlay repaints SEVERAL TIMES PER LOGIC TICK while a
 * line waves in, and that the loop is never allowed to idle-throttle for the duration.
 * Both are measured in game ticks, not seconds, so a busy machine cannot move them: a
 * per-second bound was tried and failed on correct builds, reading anywhere from 14/s to
 * 60/s depending only on how loaded the machine was. A cross-tier ratio is not the answer
 * either — `ai` costs about twice the CPU of `enhanced` and legitimately falls behind it
 * under contention. See the note beside the assertions.
 *
 * It also pins the `ai` tier's SMALLER subtitle (`aiSubScale`): the overlay draws in
 * native game pixels in every tier, which sizes the text for 1998 bitmap art and reads
 * far too heavy over the AI upscale. That is a pure presentation transform — the engine's
 * line positions are shared with the faithful bitmap path and must not move — so it is
 * checked on the rendered INK rather than on any internal number. Since the `ai` tier
 * paints DOM text by default, that size/anchor/centre trio is checked TWICE: once on the
 * canvas overlay (forced) and once on the DOM text, which reaches it by a different
 * mechanism and could drift from it.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  // The `ai` tier now paints its subtitles as DOM text by default, so everything below
  // that measures the OVERLAY (repaint counts, overlay ink) has to ask for the canvas
  // renderer explicitly or it would measure an overlay nobody is drawing on. That is not
  // a dead configuration: it is the fallback when the browser cannot run a compositor
  // animation, it is what `classic` and `enhanced` use, and the throttle contract it
  // pins is shared by both renderers. The DOM path's own geometry is asserted at the
  // bottom of this file, in the same terms.
  await p.evaluate(() => window.__ff.setSubRenderer('canvas'));

  /** Overlay repaints AND loop rAF ticks per second while a line is waving in. */
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
    // Sample ACROSS the wave, not at its start. Two things are watched:
    //
    //  - overlay repaints against LOGIC TICKS in the same window. That is the unit this
    //    probe really cares about — "the line animates BETWEEN ticks" — and because both
    //    counts come from the same window, the machine's speed cancels out of the ratio.
    //    A repaints-per-second figure cannot do this: measured on a correct build it
    //    ranges from 14/s to 60/s depending only on how busy the machine is.
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
          const start = { n: window.__ff.subPaints(), c: window.__ff.count(), l: window.__ff.throttleInfo().loops };
          let everThrottleOk = false;
          let everOnTimer = false;
          const finish = () => {
            const info = window.__ff.throttleInfo();
            everThrottleOk = everThrottleOk || info.throttleOk;
            everOnTimer = everOnTimer || info.onTimer;
            done({
              paints: window.__ff.subPaints() - start.n,
              ticks: window.__ff.count() - start.c,
              loops: window.__ff.throttleInfo().loops - start.l,
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
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
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
    // 2. Overlay repaints against LOOP ITERATIONS. Both counters are incremented by the
    //    same loop in the same window (`loopTicks` at main.ts:5308, `subOverlayPaints` at
    //    :4784), so the machine's speed divides out exactly — this is a ratio of the
    //    loop against itself, not against a clock. It catches the failure the throttle
    //    booleans cannot: capping the OVERLAY repaint while leaving the loop on rAF
    //    would keep `throttleOk` false and still leave the line juddering.
    //    Measured while a line waves in: 0.50 in `enhanced` (the loop runs at the
    //    display's 120Hz and MAX_PAINT_FPS lets half of those through), 0.67-0.87 in
    //    `ai`, and ~1.0 on a 60Hz display. An overlay capped to the water rate reads
    //    ~0.25, so 0.4 sits below every healthy figure and above the fault.
    expect(
      m.paints >= m.loops * 0.4,
      `[${tier}] the overlay repaints on the frames the loop draws (${m.paints} repaints / ${m.loops} loop iterations)`,
    );
  }
  // The window has to contain real game time, or the ratios above are vacuous.
  expect(enh.ticks >= 5 && ai.ticks >= 5, `the sample window covers real game time (enhanced ${enh.ticks} ticks, ai ${ai.ticks} ticks)`);
  // A cross-tier ratio (ai.fps / enh.fps > 0.7) used to stand here. It is gone because it
  // measured the wrong thing: two per-second rates, sampled in different windows, divided.
  // Measured on a CORRECT build it read 0.81-0.83 cold and alone, 0.59-0.66 in the pool
  // and 0.24 on a machine still hot from another probe — while `enhanced` sat at a full
  // 59.9/s throughout. That is not a slow machine being misread; it is the `ai` tier
  // honestly failing to match a tier that costs half as much (it composites a xS FBO),
  // which is not a defect and is not something this suite should require.
  //
  // The repaints-per-tick bound above keeps what the ratio was actually reaching for —
  // "the ai overlay animates faster than the tick" — without asking the two tiers to cost
  // the same, and without a wall clock anywhere in it.

  // ── the MECHANISM behind the smoothness, asserted directly ──
  //
  // What protects the subtitle is `waterOwesRepaint` capping the ×S room repaint at
  // `waterAnimMs` while the loop runs at the full paint rate for the overlay's sake —
  // and that contract is not wall-clock at all, so it can be asserted exactly. Without
  // the cap this counted ~60 repaints/s; the cap is what brought the cross-tier
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
  // Measured on the overlay's own ink, not on the scale constant: that way a transform
  // applied about the wrong origin (text drifting up the screen, or off-centre) fails
  // here, which a check on the number could not see. The line is frozen at a fixed tick
  // via the deterministic subtitle probe so both tiers are compared at the identical
  // wave phase — sampling live would compare different moments of the wave-in.
  const inkBox = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    await p.waitForFunction(() => window.__ff.subsActive());
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
  await p.waitForFunction(() => window.__ff.subsActive());
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

  // ── the same three properties, for the renderer the ai tier actually ships ──
  //
  // The DOM renderer reaches the ai tier's smaller subtitle a different way: one
  // `scale()` on the container, about its bottom edge, so glyphs, row pitch and wave
  // amplitude shrink together. That is easy to get subtly wrong (scaling the font alone
  // leaves the row pitch and the wave at full size), and the canvas ink test above
  // cannot see any of it, so it is measured here in the same terms.
  //
  // The oracle is the SAME renderer in the other tier: force `dom` in both, so the only
  // difference between the two measurements is aiSubScale itself. Both are read in CSS
  // pixels against the #subs box, which the probe has already asserted matches the room.
  const domInk = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier);
    await p.waitForFunction(() => window.__ff.subsActive());
    await p.waitForFunction(() => (document.getElementById('domsubs')?.children.length ?? 0) > 0);
    await p.waitForTimeout(2200); // let the wave settle, so the box is the resting line
    return p.evaluate(() => {
      const frame = document.getElementById('subs').getBoundingClientRect();
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

  await p.evaluate(() => window.__ff.setSubRenderer('dom'));
  const enhDom = await domInk('enhanced');
  const aiDom = await domInk('ai');
  expect(enhDom.ink && aiDom.ink, 'a subtitle line is real DOM text in both tiers when the DOM renderer is asked for');
  const domRatio = aiDom.w / enhDom.w;
  expect(
    Math.abs(domRatio - want) < 0.12,
    `[ai/dom] the DOM subtitle is drawn at ~${want} of the faithful size (width ratio ${domRatio.toFixed(2)}, ` +
      `${aiDom.w.toFixed(1)}px vs ${enhDom.w.toFixed(1)}px)`,
  );
  // The row pitch and the wave ride on the same transform, so a scale applied about the
  // wrong origin shows up here as the line drifting off its bottom edge.
  expect(
    Math.abs(aiDom.bottom - enhDom.bottom) < enhDom.h,
    `[ai/dom] the DOM subtitle sits on the same bottom edge (${aiDom.bottom.toFixed(1)}px vs ${enhDom.bottom.toFixed(1)}px from the bottom)`,
  );
  expect(
    Math.abs(aiDom.cx / aiDom.frameW - enhDom.cx / enhDom.frameW) < 0.04,
    `[ai/dom] the DOM subtitle is still centred (centre ${(aiDom.cx / aiDom.frameW).toFixed(3)} vs ${(enhDom.cx / enhDom.frameW).toFixed(3)} of the room)`,
  );
  // The two renderers must also agree with EACH OTHER about the ai tier's size, or the
  // change is a silent presentation change rather than a change of painter. Compared as
  // a ratio-of-ratios, so the canvas backing-store scale divides out.
  expect(
    Math.abs(domRatio - aiInk.w / enhInk.w) < 0.12,
    `[ai] both renderers shrink the line by the same factor (dom ${domRatio.toFixed(2)}, canvas ${(aiInk.w / enhInk.w).toFixed(2)})`,
  );

  // Leave no persisted renderer choice behind for the probes that follow.
  await p.evaluate(() => window.__ff.setSubRenderer('auto'));
}, { gl: true });
