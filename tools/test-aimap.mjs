/**
 * UI test: the `ai` graphics tier's hi-res world map. The AI path re-composites the
 * map from AI-upscaled art at 4x, so the #screen backing store grows to 2560×1920
 * (CSS box unchanged), while classic/enhanced stay at the native 640×480. The record
 * panel's art (krokoměr bg + hovered icon) is drawn from the AI bitmaps; its digits
 * and the name plaque stay crisp. Toggling the tier repaints, and no errors are logged.
 *
 * This probe asserts PIXEL CONTENT, not just canvas dimensions. A mutation that made the
 * AI map draw nothing while keeping the 2560×1920 backing store used to pass here, which
 * is the failure mode most worth guarding: a drawn map and a blank rectangle have exactly
 * the same dimensions. Waits are `waitForFunction` on a real readiness predicate rather
 * than fixed sleeps, which could otherwise assert before the app had rendered at all.
 */
import { withApp } from './ui-lib.mjs';

/** Fingerprint a native-coords (640×480) region of #screen, scale-independent. */
const REGION_HASH = (x, y, w, h) => {
  const c = document.querySelector('#screen');
  const g = c.getContext('2d');
  const s = c.width / 640;
  const d = g.getImageData(Math.round(x * s), Math.round(y * s), Math.round(w * s), Math.round(h * s)).data;
  let v = 2166136261;
  for (let i = 0; i < d.length; i += 4 * 7) {
    v ^= d[i] + d[i + 1] * 3 + d[i + 2] * 7 + d[i + 3] * 11;
    v = Math.imul(v, 16777619);
  }
  return v >>> 0;
};

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForFunction(() => window.__ff.screen() === 'map');
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'on the map screen');

  const canvasSize = () =>
    p.evaluate(() => {
      const c = document.querySelector('#screen');
      return { w: c.width, h: c.height };
    });

  /** Pixel statistics for the whole canvas, or a sub-rect in NATIVE (640×480) coords. */
  const stats = (rect) =>
    p.evaluate((r) => {
      const c = document.querySelector('#screen');
      const g = c.getContext('2d');
      const s = c.width / 640;
      const x = r ? Math.round(r.x * s) : 0;
      const y = r ? Math.round(r.y * s) : 0;
      const w = r ? Math.round(r.w * s) : c.width;
      const h = r ? Math.round(r.h * s) : c.height;
      const d = g.getImageData(x, y, w, h).data;
      const seen = new Set();
      let opaque = 0, sum = 0, n = 0;
      // Stride so a 2560×1920 read stays fast; still thousands of samples.
      for (let i = 0; i < d.length; i += 4 * 17) {
        if (d[i + 3] > 8) opaque++;
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++;
      }
      const mean = sum / n;
      let varSum = 0;
      for (let i = 0; i < d.length; i += 4 * 17) {
        const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
        varSum += (l - mean) * (l - mean);
      }
      return { colours: seen.size, opaqueFrac: opaque / n, mean, stdev: Math.sqrt(varSum / n) };
    }, rect ?? null);

  const hash = (r) => p.evaluate(([x, y, w, h]) => REGION_HASH(x, y, w, h), [r.x, r.y, r.w, r.h]);

  // Make the fingerprint helper available inside the page for waitForFunction too.
  await p.addInitScript(`window.REGION_HASH = ${REGION_HASH.toString()}`);
  await p.evaluate(`window.REGION_HASH = ${REGION_HASH.toString()}`);

  // enhanced (default): native-resolution map, and it is actually DRAWN.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => document.querySelector('#screen').width === 640);
  let s = await canvasSize();
  expect(s.w === 640 && s.h === 480, `enhanced map is 640x480 (got ${s.w}x${s.h})`);
  const enh = await stats(null);
  // The enhanced map is palette art, so its distinct-colour count is low by nature
  // (~120 at this sampling stride); the AI upscale is truecolor and lands in the tens
  // of thousands. Thresholds are per-tier for that reason, not a single shared number.
  expect(enh.colours > 60, `enhanced map has real art (${enh.colours} distinct colours)`);
  expect(enh.stdev > 20, `enhanced map has contrast (stdev ${enh.stdev.toFixed(1)})`);

  // ai: the backing store grows to the 4x AI composite — and it, too, is really drawn.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.waitForFunction(() => document.querySelector('#screen').width === 2560);
  s = await canvasSize();
  expect(s.w === 2560 && s.h === 1920, `ai map is 2560x1920 (got ${s.w}x${s.h})`);
  const ai = await stats(null);
  // The guard that matters: a blank canvas of the RIGHT SIZE must fail here.
  expect(ai.colours > 2000, `ai map is not blank (${ai.colours} distinct colours)`);
  expect(ai.stdev > 20, `ai map has contrast (stdev ${ai.stdev.toFixed(1)})`);
  expect(ai.opaqueFrac > 0.9, `ai map is opaque across the frame (${(ai.opaqueFrac * 100).toFixed(1)}%)`);
  // The upscale should carry at least comparable detail, never collapse to a flat fill.
  expect(ai.colours > enh.colours * 5, `ai map is a truecolor upscale, not the palette composite (ai ${ai.colours} vs enhanced ${enh.colours})`);
  expect(Math.abs(ai.mean - enh.mean) < 40, `ai map has a comparable overall tone (ai ${ai.mean.toFixed(1)} vs enhanced ${enh.mean.toFixed(1)})`);

  // Open a room's record panel under ai: still hi-res, and the panel REGION changes.
  const panelRect = { x: 170, y: 150, w: 300, h: 200 };
  const before = await hash(panelRect);
  await p.evaluate(() => {
    window.__ff.markSolved(1);
    window.__ff.markBest(1, '0'.repeat(20));
    window.__ff.openMapInfo(1);
  });
  await p.waitForFunction(() => window.__ff.mapInfoRoom() === 1);
  // Wait for the panel to actually reach the CANVAS, not merely for the state to flip.
  await p.waitForFunction((h) => window.REGION_HASH(170, 150, 300, 200) !== h, before);
  s = await canvasSize();
  expect(s.w === 2560 && s.h === 1920, 'ai record panel stays hi-res');
  expect((await p.evaluate(() => window.__ff.mapInfoRoom())) === 1, 'room 1 record panel open');
  const panel = await stats(panelRect);
  expect(panel.colours > 40, `record panel drew real art (${panel.colours} distinct colours)`);

  // Hovering a panel button highlights it (AI ikonky icon path) — state AND pixels.
  const rect = await p.evaluate(() => {
    const c = document.querySelector('#screen');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, sx: r.width / 640, sy: r.height / 480 };
  });
  const runRect = { x: 262, y: 232, w: 40, h: 28 };
  const runBefore = await hash(runRect);
  await p.mouse.move(rect.left + 279 * rect.sx, rect.top + 245 * rect.sy);
  await p.waitForFunction(() => window.__ff.mapInfoHover() === 'run');
  expect((await p.evaluate(() => window.__ff.mapInfoHover())) === 'run', 'Run button hovered under ai');
  await p.waitForFunction((h) => window.REGION_HASH(262, 232, 40, 28) !== h, runBefore);
  expect((await hash(runRect)) !== runBefore, 'hovering the Run button actually repaints it');

  await p.evaluate(() => window.__ff.closeMapInfo());

  // Toggle back to enhanced: the map repaints to native resolution, still drawn.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => document.querySelector('#screen').width === 640);
  s = await canvasSize();
  expect(s.w === 640 && s.h === 480, 'toggling back to enhanced restores 640x480');
  const back = await stats(null);
  expect(back.colours > 60, `map still drawn after toggling back (${back.colours} distinct colours)`);
}, { cpu: true });
