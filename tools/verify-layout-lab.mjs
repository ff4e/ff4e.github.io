/**
 * End-to-end check: does `tools/layoutPlaced.ts` really describe the running game?
 *
 * The layout lab renders the shipped model beside a candidate, and every conclusion drawn
 * from it rests on the left-hand side being the truth. `layoutPlaced.ts` calls
 * `src/app/layout.ts`'s own functions, so the SCALING cannot drift — but the PLACEMENT
 * (where the room lands, how much gap is left on each side) lives in `index.html`'s
 * stylesheet and had to be reproduced. This pins that reproduction against a real
 * Chromium, the same way `tools/test-touchbar-edge.mjs` pins the edge model.
 *
 * For each room/viewport/target it asserts:
 *   1. the room is drawn at the modelled scale,
 *   2. the room LANDS where the model says, to within a pixel of rounding,
 *   3. the gap left on each side is the gap the model reports.
 *
 * (2) and (3) are the ones that matter here: a lab that got the scale right and the
 * position wrong would show the reserve, the centring and the clipping incorrectly — which
 * is three of the six properties `tools/sweep-layout.mjs` reports on.
 *
 * Usage: FF_UI_PORT=<port> npx tsx tools/verify-layout-lab.mjs
 */
import { chromium } from 'playwright';
import { layoutRoom } from './layoutPlaced.ts';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * Deliberately spans the regions where the shipped model's floors bind, because those are
 * where a reproduction of the CSS is most likely to be wrong — and where both defects are.
 * KOSTE (540x495) is an ordinary shape, UTES (780x225) the widest room, DRAKAR (795x435)
 * the widest of the big ones.
 */
const CASES = [
  { room: 6, w: 1600, h: 1000, touch: false, mode: 'medium', note: 'desktop, ordinary window' },
  { room: 13, w: 1491, h: 1114, touch: false, mode: 'medium', note: "desktop, Martin's window" },
  { room: 7, w: 1280, h: 620, touch: false, mode: 'fixed', note: 'desktop, fixed mode, wide room' },
  { room: 6, w: 900, h: 500, touch: false, mode: 'fill', note: 'desktop, fill, small window' },
  { room: 7, w: 852, h: 393, touch: true, mode: 'fill', note: 'phone landscape, widest room' },
  { room: 6, w: 852, h: 393, touch: true, mode: 'fill', note: 'phone landscape, ordinary room' },
  { room: 13, w: 1180, h: 820, touch: true, mode: 'fill', note: 'tablet landscape' },
];

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await chromium.launch();
for (const c of CASES) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await page.goto(`${BASE}${c.touch ? '?touch=on' : ''}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ff !== undefined, null, { timeout: 30000 });
  if (!c.touch) await page.evaluate((m) => window.__ff.fitMode(m), c.mode);
  await page.evaluate((r) => window.__ff.enterRoomAwait(r), c.room);
  await page.waitForFunction(
    () => window.__ff.screen() === 'room' && !window.__ff.roomLoading(),
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(300);

  const real = await page.evaluate(() => {
    const g = window.__ff.roomGeom();
    // The canvas carries a 1px border, so its CONTENT box is what the model's drawnW/H
    // describe — `clientWidth` excludes the border, `getBoundingClientRect` includes it.
    const el = document.getElementById('screen');
    const r = el.getBoundingClientRect();
    const bl = parseFloat(getComputedStyle(el).borderLeftWidth) || 0;
    const bt = parseFloat(getComputedStyle(el).borderTopWidth) || 0;
    return {
      nativeW: g.nativeW,
      nativeH: g.nativeH,
      scale: g.scale,
      x: r.left + bl,
      y: r.top + bt,
      w: el.clientWidth,
      h: el.clientHeight,
      edge: document.documentElement.getAttribute('data-touchbar-edge') ?? 'left',
      barUp: document.documentElement.hasAttribute('data-touchbar'),
      // The row's right edge is the PANEL's on desktop, not the room's — the panel sits
      // beside the room and is part of the group the layout centres.
      rowRight: (() => {
        const col = document.getElementById('panelcol');
        if (!col || getComputedStyle(col).display === 'none') return r.right;
        return col.getBoundingClientRect().right;
      })(),
    };
  });

  const model = layoutRoom({
    viewportW: c.w,
    viewportH: c.h,
    roomW: real.nativeW,
    roomH: real.nativeH,
    target: c.touch ? 'touch' : 'pc',
    mode: c.mode,
    stripEdge: c.touch && real.barUp ? real.edge : 'none',
    dpr: 1,
  });

  console.log(
    `\n${c.note}  ${c.w}x${c.h}  room ${real.nativeW}x${real.nativeH}  ${c.mode}` +
      (c.touch ? `  bar ${real.barUp ? real.edge : 'down'}` : ''),
  );
  expect(
    Math.abs(model.contentScale - real.scale) < 1e-6,
    `drawn at the modelled scale (${real.scale.toFixed(4)} vs ${model.contentScale.toFixed(4)})`,
  );
  // Two pixels of tolerance: `relayout()` rounds the box's height, the browser rounds the
  // flex split, and `#screen` carries a 1px border that the layout model deliberately does
  // not know about (it is chrome, not content). None of the three can hide a real
  // disagreement, which would be tens of pixels.
  expect(
    Math.abs(model.roomX - real.x) <= 2.01 && Math.abs(model.roomY - real.y) <= 2.01,
    `lands where the model says (${real.x.toFixed(1)},${real.y.toFixed(1)} vs ` +
      `${model.roomX.toFixed(1)},${model.roomY.toFixed(1)})`,
  );
  const realGapL = real.x;
  const realGapT = real.y;
  const realGapR = c.w - real.rowRight;
  const realGapB = c.h - (real.y + real.h);
  const modelGapL = model.roomX;
  const modelGapT = model.roomY;
  const modelGapR = c.w - (model.roomX + model.drawnW + model.gap + model.panelW);
  const modelGapB = c.h - (model.roomY + model.drawnH);
  expect(
    Math.abs(realGapL - modelGapL) <= 2.01 &&
      Math.abs(realGapT - modelGapT) <= 2.01 &&
      Math.abs(realGapR - modelGapR) <= 2.51 &&
      Math.abs(realGapB - modelGapB) <= 2.51,
    `gaps match: real L${realGapL.toFixed(0)} T${realGapT.toFixed(0)} R${realGapR.toFixed(0)} B${realGapB.toFixed(0)}` +
      `  model L${modelGapL.toFixed(0)} T${modelGapT.toFixed(0)} R${modelGapR.toFixed(0)} B${modelGapB.toFixed(0)}`,
  );
  await page.close();
}
await browser.close();
console.log(ok ? '\nPASS' : '\nFAIL');
process.exit(ok ? 0 : 1);
