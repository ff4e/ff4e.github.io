/** UI probe: Hacky fishing hooks (the "xfisher" easter-egg). Spawns hooks and
 *  verifies one descends and catches a fish (control passes to the survivor), and
 *  that catching BOTH fish restarts the room (count resets). Also checks hooks
 *  clear on room change. */
import { forTicks, waitRoom, withApp } from './ui-lib.mjs';
await withApp(async ({ p, expect }) => {
  await p.evaluate(() => window.__ff.enterRoomAwait(7)); // UTES
  await waitRoom(p, 3);

  // One hook: descends (stav 1) and catches (stav 3); the active fish's death passes
  // control to the survivor.
  await p.evaluate(() => window.__ff.spawnHook());
  expect(await p.evaluate(() => window.__ff.hookCount()) === 1, 'a hook was spawned');
  // The hook's state machine advances on GAME ticks, so bound the watch on those:
  // 120 * 50ms of wall time is a shrinking number of ticks on a loaded machine.
  let sawDescend = false, sawCaught = false;
  await forTicks(p, 75, async () => {
    const st = await p.evaluate(() => window.__ff.hookStates());
    if (st.some((h) => h.stav === 1)) sawDescend = true;
    if (st.some((h) => h.stav === 3)) sawCaught = true;
    return !sawCaught;
  }, 50);
  expect(sawDescend, 'the hook descends (stav 1)');
  expect(sawCaught, 'the hook catches a fish (stav 3)');

  // Hooks clear when the room changes (nhacku := 0 on enter).
  await p.evaluate(() => window.__ff.enterRoomAwait(1));
  await waitRoom(p, 3);
  expect(await p.evaluate(() => window.__ff.hookCount()) === 0, 'hooks clear on room enter');

  // Spawn several hooks; catching BOTH fish restarts the room (count resets low).
  await p.evaluate(() => { for (let i = 0; i < 8; i++) window.__ff.spawnHook(); });
  let restarted = false;
  let prev = await p.evaluate(() => window.__ff.count());
  await forTicks(p, 125, async () => {
    const c = await p.evaluate(() => window.__ff.count());
    if (c < prev) restarted = true; // buildRoom reset count to 0
    prev = c;
    return !restarted;
  }, 50);
  expect(restarted, 'catching both fish restarts the room');
  console.log('Hacky OK: hook descend+catch, clear-on-enter, both-caught restart');
});
