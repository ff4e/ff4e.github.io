/**
 * UI probe: the hi-res AI control panel (and options sub-panel).
 *
 * The panel is composited at runtime from 16 colour variants; the `ai` tier re-runs
 * that composite from upscaled art into a ×scale backing store (render/panelAi.ts).
 * What this catches is the panel silently staying at the native 155x395 because a
 * manifest or a WebP failed to load — nothing errors in that case, the panel just
 * renders soft, so only the backing size reveals it.
 */
import { waitFrames, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));

  await p.evaluate(() => window.__ff.setRenderer('cpu'));

  const size = async () => p.evaluate(() => {
    const c = document.querySelector('#panel');
    return c ? { w: c.width, h: c.height } : null;
  });

  // enhanced: the faithful composite, native size.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0);
  // Wait for the panel to reach its native size rather than sleeping towards it: the
  // repaint happens on a frame, and a flat sleep is a race with the machine.
  await p
    .waitForFunction(() => {
      const c = document.querySelector('#panel');
      return c && c.width === 155 && c.height === 395;
    })
    .catch(() => {});
  const nat = await size();
  expect(nat && nat.w === 155 && nat.h === 395, `enhanced panel is native 155x395 (got ${JSON.stringify(nat)})`);

  // ai: the same composite at ×4.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  const hi = await p.waitForFunction(() => {
    const c = document.querySelector('#panel');
    return c && c.width === 620 && c.height === 1580 ? { w: c.width, h: c.height } : null;
  }, undefined).then((h) => h.jsonValue()).catch(() => null);
  expect(hi !== null, `ai panel is 620x1580 (got ${JSON.stringify(await size())})`);

  // The panel must actually be PAINTED, not just resized — a blank canvas would pass
  // a size check while showing nothing.
  const ink = await p.evaluate(() => {
    const c = document.querySelector('#panel');
    const g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, Math.min(200, c.height)).data;
    let n = 0, s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; n++; s += v; s2 += v * v; }
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  });
  expect(ink > 10, `ai panel is drawn (contrast ${ink.toFixed(1)})`);

  // Switching back must restore the faithful size, not leave the hi-res store behind.
  await p.evaluate(() => window.__ff.setGraphics('enhanced'));
  await p
    .waitForFunction(() => document.querySelector('#panel')?.width === 155)
    .catch(() => {});
  const back = await size();
  expect(back && back.w === 155, `switching back restores 155x395 (got ${JSON.stringify(back)})`);

  // --- options scroll animation under load -----------------------------------
  // The options sub-panel rolls open over ~1s (10 frames x PANEL_SCROLL_MS). That
  // animation must survive a long frame: it used to batch-advance, so a single slow
  // frame (asset decoding right after entering a room) burned the whole roll at once
  // and the panel snapped open with no animation. Simulate the stall directly — it is
  // the only way to exercise the backlog path deterministically.
  await p.evaluate(() => window.__ff.setGraphics('ai'));
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0);
  await new Promise((r) => setTimeout(r, 2500));
  const rolled = await p.evaluate(async (stallMs) => {
    const c = document.querySelector('#panel');
    const g = c.getContext('2d');
    window.__ff.toggleOptions();
    const t0 = performance.now();
    while (performance.now() - t0 < stallMs) { /* block the main thread */ }
    const seen = [];
    const t1 = performance.now();
    while (performance.now() - t1 < 1500) {
      const d = g.getImageData(0, Math.floor(c.height * 0.5), c.width, 3).data;
      let h = 0;
      for (let k = 0; k < d.length; k += 13) h = (h * 31 + d[k]) | 0;
      seen.push(h);
      await new Promise((r) => setTimeout(r, 16));
    }
    let n = 0, prev = null;
    for (const h of seen) { if (h !== prev) { n++; prev = h; } }
    return n;
  }, 1200);
  // ~10 with the backlog dropped; 1-3 when it fast-forwards.
  expect(rolled > 5, `options still roll open after a 1.2s stall (${rolled} frames, expected ~10)`);
  await p.evaluate(() => window.__ff.toggleOptions());
  await new Promise((r) => setTimeout(r, 1200));

  // --- credits -------------------------------------------------------------
  // A static frame whose transparent window reveals a scrolling strip. The faithful
  // tier composites it per pixel into #screen; the AI tier mounts two <img> layers and
  // scrolls them with a CSS transform, so the compositor animates it on the GPU (see
  // render/creditsAi.ts). Checked per tier because they use different surfaces.
  const openCredits = async (tier) => {
    await p.evaluate((g) => window.__ff.setGraphics(g), tier);
    // The credits are a MAP overlay — from a room they would not draw at all.
    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map');
    await p.evaluate(() => window.__ff.openCredits());
  };
  const stripEl = () => p.evaluate(() => {
    const i = document.querySelector('#stagebox img[style*="scaleY"]');
    if (!i) return null;
    const r = i.getBoundingClientRect();
    const box = i.parentElement.getBoundingClientRect();
    return { transform: i.style.transform, w: Math.round(box.width), h: Math.round(box.height),
      natW: i.naturalWidth, stripH: Math.round(r.height) };
  });

  await openCredits('enhanced');
  const faithful = await p.waitForFunction(() => {
    const c = document.querySelector('#screen');
    return c && c.width === 640 ? { w: c.width, h: c.height } : null;
  }, undefined).then((h) => h.jsonValue()).catch(() => null);
  expect(faithful !== null, `enhanced credits paint #screen at 640x480 (got ${JSON.stringify(faithful)})`);
  const fInk = await p.evaluate(() => {
    const c = document.querySelector('#screen');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(400, c.height)).data;
    let n = 0, s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; n++; s += v; s2 += v * v; }
    return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
  });
  expect(fInk > 5, `enhanced credits are drawn (contrast ${fInk.toFixed(1)})`);
  expect(await p.evaluate(() => !document.querySelector('#stagebox img[style*="scaleY"]')
    || document.querySelector('#stagebox img[style*="scaleY"]').closest('div').style.display === 'none'),
  'the GPU overlay stays hidden in the faithful tier');
  await p.evaluate(() => window.__ff.closeMapOverlay());

  await openCredits('ai');
  const layers = await p.waitForFunction(() => {
    const i = document.querySelector('#stagebox img[style*="scaleY"]');
    return i && i.naturalWidth === 2560 ? true : null;
  }, undefined).then(() => stripEl()).catch(() => null);
  expect(layers !== null, `ai credits mount the 2560-wide GPU layers (got ${JSON.stringify(await stripEl())})`);
  // The strip must be TALLER than the window it scrolls through, else nothing rolls.
  expect(layers && layers.stripH > layers.h * 2, `ai strip is a tall scroll (${layers?.stripH}px in a ${layers?.h}px box)`);
  // #screen must be hidden, or the map would still show through underneath.
  expect(await p.evaluate(() => document.querySelector('#screen').style.display === 'none'),
    'ai credits hide the game canvas');

  // The roll must actually advance — and via the transform, not a repaint.
  const t0 = (await stripEl()).transform;
  await p
    .waitForFunction((was) => document.querySelector('#stagebox img[style*="scaleY"]')?.style.transform !== was, t0)
    .catch(() => {});
  const t1 = (await stripEl()).transform;
  expect(t0 !== t1, `ai credits scroll (${t0} → ${t1})`);

  // Same viewport-scaling requirement as before: the credits used to be pinned at
  // 640x480 CSS px, which showed as a small window on a large display.
  //
  // Wait for the relayout, do not sleep through it. A flat 500ms after
  // `setViewportSize` is a race with the machine — under an 8-way run the second resize
  // had not landed when the box was read, and both readings came back 793px, failing a
  // correct build. The condition we are really waiting for is that the layout has caught
  // up with the viewport we just set.
  const resizeTo = async (width, height) => {
    await p.setViewportSize({ width, height });
    await p
      .waitForFunction((w) => {
          const i = document.querySelector('#stagebox img[style*="scaleY"]');
          return window.innerWidth === w && i !== null && i.parentElement.getBoundingClientRect().width > 0;
        }, width)
      .catch(() => {});
    // One more frame, so the box is measured after the layout that resize triggered.
    await waitFrames(p, 2);
    return (await stripEl()).w;
  };
  const small = await resizeTo(1000, 700);
  const large = await resizeTo(1600, 1100);
  expect(large > small * 1.2, `ai credits scale with the viewport (${small}px → ${large}px)`);
  expect(large > 1000, `ai credits fill the stage (${large}px of a 1600px viewport)`);

  // Closing must restore the canvas, or every later screen would be invisible.
  await p.evaluate(() => window.__ff.closeMapOverlay());
  await p
    .waitForFunction(() => document.querySelector('#screen').style.display !== 'none')
    .catch(() => {});
  expect(await p.evaluate(() => document.querySelector('#screen').style.display !== 'none'),
    'closing the credits restores the game canvas');

  expect(errs.length === 0, `no page errors (${errs.slice(0, 2).join(' | ')})`);
});
