/**
 * UI probe: the AI tier renders each room at the scale its ai.json declares.
 *
 * Each room's upscale factor is written into its ai.json by build-ai.mjs and read back
 * by roomAi.ts. That is uniform ×4 today, but the per-room ADAPTIVE_SCALE path still
 * exists (lib/upscale.mjs), so this probe reads the DECLARED scale rather than assuming
 * one — it passes either way and needs no edit when the flag flips.
 *
 * What it catches: a room silently falling back to the enhanced tier, or rendering at
 * the wrong factor, because the manifest, the per-scale fish set or a WebP asset failed
 * to load. None of those raise an error on their own — the room still draws.
 */
import { budget, withApp } from './ui-lib.mjs';

// A spread of room sizes: these span every bucket the adaptive path would produce.
const ROOMS = [
  { id: 42, name: 'PUCLIK' },
  { id: 34, name: 'KORALY' },
  { id: 9, name: 'ZRC' },
  { id: 39, name: 'NOGROUND' },
  { id: 33, name: 'MIKRO' },
];

await withApp(async ({ p, expect }) => {
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));

  await p.waitForFunction(() => window.__ff && window.__ff.count, null, { timeout: budget(5000) });
  // The pixel assertions below sample #screen directly, which only the canvas-2D
  // backend paints — with the GPU backend the composite lives in GlAiScreen's FBO. That
  // is a real constraint of reading pixels, not a gap: the backend-independent half of
  // this probe (the frame-effect yield) is run in BOTH renderers at the end.
  await p.evaluate(() => window.__ff.setRenderer('cpu'));
  await p.evaluate(() => window.__ff.setGraphics('ai'));

  for (const room of ROOMS) {
    const manifest = await p.evaluate(
      async (n) => (await fetch(`/enhanced-ai/${n}/ai.json`)).json(),
      room.name,
    );
    const scale = manifest.scale;
    expect(Number.isInteger(scale) && scale >= 4, `${room.name} ai.json declares a scale (x${scale})`);

    await p.evaluate((id) => window.__ff.enterRoomAwait(id), room.id);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, null, { timeout: budget(8000) });

    // The shipped background is authored at native × scale, so it is the ground truth
    // for what the compositor should have allocated.
    const bg = await p.evaluate(
      (u) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
          i.onerror = () => rej(new Error(`cannot load ${u}`));
          i.src = u;
        }),
      `/enhanced-ai/${room.name}/${manifest.bg[0]}`,
    );

    // AI room assets load asynchronously and a big room takes over a second, so poll
    // for the hi-res canvas instead of sampling once and reporting a false fallback.
    const got = await p
      .waitForFunction((want) => {
          const c = document.querySelector('#screen');
          return c && c.width === want.w && c.height === want.h ? { w: c.width, h: c.height } : null;
        }, bg, { timeout: budget(25000) })
      .then((h) => h.jsonValue())
      .catch(() => null);

    expect(
      got !== null,
      `${room.name} renders at x${scale} (${bg.w}x${bg.h}), got ${JSON.stringify(
        await p.evaluate(() => {
          const c = document.querySelector('#screen');
          return c ? { w: c.width, h: c.height } : null;
        }),
      )}`,
    );

    // The fish must actually be PAINTED, not merely loaded. drawFish returns early on
    // any unresolved frame, so a naming mismatch between the shipped assets and
    // FISH_BODY_FILE removes every fish while the room still renders perfectly and
    // nothing 404s — invisible to a canvas-size check. Measure contrast where the
    // player fish sits: an empty patch of room is far flatter than a drawn sprite.
    const fish = await p.evaluate((scale) => {
      const c = document.querySelector('#screen');
      const ctx = c && c.getContext('2d');
      const st = window.__ff.state();
      if (!ctx || !st?.big) return null;
      const T = 15 * scale;                       // 15px tiles at this room's scale
      const d = ctx.getImageData(st.big.x * T, st.big.y * T, 4 * T, 2 * T).data;
      let n = 0, s = 0, s2 = 0;
      for (let i = 0; i < d.length; i += 4) {
        const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
        n++; s += v; s2 += v * v;
      }
      return Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2));
    }, scale);

    // Measured: 58-68 with the fish drawn, 2-10 with it missing (a busy background is
    // the high end of "missing"), so 25 separates the two cases with margin either way.
    expect(fish !== null && fish > 25, `${room.name} draws the big fish (contrast ${fish?.toFixed?.(1)})`);
  }

  // The CPU-only frame effects (interlaced/silent-film/megabomb/Tetris) are applied by
  // the faithful compositor while it builds the frame. The AI path bypasses that
  // compositor, so it MUST yield for those frames or the effect silently does nothing —
  // and nothing errors, the room just renders without it.
  //
  // Asserted on roomGeom().upscale rather than on #screen.width, and run in BOTH
  // renderers. The canvas is only the ×S composite on the canvas-2D backend; with the
  // GPU backend (which is the DEFAULT) the composite lives in GlAiScreen's FBO and
  // #screen stays at native size, so a width-based oracle silently tested the path
  // users do not get.
  for (const mode of ['cpu', 'webgl']) {
    await p.evaluate((m) => window.__ff.setRenderer(m), mode);
    await p.evaluate((id) => window.__ff.enterRoomAwait(id), ROOMS[0].id);
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, null, { timeout: budget(8000) });
    const hi = await p.waitForFunction(() => {
      const g = window.__ff.roomGeom();
      return g && g.upscale > 1 ? g.upscale : null;
    }, undefined, { timeout: budget(20000) }).then((h) => h.jsonValue()).catch(() => null);
    expect(hi !== null, `[${mode}] AI room composites at x${hi} before the effect`);

    await p.evaluate(() => window.__ff.typeCheat('XINTERLACED'));
    const lo = await p.waitForFunction(() => {
      const g = window.__ff.roomGeom();
      return g && g.upscale === 1 ? 1 : null;
    }, undefined, { timeout: budget(8000) }).then((h) => h.jsonValue()).catch(() => null);
    expect(lo !== null, `[${mode}] AI path yields to a frame effect (x${hi} -> x${lo})`);

    await p.evaluate(() => window.__ff.typeCheat('XINTERLACED'));
    const restored = await p.waitForFunction((was) => {
      const g = window.__ff.roomGeom();
      return g && g.upscale === was ? was : null;
    }, hi, { timeout: budget(8000) }).then((h) => h.jsonValue()).catch(() => null);
    expect(restored !== null, `[${mode}] AI path resumes once the effect ends (x${restored})`);
  }

  expect(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
});
