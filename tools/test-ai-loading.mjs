/**
 * UI test: a room entry presents its FINAL art tier, once, with nothing black or
 * intermediate shown in between.
 *
 * Two symptoms this pins, both on the path a player actually takes — MAP → ROOM:
 *
 *  1) Unexplained black screen. draw() holds the previous frame while the room's art
 *     loads, but arriving from the map there IS no previous frame, so the hold rendered
 *     as a black stage. The delayed #loading overlay now covers that window.
 *  2) Visible enhanced→AI pop. The `ai` tier used to paint as soon as the ENHANCED art
 *     landed and then swap to the AI upscale a beat later (measured at 9-14s apart over
 *     Slow 4G). aiPending/roomArtPending() now hold the frame until the AI art is up.
 *
 * The AI assets are gated with p.route so the enhanced tier is ready long before them —
 * i.e. the exact window in which the old code exposed the intermediate frame.
 *
 * NOTE on sampling the clock: buildRoom() sets `count = 0` (main.ts), so a "gameplay is
 * frozen" check MUST sample after the requested room is the live one. Sampling on
 * roomLoading() alone reads the PREVIOUS room's clock and then compares it against the
 * post-build reset — which fails deterministically while the hold is working perfectly.
 * That is what sank the equivalent probe in the first attempt at this task.
 */
import { waitFrames, waitRoom, withApp } from './ui-lib.mjs';

await withApp(
  async ({ p, expect }) => {
    // === Enter PRVNI once in the enhanced tier, then go back to the map, so the next
    //     entry is the map→room path with its core assets already cached. ===
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await waitRoom(p, 0);
    await p.evaluate(() => window.__ff.showMap());
    await waitFrames(p, 2);

    // === Gate PRVNI's AI art (and the shared fish set) behind a release we control. ===
    let releaseAi;
    const aiGate = new Promise((r) => { releaseAi = r; });
    const gated = ['**/enhanced-ai/PRVNI/**', '**/enhanced-ai/_fish/**'];
    // continue() can race the unroute below once the gate opens; the assertion is about
    // what was painted, not about who won that race.
    for (const glob of gated) await p.route(glob, async (route) => { await aiGate; await route.continue().catch(() => {}); });

    // Watch EVERY frame for the invariant that kills symptom 2, and watch what was
    // actually PAINTED rather than what the state flags claim.
    //
    // The oracle is the #screen backing store: on the CANVAS-2D backend (pinned via
    // `{ cpu: true }` below) roomGeometry() sizes it to nativeW×4 only when the AI
    // compositor is the path drawing this frame, so a room painted in enhanced/classic
    // art is visibly a smaller canvas. Sampling the state flags alone would keep passing
    // if draw()'s hold were deleted — the flags would still say "pending" while the room
    // was painted underneath. One getImageData of a single row per frame is cheap enough
    // to run at rAF rate.
    //
    // The cpu pin is load-bearing and not incidental: this probe has to observe PAINTED
    // PIXELS per frame, and only the canvas-2D backend puts them somewhere a probe can
    // read (the GPU backend composites into GlAiScreen's FBO and leaves #screen at
    // native size). `roomGeom().upscale` is asserted alongside the width so the oracle
    // states which backend it is reading rather than implying #screen always means the
    // ×S composite.
    await p.evaluate(() => {
      window.__sampling = true;
      window.__firstPaint = null; // { w, h } of the first frame that showed room content
      window.__cleared = false;   // ...but only once the stage has been cleared for it
      const cv = document.getElementById('screen');
      const g = cv.getContext('2d', { willReadFrequently: true });
      const lit = () => {
        const W = cv.width, H = cv.height;
        if (!W || !H) return false;
        const row = g.getImageData(0, Math.floor(H / 2), W, 1).data;
        for (let i = 0; i < row.length; i += 4) {
          if (row[i] > 16 || row[i + 1] > 16 || row[i + 2] > 16) return true;
        }
        return false;
      };
      const step = () => {
        if (!window.__sampling) return;
        requestAnimationFrame(step);
        if (window.__firstPaint || window.__ff.screen() !== 'room') return;
        // Establish a known-black baseline ONCE, as soon as this room is the live one
        // and its art is being held. The stage is not reliably black on its own here:
        // with the core assets cached, roomLoading() can be true for less than a frame,
        // and while the hold is on draw() paints nothing — so the canvas still holds
        // the world map we came from. Clearing it ourselves is safe (the game repaints
        // it) and makes "the next lit frame" mean exactly "the room's first paint".
        if (!window.__cleared) {
          if (window.__ff.roomNum() !== 1 || window.__ff.roomLoading()) return;
          g.clearRect(0, 0, cv.width, cv.height);
          window.__cleared = true;
          return;
        }
        if (lit()) window.__firstPaint = { w: cv.width, h: cv.height };
      };
      requestAnimationFrame(step);
      window.__ff.setGraphics('ai');
      window.__ff.enterRoom(1);
    });

    // --- The room builds (core assets are cached); the AI art is still gated. ---
    await p.waitForFunction(() => !window.__ff.roomLoading() && window.__ff.roomNum() === 1);
    expect(await p.evaluate(() => window.__ff.roomArtPending()), 'the AI art is still pending after the room is built');

    // --- The overlay explains the wait (armed on a delay, so this is not instant). ---
    await p.waitForFunction(() => window.__ff.loadingVisible());
    expect(true, 'the loading overlay appears on the map→room path while the AI art loads');

    // --- Gameplay is frozen behind it. Sampled AFTER the build, so buildRoom()'s
    //     `count = 0` cannot be mistaken for the clock running.
    //
    //     The GAME LOOP's own iteration counter is what proves the clock being frozen
    //     means something: if the loop had stopped, `count` would hold still for a
    //     reason that has nothing to do with the art hold, and this check would pass
    //     vacuously. Counting the probe's own rAF chain cannot show that — the browser
    //     keeps delivering those frames whether the loop is alive or not.
    //
    //     The window closes on loop iterations AND a minimum duration, never on a RATE:
    //     `frames > 10 in 600ms` was a demand for >16.7fps from a probe in the worker
    //     pool, and it failed on a correct build (1/5 idle, 1/3 loaded). Load can only
    //     make this window longer, never thinner. The cap is what lets it FAIL rather
    //     than hang: without it, a stopped loop never resolves the promise and the probe
    //     runs into the runner's kill instead of naming the problem. ---
    const frozenFrom = await p.evaluate(() => window.__ff.count());
    const held = await p.evaluate(
      ([wantLoops, minMs, capMs]) =>
        new Promise((done) => {
          const t0 = performance.now();
          const loops0 = window.__ff.throttleInfo().loops;
          const report = () => ({
            loops: window.__ff.throttleInfo().loops - loops0,
            ms: performance.now() - t0,
          });
          const step = () => {
            const r = report();
            if (r.loops >= wantLoops && r.ms >= minMs) done(r);
            else if (r.ms >= capMs) done(r);
            else setTimeout(step, 16);
          };
          setTimeout(step, 16);
        }),
      [12, 600, 15000],
    );
    const frozenTo = await p.evaluate(() => window.__ff.count());
    expect(
      held.loops >= 12 && held.ms >= 600,
      `the game loop kept running during the freeze window (${held.loops} loop iterations over ${Math.round(held.ms)}ms)`,
    );
    expect(frozenTo === frozenFrom, `gameplay stays frozen while the final AI art loads (${frozenFrom} -> ${frozenTo})`);

    // === Release the AI art: the room appears, in AI art, for the first time. ===
    releaseAi();
    await p.waitForFunction(() => !window.__ff.loadingVisible() && window.__ff.aiRoomActive());
    await waitFrames(p, 3);
    const final = await p.evaluate(() => {
      window.__sampling = false;
      return {
        first: window.__firstPaint,
        pending: window.__ff.roomArtPending(),
        w: document.getElementById('screen').width,
        upscale: window.__ff.roomGeom()?.upscale ?? 0,
        backend: window.__ff.roomBackend(),
      };
    });
    expect(final.first !== null, 'the room was painted at all (the oracle saw a frame)');
    // The whole point: the FIRST frame that ever showed this room was already the AI
    // one. A ×4 backing store cannot be produced by the enhanced or classic path.
    expect(
      final.first !== null && final.first.w > 1000,
      `the first painted frame of the room is the AI one (${final.first ? final.first.w : 'none'}px backing store)`,
    );
    expect(
      final.upscale > 1 && final.backend === 'cpu',
      `the oracle read the canvas-2D composite (upscale x${final.upscale}, backend ${final.backend})`,
    );
    expect(!final.pending, 'the art hold clears once the AI art is up');
    for (const glob of gated) await p.unroute(glob).catch(() => {});
    await waitRoom(p, 0);

    // === The hold is a PREDICATE, not an awaited wait: switching tier mid-load must
    //     release it with no cancellation machinery. ===
    await p.evaluate(() => window.__ff.showMap());
    let releaseKoste;
    const kosteGate = new Promise((r) => { releaseKoste = r; });
    await p.route('**/enhanced-ai/KOSTE/**', async (route) => { await kosteGate; await route.continue().catch(() => {}); });
    await p.evaluate(() => window.__ff.enterRoom(6));
    await p.waitForFunction(() => window.__ff.roomArtPending() && window.__ff.roomNum() === 6);
    await p.evaluate(() => window.__ff.setGraphics('classic'));
    expect(
      !(await p.evaluate(() => window.__ff.roomArtPending())),
      'switching tier mid-load releases the hold immediately — no waiter to cancel',
    );
    await p.waitForFunction(() => !window.__ff.loadingVisible());
    expect(true, 'the overlay comes down when the switched-to tier is ready');

    // === Switching an ALREADY-PRESENTED room INTO the ai tier must hold too. ===
    // This is the other half of the rule and it has its own assignment in
    // setGraphics(); entering a room covers only loadRoom()'s. Without it the room
    // would repaint in enhanced art and then pop to AI a moment later — symptom 2,
    // just reached by pressing E instead of by walking through a door.
    await waitRoom(p, 0);
    const beforeSwitch = await p.evaluate(() => document.getElementById('screen').width);
    expect(beforeSwitch < 1000, `the room is presented in non-AI art before the switch (${beforeSwitch}px)`);
    await p.evaluate(() => {
      window.__ff.setGraphics('ai');
      window.__switchHeld = window.__ff.roomArtPending();
    });
    expect(
      await p.evaluate(() => window.__switchHeld),
      'switching an already-shown room into the ai tier holds until its AI art is ready',
    );
    // ...and the room is not repainted at the AI size until the gated art actually lands.
    await waitFrames(p, 3);
    const duringSwitch = await p.evaluate(() => document.getElementById('screen').width);
    expect(duringSwitch === beforeSwitch, `no AI repaint while the switched-to art is still loading (${duringSwitch}px)`);
    releaseKoste();
    await p.waitForFunction(() => window.__ff.aiRoomActive() && !window.__ff.roomArtPending());
    await waitFrames(p, 3);
    const afterSwitch = await p.evaluate(() => document.getElementById('screen').width);
    expect(afterSwitch > 1000, `the room repaints in AI art once it arrives (${afterSwitch}px)`);
    await p.unroute('**/enhanced-ai/KOSTE/**').catch(() => {});

    // === Fast path: a cached entry must never flash the spinner. ===
    // Let every gated load above settle first: a KOSTE fetch still draining would
    // share the pipe with this entry and could push it past the 200ms threshold,
    // turning a real assertion into a flaky one.
    await waitRoom(p, 0);
    await p.waitForFunction(() => window.__ff.roomAudioReady()).catch(() => {});
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await waitRoom(p, 0);
    await p.evaluate(() => window.__ff.showMap());
    await waitFrames(p, 2);
    const flashed = await p.evaluate(async () => {
      let seen = false;
      const step = () => { if (window.__ff.loadingVisible()) seen = true; if (!done) requestAnimationFrame(step); };
      let done = false;
      requestAnimationFrame(step);
      await window.__ff.enterRoomAwait(1);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      done = true;
      return seen;
    });
    expect(!flashed, 'a cached room entry never flashes the loading overlay');
  },
  { cpu: true, graphics: 'enhanced' },
);
