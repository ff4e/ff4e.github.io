/**
 * UI test: per-room music. The correct rybky track loops per room (cHud mapping),
 * cHud=-1 rooms are silent, and switching rooms swaps the track.
 */
import { observed, selectRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.music);

  async function check(room, want) {
    await selectRoom(p, room);
    await p.waitForFunction((w) => window.__ff.music() === w, want).catch(() => {});
    const got = await p.evaluate(() => window.__ff.music());
    expect(got === want, `room ${room}: music='${got}' (want '${want}')`);
  }

  await check(7, 'rybky05'); // UTES  cHud=5
  await check(1, 'rybky04'); // PRVNI cHud=4
  await check(2, ''); // KUFRIK cHud=-1 (silent)
  await check(7, 'rybky05'); // back to UTES (track swaps)

  // DRAKAR1 (13): the band-room intro `music('rybky04',-998)` is NOT a packaged
  // sound, so it must fall back to Music/rybky04.m4a via the priority-tracked path
  // (musicSnd), not the looping musicSrc. Regression guard: without the fallback the
  // intro is silent and the band "sings" with no backing.
  await selectRoom(p, 13);
  // The wait is the assertion — see test-ves: re-reading a "is playing" flag after the
  // wait races the sample ending.
  const playing = await observed(
    p.waitForFunction(() => window.__ff.playingPrior(-998)),
  );
  expect(playing, 'DRAKAR1 intro music (rybky04) plays via the Music/ fallback');

  // Undo leaves it playing: the band is the room's own time-driven performance, so the
  // rebuild keeps its carried sounds (RoomScript.carriedSounds) and `init` must not cue
  // rybky04 again. The unit tests drive a copy of buildRoom; this is the real one.
  await p.waitForFunction(() => window.__ff.undoDepth() === 1);
  for (const which of ['little', 'big']) {
    for (const dir of [4, 3, 1, 2]) {
      if ((await p.evaluate(() => window.__ff.undoDepth())) > 1) break;
      await p.evaluate(([w, d]) => window.__ff.press(w, d), [which, dir]);
      await p.waitForFunction(() => window.__ff.phase() === 'idle');
    }
  }
  await p.waitForFunction(() => window.__ff.undoDepth() > 1 && window.__ff.canUndo());
  await p.evaluate(() => window.__ff.clearSoundLog());
  // A line on screen when undo is pressed stays there: its voice carries, so must its words.
  await p.evaluate(() => window.__ff.pushSubtitle('undo-carry', 'A'));
  const undone = await p.evaluate(() => window.__ff.undo());
  const subsKept = await p.evaluate(() => window.__ff.subsActive());
  await p.waitForTimeout(400);
  const after = await p.evaluate(() => ({
    playing: window.__ff.playingPrior(-998),
    recued: window.__ff.soundLog().filter((x) => x.name.startsWith('rybky04')).length,
  }));
  expect(undone && after.playing && after.recued === 0, `DRAKAR1 undo keeps rybky04 playing, not restarted: ${JSON.stringify({ undone, ...after })}`);
  expect(subsKept, 'DRAKAR1 undo keeps the subtitles of the lines that carry on');
});
