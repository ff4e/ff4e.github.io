/** UI probe: VES (room 26, jukebox). Runs past count=65 so the head sings (snd
 *  301) and the three amps kick off looping music (musiccyc 50/51/52) without
 *  error; confirms the amp/head/crab items exist and the music channels sound. */
import { withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoomAwait(26));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'VES has an active script');
  for (const i of [1, 2, 3, 4, 13])
    expect(await p.evaluate((n) => window.__ff.itemState(n) !== null, i), `VES item ${i} exists`);
  await p.waitForFunction(() => window.__ff.count() >= 85, null, { timeout: 12000 }).catch(() => {});
  const c = await p.evaluate(() => window.__ff.count());
  expect(c >= 85, `VES Programky ran to count ${c} without error`);
  const music = await p.evaluate(() => ({
    p50: window.__ff.playingPrior(50), p51: window.__ff.playingPrior(51), p52: window.__ff.playingPrior(52),
    amp1: window.__ff.itemState(1), amp2: window.__ff.itemState(2), amp3: window.__ff.itemState(3),
  }));
  console.log('VES music/amps:', JSON.stringify(music));
  expect(music.p50 || music.p51 || music.p52, 'VES amps are looping music before the restart');

  // Restart (TRoom.Restart → KillExcept(-999), URoom.pas:1600) silences the band: the
  // amp loops stop immediately and the room falls quiet from count 0 until the head
  // strikes up the gig again (snd 301 at zac1=30, amps from zac2=65). Regression guard:
  // buildRoom used to leave the loops sounding across a restart.
  await p.evaluate(() => window.__ff.restart());
  await p.waitForFunction(() => window.__ff.count() >= 1 && window.__ff.count() < 20, { timeout: 5000 });
  const silent = await p.evaluate(() => ({
    p50: window.__ff.playingPrior(50), p51: window.__ff.playingPrior(51),
    p52: window.__ff.playingPrior(52), p301: window.__ff.playingPrior(301),
  }));
  expect(!silent.p50 && !silent.p51 && !silent.p52 && !silent.p301, `VES is silent right after a restart (${JSON.stringify(silent)})`);

  // The head sings again (301) once the reset count reaches zac1, then the amps resume.
  await p.waitForFunction(() => window.__ff.playingPrior(301), { timeout: 8000 });
  expect(await p.evaluate(() => window.__ff.playingPrior(301)), 'the head strikes up again after the restart');
  await p.waitForFunction(
    () => window.__ff.playingPrior(50) || window.__ff.playingPrior(51) || window.__ff.playingPrior(52),
    { timeout: 10000 },
  );
  expect(
    await p.evaluate(() => window.__ff.playingPrior(50) || window.__ff.playingPrior(51) || window.__ff.playingPrior(52)),
    'the amp music resumes after the head sings',
  );
});
