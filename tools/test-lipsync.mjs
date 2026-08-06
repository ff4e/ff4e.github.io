/**
 * UI test: lip-sync. While a fish's voice plays, its head cycles the hl_mluvi
 * mouth frames (0/5/6); both click-to-talk (UTES) and scripted dialogue (PRVNI)
 * animate the talking head.
 */
import { forTicks, selectRoom, tickSleep, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  // Click-to-talk on UTES.
  await selectRoom(p, 7);
  // The room's .ffs voice package is fetched after its art (it is the bulk of an
  // entry's bytes and nothing visual needs it), so the room being live does not mean
  // its voices are. Lip-sync is driven by a voice actually sounding, so wait for the
  // package — this pins the same behaviour, it just stops racing the download.
  await p.waitForFunction(() => window.__ff.roomAudioReady());
  await tickSleep(p, 4);
  await p.evaluate(() => window.__ff.talk('little'));
  // The mouth frames cycle on the game tick, so watch a window of ticks — 40 * 80ms
  // of wall time is only 40 ticks on an idle machine and far fewer on a busy one.
  const heads = new Set();
  await forTicks(p, 40, async () => {
    heads.add(await p.evaluate(() => window.__ff.heads().little));
  }, 80);
  expect(heads.has(5) || heads.has(6), `UTES click-talk shows an open-mouth frame (saw ${[...heads].sort()})`);

  // Scripted dialogue on PRVNI.
  await selectRoom(p, 1);
  await p.waitForFunction(() => window.__ff.roomAudioReady());
  const h2 = new Set();
  await forTicks(p, 120, async () => {
    const s = await p.evaluate(() => ({ l: window.__ff.heads().little, b: window.__ff.heads().big }));
    h2.add(s.l);
    h2.add(s.b);
  }, 80);
  expect(h2.has(5) || h2.has(6), `PRVNI scripted dialogue animates a head (saw ${[...h2].sort()})`);
});
