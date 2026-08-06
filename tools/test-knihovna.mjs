/**
 * UI smoke test: KNIHOVNA (room 62) runs end-to-end against the real game data.
 * Confirms the ported script is dispatched and its Programky — the global-array
 * crystals, the universal agent, the PC/door animations — executes for many
 * ticks without throwing. The harness hard-fails on any console/page error.
 */
import { forTicks, waitRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.evaluate(() => window.__ff.enterRoom(62));
  await waitRoom(p, 0);

  expect(await p.evaluate(() => window.__ff.script() !== null), 'KNIHOVNA script is active in room 62');

  // The ten crystals live at item indices 35..44 in the real room.
  const crystal = await p.evaluate(() => window.__ff.itemState(35));
  expect(crystal !== null && typeof crystal.afaze === 'number', 'crystal (item 35) present with a frame');

  // Sample across a window of GAME time, not of wall time: the assertion below is
  // about ticks, and a fixed sleep buys however many of them the machine had left
  // over (2.4s of sleep bought 15 ticks instead of 30 on a loaded run).
  const frames = new Set();
  const ran = await forTicks(p, 15, async () => {
    const st = await p.evaluate(() => window.__ff.itemState(35));
    if (st) frames.add(st.afaze);
  });
  expect(ran >= 15, `Programky advanced many ticks (${ran} ticks)`);
  expect(await p.evaluate(() => window.__ff.script() !== null), 'script still active after the run');
  expect([...frames].every((f) => Number.isInteger(f)), 'crystal frame stays a valid integer each tick');
});
