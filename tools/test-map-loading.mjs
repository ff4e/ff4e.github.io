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
 *
 * Sections: 1-2 the first appearance and its release; 3 a cached tier switch not
 * flashing the overlay; 4 leaving the tier mid-load and coming back, which is where the
 * overlay has to re-arm and re-label itself off live state; 5 an undecodable asset set
 * falling back to the faithful map instead of holding forever; 6 classic/enhanced parity.
 */
import { observed, waitFrames, withApp } from './ui-lib.mjs';

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
    // A GRID of rows, not one: the map reveal traces in from the start, so early
    // frames are lit in only part of the canvas and a single row could miss a
    // forbidden intermediate frame entirely. Strided within each row as well — a
    // full 2560px read every frame is the one thing here that could perturb what it
    // measures. Any non-black pixel means the map has been painted.
    for (let f = 1; f <= 7; f++) {
      const row = window.__g.getImageData(0, Math.floor((cv.height * f) / 8), cv.width, 1).data;
      for (let i = 0; i < row.length; i += 4 * 9) {
        if (row[i] > 16 || row[i + 1] > 16 || row[i + 2] > 16) {
          const w = window.__map.widths;
          if (!w.length || w[w.length - 1] !== cv.width) w.push(cv.width);
          return;
        }
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
      painted: window.__ff.mapPresented(),
      msg: document.getElementById('loading-msg').textContent,
      titled: !document.getElementById('loading').classList.contains('inroom'),
    }));
    expect(held.widths.length === 0, `nothing is presented while the map's art loads (saw ${JSON.stringify(held.widths)})`);
    expect(!held.painted, 'the map has not been painted yet');
    expect(held.visible, 'the loading overlay covers the wait');
    expect(/world map/i.test(held.msg ?? ''), `the overlay says what is being waited for (got "${held.msg}")`);
    // On THIS path the overlay is boot's own, still up — so it keeps boot's title and
    // attribution. (A wait arrived at mid-game re-shows it stripped down, as a room
    // entry does; section 4 covers that.)
    expect(held.titled, 'boot straight to the map keeps the boot splash, because it never came down');
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
    //        map in the art the player actually chose. Coming BACK re-applies it, and
    //        the overlay must re-arm and re-label itself, which is why none of that is
    //        pushed from the (one-shot) site that starts the load. ===
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

    // Back into the tier while the same load is STILL in flight. Nothing re-runs the
    // start site (aiMapTried is a one-shot), so everything the player sees here has to
    // come from the derived path. A stale room/boot label would show up as a message
    // that is no longer about the map.
    await p.evaluate(() => {
      document.getElementById('loading-msg').textContent = 'Loading Útes…'; // as a room entry leaves it
      window.__ff.setGraphics('ai');
    });
    await p.waitForFunction(() => window.__ff.loadingVisible());
    const rearmed = await p.evaluate(() => ({
      msg: document.getElementById('loading-msg').textContent,
      stripped: document.getElementById('loading').classList.contains('inroom'),
      widths: [...window.__map.widths],
    }));
    expect(/world map/i.test(rearmed.msg ?? ''), `returning to the wait re-labels the overlay (got "${rearmed.msg}")`);
    expect(rearmed.stripped, 'a wait arrived at mid-game shows the stripped-down overlay, not the boot splash');
    expect(
      rearmed.widths.length === 1 && rearmed.widths[0] === 640,
      `the AI map is withheld again on return to the tier (${JSON.stringify(rearmed.widths)})`,
    );

    // The credits roll takes #screen over on the map screen, so there is no map to
    // withhold while it is up (and nothing to explain). Closing it puts the player back
    // in front of the wait over a stage that is now showing credits art — so there is
    // no map frame left to preserve, and the overlay is not delayed for one.
    await p.evaluate(() => window.__ff.openCredits());
    await p.waitForFunction(() => window.__ff.mapOverlay() === 'credits');
    expect(
      await observed(p.waitForFunction(() => !window.__ff.loadingVisible())),
      'the credits are not held behind the map overlay',
    );
    await p.evaluate(() => window.__ff.closeMapOverlay());
    await p.waitForFunction(() => window.__ff.mapOverlay() === 'none');
    expect(
      await observed(p.waitForFunction(() => window.__ff.loadingVisible())),
      'closing the credits puts the still-pending map back behind the overlay',
    );
    // Asserted as state rather than as a time: "not delayed" is a claim about which
    // branch ran, and timing it would mean asserting a 200ms margin from a probe
    // sharing the machine with a poolful of browsers — the loop may legitimately be on
    // the 80ms idle timer here. This is the input that branch reads.
    expect(
      !(await p.evaluate(() => window.__ff.mapPresented())),
      'the credits roll counts as taking the stage from the map, so the overlay is not delayed',
    );

    releaseMap();
    await p.waitForFunction(() => window.__ff.aiMapLoaded() && !window.__ff.mapArtPending());
    await waitFrames(p, 5);
    const after = await p.evaluate(() => [...window.__map.widths]);
    expect(
      after.length === 2 && after[1] > 1000,
      `each presentation is in the tier that was chosen for it (${JSON.stringify(after)})`,
    );

    // === 5. An AI map that 404s is a BROKEN DEPLOY, and stops the game.
    //
    //        This used to fall back to the faithful composite and carry on, on the
    //        reasoning that an answer is a fact the player cannot act on. The fact is
    //        real; the silence was the mistake. Every one of the eight `_ai` files ships
    //        — there is no build in which this 404 is correct — so the fallback could
    //        only ever mean the player was looking at the 1998 map with `ai` selected,
    //        with no way to tell. The absences that ARE by design are per-ROOM — SCORE
    //        ships no enhanced art at all — and those still fall back silently.
    //
    //        §5b is the other half: the same asset, FAILING rather than absent, which
    //        gets the other sentence. ===
    await p.unroute(GATED).catch(() => {});
    await p.route(GATED, (route) => route.fulfill({ status: 404, body: '' }));
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.fatalShown());
    await waitFrames(p, 4);
    const failed = await p.evaluate(() => ({
      widths: [...window.__map.widths],
      loaded: window.__ff.aiMapLoaded(),
      pending: window.__ff.mapArtPending(),
      note: window.__ff.fatalText(),
      spinner: window.__ff.loadingVisible(),
    }));
    expect(!failed.loaded, 'the AI map really did fail to load');
    expect(failed.pending, 'the map is HELD rather than quietly presented in the faithful tier');
    expect(
      failed.widths.length === 0,
      `nothing was presented in the wrong tier (${JSON.stringify(failed.widths)})`,
    );
    // The screen no longer NAMES the asset — its one action is Reload whichever file
    // broke, so the name went to the console instead (see failAssets). Which asset was
    // named is asserted in test-asset-tiers.mjs, on the log. What still matters here is
    // that the two KINDS of failure are told apart.
    expect(
      /problem with the game, not with your connection/i.test(failed.note),
      `a 404 is reported as a problem with the game, not the connection: “${failed.note}”`,
    );
    expect(!failed.spinner, 'the loading spinner stands down — the screen has taken over the wait');
    await p.unroute(GATED).catch(() => {});
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.aiMapLoaded() && !window.__ff.fatalShown());

    // === 5b. A map load that FAILED is the opposite case: the art exists, the player
    //         asked for it, and quietly presenting the 1998 map under an `ai` setting is
    //         a downgrade they cannot see and did not choose. So the map is HELD and the
    //         game stops on its one failure screen.
    //
    //         Served as a 200 of garbage, so the failure lands in createImageBitmap —
    //         which `decodeAsset` classifies as transient on purpose (a truncated
    //         download and a corrupt file are indistinguishable there, and guessing
    //         transient costs one refetch while guessing absent costs the tier). ===
    await p.route(GATED, (route) => route.fulfill({ status: 200, contentType: 'image/webp', body: 'not an image' }));
    // Boot's own room (7, UTES) is SLOWED so its art lands AFTER the map has failed.
    // That ordering is the bug this pins: a successful ROOM load used to dismiss the
    // MAP's screen, which went invisible under the player mid-click. The screen no
    // longer comes down for anything, so this now guards against a hide being
    // reintroduced rather than against a mis-scoped one — worth keeping, because it is
    // the exact mistake that was made before. Left to chance the order flips with
    // machine load, and the assertion becomes a coin toss that mostly passes.
    await p.route('**/enhanced-ai/UTES/**', async (route) => {
      await new Promise((r) => setTimeout(r, 1500));
      await route.continue().catch(() => {});
    });
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.fatalShown());
    await waitFrames(p, 4);
    // Now let the slowed room art land underneath it.
    await p.waitForFunction(() => window.__ff.aiRoomLoaded());
    await waitFrames(p, 4);
    expect(
      (await p.evaluate(() => window.__ff.fatalShown())) === true,
      "a room's art landing does not dismiss the MAP's failure screen",
    );
    await p.unroute('**/enhanced-ai/UTES/**').catch(() => {});
    const mapHeld = await p.evaluate(() => ({
      title: window.__ff.fatalText(),
      pending: window.__ff.mapArtPending(),
      spinner: window.__ff.loadingVisible(),
    }));
    expect(mapHeld.pending, 'the map is held rather than presented in the wrong tier');
    expect(!mapHeld.spinner, 'the loading spinner stands down — the screen has taken over the wait');

    // The screen's only exit is a reload, so that is what has to get the player their
    // map — and it doubles as the proof that the failure was not remembered.
    await p.unroute(GATED).catch(() => {});
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__ff !== undefined);
    await p.waitForFunction(() => window.__ff.aiMapLoaded() && !window.__ff.fatalShown());
    expect(true, 'a reload recovers the AI map');

    // === 6. Tier parity: `classic` and `enhanced` fetch no AI map and never hold, so
    //        the map goes up as directly as it always did. ===
    for (const tier of ['classic', 'enhanced']) {
      await p.addInitScript((t) => {
        try {
          localStorage.setItem('ff.graphics', t);
        } catch {
          /* storage unavailable */
        }
      }, tier);
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__ff !== undefined);
      await p.waitForFunction(() => window.__ff.mapPresented());
      await waitFrames(p, 4); // let the sampler see the frame that paint produced
      const plain = await p.evaluate(() => ({
        widths: [...window.__map.widths],
        overlay: [...window.__map.overlay],
        pending: window.__ff.mapArtPending(),
      }));
      expect(!plain.pending, `the ${tier} tier never waits on AI map art`);
      expect(
        plain.widths.length === 1 && plain.widths[0] === 640,
        `the ${tier} map is presented once, at native size (${JSON.stringify(plain.widths)})`,
      );
      expect(
        plain.overlay.length === 2 && plain.overlay[1] === false,
        `the ${tier} boot overlay comes down once, as it always did (${JSON.stringify(plain.overlay)})`,
      );
    }
  },
  // Pinned so the FIRST boot fetches no AI map art, leaving it cold for the gated
  // reloads (see the header note on the memory cache). The sampler's init script
  // overrides this to `ai` for every navigation after that one.
  // The 404s in §5 are served on purpose; §5b's garbage 200 logs a decode failure.
  { graphics: 'enhanced', allowErrors: /asset failed|Failed to load resource|404/ },
);
