/**
 * UI test: the `ai` graphics tier's hi-res world map. The AI path re-composites the
 * map from AI-upscaled art at 4x, so the #screen backing store grows to 2560×1920
 * (CSS box unchanged), while classic/enhanced stay at the native 640×480. The record
 * panel's art (krokoměr bg + hovered icon) is drawn from the AI bitmaps; its digits
 * and the name plaque stay crisp. Toggling the tier repaints, and no errors are logged.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap(), { timeout: 8000 });
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(200);
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'on the map screen');

  const canvasSize = () =>
    p.evaluate(() => {
      const c = document.querySelector('#screen');
      return { w: c.width, h: c.height };
    });

  // enhanced (default): native-resolution map.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForTimeout(200);
  let s = await canvasSize();
  expect(s.w === 640 && s.h === 480, `enhanced map is 640x480 (got ${s.w}x${s.h})`);

  // ai: the backing store grows to the 4x AI composite.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.waitForTimeout(300);
  s = await canvasSize();
  expect(s.w === 2560 && s.h === 1920, `ai map is 2560x1920 (got ${s.w}x${s.h})`);

  // Open a room's record panel under ai: still hi-res, panel art + digits render.
  await p.evaluate(() => {
    window.__ff.markSolved(1);
    window.__ff.markBest(1, '0'.repeat(20));
    window.__ff.openMapInfo(1);
  });
  await p.waitForTimeout(600);
  s = await canvasSize();
  expect(s.w === 2560 && s.h === 1920, 'ai record panel stays hi-res');
  expect((await p.evaluate(() => window.__ff.mapInfoRoom())) === 1, 'room 1 record panel open');

  // Hovering a panel button highlights it (AI ikonky icon path).
  const rect = await p.evaluate(() => {
    const c = document.querySelector('#screen');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top, sx: r.width / 640, sy: r.height / 480 };
  });
  await p.mouse.move(rect.left + 279 * rect.sx, rect.top + 245 * rect.sy);
  await p.waitForTimeout(200);
  expect((await p.evaluate(() => window.__ff.mapInfoHover())) === 'run', 'Run button hovered under ai');

  await p.evaluate(() => window.__ff.closeMapInfo());

  // Toggle back to enhanced: the map repaints to native resolution.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForTimeout(300);
  s = await canvasSize();
  expect(s.w === 640 && s.h === 480, 'toggling back to enhanced restores 640x480');
}, { cpu: true });
