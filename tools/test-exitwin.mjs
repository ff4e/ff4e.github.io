/**
 * UI test: exiting / winning a room. Driving both fish out through the exit
 * animation solves the room (venku -> won) and records it in the solved-set
 * progression (which lights the map + unlocks branches).
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.selectOption('#room', '7'); // UTES
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => localStorage.removeItem('ff.solved'));
  await p.waitForTimeout(300);

  expect(!(await p.evaluate(() => window.__ff.state().won)), 'room not solved yet');

  // Send the little fish out of the left edge.
  await p.evaluate(() => window.__ff.forceExit('little', 3));
  await p.waitForFunction(() => window.__ff.state().venku.little, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.state().venku.little), 'little fish exited');
  expect(!(await p.evaluate(() => window.__ff.state().won)), 'not won with one fish still in');

  // Send the big fish out too -> the room is solved.
  await p.evaluate(() => window.__ff.forceExit('big', 3));
  await p.waitForFunction(() => window.__ff.state().won, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.state().won), 'both fish out => room won');

  // Winning records the room in the persisted progression (room 7).
  await p.waitForFunction(() => window.__ff.solvedRooms().includes(7), { timeout: 3000 }).catch(() => {});
  expect(await p.evaluate(() => window.__ff.solvedRooms().includes(7)), 'solved room recorded in progression');

  // The move count is recorded as the room result (RoomVysl := LengthOfRecord).
  const score = await p.evaluate(() => window.__ff.scores()[7]);
  expect(typeof score === 'number', `solve move count recorded as the score (${score})`);

  // After the win countdown, the room auto-returns to the world map (no click).
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 5000 }).catch(() => {});
  expect(await p.evaluate(() => window.__ff.screen() === 'map'), 'auto-returns to the map after the win countdown');
});
