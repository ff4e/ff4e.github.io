/**
 * UI test: the world map is presented ONCE, in the tier's final art, with the loading
 * state covering the wait.
 *
 * The room version of this rule has its own probe (test-ai-loading.mjs). The map was the
 * one screen it never covered, and the map had the defect rooms used to have: the draw
 * kicked the AI art off and painted whatever was ready, so the faithful map went up first
 * and visibly swapped to the AI upscale a beat later. The window is not small — 2.36 MB
 * of AI map art against 0.59 MB of BMPs, measured at 28.0s of enhanced map on screen
 * (Slow 4G, cold cache) — and it lands on the first screen of the game.
 *
 * The AI map files are gated with p.route so the faithful map is ready long before them,
 * i.e. exactly the window in which the old code exposed the intermediate frame.
 *
 * THE ORACLE IS PIXELS, NOT FLAGS, and that is load-bearing: a state-only check would
 * keep passing with the hold deleted, because the flags would still say "pending" while
 * the map was painted underneath them. Every frame is sampled for a LIT row of #screen,
 * and the backing-store width of each lit frame is recorded — the AI compositor draws
 * into 2560×1920, the faithful one into 640×480, so the sequence of widths ever shown
 * is the whole assertion. `[2560]` is a map presented once, in its final art; `[640,
 * 2560]` is the bug.
 *
 * Boot is where the map's wait actually happens, so the probe reboots the page under the
 * gate rather than testing a mid-game visit. The first boot is pinned to `enhanced` so
 * that reboot starts with a COLD AI map: had the first boot fetched it, the second could
 * be served from the browser's memory cache, no request would be issued, and the gate
 * would silently hold nothing.
 */
import { waitFrames, withApp } from './ui-lib.mjs';

/** Everything loadAiWorldMap fetches: mapa-0/1, krokomer, ikonky, n0..n4. */
const GATED = '**/Menu/*_ai.*';

/**
 * Record, per frame: the #screen backing-store width of every frame that shows lit
 * content (deduplicated to transitions), and every change in the loading overlay's
 * visibility. Installed as an init script so it is running before the app boots — the
 * map's first paint is moments after boot, so a sampler added afterwards has already
 * missed the frame the whole probe is about.
 */
const SAMPLER = () => {
  try {
    localStorage.setItem('ff.graphics', 'ai');
  } catch {
    /* storage unavailable */
  }
  window.__map = { widths: [], overlay: [] };
  const step = () => {
    requestAnimationFrame(step);
    const el = document.getElementById('loading');
    if (el) {
      const vis = el.hidden === false;
      const o = window.__map.overlay;
      if (!o.length || o[o.length - 1] !== vis) o.push(vis);
    }
    const cv = document.getElementById('screen');
    if (!cv || !cv.width || !cv.height) return;
    if (!window.__g) window.__g = cv.getContext('2d', { willReadFrequently: true });
    const row = window.__g.getImageData(0, Math.floor(cv.height / 2), cv.width, 1).data;
    // Stride the row: a 2560px read every frame is the one thing here that could
    // perturb what it measures. Any non-black pixel means the map has been painted.
    for (let i = 0; i < row.length; i += 4 * 9) {
      if (row[i] > 16 || row[i + 1] > 16 || row[i + 2] > 16) {
        const w = window.__map.widths;
        if (!w.length || w[w.length - 1] !== cv.width) w.push(cv.width);
        return;
      }
    }
  };
  requestAnimationFrame(step);
};

await withApp(
  async ({ p, expect }) => {
    await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());

    // The sampler is added AFTER withApp's own init scripts, so its `ff.graphics = ai`
    // is the one that sticks on every reload from here on (they run in insertion order).
    await p.addInitScript(SAMPLER);

    let releaseMap;
    const openGate = () => new Promise((r) => { releaseMap = r; });
    let gate = openGate();
    // continue() can race the unroute below once the gate opens; the assertions are
    // about what was painted, not about who won that race.
    await p.route(GATED, async (route) => { await gate; await route.continue().catch(() => {}); });

    // === 1. First appearance: boot straight onto the map in the `ai` tier. ===
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapArtPending());
    await waitFrames(p, 4);

    const held = await p.evaluate(() => ({
      widths: [...window.__map.widths],
      overlay: [...window.__map.overlay],
      visible: window.__ff.loadingVisible(),
      painted: window.__ff.mapEverPainted(),
    }));
    expect(held.widths.length === 0, `nothing is presented while the map's art loads (saw ${JSON.stringify(held.widths)})`);
    expect(!held.painted, 'the map has not been painted yet');
    expect(held.visible, 'the loading overlay covers the wait');
    // The point of folding this into boot rather than arming it on a delay: the boot
    // overlay is already up, so it must simply stay up. A [true, false, true] here is
    // the map blinking the loading screen off and back on, which is what a naive
    // 200ms-delayed arm would have produced.
    expect(
      held.overlay.length === 1 && held.overlay[0] === true,
      `the overlay is continuous from boot into the map's wait (transitions: ${JSON.stringify(held.overlay)})`,
    );

    // === 2. Release: the map appears, in AI art, and that is the ONLY art it ever
    //        appeared in. This is the assertion that fails if the hold is removed. ===
    releaseMap();
    await p.waitForFunction(() => !window.__ff.mapArtPending() && window.__ff.aiMapLoaded());
    await waitFrames(p, 5);

    const shown = await p.evaluate(() => ({
      widths: [...window.__map.widths],
      overlay: [...window.__map.overlay],
      visible: window.__ff.loadingVisible(),
    }));
    expect(
      shown.widths.length === 1 && shown.widths[0] > 1000,
      `the map is presented once, in the AI art (backing stores shown: ${JSON.stringify(shown.widths)})`,
    );
    expect(!shown.visible, 'the overlay comes down once the map has been painted');
    expect(
      shown.overlay.length === 2 && shown.overlay[1] === false,
      `the overlay went down exactly once, after the map was up (transitions: ${JSON.stringify(shown.overlay)})`,
    );

    // === 3. The map is now cached for the session: switching tiers must be instant,
    //        with no spinner flash. aiMapTried is a one-shot, so nothing reloads. ===
    await p.unroute(GATED).catch(() => {});
    const flashed = await p.evaluate(async () => {
      const frames = (n) => new Promise((d) => {
        const s = () => (--n <= 0 ? d() : requestAnimationFrame(s));
        requestAnimationFrame(s);
      });
      let seen = false;
      const watch = () => {
        if (window.__ff.loadingVisible()) seen = true;
        if (!seen) requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
      window.__ff.setGraphics('enhanced');
      await frames(20);
      window.__ff.setGraphics('ai');
      await frames(20);
      return { seen, pending: window.__ff.mapArtPending(), w: document.getElementById('screen').width };
    });
    expect(!flashed.seen, 'a cached map never flashes the loading overlay when the tier is switched');
    expect(!flashed.pending, 'a cached map has nothing pending');
    expect(flashed.w > 1000, `the cached AI map is back on screen immediately (${flashed.w}px)`);

    // === 4. The hold is a PREDICATE, not an awaited wait: leaving the tier mid-load
    //        must release it with no cancellation machinery — and must then present the
    //        map in the art the player actually chose. ===
    gate = openGate();
    await p.route(GATED, async (route) => { await gate; await route.continue().catch(() => {}); });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapArtPending());
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    expect(
      !(await p.evaluate(() => window.__ff.mapArtPending())),
      'leaving the tier mid-load releases the hold immediately — no waiter to cancel',
    );
    await p.waitForFunction(() => !window.__ff.loadingVisible());
    await waitFrames(p, 4);
    const switched = await p.evaluate(() => [...window.__map.widths]);
    expect(
      switched.length === 1 && switched[0] === 640,
      `the map is presented in the tier that was switched TO (backing stores shown: ${JSON.stringify(switched)})`,
    );
    releaseMap();
    // The gated art still lands, but the player is no longer in the `ai` tier, so it
    // must not seize the screen — the pop this whole probe is about, reached backwards.
    await p.waitForFunction(() => window.__ff.aiMapLoaded());
    await waitFrames(p, 5);
    const after = await p.evaluate(() => [...window.__map.widths]);
    expect(
      after.length === 1 && after[0] === 640,
      `art that lands after the player left the tier does not take over the map (${JSON.stringify(after)})`,
    );
  },
  // Pinned so the FIRST boot fetches no AI map art, leaving it cold for the gated
  // reloads (see the header note on the memory cache). The sampler's init script
  // overrides this to `ai` for every navigation after that one.
  { graphics: 'enhanced' },
);
