/**
 * UI test: the leg-completion story page (obrazek, UMain.pas:831/991). Winning the
 * last room of a leg (a depth-15 room, one per branch 1..8) shows that leg's
 * full-screen "case file" page over a frozen map; a click or key dismisses it back
 * to the map (zrus_obrazek). Ordinary (shallower) rooms return straight to the map.
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

  // --- Last room of leg 1 (Ship Wrecks): room 19, depth 15 -> shows story page 1 ---
  await p.selectOption('#room', '19');
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0 && !window.__ff.state().won && !window.__ff.state().venku.little && !window.__ff.state().venku.big, { timeout: 5000 });
  await p.evaluate(() => localStorage.removeItem('ff.solved'));
  await winCurrentRoom();

  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'legimage', 'winning the last room of a leg shows the story page');
  expect((await p.evaluate(() => window.__ff.legImage())) === 1, 'leg 1 (Ship Wrecks) shows story page 1');

  // A click dismisses the page back to the world map (zrus_obrazek).
  await p.click('#screen');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 3000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'a click dismisses the story page to the map');
  expect((await p.evaluate(() => window.__ff.legImage())) === null, 'no story page once dismissed');
  expect((await p.evaluate(() => window.__ff.solvedRooms().includes(19))), 'room 19 recorded as solved');

  // --- Last room of leg 8 (Computer): room 70, depth 15 -> shows story page 8 ---
  await p.evaluate(() => window.__ff.showMap());
  await p.selectOption('#room', '70');
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0 && !window.__ff.state().won && !window.__ff.state().venku.little && !window.__ff.state().venku.big, { timeout: 5000 });
  await winCurrentRoom();
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.legImage())) === 8, 'leg 8 (Computer) shows story page 8');

  // A key also dismisses it (FormKeyDown).
  await p.keyboard.press('Space');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 3000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'a key dismisses the story page to the map');

  // --- Control: an ordinary room (7, depth < 15) returns straight to the map ---
  await p.evaluate(() => window.__ff.showMap());
  await p.selectOption('#room', '7');
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0 && !window.__ff.state().won && !window.__ff.state().venku.little && !window.__ff.state().venku.big, { timeout: 5000 });
  await winCurrentRoom();
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'a shallow room returns straight to the map, no story page');
  expect((await p.evaluate(() => window.__ff.legImage())) === null, 'no story page for a non-leg-final room');

  // --- Dev "Win room" button (dev pane): genuinely wins the current room via the real
  // win path, so a leg-final room reveals its story page — a spot-check shortcut. ---
  await p.evaluate(() => window.__ff.showMap());
  await p.selectOption('#room', '29'); // last room of leg 2
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0 && !window.__ff.state().won && !window.__ff.state().venku.little && !window.__ff.state().venku.big, { timeout: 5000 });
  await p.click('#winroom');
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.legImage())) === 2, 'the dev Win-room button shows leg 2\'s story page');
  await p.click('#screen');
  await p.waitForFunction(() => window.__ff.screen() === 'map', { timeout: 3000 });
  expect((await p.evaluate(() => window.__ff.solvedRooms().includes(29))), 'the dev Win-room button records the room as solved (not cheated)');

  // --- Re-entry (daClickAndRun, UMain.pas:958/1030): Run/Replay on an already-solved
  // leg-final room shows that leg's story page FIRST, then loads/replays the room once
  // the page is dismissed (rather than the after-win case, which returns to the map). ---
  const RUN = [279, 244];
  const REPLAY = [322, 244];

  // Run: room 19 (leg 1) is solved -> its panel's Run shows story page 1 before launch.
  await p.evaluate(() => window.__ff.showMap());
  await p.evaluate(() => window.__ff.openMapInfo(19));
  await p.waitForFunction(() => window.__ff.mapInfoRoom() === 19, { timeout: 3000 });
  await p.evaluate(([x, y]) => window.__ff.clickMap(x, y), RUN);
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.legImage())) === 1, 'Run on a solved leg-final room shows its story page first');
  // Dismissing the re-entry page continues into the room (not back to the map).
  await p.click('#screen');
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'dismissing the re-entry story page loads the room');
  expect((await p.evaluate(() => window.__ff.replayActive())) === false, 'the re-entry Run is a normal play, not a replay');

  // Replay: give room 19 a stored best, then its panel's Replay shows the page first,
  // and dismissing it starts the (silent) best-solution replay.
  await p.evaluate(() => window.__ff.showMap());
  await p.evaluate(() => window.__ff.markBest(19, 'I'.repeat(200)));
  await p.evaluate(() => window.__ff.openMapInfo(19));
  await p.waitForFunction(() => window.__ff.mapInfoRoom() === 19, { timeout: 3000 });
  await p.evaluate(([x, y]) => window.__ff.clickMap(x, y), REPLAY);
  await p.waitForFunction(() => window.__ff.screen() === 'legimage', { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.legImage())) === 1, 'Replay on a solved leg-final room shows its story page first');
  await p.keyboard.press('Space');
  await p.waitForFunction(() => window.__ff.replayActive(), { timeout: 6000 });
  expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'dismissing the re-entry story page enters the room');
  expect(await p.evaluate(() => window.__ff.replayActive()), 'dismissing the Replay page starts the best-solution replay');
});
