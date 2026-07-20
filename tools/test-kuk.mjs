/**
 * UI test: stav_kuk "peek at player" (URoom.pas:24459/24712). Selecting/switching the
 * active fish makes it briefly turn to face the user — body frame tl_otocka[1] (=10),
 * head hidden — for fazi_kuk (2) ticks, then it returns to rest. Drives the real DOM
 * keydown handler and reads the rendered frame via __ff.state().littleFrame.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.evaluate(() => window.__ff.enterRoomAwait(3)); // PRAVIDLA / cellar — both fish, no early dialogue
  await p.waitForFunction(() => window.__ff && window.__ff.screen() === 'room' && window.__ff.count() > 0, {
    timeout: 5000,
  });
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });

  // Select the little fish; read the frame synchronously in the same tick, before the
  // 2-tick peek animation advances.
  const snap = await p.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Digit1', bubbles: true, cancelable: true }));
    const s = window.__ff.state();
    return { phase: s.phase, body: s.littleFrame.bodyFrame, head: s.littleFrame.headFrame };
  });
  expect(snap.phase === 'kuk', `select enters stav_kuk (saw phase '${snap.phase}')`);
  expect(snap.body === 10, `peek shows the face-user body frame tl_otocka[1]=10 (saw ${snap.body})`);
  expect(snap.head === 0, `peek hides the head (saw headFrame ${snap.head})`);

  // The peek is brief: it returns to rest, off the turned frame.
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 2000 });
  const restBody = await p.evaluate(() => window.__ff.state().littleFrame.bodyFrame);
  expect(restBody !== 10, `after the peek the fish returns to a resting body frame (saw ${restBody})`);
});
