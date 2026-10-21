/**
 * UI test: the world-map "record" info panel (krokoměr) shown when an already
 * solved room is clicked, and its Run / Replay / Cancel buttons (UMain.pas:1008/
 * 1364). Verifies: solved rooms open the panel (unsolved launch directly), the
 * best count is read from ff.scores, Cancel closes, Run launches, Replay animates
 * a stored best solution, and a cheat-only room has Replay disabled.
 */
import { waitRoom, withApp } from './ui-lib.mjs';

// Button centres in 640×480 map space (icons at y=222..268; Run 258-, Replay 301-,
// Cancel 344-); Fish-House room 1's node is at KulXY (320,121).
const RUN = [279, 244];
const REPLAY = [322, 244];
const CANCEL = [365, 244];
const ROOM1_NODE = [320, 121];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.hasMap && window.__ff.hasMap());
  const reset = () =>
    p.evaluate(() => {
      ['ff.solved', 'ff.cheated', 'ff.scores', 'ff.best'].forEach((k) => localStorage.removeItem(k));
    });
  await reset();
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(200);
  expect((await p.evaluate(() => window.__ff.screen())) === 'map', 'on the map screen');

  const click = (xy) => p.evaluate(({ x, y }) => window.__ff.clickMap(x, y), { x: xy[0], y: xy[1] });
  const infoRoom = () => p.evaluate(() => window.__ff.mapInfoRoom());
  const screen = () => p.evaluate(() => window.__ff.screen());

  // Unsolved room 1: clicking launches it directly (no panel).
  await click(ROOM1_NODE);
  await waitRoom(p, 0);
  expect((await screen()) === 'room', 'unsolved room launches immediately');
  expect((await infoRoom()) === null, 'no info panel for an unsolved room');

  // Seed a genuine best for room 1 (count 42) and a couple of solved rooms.
  await p.evaluate(() => {
    window.__ff.markSolved(1);
    window.__ff.markBest(1, 'I'.repeat(200)); // best solution (move count 200) + record for Replay
    window.__ff.showMap();
  });
  await p.waitForTimeout(200);
  expect((await screen()) === 'map', 'back on the map');

  // Solved room 1: clicking opens the record panel instead of launching.
  await click(ROOM1_NODE);
  await p.waitForTimeout(120);
  expect((await infoRoom()) === 1, 'clicking a solved room opens the record panel');
  expect((await screen()) === 'map', 'still on the map (panel is modal over it)');
  expect((await p.evaluate(() => window.__ff.scores()['1'])) === 200, 'best count is 200');

  // Cancel closes the panel, staying on the map.
  await click(CANCEL);
  await p.waitForTimeout(80);
  expect((await infoRoom()) === null, 'Cancel closes the panel');
  expect((await screen()) === 'map', 'Cancel returns to the map, no launch');

  // Re-open, then Run launches the room.
  await click(ROOM1_NODE);
  await p.waitForTimeout(80);
  expect((await infoRoom()) === 1, 'panel re-opened');
  await click(RUN);
  await waitRoom(p, 0);
  expect((await screen()) === 'room', 'Run launches the room');
  expect((await p.evaluate(() => window.__ff.replayActive())) === false, 'Run is a normal play (not a replay)');

  // Control: room 1's ruler head (hlava soudce) speaks during normal idle play
  // (per-step 1/50 chance, vitejte1.ts:253) — proves this room DOES talk, so the
  // silent-replay assertion below is meaningful and not vacuously true.
  await p.waitForFunction(() => window.__ff.lines() > 0);
  expect((await p.evaluate(() => window.__ff.lines())) > 0, 'room 1 speaks during normal play');

  // Back to the map; Replay arms the best-solution playback. Both now happen BEHIND the
  // parchment: a launch off the map keeps the map on screen until the room can be drawn
  // (main.ts beginMapLaunch), and replaymode is armed in a .then() after loadRoom resolves,
  // which is inside that window — so `replayActive()` goes true a beat before the room
  // takes the stage. Wait for both.
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(150);
  await click(ROOM1_NODE);
  await p.waitForTimeout(80);
  await click(REPLAY);
  await p.waitForFunction(() => window.__ff.replayActive() && window.__ff.screen() === 'room');
  expect((await screen()) === 'room', 'Replay entered the room');
  expect(await p.evaluate(() => window.__ff.replayActive()), 'Replay armed best-solution playback');
  await p.selectOption('#touchmode', 'on');
  const silentHints = await p.evaluate(() => {
    const line = window.__ff.lastLine();
    const count = window.__ff.lines();
    for (const name of ['1st-v-navod1', 'help2', 'help7', 'help11']) window.__ff.speakLine(name);
    return !document.getElementById('dialogue-gesture-hint') &&
      !document.querySelector('.dialogue-hint-pulse') &&
      !document.getElementById('dialogue-button-arrow') &&
      window.__ff.lastLine() === line && window.__ff.lines() === count;
  });
  expect(silentHints, 'silent replay suppresses tutorial hints and preserves the dialogue debug counters');
  // Playback locks the save slot from both doors: the greyed touch buttons here
  // (buttonAvailability.ts), and the F2/F3 keys (main.ts) after the cadence window below.
  await p.waitForFunction(() => ['12', '13', '24'].every((r) =>
    document.querySelector(`#touchbar [data-region="${r}"]`).getAttribute('aria-disabled') === 'true'));
  expect(true, 'Replay greys the touch Save, Load and Undo');
  await p.selectOption('#touchmode', 'off');

  // A best-solution replay is SILENT, like the original's loadmode replay
  // (loadtype=nej skips Programky + Zvuky_okoli, UMain.pas:1027 / URoom.pas:24937):
  // no scripted dialogue, voices, ambient bubbles, death lines, or idle chatter.
  // The ruler head that spoke during the normal Run above must stay mute here — so
  // lines() must NOT advance across a couple seconds of replay, and no subtitle shows.
  const replayLines0 = await p.evaluate(() => window.__ff.lines());
  const s0 = await p.evaluate(() => ({ c: window.__ff.count(), i: window.__ff.replayIndex(), b: window.__ff.blockedMoves() }));
  await p.waitForTimeout(2200);
  const s1 = await p.evaluate(() => ({ c: window.__ff.count(), i: window.__ff.replayIndex(), b: window.__ff.blockedMoves() }));
  const replayLines1 = await p.evaluate(() => window.__ff.lines());
  expect(replayLines1 === replayLines0, `no dialogue spoken during replay (lines ${replayLines0} -> ${replayLines1})`);
  expect((await p.evaluate(() => window.__ff.subsActive())) === false, 'no subtitle appears during replay');

  // ...and it plays ONE move per tick that STARTED idle, not per tick that merely ended
  // idle. This is the live half of the cadence rule; `advanceReplay`'s `startedIdle`
  // parameter carries the derivation from the Delphi source and why a held key does NOT
  // share it. Asserted as a RATE: every animated move costs at least one animation tick
  // plus its settled tick, so the strict rule never averages under 2 ticks per move. The
  // replay carries `jizda` across the settled tick (`landed`, `replayMode.ts`), so a cell
  // can take 1 to 3 ticks and 2 is the only bound that holds for every move. The loose rule
  // breaks it only once a run has accelerated to 1 tick per cell, so this is the LIVE wiring
  // check (that `logicTick` hands the driver the right flag), not the rule's proof — the
  // rules themselves are pinned in `test/replayMode.test.ts`. A move the engine REFUSES (the
  // fish at the ceiling) animates nothing and costs its one tick under either rule, so those
  // are counted apart.
  //
  // The settled tick is run undrawn, in the landing's frame (`replaySettleDue`), so it
  // still counts here although the player never sees the fish stop.
  //
  // Worth knowing what this cheap assertion stands in for: under the loose cadence the map
  // Replay of WIN #68 killed the big fish at move 142 and GRAL #64 played all 1691 moves
  // without ever winning. Replaying either of those here would be the direct oracle and
  // costs minutes of wall clock, which is why the rate is measured instead — inside a
  // window this probe was already waiting out, so it adds no time at all.
  const movesPlayed = s1.i - s0.i;
  const refused = s1.b - s0.b;
  const ticksElapsed = s1.c - s0.c;
  const minTicks = (movesPlayed - refused) * 2 + refused;
  expect(movesPlayed - refused >= 2, `the replay actually moved a fish during the window (${movesPlayed} moves, ${refused} refused)`);
  expect(
    ticksElapsed >= minTicks,
    `replay plays at most one move per settled tick (${ticksElapsed} ticks / ${movesPlayed} moves, ${refused} refused, min ${minTicks})`,
  );

  // F2/F3 during the same Replay, after the cadence window so its wait cannot shift it.
  // Pressed on a frame where the replay is between moves: `atRest()` is what F2/F3 used
  // to check, and at any other moment the press was refused anyway and proved nothing.
  const slot = await p.evaluate(() => 'ff.save.' + window.__ff.roomNum());
  const slotBefore = await p.evaluate((k) => localStorage.getItem(k), slot);
  const pressedAtRest = await p.evaluate(() => new Promise((resolve) => {
    const key = (code) => window.dispatchEvent(new KeyboardEvent('keydown', { key: code, code, bubbles: true, cancelable: true }));
    const until = performance.now() + 5000;
    const poll = () => {
      if (!window.__ff.replayActive() || performance.now() > until) return resolve(false);
      if (window.__ff.phase() !== 'idle' || window.__ff.loading()) return requestAnimationFrame(poll);
      key('F2');
      key('F3');
      resolve(true);
    };
    poll();
  }));
  await p.waitForTimeout(150);
  expect(pressedAtRest && await p.evaluate(([k, b]) => window.__ff.replayActive() && localStorage.getItem(k) === b &&
    !window.__ff.loading() && !document.getElementById('room-action-badge'), [slot, slotBefore]),
  'and F2/F3 between two replayed moves neither save nor load over it');

  // A cheat-only room (room 2: solved-by-cheat, no genuine record): the panel opens
  // but Replay is disabled (no ff.best.2). Use a fresh room so in-memory best of room 1
  // doesn't leak (clearing localStorage would not clear the live bestRecords map).
  await p.evaluate(() => window.__ff.showMap());
  await p.waitForTimeout(150);
  await p.evaluate(() => window.__ff.openMapInfo(2));
  await p.waitForTimeout(80);
  expect((await infoRoom()) === 2, 'panel opens for a cheat-only room');
  expect((await p.evaluate(() => window.__ff.bestRecord(2))) === null, 'no best record for a cheat-only room');
  await click(REPLAY);
  await p.waitForTimeout(120);
  expect((await infoRoom()) === 2, 'Replay is disabled — the panel stays open, no launch');
  expect((await screen()) === 'map', 'still on the map after a disabled-Replay click');

  // Odometer timing: the roll must advance on wall-clock time (~2.7s = 27×100ms),
  // NOT per paint (which settled in ~0.45s at 60fps). Re-open room 1's panel and
  // sample the faze.
  await click(CANCEL);
  await p.waitForTimeout(60);
  await click(ROOM1_NODE);
  await p.waitForTimeout(120);
  const fazeEarly = await p.evaluate(() => window.__ff.mapInfoFaze());
  expect(fazeEarly < 6, `odometer barely started ~120ms in (faze=${fazeEarly})`);
  await p.waitForTimeout(500); // ~620ms total
  const fazeMid = await p.evaluate(() => window.__ff.mapInfoFaze());
  expect(fazeMid < 20, `odometer not yet settled ~620ms in — would be 27 if per-paint (faze=${fazeMid})`);
  await p.waitForFunction(() => window.__ff.mapInfoFaze() >= 27);
  expect(true, 'odometer settles within ~2.7s');

  // Single language setting: the room-name plaques follow the subtitle language
  // (there is no separate titles language). Switching subtitles switches the plaques.
  await click(CANCEL);
  await p.waitForTimeout(60);
  await p.evaluate(() => window.__ff.panelAction(21)); // subtitles -> English
  await p.waitForFunction(() => window.__ff.deskyLang() === 'en');
  expect((await p.evaluate(() => window.__ff.deskyLang())) === 'en', 'English subtitles -> English plaques');
  await p.evaluate(() => window.__ff.panelAction(20)); // subtitles -> Czech
  await p.waitForFunction(() => window.__ff.deskyLang() === 'cz');
  expect((await p.evaluate(() => window.__ff.deskyLang())) === 'cz', 'Czech subtitles -> Czech plaques');
  await p.evaluate(() => window.__ff.panelAction(22)); // subtitles off -> plaques keep last language
  await p.waitForTimeout(120);
  expect((await p.evaluate(() => window.__ff.deskyLang())) === 'cz', 'subtitles off keeps the last plaque language');

  // --- The open record panel hides the lit map (paths + node balls): Delphi zeroes
  // RTable when InfoMode>0 (UMain.pas:1446), so the base map draws fully unlit and no
  // room balls (Vykul) — only the name plaque + panel stand out. Sample room 1's solved
  // node (above the panel rect): bright with the panel closed, dim base map once open. ---
  await click(CANCEL);
  await p.evaluate(() => { window.__ff.markSolved(1); window.__ff.markSolved(7); window.__ff.setRenderer('cpu'); window.__ff.showMap(); });
  await p.waitForTimeout(400);
  const nodePixel = () =>
    p.evaluate(() => {
      const c = document.querySelector('#screen');
      const d = c.getContext('2d').getImageData(320, 121, 1, 1).data; // room 1's node centre
      return [d[0], d[1], d[2]];
    });
  const nodeClosed = await nodePixel(); // room 1's solved ball is drawn here
  await p.evaluate(() => window.__ff.openMapInfo(7)); // panel for another room (its plaque is elsewhere)
  await p.waitForTimeout(400);
  const nodeOpen = await nodePixel(); // node + lit region gone -> plain unlit base map
  const nodeDiff =
    Math.abs(nodeClosed[0] - nodeOpen[0]) + Math.abs(nodeClosed[1] - nodeOpen[1]) + Math.abs(nodeClosed[2] - nodeOpen[2]);
  expect(nodeDiff > 30, `opening the record panel hides the lit map/node (closed ${nodeClosed} vs open ${nodeOpen}, diff ${nodeDiff})`);
}, { graphics: 'enhanced' });
