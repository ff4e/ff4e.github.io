/**
 * End-to-end check on the touch bar's edge: does the browser do what
 * `src/app/touchBarEdge.ts` predicts?
 * This exercises the retained tablet bar through desktop `?touch=on`, including
 * historical phone-sized fixtures. Real phones now use the overlay-layout probe.
 *
 * The pure function decides the edge by laying the room out twice with `layout.ts`'s
 * functions and keeping whichever shows more of it. `tools/measure-touchbar-edge.mjs`
 * uses that same arithmetic to survey all 72 rooms against every device Playwright knows,
 * and the conclusions drawn from it rest on the arithmetic matching a real page — so it is
 * worth pinning that it does, on both landscape edges and in portrait.
 *
 * For each room/viewport it asserts three things:
 *   1. the edge the page chose is the edge the pure function predicts,
 *   2. `.stage` is the WHOLE viewport — the buttons float over the room and reserve
 *      nothing, whichever edge they are on (2026-09-29; it used to be the viewport minus
 *      that edge's bar),
 *   3. the room's rendered scale is the one the model computes for the whole viewport.
 *
 * (2) and (3) are what would catch a reserve creeping back — a stylesheet rule that gave
 * the bar space again would still satisfy (1). `tools/test-touchbar.mjs` owns the
 * behavioural assertions (buttons, centring); this one owns the claim that the offline
 * measurement is describing the real thing.
 *
 * ── Why this is `test-` and not `verify-` ────────────────────────────────────
 * `tools/run-ui-tests.mjs` discovers `test-*.mjs` and nothing else, so under its old name
 * this file only ever ran when somebody remembered to type it. It did not run when the
 * left edge started reserving 14px too much, and the drift lived until it was found by
 * hand (ed3ebc4) — by a check that existed, passed no gate, and was therefore not a check.
 * The rename is the fix. Renamed and not copied, so there is one of it.
 *
 * ── The housing cases ────────────────────────────────────────────────────────
 * Chromium reports no safe-area insets, so the browser cases below are all the no-cutout
 * world — which is honest for a browser and useless for the iOS shell, where the island is
 * 62px and the left edge is priced at 120 instead of 72. Those cases set `--sa-left` on the
 * root by hand at the phone's FULL-BLEED size (874x402, not Safari's 756x352) and re-assert
 * all three claims, which is the only place any of this is checked against a rendering
 * engine.
 *
 * Usage: FF_UI_PORT=<port> npx tsx tools/test-touchbar-edge.mjs
 */
import { computeStageLayout, contentScale } from '../src/app/layout.ts';
import { touchBarEdgeFor, TOUCHBAR_LEAD } from '../src/app/touchBarEdge.ts';
import { appReady, exitProbe, launchBrowser, WAIT_BACKSTOP } from './ui-lib.mjs';
import { LAB_ROOMS } from './layoutLabRooms.ts';

const BASE = `http://127.0.0.1:${process.env.FF_UI_PORT ?? '5173'}/`;

/**
 * Rooms chosen to land on both landscape edges: UTES is the widest room in the game
 * (780x225) and DRAKAR the widest of the big ones (795x435), while KOSTE (540x495) is an
 * ordinary shape. Portrait keeps the top for an ordinary room, and VRAK (315x555) is the
 * room whose top buttons an iPad in portrait would sit over and whose left ones it would
 * not, so it moves them to the left (`touchBarEdgeFor`).
 *
 * `inset` is the display cutout in css px — 0 everywhere a browser is being modelled,
 * because a browser has already subtracted it. The last two are the native iOS shell at
 * its real full-screen size with its measured island (`tools/layoutLabHousings.ts`).
 */
const CASES = [
  { room: 7, w: 852, h: 393, inset: 0, note: 'phone landscape, very wide room' },
  { room: 6, w: 852, h: 393, inset: 0, note: 'phone landscape, ordinary room' },
  { room: 17, w: 1180, h: 820, inset: 0, note: 'tablet landscape, wide room' },
  { room: 6, w: 1180, h: 820, inset: 0, note: 'tablet landscape, ordinary room' },
  { room: 17, w: 1040, h: 860, inset: 0, note: 'foldable, near square' },
  { room: 17, w: 393, h: 852, inset: 0, note: 'portrait, ordinary room' },
  { room: 4, w: 834, h: 1194, inset: 0, note: 'iPad portrait, VRAK: only the top buttons would cover it' },
  { room: 7, w: 874, h: 402, inset: 62, note: 'iPhone 17 native, island, very wide room' },
  { room: 6, w: 874, h: 402, inset: 62, note: 'iPhone 17 native, island, ordinary room' },
];

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

const browser = await launchBrowser();
// ONE context, resized per case. A fresh page per case cost ~2-3s of boot each; the game is
// stateless between `enterRoomAwait` calls, so there is nothing a new page buys.
const page = await browser.newPage({ viewport: { width: CASES[0].w, height: CASES[0].h } });
// The backstop is the page default, so nothing below carries a timeout of its own — a
// number sized just above a nominal duration is a race the timeout loses, reporting a fake
// failure (see ui-lib.mjs). `gotoApp` is not used here only because this probe needs
// `?touch=on` in the query; `appReady` is the rest of it.
page.setDefaultTimeout(WAIT_BACKSTOP);
await page.goto(`${BASE}?touch=on`, { waitUntil: 'domcontentloaded' });
await appReady(page);

for (const c of CASES) {
  await page.setViewportSize({ width: c.w, height: c.h });
  // The cutout has to be set as a real custom property, not passed to the model, or this
  // would be checking the arithmetic against itself instead of against a layout engine.
  await page.evaluate((px) => {
    const r = document.documentElement;
    if (px) r.style.setProperty('--sa-left', `${px}px`);
    else r.style.removeProperty('--sa-left');
  }, c.inset);
  await page.evaluate((r) => window.__ff.enterRoomAwait(r), c.room);
  await page.waitForFunction(() => window.__ff.screen() === 'room' && !window.__ff.roomLoading());
  // Wait for THIS room, by its native size, and not merely for "a room is up". Consecutive
  // cases here deliberately share a viewport and differ only in the room, so there is no
  // resize to ride and `roomLoading` drops while the previous room's geometry is still what
  // `roomGeom()` reports — the probe then reads the last case's edge and fails a case that
  // is actually correct. It passed alone and failed in the full 4-way run, which is what a
  // fixed 300ms sleep buys: a pass that depends on how busy the machine is.
  const wantRoom = LAB_ROOMS.find((r) => r.n === c.room);
  if (!wantRoom) throw new Error(`case names room ${c.room}, which is not in LAB_ROOMS`);
  await page.waitForFunction(
    (d) => {
      const g = window.__ff.roomGeom();
      return g !== null && g.nativeW === d.w && g.nativeH === d.h;
    },
    { w: wantRoom.w, h: wantRoom.h },
  );
  // Geometry describes the new room before it is painted. The bar is reconciled AFTER
  // draw(), then the following draw rescales the canvas. Two stable stage reads alone
  // can still observe the old edge. Wait for an app frame and for the canvas to match
  // its geometry as well, without waiting for the model's predicted edge or scale.
  // Clear the previous sample so equal-sized consecutive cases cannot pass instantly.
  const beforePaint = await page.evaluate(() => {
    window.__edgeProbeLast = null;
    return window.__ff.throttleInfo().loops;
  });
  await page.waitForFunction((start) => {
    const g = window.__ff.roomGeom();
    const canvas = document.getElementById('screen');
    if (window.__ff.throttleInfo().loops <= start || !g ||
        Math.abs(canvas.clientWidth - g.cssW) > 1 || Math.abs(canvas.clientHeight - g.cssH) > 1) {
      window.__edgeProbeLast = null;
      return false;
    }
    const stage = document.querySelector('.stage');
    const now = `${stage.clientWidth}x${stage.clientHeight}`;
    const was = window.__edgeProbeLast;
    window.__edgeProbeLast = now;
    return was === now;
  }, beforePaint);

  const real = await page.evaluate(() => {
    const g = window.__ff.roomGeom();
    const stage = document.querySelector('.stage');
    return {
      nativeW: g.nativeW,
      nativeH: g.nativeH,
      scale: g.scale,
      stageW: stage.clientWidth,
      stageH: stage.clientHeight,
      edge:
        document.documentElement.getAttribute('data-touchbar-edge') ??
        (window.innerWidth > window.innerHeight ? 'left' : 'top'),
    };
  });

  const landscape = c.w > c.h;
  // The island cases are landscape, so it is on a SIDE: it feeds `clearLeft` and leaves
  // `insetTop` at 0.
  const clearLeft = Math.max(c.inset, TOUCHBAR_LEAD);
  const want = touchBarEdgeFor(real.nativeW, real.nativeH, c.w, c.h, 'fill', 1, 0, clearLeft);
  // The buttons float over the room, so the room has the whole viewport on either edge.
  const availW = c.w;
  const availH = c.h;
  const l = computeStageLayout(availW, availH, 'fill', false);
  const predicted = contentScale(real.nativeW, real.nativeH, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);

  console.log(
    `\n${c.note}  ${c.w}x${c.h}${c.inset ? ` cutout ${c.inset}` : ''}  room ${real.nativeW}x${real.nativeH}` +
      `  -> bar ${want}${landscape ? '' : ' (portrait)'}`,
  );
  expect(real.edge === want, `the page put the bar on the predicted edge (${real.edge})`);
  expect(
    real.stageW === availW && real.stageH === availH,
    `the stage is the whole viewport — the bar reserves nothing (${real.stageW}x${real.stageH}, expected ${availW}x${availH})`,
  );
  expect(
    Math.abs(predicted - real.scale) < 1e-6,
    `and the room is drawn at the modelled scale (${real.scale.toFixed(4)} vs ${predicted.toFixed(4)})`,
  );
}
// The property is inline on the root, so it would outlive this page if the context were
// ever shared further. Cheap to undo, and a stray 62px island is a baffling failure.
await page.evaluate(() => document.documentElement.style.removeProperty('--sa-left'));
await page.close();
console.log(ok ? '\nPASS' : '\nFAIL');
exitProbe(ok ? 0 : 1);
