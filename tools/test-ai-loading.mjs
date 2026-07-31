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
import { waitRoom, withApp, waitFrames } from './ui-lib.mjs';

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

    // Watch EVERY frame for the invariant that kills symptom 2: the instant the room
    // becomes presentable, it must already be presentable in the AI art. While
    // roomArtPending() is true draw() paints nothing at all, so the ≤200ms window
    // before the overlay arms exposes no room frame — wrong-tier or otherwise.
    await p.evaluate(() => {
      window.__sampling = true;
      window.__exposedNonAi = false;
      const step = () => {
        if (!window.__sampling) return;
        if (
          window.__ff.screen() === 'room' &&
          !window.__ff.roomLoading() &&
          !window.__ff.roomArtPending() &&
          !window.__ff.aiRoomActive()
        ) window.__exposedNonAi = true;
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
      window.__ff.setGraphics('ai');
      window.__ff.enterRoom(1);
    });

    // --- The room builds (core assets are cached); the AI art is still gated. ---
    await p.waitForFunction(() => !window.__ff.roomLoading() && window.__ff.roomNum() === 1, null, { timeout: 30000 });
    expect(await p.evaluate(() => window.__ff.roomArtPending()), 'the AI art is still pending after the room is built');

    // --- The overlay explains the wait (armed on a delay, so this is not instant). ---
    await p.waitForFunction(() => window.__ff.loadingVisible(), null, { timeout: 10000 });
    expect(true, 'the loading overlay appears on the map→room path while the AI art loads');

    // --- Gameplay is frozen behind it. Sampled AFTER the build, so buildRoom()'s
    //     `count = 0` cannot be mistaken for the clock running. ---
    const frozenFrom = await p.evaluate(() => window.__ff.count());
    await p.waitForTimeout(600);
    const frozenTo = await p.evaluate(() => window.__ff.count());
    expect(frozenTo === frozenFrom, `gameplay stays frozen while the final AI art loads (${frozenFrom} -> ${frozenTo})`);

    // === Release the AI art: the room appears, in AI art, for the first time. ===
    releaseAi();
    await p.waitForFunction(() => !window.__ff.loadingVisible() && window.__ff.aiRoomActive(), null, { timeout: 60000 });
    const final = await p.evaluate(() => {
      window.__sampling = false;
      return { exposed: window.__exposedNonAi, pending: window.__ff.roomArtPending(), w: document.getElementById('screen').width };
    });
    expect(!final.exposed, 'no enhanced/classic room frame is ever exposed before the AI art');
    expect(!final.pending, 'the art hold clears once the AI art is up');
    expect(final.w > 1000, `the presented frame uses the AI backing store (${final.w}px)`);
    for (const glob of gated) await p.unroute(glob);
    await waitRoom(p, 0);

    // === The hold is a PREDICATE, not an awaited wait: switching tier mid-load must
    //     release it with no cancellation machinery. ===
    await p.evaluate(() => window.__ff.showMap());
    let releaseKoste;
    const kosteGate = new Promise((r) => { releaseKoste = r; });
    await p.route('**/enhanced-ai/KOSTE/**', async (route) => { await kosteGate; await route.continue().catch(() => {}); });
    await p.evaluate(() => window.__ff.enterRoom(6));
    await p.waitForFunction(() => window.__ff.roomArtPending() && window.__ff.roomNum() === 6, null, { timeout: 30000 });
    await p.evaluate(() => window.__ff.setGraphics('classic'));
    expect(
      !(await p.evaluate(() => window.__ff.roomArtPending())),
      'switching tier mid-load releases the hold immediately — no waiter to cancel',
    );
    await p.waitForFunction(() => !window.__ff.loadingVisible(), null, { timeout: 10000 });
    expect(true, 'the overlay comes down when the switched-to tier is ready');
    releaseKoste();
    await p.unroute('**/enhanced-ai/KOSTE/**').catch(() => {});

    // === Fast path: a cached entry must never flash the spinner. ===
    await p.evaluate(() => window.__ff.setGraphics('ai'));
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
