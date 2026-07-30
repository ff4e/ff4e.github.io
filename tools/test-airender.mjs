/**
 * UI test: the hi-res AI room compositor (src/render/roomAi.ts) against the FAITHFUL
 * renderer, on real pixels.
 *
 * Why this exists: the unit suite (test/roomAi.test.ts) can only reach the compositor's
 * pure math, because vitest runs in `node` with no canvas. So its rope/dissolve/mirror
 * coverage re-states the algorithm locally and pins it against the faithful
 * implementation — which proves the two formulas agree, but NOT that roomAi.ts actually
 * calls them correctly. Mutation testing confirmed the gap: changing the rope strand
 * offset, the dissolve comparison, the mirror axis or the item draw ORDER inside
 * roomAi.ts left the whole unit suite green.
 *
 * The AI tier's contract is "the same frame, only bigger". So: render a room in `ai`,
 * downsample the ×4 backing store back to 640×480, render the SAME room state in
 * `enhanced`, and compare. Colour detail differs (that is the upscale), but structure —
 * where every sprite sits, which sprite is on top, which pixels are erased by the
 * dissolve, where the mirror axis falls — must match. Any of those mutations moves
 * pixels and shows up as a large structural difference.
 */
import { withApp } from './ui-lib.mjs';

/**
 * Grab #screen downsampled to native 640×480-space luminance.
 * `nw`/`nh` are the room's native size; the AI canvas is nw*4 × nh*4.
 */
const GRAB = (nw, nh) => {
  const c = document.querySelector('#screen');
  const t = document.createElement('canvas');
  t.width = nw; t.height = nh;
  const g = t.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingEnabled = true;
  g.drawImage(c, 0, 0, c.width, c.height, 0, 0, nw, nh);
  const d = g.getImageData(0, 0, nw, nh).data;
  const out = new Array(nw * nh);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) out[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
  return out;
};

/** Mean absolute luminance difference between two same-size grabs. */
function mad(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/**
 * Fraction of pixels whose luminance differs by more than `t`. Structure-sensitive:
 * an upscale shifts many pixels a little, a moved/reordered sprite shifts some a lot.
 */
function grossFrac(a, b, t = 60) {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > t) n++;
  return n / a.length;
}

/*
 * NOTE on what this probe can and cannot see.
 *
 * A localised metric (worst 16x16 tile) was tried and removed: the two grabs are taken
 * at different game ticks, because switching tiers takes time and the room keeps
 * animating. Animated art therefore differs legitimately — room 1 shows a worst-tile
 * delta of ~96 on a perfectly correct build — so any tile-level threshold is either
 * useless or flaky. Only the frame-wide statistics are meaningful across a tier switch.
 *
 * That means this probe is a coarse "same scene, same layout, really drawn" guard.
 * Fine-grained compositor behaviour (item z-order, per-item offsets, visibility rules)
 * is asserted deterministically instead by the recording-context tests at the end of
 * test/roomAi.test.ts, which drive AiRoom.draw directly with no timing involved.
 */

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 15000 });
  await p.evaluate(`window.GRAB = ${GRAB.toString()}`);

  /**
   * Wait until at least two room frames have been PAINTED in `tier`.
   *
   * One frame is not enough: paintedRoomSig() flips to the new tier at the top of the
   * room draw, while #screen's backing store is resized inside it, so sampling on the
   * first matching sig reads the previous screen's canvas (640x480, the map) and
   * silently compares the wrong thing. The sig's leading field is the game tick, so
   * requiring it to advance guarantees a completed frame in this tier.
   */
  const waitPainted = async (tier) => {
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier, { timeout: 20000 });
    const c0 = Number((await p.evaluate(() => window.__ff.paintedRoomSig())).split('|')[0]);
    await p.waitForFunction(
      ([t, c]) => {
        const sig = window.__ff.paintedRoomSig() || '';
        return sig.includes(`|${t}|`) && Number(sig.split('|')[0]) >= c + 2;
      },
      [tier, c0],
      { timeout: 20000 },
    );
  };

  /** Rooms chosen to exercise the compositor branches the unit tests cannot reach. */
  const ROOMS = [
    { n: 1, why: 'plain room: background wobble + item pass draw order' },
    { n: 6, why: 'elevator rope (spec=3): drawRope stepping and colour' },
    { n: 4, why: 'mirror room (spec=1): drawMirror reflection axis' },
  ];

  for (const r of ROOMS) {
    // --- faithful (enhanced) reference -------------------------------------
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), r.n);
    await p.waitForFunction((n) => window.__ff.roomNum() === n, r.n, { timeout: 15000 });
    // Wait for a room frame actually PAINTED in this tier. Waiting on roomNum alone
    // samples while #screen is still the map-sized canvas, and waiting on a fixed sleep
    // would silently pass against an app that never rendered.
    await waitPainted('enhanced');
    const size = await p.evaluate(() => {
      const c = document.querySelector('#screen');
      return { w: c.width, h: c.height };
    });
    const ref = await p.evaluate(([w, h]) => window.GRAB(w, h), [size.w, size.h]);

    // --- AI tier, same room, same state ------------------------------------
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    await waitPainted('ai');
    await p.waitForFunction((w) => document.querySelector('#screen').width === w * 4, size.w, { timeout: 15000 });
    const aiGrab = await p.evaluate(([w, h]) => window.GRAB(w, h), [size.w, size.h]);

    expect(aiGrab.length === ref.length, `room ${r.n}: grabs are the same size`);

    // The AI canvas must not be blank (that alone would make MAD huge, but say it
    // explicitly so a failure is readable).
    let aiMin = Infinity, aiMax = -Infinity;
    for (const v of aiGrab) { if (v < aiMin) aiMin = v; if (v > aiMax) aiMax = v; }
    expect(aiMax - aiMin > 30, `room ${r.n}: ai frame has real contrast (${(aiMax - aiMin).toFixed(0)}) — ${r.why}`);

    const d = mad(aiGrab, ref);
    const gross = grossFrac(aiGrab, ref);
    // Calibrated against the real tier: the upscale alone lands at |Δlum| ~7-13 with
    // <2% grossly-different pixels. A wrong draw order, a shifted sprite or a mirrored
    // axis moves whole regions and lands far outside both bounds. Thresholds sit just
    // above the observed clean values, not comfortably above, so they stay sensitive.
    expect(d < 18, `room ${r.n}: ai frame matches the faithful frame (mean |Δlum| ${d.toFixed(2)}) — ${r.why}`);
    expect(gross < 0.03, `room ${r.n}: few grossly-different pixels (${(gross * 100).toFixed(2)}%) — ${r.why}`);
  }

  // --- fish are actually drawn ------------------------------------------------
  // The `.png` vs `.webp` key mismatch removed every fish from every room with no
  // error and no 404. A whole-frame comparison catches it (fish are large), but assert
  // it directly too, since it is the single most expensive silent failure in this tier.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await p.waitForFunction(() => window.__ff.roomNum() === 1, { timeout: 15000 });
  await waitPainted('ai');
  const fishMoved = await p.evaluate(async () => {
    const c = document.querySelector('#screen');
    const g = c.getContext('2d', { willReadFrequently: true });
    const snap = () => {
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let h = 2166136261;
      for (let i = 0; i < d.length; i += 4 * 31) { h ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7; h = Math.imul(h, 16777619); }
      return h >>> 0;
    };
    const before = snap();
    // Drive the small fish one step; if the fish are drawn, the frame must change.
    window.__ff.press('little', 2); // step right
    for (let i = 0; i < 40; i++) await new Promise((res) => requestAnimationFrame(res));
    return snap() !== before;
  });
  expect(fishMoved, 'moving a fish changes the ai frame (fish sprites are actually drawn)');
}, { cpu: true });
