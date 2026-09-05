/**
 * End-to-end check on the touch bar's edge: does the browser do what
 * `src/app/touchBarEdge.ts` predicts?
 *
 * The pure function decides the edge by laying the room out twice with `layout.ts`'s
 * functions and keeping whichever shows more of it. `tools/measure-touchbar-edge.mjs`
 * uses that same arithmetic to survey all 72 rooms against every device Playwright knows,
 * and the conclusions drawn from it rest on the arithmetic matching a real page — so it is
 * worth pinning that it does, on both landscape edges and in portrait.
 *
 * For each room/viewport it asserts three things:
 *   1. the edge the page chose is the edge the pure function predicts,
 *   2. `.stage` really is the viewport minus THAT edge's bar,
 *   3. the room's rendered scale is the one the model computed for it.
 *
 * (3) is what would catch the CSS and the JS drifting apart — a rule that moved the bar
 * without moving the space it reserves would still satisfy (1). `tools/test-touchbar.mjs`
 * owns the behavioural assertions (margins, centring, no overlap); this one owns the claim
 * that the offline measurement is describing the real thing.
 *
 * Usage: FF_UI_PORT=<port> npx tsx tools/verify-touchbar-edge.mjs
 */
import { chromium } from 'playwright';
import { computeStageLayout, contentScale } from '../src/app/layout.ts';
import { preferredTouchBarEdge, TOUCHBAR_H, touchBarLeftW } from '../src/app/touchBarEdge.ts';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * Rooms chosen to land on both landscape edges: UTES is the widest room in the game
 * (780x225) and DRAKAR the widest of the big ones (795x435), while KOSTE (540x495) is an
 * ordinary shape. Portrait is included to show the media query still owns it.
 */
const CASES = [
  { room: 7, w: 852, h: 393, note: 'phone landscape, very wide room' },
  { room: 6, w: 852, h: 393, note: 'phone landscape, ordinary room' },
  { room: 17, w: 1180, h: 820, note: 'tablet landscape, wide room' },
  { room: 6, w: 1180, h: 820, note: 'tablet landscape, ordinary room' },
  { room: 17, w: 1040, h: 860, note: 'foldable, near square' },
  { room: 17, w: 393, h: 852, note: 'portrait — the media query still owns this' },
];

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await chromium.launch();
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await page.goto(`${BASE}?touch=on`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ff !== undefined, null, { timeout: 30000 });
  await page.evaluate((r) => window.__ff.enterRoomAwait(r), c.room);
  await page.waitForFunction(() => window.__ff.screen() === 'room' && !window.__ff.roomLoading(), null, {
    timeout: 30000,
  });
  await page.waitForTimeout(300);

  const real = await page.evaluate(() => {
    const g = window.__ff.roomGeom();
    const stage = document.querySelector('.stage');
    return {
      nativeW: g.nativeW,
      nativeH: g.nativeH,
      scale: g.scale,
      stageW: stage.clientWidth,
      stageH: stage.clientHeight,
      edge: document.documentElement.getAttribute('data-touchbar-edge') ?? 'left',
    };
  });

  // Portrait belongs to the media query and the attribute is inert there, so the expected
  // edge is 'top' by the stylesheet rather than by the comparison.
  const landscape = c.w > c.h;
  const want = landscape
    ? preferredTouchBarEdge(real.nativeW, real.nativeH, c.w, c.h, 'fill')
    : 'top';
  // `touchBarLeftW()`, not `TOUCHBAR_W`: the left edge's footprint is the bar's content
  // PLUS the clearance it holds off the display corner, and only the first of those is the
  // constant. Chromium reports no housing inset, so this is the no-inset case — 72.
  const availW = want === 'left' ? c.w - touchBarLeftW() : c.w;
  const availH = want === 'top' ? c.h - TOUCHBAR_H : c.h;
  const l = computeStageLayout(availW, availH, 'fill', false);
  const predicted = contentScale(real.nativeW, real.nativeH, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);

  console.log(
    `\n${c.note}  ${c.w}x${c.h}  room ${real.nativeW}x${real.nativeH}` +
      `  -> bar ${want}${landscape ? '' : ' (portrait)'}`,
  );
  if (landscape) {
    expect(real.edge === want, `the page put the bar on the predicted edge (${real.edge})`);
  }
  expect(
    real.stageW === availW && real.stageH === availH,
    `the stage is the viewport minus that bar (${real.stageW}x${real.stageH}, expected ${availW}x${availH})`,
  );
  expect(
    Math.abs(predicted - real.scale) < 1e-6,
    `and the room is drawn at the modelled scale (${real.scale.toFixed(4)} vs ${predicted.toFixed(4)})`,
  );
  await page.close();
}
await browser.close();
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
