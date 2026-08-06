/**
 * UI test: loading a saved position must not make the fish re-say lines they
 * already said. The port re-simulates the move record on load, which rebuilds
 * the room and resets the script Vars — so without the saved script snapshot the
 * "already said" flags are lost and dialogue re-fires. We verify the new save
 * (with the snapshot) preserves them, and that a legacy plain-record save (no
 * snapshot) still re-fires — proving the snapshot is what fixes it.
 */
import { forTicks, tickSleep, waitRoom, withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {

  // Collect the set of line names that fire over a window of GAME time. Dialogue is
  // scheduled in ticks, so a wall-clock window is the wrong unit twice over: it makes
  // the positive check (a legacy save DOES re-fire) flaky, and — worse — it silently
  // WEAKENS the negative check, which would "pass" on a loaded machine simply by
  // observing almost no game time at all.
  async function collectRefired(ticks) {
    let prev = await p.evaluate(() => window.__ff.lines());
    const seen = new Set();
    await forTicks(p, ticks, async () => {
      const [nl, l] = await p.evaluate(() => [window.__ff.lines(), window.__ff.lastLine()]);
      if (nl > prev && l && l.name) seen.add(l.name);
      prev = nl;
    }, 80);
    return [...seen];
  }

  async function playUntilDialogue() {
    await p.evaluate(() => window.__ff.enterRoomAwait(1)); // PRVNI (intro dialogue)
    await waitRoom(p, 0);
    await p.evaluate(() => localStorage.removeItem('ff.save.1'));
    await p.waitForFunction(() => window.__ff.lines() >= 2).catch(() => {});
  }

  // --- new save (with the script snapshot): loading does not re-fire dialogue ---
  await playUntilDialogue();
  await p.evaluate(() => window.__ff.save());
  await tickSleep(p, 11); // let the current line finish
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading());
  const refiredNew = await collectRefired(42);
  expect(refiredNew.length === 0, `new save/load does not re-say dialogue (heard: [${refiredNew.join(', ')}])`);

  // --- legacy save (plain move record, no snapshot): re-fires, proving the fix ---
  await playUntilDialogue();
  await p.evaluate(() => localStorage.setItem('ff.save.1', window.__ff.record())); // legacy format
  await tickSleep(p, 11);
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading());
  const refiredLegacy = await collectRefired(42);
  expect(refiredLegacy.length > 0, `a legacy save (no snapshot) DOES re-say dialogue (heard: [${refiredLegacy.join(', ')}])`);

  // --- KUFRIK (the reported case): after the big fish has said "kuf-v-hod", a
  // save/load must not make it repeat that intro line. ---
  await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
  await waitRoom(p, 0);
  await p.evaluate(() => localStorage.removeItem('ff.save.2'));
  // Wait until kuf-v-hod has actually played (the intro is kuf-m-je -> kuf-v-noco -> kuf-v-hod).
  const said = new Set();
  await forTicks(p, 150, async () => {
    const l = await p.evaluate(() => window.__ff.lastLine());
    if (l && l.name) said.add(l.name);
    return !said.has('kuf-v-hod');
  }, 80);
  expect(said.has('kuf-v-hod'), 'kuf-v-hod was spoken before the save');
  await p.evaluate(() => window.__ff.save());
  await tickSleep(p, 6);
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading());
  const refiredKufr = await collectRefired(42);
  const intro = refiredKufr.filter((n) => ['kuf-m-je', 'kuf-v-noco', 'kuf-v-hod'].includes(n));
  expect(intro.length === 0, `KUFRIK: loading does not repeat the intro banter (heard: [${refiredKufr.join(', ')}])`);
});
