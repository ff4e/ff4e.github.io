/**
 * UI test: the ZAVER endgame finale auto-trigger (pustitzaver, USoutez.pas:729 ->
 * av:=9 daRun, UMain.pas:948). Once every registered room (1..70) is genuinely solved,
 * the next return-to-map launches the ZAVER cutscene ("At Home", room 71) instead of
 * the map: after the leg's story page when the completing room is a leg-final, or
 * straight away otherwise. SCORE (room 72) is deliberately never auto-launched — it
 * stays a hidden secret, reachable only via the debug Room picker.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  const winCurrentRoom = async () => {
    await p.evaluate(() => window.__ff.forceExit('little', 3));
    await p.waitForFunction(() => window.__ff.state().venku.little, { timeout: 5000 });
    await p.evaluate(() => window.__ff.forceExit('big', 3));
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

  // --- Positive (non-leg-final completes the game): winning an ordinary room when the
  //     game is already fully solved goes STRAIGHT to ZAVER, with no leg story page. ---
  await p.evaluate(() => window.__ff.showMap());
  let sawLegImage = false;
  await enterAndWin(7); // Fish House room 7 (depth < 15), all 70 already solved
  // Poll briefly: we should reach ZAVER without ever passing through a leg image.
  await p.waitForFunction(() => window.__ff.zaverMode() || window.__ff.screen() === 'legimage', { timeout: 6000 });
  if ((await p.evaluate(() => window.__ff.screen())) === 'legimage') sawLegImage = true;
  await p.waitForFunction(() => window.__ff.zaverMode(), { timeout: 6000 });
  expect(!sawLegImage, 'a non-leg-final completion goes straight to ZAVER (no story page)');
  expect(await p.evaluate(() => window.__ff.zaverMode()), 'a non-leg-final completion still launches the ZAVER finale');

  // --- SCORE (room 72) stays a hidden secret: the completion never launches it (the
  //     finale is ZAVER/zavermode, not SCORE), yet it remains reachable via debug. ---
  await p.evaluate(() => window.__ff.enterRoom(72));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(
    (await p.evaluate(() => window.__ff.zaverMode())) === false,
    'SCORE (room 72) is not the finale cutscene — it stays a separate secret room',
  );
});
