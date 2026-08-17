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
 * fast. What is chosen instead is one room per SHAPE, and nothing that merely repeats a
 * shape already covered (DELA #47, the corpus's shortest, was dropped for exactly that
 * reason once WIN joined — "it is quick" is not coverage):
 *
 *   PRVNI #1  — the tutorial room, which TALKS: the case that proves this mode is not
 *               silent the way the player-facing replay deliberately is.
 *   WIN   #68 — the bonus level (794 moves): the only room with a SECOND control set
 *               (`w`/`x`/`y`/`z`, the elderly pair) and the only `gspec=5`. Its bonus opens
 *               from a POSITIONAL trigger inside `prog`, which makes it the one room that
 *               notices if a move is played on a tick that had not yet given `prog` an
 *               at-rest pass: the fish arrives one cell past the trigger column and is
 *               crushed. It failed at move 143/794 while the other three passed.
 *   LODE  #19 — a gspec=9 PUSH-OUT room (533 moves), and the reason this list is not two
 *               rooms long. Eight rooms win by shoving an item off the edge with the fish
 *               still inside, so `room.won` (both fish outside) is never true and the win
 *               lands several ticks AFTER the final recorded move. Review caught the
 *               driver reading `room.won` and calling `exhausted` on the first idle tick;
 *               LODE failed and the three fish-exit rooms above all passed, which is
 *               exactly why one of them is now in the gate.
 *
 * The replay is run at a speed multiplier, which shortens the logic tick rather than
 * skipping ticks: every 80 ms step still happens, in order. That is what keeps this
 * honest — it is the same run, only compressed.
 */
import { budget, observed, withApp } from './ui-lib.mjs';

/**
 * The multiplier the two non-dialogue rooms are watched at. It does NOT skip ticks or
 * batch moves — it shortens the logic tick, so every move still plays through the real
 * loop, in order, with the script running.
 *
 * The effective ceiling is the frame rate, not this number: `MAX_STEPS_PER_FRAME` is 1, so
 * at 60 fps the sim tops out around 4.8x whatever is asked for. 20 simply means "as fast
 * as the frame rate allows".
 */
const SPEED = 20;

const ROOMS = [
  // PRVNI runs at REAL speed, and that is the point of it. Above 1 the logic tick shortens
  // while WebAudio stays on the wall clock, so the dialogue is SCHEDULED faster than it can
  // be spoken — `lines()` would still count up and prove only that `scriptTalk` ran. At
  // speed 1 the count means what the assertion says it means. It costs ~4 s: 54 moves.
  { num: 1, jmeno: 'PRVNI', talks: true, speed: 1 },
  { num: 19, jmeno: 'LODE', talks: false, speed: SPEED },
  { num: 68, jmeno: 'WIN', talks: false, speed: SPEED },
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  // The button and the __ff hook are both armed only while the dev pane is enabled.
  await p.evaluate(() => localStorage.setItem('ff.devEnabled', '1'));
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());

  for (const { num, jmeno, talks, speed } of ROOMS) {
    await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
    // `roomNum()` flips early and `phase()` reads the OUTGOING engine, so both can be true
    // while `room` is still the previous room — which, after the room before this one won,
    // is a room with `won === true`, and the button then correctly refuses to start. Wait
    // for the new room to actually be built and unwon, the same shape `test-legimage.mjs`
    // uses, or this races and blames the driver for the probe's own impatience.
    await p.waitForFunction(
      `window.__ff.roomNum() === ${num} && window.__ff.screen() === 'room'` +
        ` && window.__ff.count() > 0 && !window.__ff.state().won`,
    );
    await p.waitForFunction(() => window.__ff.phase() === 'idle');

    const before = await p.evaluate(() => window.__ff.lines());
    // Drive it through the dev-bar BUTTON, not the hook, so the wiring is what is asserted.
    await p.click('#solveroom');
    const armed = await p.evaluate(() => window.__ff.solveStatus());
    const why = await p.evaluate(() => document.getElementById('solveroom').title);
    expect(armed.running, `${jmeno} started playing its solution (button says: ${why})`);
    expect(armed.total > 0, `${jmeno} has moves to play (${armed.total})`);
    expect(!(await p.evaluate(() => window.__ff.replayActive())), `${jmeno} is NOT the map replay — that one is silent`);
    if (speed > 1) await p.evaluate((s) => window.__ff.solveSetSpeed(s), speed);

    // The player is locked out while it plays: a fish key must not reach the room. The
    // move INDEX cannot witness that — it only ever goes up, so `idx >= before` is true
    // whether the lockout works or not. The move RECORD can: a key that got through would
    // append a move nothing in the recording asked for, so the record would end up longer
    // than the moves played. That equality is checked at the end of the run, and this is
    // the same claim taken at its most fragile moment.
    // Both numbers in ONE evaluate: the sim runs between round-trips (and fast, with the
    // per-frame cap lifted), so two separate reads are not a snapshot of the same tick and
    // the comparison drifts by however many moves landed in between.
    const snap = () => p.evaluate(() => ({ rec: window.__ff.moves(), idx: window.__ff.solveStatus().idx }));
    const preKeys = await snap();
    await p.keyboard.press('ArrowUp');
    await p.keyboard.press('ArrowDown');
    const postKeys = await snap();
    const st = await p.evaluate(() => window.__ff.solveStatus());
    expect(st.abort === null, `${jmeno}: a stray key did not break the run (${JSON.stringify(st.abort)})`);
    // Every accepted recorded move appends exactly one counted character, so these deltas
    // are equal unless a key got through and added a move of its own.
    expect(
      postKeys.rec - preKeys.rec === postKeys.idx - preKeys.idx,
      `${jmeno}: two stray keys added no moves of their own (record +${postKeys.rec - preKeys.rec}, recording +${postKeys.idx - preKeys.idx})`,
    );

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

    // Recorded normally: the srecord built as if the keys had been pressed. Compare MOVE
    // COUNTS, not string lengths — `srecord` is not the same alphabet as the recording
    // (IJKL/WASD, `record.ts`) and the engine appends consequence markers the move counter
    // skips: a `q`+3-digit marker per item pushed out of a gspec=9 room. LODE's record is
    // 537 characters for 533 moves, and reading that as a mismatch is a false alarm.
    // `__ff.moves()` is `lengthOfRecord`, which is what the player's move counter shows.
    const recMoves = await p.evaluate(() => window.__ff.moves());
    expect(recMoves === end.total, `${jmeno} recorded every move it played (${recMoves} of ${end.total})`);

    // Spoke normally: `replaymode` is deliberately silent (loadtype=nej, UMain.pas:1027)
    // and this must not be. PRVNI is the tutorial room, so it has lines to say.
    const spoke = (await p.evaluate(() => window.__ff.lines())) - before;
    if (talks) expect(spoke > 0, `${jmeno} spoke while it played (${spoke} lines) — it must not inherit the replay's silence`);

    // The normal win path runs and hands the screen on by itself. Which screen depends on
    // the room: a leg-final room reveals its story page first and only then the map, which
    // is exactly what a real solve does — so accept either and dismiss the page if it came,
    // rather than pinning a room's position in the game's structure into this probe.
    await p.waitForFunction(
      () => window.__ff.screen() === 'map' || window.__ff.screen() === 'legimage',
      null,
      { timeout: budget(20000) },
    );
    if ((await p.evaluate(() => window.__ff.screen())) === 'legimage') {
      await p.keyboard.press('Escape');
    }
    await p.waitForFunction(() => window.__ff.screen() === 'map', null, { timeout: budget(15000) });
    expect((await p.evaluate(() => window.__ff.solvedRooms())).includes(num), `${jmeno} is recorded as solved, like a real win`);
  }
});
