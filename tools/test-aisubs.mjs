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
 *
 * It also pins the `ai` tier's SMALLER subtitle (`aiSubScale`): the overlay draws in
 * native game pixels in every tier, which sizes the text for 1998 bitmap art and reads
 * far too heavy over the AI upscale. That is a pure presentation transform — the engine's
 * line positions are shared with the faithful bitmap path and must not move — so it is
 * checked on the rendered INK rather than on any internal number.
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
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: 15000 });
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

  // ── the ai tier draws the SAME line smaller, anchored to the same bottom edge ──
  //
  // Measured on the overlay's own ink, not on the scale constant: that way a transform
  // applied about the wrong origin (text drifting up the screen, or off-centre) fails
  // here, which a check on the number could not see. The line is frozen at a fixed tick
  // via the deterministic subtitle probe so both tiers are compared at the identical
  // wave phase — sampling live would compare different moments of the wave-in.
  const inkBox = async (tier) => {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: 15000 });
    await p.waitForFunction(() => window.__ff.subsActive(), { timeout: 8000 });
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
  await p.waitForFunction(() => window.__ff.subsActive(), { timeout: 8000 });
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
