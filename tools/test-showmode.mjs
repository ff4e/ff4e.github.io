/** UI probe: KUFRIK automatic demonstration (showmode / help.cap replay, room 2).
 *
 *  Part 1 (staged at the in-game demo spot malar 25,23 / velkar 27,21, where the
 *  trigger fires in normal play, so the recording's absolute waypoints line up):
 *    - the recording loads and the replay pointer advances (one action per idle step);
 *    - the fish auto-move along the recorded path with no player input;
 *    - the tutorial subtitles fire (helptext advances, dialogue lines are spoken);
 *    - player input is blocked while it plays;
 *    - a restart (Backspace) ends the demonstration.
 *
 *  Part 2 (death-restart synchronisation): the demo deliberately kills the fish
 *  ("what you shouldn't do"); the recording then drives the restart via a run of
 *  akce_restart entries (idx ~289 = the engine's countdown auto-restart). The replay
 *  must keep advancing WHILE the fish are dead and rebuild the room (fish back to
 *  spawn, showmode preserved) at the recorded restart, then fire help7 ("Nyní
 *  začínáme znovu"). This is the bug the user hit: previously the restart cleared
 *  showmode and the fish spoke the normal pokus>1 intro instead of continuing. */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  await p.evaluate(() => window.__ff.enterRoomAwait(2));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 3, { timeout: 5000 });
  expect(await p.evaluate(() => window.__ff.script() !== null), 'KUFRIK has an active script');

  const realSpawn = await p.evaluate(() => ({
    little: window.__ff.fishCell('little'),
    big: window.__ff.fishCell('big'),
  }));

  // ---- Part 1: staged demonstration ----
  await p.evaluate(() => {
    window.__ff.setFishCell('little', 25, 23);
    window.__ff.setFishCell('big', 27, 21);
  });
  const startCells = await p.evaluate(() => ({
    little: window.__ff.fishCell('little'),
    big: window.__ff.fishCell('big'),
  }));

  await p.evaluate(() => window.__ff.forceShowmode());
  expect(await p.evaluate(() => window.__ff.showmodeState().flag), 'showmode flag set on start');
  await p.waitForFunction(() => window.__ff.showmodeState().active, { timeout: 5000 });
  const total = await p.evaluate(() => window.__ff.showmodeState().total);
  expect(total > 1000, `help.cap loaded (${total} recorded actions)`);
  console.log(`showmode started (${total} actions)`);

  const idx0 = await p.evaluate(() => window.__ff.showmodeState().idx);
  await p.waitForFunction((i) => window.__ff.showmodeState().idx >= i + 20, idx0, { timeout: 10000 });
  console.log('replay advancing');

  await p.waitForFunction((s) => {
    const l = window.__ff.fishCell('little');
    return l && (l.x !== s.little.x || l.y !== s.little.y);
  }, startCells, { timeout: 12000 });
  const moved = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    moved.x !== startCells.little.x || moved.y !== startCells.little.y,
    `the little fish auto-moved during the demonstration (${startCells.little.x},${startCells.little.y} -> ${moved.x},${moved.y})`,
  );
  console.log(`fish auto-moved (${startCells.little.x},${startCells.little.y} -> ${moved.x},${moved.y})`);

  await p.waitForFunction(() => window.__ff.showmodeState().helptext >= 2, { timeout: 15000 });
  const ht = await p.evaluate(() => window.__ff.showmodeState().helptext);
  expect(ht >= 2, `tutorial subtitles fired (helptext=${ht})`);
  console.log(`tutorial subtitles firing (helptext=${ht})`);

  await p.keyboard.press('ArrowUp');
  expect(await p.evaluate(() => window.__ff.showmodeState().active), 'arrow key did not disrupt the demo');
  console.log('player input blocked during demo');

  await p.keyboard.press('Backspace');
  await p.waitForFunction(() => !window.__ff.showmodeState().active && !window.__ff.showmodeState().flag, { timeout: 5000 });
  expect(!(await p.evaluate(() => window.__ff.showmodeState().active)), 'Backspace ended the demonstration');
  console.log('player restart ended the demo');

  // ---- Part 2: death-restart synchronisation (from a clean spawn start) ----
  // The room is back to normal play at spawn; force the demo again and kill both fish
  // early so the replay runs the death countdown through to the recorded restart.
  await p.waitForFunction(() => window.__ff.screen() === 'room' && !window.__ff.showmodeState().active, { timeout: 5000 });
  await p.evaluate(() => window.__ff.forceShowmode());
  await p.waitForFunction(() => window.__ff.showmodeState().active, { timeout: 5000 });
  // Let a couple of actions pass (fish at spawn), then kill both fish.
  await p.waitForFunction(() => window.__ff.showmodeState().idx >= 3, { timeout: 5000 });
  await p.evaluate(() => {
    window.__ff.killFish('little');
    window.__ff.killFish('big');
  });
  console.log('killed both fish mid-demo');

  // The replay keeps advancing while the fish are dead (idle even in death) and
  // reaches the recorded restart run (idx ~289).
  await p.waitForFunction(() => window.__ff.showmodeState().active && window.__ff.showmodeState().idx >= 289, { timeout: 40000 });
  // Past the restart run: the room was rebuilt (fish back to spawn) and the demo
  // continues — help7 ("Nyní začínáme znovu") fires (helptext >= 7).
  await p.waitForFunction(() => window.__ff.showmodeState().active && window.__ff.showmodeState().helptext >= 7, { timeout: 15000 });
  expect(await p.evaluate(() => window.__ff.showmodeState().active), 'demo survived + stayed synced through the death-restart');
  const afterRestart = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    afterRestart.x === realSpawn.little.x && afterRestart.y === realSpawn.little.y,
    `fish rebuilt to spawn at the recorded restart (want ${realSpawn.little.x},${realSpawn.little.y}, got ${afterRestart.x},${afterRestart.y})`,
  );
  console.log(`demo survived death-restart, re-synced to spawn (${afterRestart.x},${afterRestart.y}), help7 fired — showmode probe OK`);
});
