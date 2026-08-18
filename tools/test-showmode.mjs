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
import { budget, waitRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {

  await p.evaluate(() => window.__ff.enterRoomAwait(2));
  await waitRoom(p, 3);
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
  await p.waitForFunction(() => window.__ff.showmodeState().active);
  const total = await p.evaluate(() => window.__ff.showmodeState().total);
  expect(total > 1000, `help.cap loaded (${total} recorded actions)`);
  console.log(`showmode started (${total} actions)`);

  const idx0 = await p.evaluate(() => window.__ff.showmodeState().idx);
  await p.waitForFunction((i) => window.__ff.showmodeState().idx >= i + 20, idx0);
  console.log('replay advancing');

  await p.waitForFunction((s) => {
    const l = window.__ff.fishCell('little');
    return l && (l.x !== s.little.x || l.y !== s.little.y);
  }, startCells);
  const moved = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    moved.x !== startCells.little.x || moved.y !== startCells.little.y,
    `the little fish auto-moved during the demonstration (${startCells.little.x},${startCells.little.y} -> ${moved.x},${moved.y})`,
  );
  console.log(`fish auto-moved (${startCells.little.x},${startCells.little.y} -> ${moved.x},${moved.y})`);

  await p.waitForFunction(() => window.__ff.showmodeState().helptext >= 2);
  const ht = await p.evaluate(() => window.__ff.showmodeState().helptext);
  expect(ht >= 2, `tutorial subtitles fired (helptext=${ht})`);
  console.log(`tutorial subtitles firing (helptext=${ht})`);

  await p.keyboard.press('ArrowUp');
  expect(await p.evaluate(() => window.__ff.showmodeState().active), 'arrow key did not disrupt the demo');
  console.log('player input blocked during demo');

  await p.keyboard.press('Backspace');
  await p.waitForFunction(() => !window.__ff.showmodeState().active && !window.__ff.showmodeState().flag);
  expect(!(await p.evaluate(() => window.__ff.showmodeState().active)), 'Backspace ended the demonstration');
  console.log('player restart ended the demo');

  // ---- Part 2: death-restart synchronisation (from a clean spawn start) ----
  // The room is back to normal play at spawn; force the demo again and kill both fish
  // early so the replay runs the death countdown through to the recorded restart.
  await p.waitForFunction(() => window.__ff.screen() === 'room' && !window.__ff.showmodeState().active);
  await p.evaluate(() => window.__ff.forceShowmode());
  await p.waitForFunction(() => window.__ff.showmodeState().active);
  // Let a couple of actions pass (fish at spawn), then kill both fish.
  await p.waitForFunction(() => window.__ff.showmodeState().idx >= 3);
  await p.evaluate(() => {
    window.__ff.killFish('little');
    window.__ff.killFish('big');
  });
  console.log('killed both fish mid-demo');

  // The replay keeps advancing while the fish are dead (idle even in death) and
  // reaches the recorded restart run (idx ~289).
  // NB: the options object must be the THIRD argument — as the second it is taken
  // as the predicate's `arg` and silently ignored, leaving Playwright's 30s default
  // (which this wait, ~290 replayed actions at ~12.5/s, outgrows under a parallel run).
  // Traced at 82-197s in the pool against 25s alone: ~290 recorded actions, replayed one
  // per idle step, so it stretches with the game clock. The only wait in the suite that
  // genuinely outruns the backstop.
  await p.waitForFunction(() => window.__ff.showmodeState().active && window.__ff.showmodeState().idx >= 289, null, {
    timeout: budget(25000),
  });
  // Past the restart run: the room was rebuilt (fish back to spawn) and the demo
  // continues — help7 ("Nyní začínáme znovu") fires (helptext >= 7).
  // Same replay, a little further on (traced at 19.5s in the pool); budgeted with the
  // same headroom because it is the same clock.
  await p.waitForFunction(() => window.__ff.showmodeState().active && window.__ff.showmodeState().helptext >= 7, null, {
    timeout: budget(10000),
  });
  expect(await p.evaluate(() => window.__ff.showmodeState().active), 'demo survived + stayed synced through the death-restart');
  const afterRestart = await p.evaluate(() => window.__ff.fishCell('little'));
  expect(
    afterRestart.x === realSpawn.little.x && afterRestart.y === realSpawn.little.y,
    `fish rebuilt to spawn at the recorded restart (want ${realSpawn.little.x},${realSpawn.little.y}, got ${afterRestart.x},${afterRestart.y})`,
  );
  // Past the first deliberate hold. SHOWMODE_HOLDS keys index 302, and a hold that
  // re-armed itself instead of advancing would sit on that entry for ever — a real bug
  // once, and one nothing else in the suite can see, because the wait above is satisfied
  // by index 301, the entry immediately before it. Crossing 304 costs the ten held ticks,
  // under a second.
  await p.waitForFunction(() => window.__ff.showmodeState().active && window.__ff.showmodeState().idx >= 304, null, {
    timeout: budget(10000),
  });
  expect(
    await p.evaluate(() => window.__ff.showmodeState().idx) >= 304,
    'the replay advanced past its first deliberate hold instead of re-arming on it',
  );

  console.log(`demo survived death-restart, re-synced to spawn (${afterRestart.x},${afterRestart.y}), help7 fired, cleared its first hold — showmode probe OK`);
});
