/**
 * UI smoke test: SCHODY (room 5) runs end-to-end against the real game data.
 * Confirms the ported script is dispatched and its per-tick Programky (slug +
 * snail state machines, incl. the FArray grid query) executes for many ticks
 * without throwing — the harness hard-fails on any console/page error.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoom(5));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });

  const scriptActive = await p.evaluate(() => window.__ff.script() !== null);
  expect(scriptActive, 'SCHODY script is active in room 5');

  const slug = await p.evaluate(() => window.__ff.itemState(1)); // plzik
  const snail = await p.evaluate(() => window.__ff.itemState(8)); // snecek
  expect(slug !== null && typeof slug.afaze === 'number', 'slug (item 1) present with a frame');
  expect(snail !== null && typeof snail.afaze === 'number', 'snail (item 8) present with a frame');

  // Let the Programky run for a good stretch of ticks, sampling frames.
  const start = await p.evaluate(() => window.__ff.count());
  const frames = new Set();
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(60);
    const st = await p.evaluate(() => window.__ff.itemState(8));
    if (st) frames.add(st.afaze);
  }
  const end = await p.evaluate(() => window.__ff.count());
  expect(end - start >= 15, `Programky advanced many ticks (${end - start} ticks)`);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'script still active after the run');
  // The state machine writes a valid frame every tick (no crash, always a number).
  expect([...frames].every((f) => Number.isInteger(f)), 'snail frame stays a valid integer each tick');
});
