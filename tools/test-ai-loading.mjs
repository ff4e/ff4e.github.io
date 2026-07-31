/**
 * UI test: AI room entry is a single final-art presentation.
 *
 * Delay the target room's AI assets so enhanced art is available much earlier.
 * The player must see the loading overlay until AI is ready, never the intermediate
 * enhanced frame that previously appeared as a visible resolution pop.
 */
import { waitRoom, withApp } from './ui-lib.mjs';

await withApp(
  async ({ p, expect }) => {
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await waitRoom(p, 0);
    await p.evaluate(() => window.__ff.showMap());

    let releaseAi;
    const aiGate = new Promise((resolve) => {
      releaseAi = resolve;
    });
    await p.route('**/enhanced-ai/PRVNI/**', async (route) => {
      await aiGate;
      await route.continue();
    });
    await p.route('**/enhanced-ai/_fish/**', async (route) => {
      await aiGate;
      await route.continue();
    });

    await p.evaluate(() => {
      window.__exposedNonAiRoom = false;
      window.__sampleAiEntry = true;
      const sample = () => {
        if (!window.__sampleAiEntry) return;
        if (
          window.__ff.screen() === 'room' &&
          !window.__ff.roomLoading() &&
          !window.__ff.loadingVisible() &&
          !window.__ff.aiRoomActive()
        ) {
          window.__exposedNonAiRoom = true;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      window.__ff.setGraphics('ai');
      window.__aiEntryDone = false;
      window.__aiEntry = window.__ff.enterRoomAwait(1).then(() => {
        window.__aiEntryDone = true;
      });
    });
    await p.waitForFunction(() => window.__ff.roomLoading(), null, { timeout: 5000 });
    const count = await p.evaluate(() => window.__ff.count());
    await p.waitForTimeout(500);
    expect((await p.evaluate(() => window.__ff.count())) === count, 'gameplay stays frozen while final AI art loads');
    await p.waitForFunction(() => window.__ff.loadingVisible(), null, { timeout: 3000 });
    expect(await p.evaluate(() => window.__ff.roomArtPending()), 'AI art remains pending behind the overlay');
    expect(!(await p.evaluate(() => window.__aiEntryDone)), 'room readiness does not resolve at the enhanced tier');
    releaseAi();

    await p.evaluate(() => window.__aiEntry);
    await p.waitForFunction(
      () => !window.__ff.loadingVisible() && window.__ff.aiRoomActive(),
      null,
      { timeout: 30000 },
    );
    const final = await p.evaluate(() => {
      window.__sampleAiEntry = false;
      const canvas = document.getElementById('screen');
      return {
        exposedNonAi: window.__exposedNonAiRoom,
        width: canvas.width,
        pending: window.__ff.roomArtPending(),
      };
    });
    expect(!final.exposedNonAi, 'no enhanced room frame is exposed before final AI art');
    expect(final.width > 1000, `the first presented room frame uses the AI backing store (${final.width}px)`);
    expect(!final.pending, 'the final-art readiness gate clears');

    // Changing away from AI cancels the obsolete final-art wait without cancelling
    // the background cache fill itself.
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await p.evaluate(() => window.__ff.enterRoomAwait(6));
    await waitRoom(p, 0);
    await p.evaluate(() => window.__ff.showMap());
    let releaseKoste;
    const kosteGate = new Promise((resolve) => {
      releaseKoste = resolve;
    });
    await p.route('**/enhanced-ai/KOSTE/**', async (route) => {
      await kosteGate;
      await route.continue();
    });
    await p.evaluate(() => {
      window.__ff.setGraphics('ai');
      window.__tierEntryDone = false;
      window.__tierEntry = window.__ff.enterRoomAwait(6).then(() => {
        window.__tierEntryDone = true;
      });
    });
    await p.waitForFunction(() => window.__ff.loadingVisible(), null, { timeout: 3000 });
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await p.waitForFunction(() => window.__tierEntryDone && !window.__ff.loadingVisible(), null, { timeout: 5000 });
    expect(!(await p.evaluate(() => window.__ff.roomLoading())), 'switching away from AI releases the obsolete room wait');
    expect((await p.evaluate(() => window.__ff.graphics())) === 'enhanced', 'the selected enhanced tier is presented');
    releaseKoste();
    await p.waitForFunction(() => window.__ff.aiRoomLoaded(), null, { timeout: 15000 });
  },
  { cpu: true, graphics: 'enhanced' },
);
