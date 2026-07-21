/**
 * UI test: the ZAVER endgame finale auto-trigger (pustitzaver, USoutez.pas:729 ->
 * av:=9 daRun, UMain.pas:948). Once every registered room (1..70) is genuinely solved,
 * the next return-to-map launches the ZAVER cutscene ("At Home", room 71) — but only when
 * the completing win is itself a leg-final (depth-15) room, chaining out of that leg's
 * story page (pustitzaver := (hloubka=15) and (chybi=0)). Winning an ordinary room while
 * fully solved just returns to the map. SCORE (room 72) is deliberately never auto-launched
 * — it stays a hidden secret, reachable only via the debug Room picker.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // forceExit is a no-op unless the engine is idle (main.ts:4338), so a room still
  // settling on entry would silently swallow the exit and hang the win. Wait for idle
  // before each forced exit, and re-issue if the first attempt didn't take.
  const exitFish = async (which) => {
    await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 6000 });
    await p.evaluate((w) => window.__ff.forceExit(w, 3), which);
    await p
      .waitForFunction((w) => window.__ff.state().venku[w], which, { timeout: 4000 })
      .catch(async () => {
        await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 6000 });
        await p.evaluate((w) => window.__ff.forceExit(w, 3), which);
        await p.waitForFunction((w) => window.__ff.state().venku[w], which, { timeout: 6000 });
      });
  };
  const winCurrentRoom = async () => {
    await exitFish('little');
    await exitFish('big');
    await p.waitForFunction(() => window.__ff.state().won, { timeout: 5000 });
  };
  const enterAndWin = async (room) => {
    await p.selectOption('#room', String(room));
    await p.waitForFunction(
      () =>
        window.__ff.screen() === 'room' &&
        window.__ff.count() > 0 &&
        !window.__ff.state().won &&
        !window.__ff.state().venku.little &&
        !window.__ff.state().venku.big,
      { timeout: 5000 },
    );
    await winCurrentRoom();
  };

  // --- Negative: winning a leg-final while other rooms are still unsolved shows the
  //     leg page and returns to the MAP (no finale) — the pre-existing behaviour. ---
  await p.evaluate(() => localStorage.removeItem('ff.solved'));
  await enterAndWin(19); // leg 1 final (depth 15), but rooms 1..70 not all solved
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  await p.click('#screen');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 3000 });
  expect(
    (await p.evaluate(() => window.__ff.screen())) === 'map',
    'incomplete game: a leg-final win returns to the map, not the finale',
  );
  expect((await p.evaluate(() => window.__ff.zaverMode())) === false, 'no ZAVER while rooms remain unsolved');

  // --- Positive (leg-final completes the game): mark all 70 registered rooms solved,
  //     then win a leg-final room -> its story page first, then ZAVER on dismiss. ---
  await p.evaluate(() => {
    for (let n = 1; n <= 70; n++) window.__ff.markSolved(n);
  });
  await p.evaluate(() => window.__ff.showMap());
  await enterAndWin(19); // leg 1 final; game is now fully solved
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect(
    (await p.evaluate(() => window.__ff.legImage())) === 1,
    'completing on a leg-final still shows that leg story page first',
  );
  await p.click('#screen'); // dismiss the story page -> chain into ZAVER (not the map)
  await p.waitForFunction(() => window.__ff.zaverMode(), { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'dismissing the final leg page enters a room');
  expect(await p.evaluate(() => window.__ff.zaverMode()), 'the ZAVER finale (room 71) auto-launches after the last leg page');

  // --- Negative (non-leg-final while fully solved): winning an ordinary room when the
  //     game is already fully solved must NOT launch the finale (pustitzaver requires
  //     hloubka=15, USoutez.pas:729) — it just returns to the map, no ZAVER, no leg page. ---
  await p.evaluate(() => window.__ff.showMap());
  let sawLegImage = false;
  await enterAndWin(7); // Fish House room 7 (depth < 15), all 70 already solved
  // Give the win countdown time to return; it should reach the MAP, never ZAVER/legimage.
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 6000 }).catch(() => {});
  if ((await p.evaluate(() => window.__ff.screen())) === 'legimage') sawLegImage = true;
  expect(!sawLegImage, 'a non-leg-final completion shows no leg story page');
  expect(
    (await p.evaluate(() => window.__ff.zaverMode())) === false,
    'a non-leg-final completion does NOT launch the ZAVER finale (needs a depth-15 leg-final)',
  );
  expect(
    (await p.evaluate(() => window.__ff.screen())) === 'map',
    'a non-leg-final completion returns to the map even when the game is fully solved',
  );

  // --- SCORE (room 72) stays a hidden secret: the completion never launches it (the
  //     finale is ZAVER/zavermode, not SCORE), yet it remains reachable via debug. ---
  await p.evaluate(() => window.__ff.enterRoom(72));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(
    (await p.evaluate(() => window.__ff.zaverMode())) === false,
    'SCORE (room 72) is not the finale cutscene — it stays a separate secret room',
  );
});
