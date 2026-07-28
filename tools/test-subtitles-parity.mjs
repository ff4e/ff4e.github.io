/**
 * UI test: the enhanced (vector) subtitle overlay is PIXEL-IDENTICAL to a direct,
 * unoptimised reference implementation of the PisStringF wave.
 *
 * `SubtitleSystem.drawVector` memoises the per-line text shaping and shares the
 * bevel gradient between glyphs that sit at the same wave offset, and the app only
 * repaints the overlay when the drawn image would actually change. None of that may
 * alter a single pixel — so this probe re-derives the overlay from first principles
 * (the ported URoom.pas:25572 maths, spelled out below) into an offscreen canvas of
 * the same size, and compares the two ImageDatas byte for byte, over a sweep of
 * logic ticks that covers the wave-in, the settled line and the scroll.
 *
 * This is the guard for any future rewrite of the renderer (glyph atlas, WebGL,
 * CSS): if it changes what is on screen, this fails.
 */
import { selectRoom, withApp } from './ui-lib.mjs';

// Layout constants — must match src/render/subtitles.ts.
const SUB_FONT_PX = 23;
const SUB_BASELINE_OFF = -6;
const BORDERTITLE = 20;
const UNDERTITLE = 15;

const LINE_A = 'Careful now, the whole cavern is about to collapse on top of us both!';
const LINE_B = 'Stop shoving me around, you overgrown sardine, I can see it perfectly well!';

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.waitForFunction(() => window.__ff.subFontReady(), { timeout: 20000 });
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'M'), LINE_A);
  await p.evaluate((s) => window.__ff.pushSubtitle(s, 'V'), LINE_B);
  await p.waitForTimeout(120);
  expect(await p.evaluate(() => window.__ff.subsActive()), 'parity: subtitles are on screen');

  // Sweep ticks relative to each line's own start: 0-24 walks the wave-in glyph by
  // glyph (p = cas*5 - index), 40/80 are the settled line.
  const TICKS = [0, 1, 2, 3, 5, 8, 11, 14, 17, 20, 24, 40, 80];
  const results = await p.evaluate(
    ({ ticks, K }) => {
      const out = [];
      const sub = document.getElementById('subs');
      const ref = document.createElement('canvas');
      for (const dt of ticks) {
        // Paint the real overlay for this tick (bypasses the repaint gate).
        const st = window.__ff.subsPaintAt(window.__ff.count() + dt);
        if (!st) return [{ tick: dt, error: 'no subtitle state' }];
        ref.width = st.w;
        ref.height = st.h;
        const r = ref.getContext('2d');
        r.setTransform(st.scale, 0, 0, st.scale, 0, 0);

        // ── Reference implementation: the straight-line port of PisStringF's
        // wave, re-measuring and re-creating everything on every glyph.
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
          const baseline = t.ys + st.screenH + K.SUB_BASELINE_OFF;
          const amp = K.UNDERTITLE - t.ys;
          const cas = window.__ff.count() + dt - t.startcount;
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
        out.push({ tick: dt, diff, maxDelta, ink, px: a.length / 4 });
      }
      return out;
    },
    { ticks: TICKS, K: { SUB_FONT_PX, SUB_BASELINE_OFF, BORDERTITLE, UNDERTITLE } },
  );

  // The sweep must actually have drawn something (a silently blank overlay would
  // otherwise "match" the reference perfectly).
  const inked = results.filter((r) => r.ink > 0);
  expect(inked.length >= TICKS.length - 2, `parity: overlay painted on ${inked.length}/${TICKS.length} sampled ticks`);
  expect(results.some((r) => r.ink > 2000), 'parity: a settled line covers a real number of pixels');
  for (const r of results) {
    expect(
      r.diff === 0 && r.maxDelta === 0,
      `parity: tick +${r.tick} matches the reference exactly (differing pixels ${r.diff}, max channel delta ${r.maxDelta})`,
    );
  }
}, { cpu: true });
