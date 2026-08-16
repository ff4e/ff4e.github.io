/**
 * UI test: the dev bar's "Solve room" button plays the room's recorded solution live, and
 * the room actually solves itself.
 *
 * This is the live half of the solvability net, and it is worth its ~40 s precisely
 * because of what the HEADLESS half cannot see. `test/solutions.test.ts` replays all 70
 * recordings through the shared step-engine in about a second and proves the moves still
 * win — against physics, `prog()` and the win hook, with no browser at all. Everything
 * around that is unasserted by it: that the moves reach the engine through the real key
 * path and the real swim animation, that the room script's dialogue is scheduled and
 * spoken while it plays, that the move record builds as if a player had pressed the keys,
 * that the win path returns to the map, and that the player is locked out meanwhile. A
 * regression in any of those leaves the headless suite green.
 *
 * Cost is a real decision here, so: THREE rooms, not seventy. A full sweep at one move per
 * idle tick would be minutes of wall-clock (MAPA's recording alone is 6 045 moves), and it
 * would buy almost nothing — `npm run test:solutions` is the exhaustive one and it is
 * fast. What is chosen instead is one of each shape:
 *
 *   DELA  #47 — the shortest recording in the corpus (39 moves): the cheap smoke test.
 *   PRVNI #1  — the tutorial room, which TALKS: the case that proves this mode is not
 *               silent the way the player-facing replay deliberately is.
 *   ZRC   #9  — a third room (83 moves) so a pass is not two rooms wide.
 *
 * The replay is run at a speed multiplier, which shortens the logic tick rather than
 * skipping ticks: every 80 ms step still happens, in order. That is what keeps this
 * honest — it is the same run, only compressed.
 */
import { budget, observed, withApp } from './ui-lib.mjs';

/**
 * The multiplier the run is watched at. It does NOT skip ticks or batch moves — it
 * shortens the logic tick, so all three rooms play every one of their 176 moves through
 * the real loop, in order, with the script and the dialogue running. Measured: 25 s for
 * the whole probe at 20, against ~2 min at 8, which is the difference between "inside the
 * suite's median band" and "one of its slowest probes".
 */
const SPEED = 20;

const ROOMS = [
  { num: 47, jmeno: 'DELA', talks: false },
  { num: 1, jmeno: 'PRVNI', talks: true },
  { num: 9, jmeno: 'ZRC', talks: false },
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  // The button and the __ff hook are both armed only while the dev pane is enabled.
  await p.evaluate(() => localStorage.setItem('ff.devEnabled', '1'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());

  for (const { num, jmeno, talks } of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    await p.waitForFunction(`window.__ff.roomNum() === ${num}`);
    await p.waitForFunction(() => window.__ff.phase() === 'idle');

    const before = await p.evaluate(() => window.__ff.lines());
    // Drive it through the dev-bar BUTTON, not the hook, so the wiring is what is asserted.
    await p.click('#solveroom');
    const armed = await p.evaluate(() => window.__ff.solveStatus());
    expect(armed.running, `${jmeno} started playing its solution`);
    expect(armed.total > 0, `${jmeno} has moves to play (${armed.total})`);
    expect(!(await p.evaluate(() => window.__ff.replayActive())), `${jmeno} is NOT the map replay — that one is silent`);
    await p.evaluate((s) => window.__ff.solveSetSpeed(s), SPEED);

    // The player is locked out while it plays: a fish key must not reach the room. The
    // move index is the witness — the recording, not the keyboard, is what advances it.
    const idxBefore = (await p.evaluate(() => window.__ff.solveStatus())).idx;
    await p.keyboard.press('ArrowUp');
    const st = await p.evaluate(() => window.__ff.solveStatus());
    expect(st.abort === null, `${jmeno}: a stray key did not break the run (${JSON.stringify(st.abort)})`);
    expect(st.idx >= idxBefore, `${jmeno}: the recording is what drives it`);

    const done = await observed(
      p.waitForFunction(
        () => {
          const s = window.__ff.solveStatus();
          return s.won || s.abort !== null;
        },
        null,
        { timeout: budget(45000) },
      ),
    );
    expect(done, `${jmeno} finished its solution`);

    const end = await p.evaluate(() => window.__ff.solveStatus());
    // The abort detail is the whole value of the mode, so it is what the failure says.
    expect(end.won, `${jmeno} solved itself — ${end.abort ? `${end.abort.reason}: ${end.abort.detail}` : 'no abort'}`);
    expect(end.idx === end.total, `${jmeno} played every move (${end.idx}/${end.total})`);

    // Recorded normally: the srecord built as if the keys had been pressed, so it is the
    // recording, character for character. This is what makes undo/save/load and the move
    // counter behave as in real play.
    const rec = await p.evaluate(() => window.__ff.record());
    expect(rec.length === end.total, `${jmeno} recorded every move it played (${rec.length} of ${end.total})`);

    // Spoke normally: `replaymode` is deliberately silent (loadtype=nej, UMain.pas:1027)
    // and this must not be. PRVNI is the tutorial room, so it has lines to say.
    const spoke = (await p.evaluate(() => window.__ff.lines())) - before;
    if (talks) expect(spoke > 0, `${jmeno} spoke while it played (${spoke} lines) — it must not inherit the replay's silence`);

    // The normal win path runs: the countdown lapses and the map comes back on its own.
    await p.waitForFunction(() => window.__ff.screen() === 'map', null, { timeout: budget(20000) });
    expect((await p.evaluate(() => window.__ff.solvedRooms())).includes(num), `${jmeno} is recorded as solved, like a real win`);
  }
});
