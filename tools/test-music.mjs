/**
 * UI test: per-room music. The correct rybky track loops per room (cHud mapping),
 * cHud=-1 rooms are silent, and switching rooms swaps the track.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.music, { timeout: 8000 });

  async function check(room, want) {
    await p.selectOption('#room', String(room));
    await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
    await p.waitForFunction((w) => window.__ff.music() === w, want, { timeout: 20000 }).catch(() => {});
    const got = await p.evaluate(() => window.__ff.music());
    expect(got === want, `room ${room}: music='${got}' (want '${want}')`);
  }

  await check(7, 'rybky05'); // UTES  cHud=5
  await check(1, 'rybky04'); // PRVNI cHud=4
  await check(2, ''); // KUFRIK cHud=-1 (silent)
  await check(7, 'rybky05'); // back to UTES (track swaps)

  // DRAKAR1 (13): the band-room intro `music('rybky04',-998)` is NOT a packaged
  // sound, so it must fall back to Music/rybky04.wav via the priority-tracked path
  // (musicSnd), not the looping musicSrc. Regression guard: without the fallback the
  // intro is silent and the band "sings" with no backing.
  await p.selectOption('#room', '13');
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p
    .waitForFunction(() => window.__ff.playingPrior(-998), { timeout: 20000 })
    .catch(() => {});
  expect(
    await p.evaluate(() => window.__ff.playingPrior(-998)),
    'DRAKAR1 intro music (rybky04) plays via the Music/ fallback',
  );
});
