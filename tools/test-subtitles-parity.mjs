/**
 * UI test: the enhanced (vector) subtitle overlay is PIXEL-IDENTICAL to a direct,
 * unoptimised reference implementation of the PisStringF wave.
 *
 * `SubtitleSystem.drawVector` memoises the per-line text shaping, shares the bevel
 * gradient between glyphs at the same wave offset, and interpolates the wave and the
 * line scroll between logic ticks; the app repaints the overlay only when the drawn
 * image would change. None of that may alter a single pixel — so this probe
 * re-derives the overlay from first principles (the ported URoom.pas:25572 maths,
 * spelled out below) into an offscreen canvas of the same size and compares the two
 * ImageDatas byte for byte.
 *
 * Two phases:
 *  1. A deterministic sweep of logic ticks x sub-tick fractions with the line state
 *     frozen, covering the wave-in and the settled line.
 *  2. A live phase that lets the game actually tick, so the reference is also checked
 *     against real PosunTitulky scrolling and real line arrival/expiry.
 *
 * This is the guard for any future rewrite of the renderer (glyph atlas, WebGL,
 * CSS): if it changes what is on screen, this fails.
 */
import { selectRoom, withApp } from './ui-lib.mjs';

// Layout constants — must match src/render/subtitles.ts.
const K = {
  SUB_FONT_PX: 23,
  SUB_BASELINE_OFF: -6,
  BORDERTITLE: 20,
  UNDERTITLE: 15,
  SPEEDTITLE: 2,
};

const LINE_A = 'Careful now, the whole cavern is about to collapse on top of us both!';
const LINE_B = 'Stop shoving me around, you overgrown sardine, I can see it perfectly well!';

/**
 * Install the reference renderer + comparator in the page. `__subsCheck(dt, alpha)`
 * paints the real overlay for tick `count+dt` at sub-tick fraction `alpha`, redraws
 * the same state from scratch on its own canvas, and reports how far apart they are.
 */
async function installReference(p) {
  await p.evaluate((K) => {
    const ref = document.createElement('canvas');
    window.__subsCheck = (dt, al) => {
      const sub = document.getElementById('subs');
      const at = window.__ff.count() + dt;
      const st = window.__ff.subsPaintAt(at, al); // bypasses the repaint gate
      if (!st) return null;
      // The overlay quantises the sub-tick fraction onto a fixed step grid.
      const frac = al > 0 ? Math.min(Math.floor(al * st.substeps), st.substeps - 1) / st.substeps : 0;
      ref.width = st.w;
      ref.height = st.h;
      const r = ref.getContext('2d');
      r.setTransform(st.scale, 0, 0, st.scale, 0, 0);

      // ── Reference: the straight-line port of PisStringF's wave, re-measuring and
      // re-creating everything for every glyph, every time.
      r.textAlign = 'left';
      r.textBaseline = 'alphabetic';
      r.lineJoin = 'round';
      r.miterLimit = 2;
      const maxW = st.screenW - K.BORDERTITLE * 2;
      for (const t of st.lines) {
        const [red, grn, blu] = t.rgb;
        let fs = K.SUB_FONT_PX;
        r.font = `${st.weight} ${fs}px ${st.family}`;
        let total = r.measureText(t.obsah).width;
        if (total > maxW) {
          fs = Math.max(8, (fs * maxW) / total);
          r.font = `${st.weight} ${fs}px ${st.family}`;
          total = r.measureText(t.obsah).width;
        }
        // PosunTitulky moves the line SPEEDTITLE px per tick toward cilys, so its
        // position part-way through a tick is exactly that fraction of the step.
        const ys =
          frac === 0 || t.ys <= t.cilys
            ? t.ys
            : t.ys + (Math.max(t.cilys, t.ys - K.SPEEDTITLE) - t.ys) * frac;
        const baseline = ys + st.screenH + K.SUB_BASELINE_OFF;
        const amp = K.UNDERTITLE - ys;
        const cas = at - t.startcount + frac;
        let x = (st.screenW - total) / 2;
        let index = 0;
        for (const ch of t.obsah) {
          index++;
          const w = r.measureText(ch).width;
          const pp = cas * 5 - index;
          if (pp >= 0 && ch !== ' ') {
            let dy = 0;
            if (pp < 50) dy = ((amp * (50 - pp)) / 50) * Math.cos((3.5 * Math.PI * pp) / 50);
            const gy = baseline + dy;
            const grad = r.createLinearGradient(0, gy - fs * 0.72, 0, gy + fs * 0.1);
            grad.addColorStop(0, `rgb(${red},${grn},${blu})`);
            grad.addColorStop(1, `rgb(${Math.round(red * 0.42)},${Math.round(grn * 0.42)},${Math.round(blu * 0.42)})`);
            r.strokeStyle = 'rgb(5,5,12)';
            r.lineWidth = fs * 0.16;
            r.strokeText(ch, x, gy);
            r.fillStyle = grad;
            r.fillText(ch, x, gy);
          }
          x += w;
        }
      }

      const a = sub.getContext('2d').getImageData(0, 0, st.w, st.h).data;
      const b = r.getImageData(0, 0, st.w, st.h).data;
      let diff = 0;
      let maxDelta = 0;
      let ink = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i + 3] !== 0) ink++;
        for (let c = 0; c < 4; c++) {
          const d = Math.abs(a[i + c] - b[i + c]);
          if (d !== 0) {
            if (c === 0) diff++;
            if (d > maxDelta) maxDelta = d;
          }
        }
      }
      return { diff, maxDelta, ink, lines: st.lines.length, ys: st.lines.map((l) => l.ys).join(',') };
    };
  }, K);
}

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => window.__ff.subFontReady(), { timeout: 20000 });
  await installReference(p);
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LINE_A);
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LINE_B);
  await p.waitForTimeout(120);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'parity: subtitles are on screen');

  // ── Phase 1: frozen line state, swept over ticks x sub-tick fractions.
  // 0-24 walks the wave-in glyph by glyph (p = cas*5 - index); 40/80 are settled.
  const TICKS = [0, 1, 2, 3, 5, 8, 11, 14, 17, 20, 24, 40, 80];
  const ALPHAS = [0, 0.15, 0.4, 0.55, 0.9];
  const swept = await p.evaluate(
    (pairs) => pairs.map(([dt, al]) => ({ dt, al, ...window.__subsCheck(dt, al) })),
    TICKS.flatMap((t) => ALPHAS.map((a) => [t, a])),
  );

  const samples = TICKS.length * ALPHAS.length;
  const inked = swept.filter((r) => r.ink > 0);
  expect(
    inked.length >= samples - ALPHAS.length * 2,
    `sweep: overlay painted on ${inked.length}/${samples} tick+fraction pairs`,
  );
  expect(swept.some((r) => r.ink > 2000), 'sweep: a settled line covers a real number of pixels');
  for (const r of swept.filter((r) => r.diff !== 0 || r.maxDelta !== 0)) {
    expect(false, `sweep: tick +${r.dt} @${r.al} differs (${r.diff} pixels, max channel delta ${r.maxDelta})`);
  }
  expect(
    swept.every((r) => r.diff === 0 && r.maxDelta === 0),
    `sweep: all ${samples} tick+fraction samples match the reference byte for byte`,
  );
  // The sub-tick sampling must actually MOVE the image, or the sweep would be
  // comparing the same frame against itself five times over.
  expect(
    new Set(swept.filter((r) => r.dt === 5).map((r) => r.ink)).size > 1,
    'sweep: the sub-tick fractions really do animate the wave (ink varies within one tick)',
  );

  // ── Phase 2: let the game run. Now the reference is checked against real
  // PosunTitulky scrolling (ys marching toward cilys) and real line arrival/expiry,
  // which the frozen sweep above cannot exercise.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LINE_A);
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LINE_B);
  const live = [];
  for (let i = 0; i < 24; i++) {
    const r = await p.evaluate((al) => window.__subsCheck(0, al), (i % 5) / 5 + 0.05);
    if (r) live.push(r);
    await p.waitForTimeout(300);
    if (i === 11) await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), 'And there it goes again.');
  }

  expect(live.length > 12, `live: collected ${live.length} samples while the game ran`);
  expect(new Set(live.map((r) => r.ys)).size > 3, 'live: the lines really scrolled (ys changed over time)');
  expect(new Set(live.map((r) => r.lines)).size > 1, 'live: the line stack really changed (added/expired)');
  expect(live.some((r) => r.ink > 2000), 'live: real text was on screen');
  for (const r of live.filter((r) => r.diff !== 0 || r.maxDelta !== 0)) {
    expect(false, `live: ${r.lines} lines at ys=${r.ys} differ (${r.diff} pixels, max delta ${r.maxDelta})`);
  }
  expect(
    live.every((r) => r.diff === 0 && r.maxDelta === 0),
    `live: all ${live.length} running-game samples match the reference byte for byte`,
  );
}, { cpu: true });
