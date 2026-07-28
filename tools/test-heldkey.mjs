/**
 * UI test: engine-level held-key auto-repeat (KeyRoom, URoom.pas:26941 / Uovl.pas:990).
 * Holding a movement key must move the fish continuously, cell-by-cell, with no OS
 * typematic delay — the engine re-issues the held key each rest tick. A synthetic
 * keydown does NOT OS-auto-repeat, so a single held keydown that travels several cells
 * can only be the engine's own repeat; a tap moves at most one cell.
 */
import { waitRoom, withApp, forTicks, tickSleep } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  const key = (type, code) =>
    p.evaluate(({ t, c }) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })), {
      t: type,
      c: code,
    });
  const cell = () => p.evaluate(() => window.__ff.fishCell('little'));
  const waitIdle = () => p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });
  const dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

  await p.evaluate(() => window.__ff.enterRoomAwait(30)); // RECYCLED — open water
  await waitRoom(p, 0);
  await waitIdle();

  // Hold each little-fish direction (one keydown, no repeat); the best open direction
  // must carry the fish several cells — proof the engine repeats a held key. While it
  // travels, the move speed-up (jizda) must kick in: ticks/cell drops from 3 toward 1.
  let best = 0;
  let bestDir = '';
  let minFrames = 3;
  for (const d of ['KeyJ', 'KeyL', 'KeyI', 'KeyK']) {
    await p.evaluate(() => window.__ff.restart());
    await waitIdle();
    const start = await cell();
    await key('keydown', d);
    // Sample the current ticks/cell across the hold (its minimum = the top speed
    // reached). jizda counts TICKS of unobstructed movement (0..6 -> 3, 7..10 -> 2,
    // 11+ -> 1), so the hold has to be measured in ticks: 24 * 60ms of wall time
    // reaches tier 1 on an idle machine and never leaves tier 3 on a loaded one.
    let localMin = 3;
    await forTicks(p, 18, async () => {
      localMin = Math.min(localMin, await p.evaluate(() => window.__ff.moveFrames()));
    }, 60);
    await key('keyup', d);
    await waitIdle();
    const moved = dist(await cell(), start);
    if (moved > best) {
      best = moved;
      bestDir = d;
      minFrames = localMin;
    }
  }
  expect(best >= 3, `holding a direction moves the fish several cells continuously (best ${best} via ${bestDir})`);
  expect(minFrames <= 2, `sustained holding accelerates: ticks/cell dropped to ${minFrames} (from 3)`);

  // Smoothness: during a sustained hold the fish spends most frames sliding (phase 'move'),
  // not teleporting cell-to-cell between idle frames. Before the gfaze=0 start-frame fix,
  // the accelerated (1-tick/cell) move completed within its dispatch tick, so it never
  // rendered mid-slide and phase read 'idle' every frame.
  await p.evaluate(() => window.__ff.restart());
  await waitIdle();
  await key('keydown', bestDir);
  let moving = 0;
  let total = 0;
  await forTicks(p, 16, async () => {
    total++;
    if ((await p.evaluate(() => window.__ff.phase())) === 'move') moving++;
  }, 20);
  await key('keyup', bestDir);
  await waitIdle();
  expect(moving / total >= 0.4, `the fish spends a hold sliding, not teleporting (move ${moving}/${total} frames)`);

  // Control: a single tap moves at most one cell (so the multi-cell travel above is the
  // engine's repeat, not one giant move). Wait for the move to dispatch + settle first.
  await p.evaluate(() => window.__ff.restart());
  await waitIdle();
  const s2 = await cell();
  await key('keydown', bestDir);
  await key('keyup', bestDir);
  await tickSleep(p, 5); // let the single move dispatch and start
  await waitIdle();
  const tap = dist(await cell(), s2);
  expect(tap <= 1, `a single tap moves at most one cell (moved ${tap})`);

  // Regression guard: separate taps still register (each ~1 cell) — the held-key rework
  // must not swallow discrete presses.
  await p.evaluate(() => window.__ff.restart());
  await waitIdle();
  const s3 = await cell();
  for (let i = 0; i < 3; i++) {
    await key('keydown', bestDir);
    await key('keyup', bestDir);
    await tickSleep(p, 5);
    await waitIdle();
  }
  const taps = dist(await cell(), s3);
  expect(taps >= 2, `repeated taps each move the fish (3 taps moved ${taps})`);

  // After release, the fish stops (no runaway repeat).
  await p.evaluate(() => window.__ff.restart());
  await waitIdle();
  await key('keydown', bestDir);
  await tickSleep(p, 9);
  await key('keyup', bestDir);
  await waitIdle();
  const stopped = await cell();
  // Watch for a runaway repeat over GAME ticks. A wall-clock sleep makes this
  // "nothing happened" check weaker the busier the machine is — in the limit it
  // passes because the game barely ran at all.
  const quiet = await tickSleep(p, 6);
  const later = await cell();
  expect(dist(stopped, later) === 0, `the fish stops once the held key is released (still after ${quiet} ticks)`);
});
