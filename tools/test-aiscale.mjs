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
import { withApp } from './ui-lib.mjs';

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

  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  // The CPU backend paints #screen; the default WebGL one leaves it blank.
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
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 8000 });

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
      .waitForFunction(
        (want) => {
          const c = document.querySelector('#screen');
          return c && c.width === want.w && c.height === want.h ? { w: c.width, h: c.height } : null;
        },
        bg,
        { timeout: 25000 },
      )
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

  expect(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
});
