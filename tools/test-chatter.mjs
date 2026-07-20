/**
 * UI test: ambient idle chatter (StdKecej) — the porting-INDEPENDENT integration bits
 * only. The firing logic (timer gating, enqueue, interval growth, no-repeat group
 * rotation) is owned by the deterministic unit test test/chatter.test.ts, so this probe
 * no longer needs an "unported quiet room" to watch chatter fire (that was a moving
 * target as rooms got ported: 20 -> 30 -> 59 -> 67 -> ...).
 *
 * Here we confirm the real assets + wiring that a unit test can't see: the global x03
 * chatter bank (subtitles + voices) actually loaded, a chatter timer is wired up in a
 * live room, and the TrepatRoom shake jitters the real canvas.
 */
import { withApp, idle } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // The global x03 chatter bank loaded (subtitles + voices).
  expect((await p.evaluate(() => window.__ff.chatCount())) > 0, 'x03 chatter subtitle bank loaded');
  expect(await p.evaluate(() => window.__ff.audioHas('ob-v-jit0')), 'x03 chatter voices loaded');

  // A chatter timer is wired up in a live room (the host arms StdKecej every room).
  await p.evaluate(() => window.__ff.enterRoomAwait(7)); // UTES
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  await idle(p);
  const info = await p.evaluate(() => window.__ff.chatterInfo());
  expect(info !== null && info.interval > 0, 'a live room has an armed chatter timer');

  // TrepatRoom shake: setting the flag jitters the canvas; clearing it restores it.
  await p.evaluate(() => window.__ff.setTrepat(1));
  let shook = false;
  for (let i = 0; i < 12 && !shook; i++) {
    await p.waitForTimeout(60);
    const t = await p.evaluate(() => window.__ff.canvasTransform());
    if (t && t.includes('translate(')) shook = true;
  }
  expect(shook, 'TrepatRoom shake jitters the canvas while set');
  await p.evaluate(() => window.__ff.setTrepat(0));
  await p.waitForTimeout(300);
  expect(!(await p.evaluate(() => window.__ff.canvasTransform())).includes('translate('), 'the shake clears when TrepatRoom resets');
});
