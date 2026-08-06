/**
 * UI test: exiting / winning a room. Driving both fish out through the exit
 * animation solves the room (venku -> won) and records it in the solved-set
 * progression (which lights the map + unlocks branches).
 */
import { selectRoom, tickSleep, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await selectRoom(p, 7); // UTES
  await p.evaluate(() => localStorage.removeItem('ff.solved'));
  await tickSleep(p, 4);

  expect(!(await p.evaluate(() => window.__ff.state().won)), 'room not solved yet');

  // Send the little fish out of the left edge (wait for idle first — forceExit is a
  // no-op unless the engine is idle, main.ts:4338).
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  await p.evaluate(() => window.__ff.forceExit('little', 3));
  await p.waitForFunction(() => window.__ff.state().venku.little);
  expect(await p.evaluate(() => window.__ff.state().venku.little), 'little fish exited');
  expect(!(await p.evaluate(() => window.__ff.state().won)), 'not won with one fish still in');

  // Send the big fish out too -> the room is solved.
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
  await p.evaluate(() => window.__ff.forceExit('big', 3));
  await p.waitForFunction(() => window.__ff.state().won);
  expect(await p.evaluate(() => window.__ff.state().won), 'both fish out => room won');

  // The exit cheer plays as a tracked voice line; model a still-playing line with a
  // subtitle so the win auto-return holds instead of cutting it (enhancement over the
  // original's fixed ~2.4s countdown, URoom.pas:24349). Push it right as the win starts.
  await p.evaluate(() => window.__ff.pushSubtitle('The fish is delivering a long farewell line', 'M'));

  // Winning records the room in the persisted progression (room 7).
  await p.waitForFunction(() => window.__ff.solvedRooms().includes(7)).catch(() => {});
  expect(await p.evaluate(() => window.__ff.solvedRooms().includes(7)), 'solved room recorded in progression');

  // The move count is recorded as the room result (RoomVysl := LengthOfRecord).
  const score = await p.evaluate(() => window.__ff.scores()[7]);
  expect(typeof score === 'number', `solve move count recorded as the score (${score})`);

  // The room holds on-screen while the line is still showing — well past the ~2.4s
  // (30-tick @ 80ms) countdown — re-pushing so the subtitle never expires mid-check.
  // Without the hold, the room would have auto-returned to the map by ~2.4s.
  // Counted in TICKS, because the countdown being outlasted is counted in ticks. As
  // wall-clock sleeps this check quietly evaporates under load: 8 x 400ms can contain
  // far fewer than the 30 ticks it is supposed to outlast, so it would "hold" for the
  // wrong reason. 8 rounds x 5 ticks = 40 ticks, comfortably past the countdown.
  let held = 0;
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => window.__ff.pushSubtitle('The fish is delivering a long farewell line', 'M'));
    held += await tickSleep(p, 5);
    expect(await p.evaluate(() => window.__ff.subsActive()), `subtitle still showing (round ${i})`);
    expect(
      await p.evaluate(() => window.__ff.screen() === 'room'),
      `room holds while the line is on screen (round ${i}, ${held} ticks > the 30-tick countdown)`,
    );
  }
  // The countdown lapsed but was held at 1 rather than returning to the map.
  expect(await p.evaluate(() => window.__ff.winCountdown()) === 1, 'win countdown held at 1 while the line plays');

  // Once the line clears, the held countdown releases and the room returns to the map.
  await p.evaluate(() => window.__ff.clearSubtitles());
  await p.waitForFunction(() => window.__ff.screen() === 'map').catch(() => {});
  expect(await p.evaluate(() => window.__ff.screen() === 'map'), 'returns to the map once the exit line finishes');
});
