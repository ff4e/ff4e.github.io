/**
 * UI test: losing the browser's GPU process puts the player back where they were, not on
 * a black screen.
 *
 * The bug, reported from play on the iOS app: after the app had been in the background a
 * while, coming back showed only the two side panels around a black map. iOS had killed
 * WebKit's GPU process, which takes every decoded image and canvas with it
 * (gpuLossRecovery.ts has the measurements). The game now detects that with a sentinel
 * canvas, reloads, and resumes the attempt in progress.
 *
 * A probe cannot kill Chromium's GPU process, and Chromium would not wipe the page the
 * way WebKit does if it could. So the loss is simulated where the game reads it: the
 * sentinel is wiped exactly as the real loss wipes it (`__ff.simulateGpuLoss`). The
 * real thing was verified by hand in the iOS Simulator; what this pins is everything
 * after the detection: the reload really happens, it lands in the SAME room with the
 * SAME record, undo history and selected fish, it happens once, and an ordinary return
 * to the foreground with the art intact does not reload anything.
 */
import { appReady, budget, selectRoom, withApp } from './ui-lib.mjs';

const KOSTE = 6; // an ordinary room with no entry demonstration, and not the boot room

await withApp(async ({ p, expect }) => {
  expect(await p.evaluate(() => window.__ff.gpuLossArmed()), 'the sentinel is armed after boot');

  await selectRoom(p, KOSTE, 1);
  // Moves are found rather than chosen, as in test-touchbar: any press the record accepts.
  for (const which of ['little', 'big']) {
    for (const dir of [4, 3, 1, 2]) {
      if ((await p.evaluate(() => window.__ff.undoDepth())) >= 4) break;
      await p.evaluate(([w, d]) => window.__ff.press(w, d), [which, dir]);
      await p.waitForFunction(() => window.__ff.phase() === 'idle');
    }
  }
  // Leave the BIG fish selected: the engine's default is little, so a resume that forgot
  // the selection would show here. A press selects its fish whether or not it moves.
  await p.evaluate(() => window.__ff.press('big', 4));
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  const before = await p.evaluate(() => ({
    rec: window.__ff.record(),
    undo: window.__ff.undoDepth(),
    pos: window.__ff.posHash(),
    active: window.__ff.state()?.active,
  }));
  expect(before.undo >= 3, `moves were made to carry over (${before.undo - 1})`);
  expect(before.active === 'big', 'the big fish is selected');

  // An ordinary return to the foreground, art intact: nothing may happen. The check runs
  // at once and again a second later, so wait out both.
  await p.evaluate(() => {
    window.__notReloaded = true;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await p.waitForTimeout(1500);
  expect(
    await p.evaluate(() => window.__notReloaded === true),
    'coming back with the art intact does not reload',
  );

  // The loss.
  const reloaded = p.waitForEvent('load', { timeout: budget(5000) });
  expect(await p.evaluate(() => window.__ff.simulateGpuLoss()), 'a wiped sentinel is detected');
  await reloaded;
  await appReady(p);
  expect(await p.evaluate(() => window.__notReloaded === undefined), 'the page reloaded');
  const resumed = await p
    .waitForFunction(
      (rec) =>
        window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.record() === rec,
      before.rec,
      { timeout: budget(5000) },
    )
    .then(() => true, () => false);
  expect(resumed, 'the reload goes straight back into the room, with the same record');
  const after = await p.evaluate(() => ({
    room: window.__ff.roomNum(),
    undo: window.__ff.undoDepth(),
    pos: window.__ff.posHash(),
    active: window.__ff.state()?.active,
    left: sessionStorage.getItem('ff.gpuLossResume'),
  }));
  expect(after.room === KOSTE, `in room ${KOSTE} (${after.room})`);
  expect(after.pos === before.pos, 'with every object where it was');
  expect(after.undo === before.undo, `with the undo history (${after.undo} of ${before.undo})`);
  expect(after.active === 'big', 'with the same fish selected');
  expect(after.left === null, 'the hand-over is used once and removed');

  // A second loss right after a recovery is not reloaded again: that is what keeps a
  // loss that recurs from turning into a reload loop.
  await p.evaluate(() => {
    window.__notReloaded = true;
  });
  expect(
    (await p.evaluate(() => window.__ff.simulateGpuLoss())) === false,
    'a second loss inside the cooldown is not acted on',
  );
  await p.waitForTimeout(500);
  expect(await p.evaluate(() => window.__notReloaded === true), 'and the page stays');
});
