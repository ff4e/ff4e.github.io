/**
 * UI smoke test: KNIHOVNA (room 62) runs end-to-end against the real game data.
 * Confirms the ported script is dispatched and its Programky — the global-array
 * crystals, the universal agent, the PC/door animations — executes for many
 * ticks without throwing. The harness hard-fails on any console/page error.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });
  await p.evaluate(() => window.__ff.enterRoom(62));
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });

  expect(await p.evaluate(() => window.__ff.script() !== null), 'KNIHOVNA script is active in room 62');

  // The ten crystals live at item indices 35..44 in the real room.
  const crystal = await p.evaluate(() => window.__ff.itemState(35));
  expect(crystal !== null && typeof crystal.afaze === 'number', 'crystal (item 35) present with a frame');

  const start = await p.evaluate(() => window.__ff.count());
  const frames = new Set();
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(60);
    const st = await p.evaluate(() => window.__ff.itemState(35));
    if (st) frames.add(st.afaze);
  }
  const end = await p.evaluate(() => window.__ff.count());
  expect(end - start >= 15, `Programky advanced many ticks (${end - start} ticks)`);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'script still active after the run');
  expect([...frames].every((f) => Number.isInteger(f)), 'crystal frame stays a valid integer each tick');
});
