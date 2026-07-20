/**
 * UI test: loading a saved position must not make the fish re-say lines they
 * already said. The port re-simulates the move record on load, which rebuilds
 * the room and resets the script Vars — so without the saved script snapshot the
 * "already said" flags are lost and dialogue re-fires. We verify the new save
 * (with the snapshot) preserves them, and that a legacy plain-record save (no
 * snapshot) still re-fires — proving the snapshot is what fixes it.
 */
import { withApp } from './ui-lib.mjs';

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.count, { timeout: 5000 });

  // Collect the set of line names that fire over a window.
  async function collectRefired(seconds) {
    let prev = await p.evaluate(() => window.__ff.lines());
    const seen = new Set();
    for (let i = 0; i < seconds * 12; i++) {
      await p.waitForTimeout(80);
      const [nl, l] = await p.evaluate(() => [window.__ff.lines(), window.__ff.lastLine()]);
      if (nl > prev && l && l.name) seen.add(l.name);
      prev = nl;
    }
    return [...seen];
  }

  async function playUntilDialogue() {
    await p.evaluate(() => window.__ff.enterRoomAwait(1)); // PRVNI (intro dialogue)
    await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
    await p.evaluate(() => localStorage.removeItem('ff.save.1'));
    await p.waitForFunction(() => window.__ff.lines() >= 2, { timeout: 15000 }).catch(() => {});
  }

  // --- new save (with the script snapshot): loading does not re-fire dialogue ---
  await playUntilDialogue();
  await p.evaluate(() => window.__ff.save());
  await p.waitForTimeout(900); // let the current line finish
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading(), { timeout: 5000 });
  const refiredNew = await collectRefired(3.5);
  expect(refiredNew.length === 0, `new save/load does not re-say dialogue (heard: [${refiredNew.join(', ')}])`);

  // --- legacy save (plain move record, no snapshot): re-fires, proving the fix ---
  await playUntilDialogue();
  await p.evaluate(() => localStorage.setItem('ff.save.1', window.__ff.record())); // legacy format
  await p.waitForTimeout(900);
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading(), { timeout: 5000 });
  const refiredLegacy = await collectRefired(3.5);
  expect(refiredLegacy.length > 0, `a legacy save (no snapshot) DOES re-say dialogue (heard: [${refiredLegacy.join(', ')}])`);

  // --- KUFRIK (the reported case): after the big fish has said "kuf-v-hod", a
  // save/load must not make it repeat that intro line. ---
  await p.evaluate(() => window.__ff.enterRoomAwait(2)); // KUFRIK
  await p.waitForFunction(() => window.__ff.screen() === 'room' && window.__ff.count() > 0, { timeout: 5000 });
  await p.evaluate(() => localStorage.removeItem('ff.save.2'));
  // Wait until kuf-v-hod has actually played (the intro is kuf-m-je -> kuf-v-noco -> kuf-v-hod).
  const said = new Set();
  for (let i = 0; i < 150 && !said.has('kuf-v-hod'); i++) {
    await p.waitForTimeout(80);
    const l = await p.evaluate(() => window.__ff.lastLine());
    if (l && l.name) said.add(l.name);
  }
  expect(said.has('kuf-v-hod'), 'kuf-v-hod was spoken before the save');
  await p.evaluate(() => window.__ff.save());
  await p.waitForTimeout(500);
  await p.evaluate(() => window.__ff.load());
  await p.waitForFunction(() => !window.__ff.loading(), { timeout: 5000 });
  const refiredKufr = await collectRefired(3.5);
  const intro = refiredKufr.filter((n) => ['kuf-m-je', 'kuf-v-noco', 'kuf-v-hod'].includes(n));
  expect(intro.length === 0, `KUFRIK: loading does not repeat the intro banter (heard: [${refiredKufr.join(', ')}])`);
});
