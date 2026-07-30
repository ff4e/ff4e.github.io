/**
 * UI smoke test: SCHODY (room 5) runs end-to-end against the real game data.
 * Confirms the ported script is dispatched and its per-tick Programky (slug +
 * snail state machines, incl. the FArray grid query) executes for many ticks
 * without throwing — the harness hard-fails on any console/page error.
 */
import { waitRoom, withApp, forTicks } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoom(5));
  await waitRoom(p, 0);

  const scriptActive = await p.evaluate(() => window.__ff.script() !== null);
  expect(scriptActive, 'SCHODY script is active in room 5');

  const slug = await p.evaluate(() => window.__ff.itemState(1)); // plzik
  const snail = await p.evaluate(() => window.__ff.itemState(8)); // snecek
  expect(slug !== null && typeof slug.afaze === 'number', 'slug (item 1) present with a frame');
  expect(snail !== null && typeof snail.afaze === 'number', 'snail (item 8) present with a frame');

  // Let the Programky run for a good stretch of ticks, sampling frames.
  // Bounded on GAME time — see test-knihovna: a fixed sleep makes the tick assertion
  // below a statement about the machine rather than about the script.
  const frames = new Set();
  const ran = await forTicks(p, 15, async () => {
    const st = await p.evaluate(() => window.__ff.itemState(8));
    if (st) frames.add(st.afaze);
  });
  expect(ran >= 15, `Programky advanced many ticks (${ran} ticks)`);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'script still active after the run');
  // The state machine writes a valid frame every tick (no crash, always a number).
  expect([...frames].every((f) => Number.isInteger(f)), 'snail frame stays a valid integer each tick');
});
