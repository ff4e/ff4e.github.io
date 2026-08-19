/**
 * UI test: a room that cannot be loaded must not hand the player a different one.
 *
 * ── The bug this is the acceptance test for ───────────────────────────────────
 * Reported from play on v1.0.20: on the world map, with the network disabled, clicking a
 * room that had never been visited OPENED A DIFFERENT ROOM — the last one that had been
 * loaded — with no error, no message, and the input live for the wrong room.
 *
 * It was three reasonable decisions combining into a wrong result. `loadRoom` fetched the
 * FFR with a bare `fetch` and threw; `tickMapLaunch` caught that and called
 * `finishMapLaunch`, which sets `screen = 'room'`; and the room state still in memory was
 * the PREVIOUS room's, because `loadRoom` throws before it rebuilds any of it. So the
 * stage was handed to a fully built, fully playable room nobody had asked for.
 *
 * ── Which room, and why it matters ────────────────────────────────────────────
 * **This probe fails ROOM 1 (PRVNI), and proves it has never been fetched first.**
 * That is the point, not decoration: boot loads room 7, so room 7's assets are in the
 * browser's cache from then on, and a probe that failed room 7's FFR could be answered
 * from cache, never issue a request, load happily, and report the bug fixed having
 * exercised nothing. Room 1 is unvisited on a fresh profile — the same condition as the
 * report — and §1 proves no request for it has been made before the route is armed.
 *
 * ── What each section covers ──────────────────────────────────────────────────
 *  1. Nothing has fetched room 1 yet, and room 7 (boot's) is the live room.
 *  2. Network off, enter room 1: the game stops on its failure screen, room 7 is NOT
 *     presented, the wording blames the connection, the launch is disarmed and the frame
 *     loop is still running.
 *  3. A reload with the network back plays the room — the failure was not remembered.
 *  4. The SUBTITLE index alone failing also fails the entry — it used to fall back to an
 *     empty table and play the room through in silence.
 *  5. A 404 is not a blip: it is reported as a problem with the game, not the connection.
 *  6-8. The three audio loaders, each failed separately.
 *  9. …and with the network back, the same room enters and is heard.
 */
import { budget, observed, reloadApp, tickBudget, waitFrames, withApp } from './ui-lib.mjs';

/** Room 1 = PRVNI. Unvisited on a fresh profile, and never fetched by boot. */
const ROOM = 1;
const FFR = '**/data/Graphic/001.ffr';
const FFT = '**/data/Title/001.fft';
/** Boot's own room. Its assets ARE cached, which is exactly why it is not the subject. */
const BOOT_ROOM = 7;

/**
 * Wait until the entry has RESOLVED one way or the other — the failure screen went up, or
 * the screen went to a room. Deliberately not "wait for the failure": against the old behaviour that
 * would time out after 72 seconds and report nothing about the wrong room being shown,
 * which is the finding this probe exists to make. Settle first, assert second.
 */
const settled = (p) =>
  p.waitForFunction(() => window.__ff.fatalShown() || window.__ff.screen() === 'room', null, {
    timeout: budget(6000),
  });

await withApp(
  async ({ p, expect }) => {
    // Installed before a RELOAD rather than before the first boot, because withApp boots
    // the page itself: reloading with the listener attached is what makes §1's "room 1
    // was never asked for" a measurement instead of an assumption.
    const asked = [];
    p.on('request', (r) => asked.push(r.url()));
    await reloadApp(p);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());

    // ── 1. Room 1 is genuinely cold ───────────────────────────────────────────
    expect(
      !asked.some((u) => u.includes('/data/Graphic/001.ffr')),
      'room 1 has never been fetched, so failing it cannot be answered from cache',
    );
    expect(
      (await p.evaluate(() => window.__ff.roomNum())) === BOOT_ROOM,
      `the live room is boot's (${BOOT_ROOM}) — the one that would be wrongly presented`,
    );

    // ── 2. Network off, enter an unvisited room ───────────────────────────────
    // Both of the room's core assets are aborted, which is what "the internet is off"
    // does. `abort('failed')` is a transport failure with no response — the transient
    // side of the taxonomy, and the side that earns a retry button.
    await p.route(FFR, (r) => r.abort('failed'));
    await p.route(FFT, (r) => r.abort('failed'));

    const loopsBefore = await p.evaluate(() => window.__ff.throttleInfo().loops);
    await p.evaluate((n) => {
      // The rejection is expected; swallowed here so the assertions are about the NOTE
      // and not racing an unhandled rejection.
      void window.__ff.enterRoomAwait(n).catch(() => {});
    }, ROOM);

    await settled(p);

    const after = await p.evaluate(() => ({
      screen: window.__ff.screen(),
      room: window.__ff.roomNum(),
      launching: window.__ff.mapLaunching(),
      note: window.__ff.fatalText(),
      loading: window.__ff.roomLoading(),
    }));

    expect(after.screen !== 'room', 'the player is not put into a room');
    // The reported symptom, stated directly. `roomNum()` alone is not enough to catch it:
    // under the old behaviour `curNum` stayed at 7 (loadRoom throws before it advances)
    // while `screen` flipped to `room`, so "the live room is still 7" was TRUE at the
    // exact moment room 7 was being wrongly shown to a player who asked for room 1.
    expect(
      !(after.screen === 'room' && after.room !== ROOM),
      `no room other than the one clicked is presented (screen=${after.screen}, room=${after.room})`,
    );
    expect(after.room === BOOT_ROOM, 'the live room is untouched — a failed entry does not half-replace it');
    expect(after.launching === null, 'the launch is disarmed, so the map is not frozen behind a parchment');
    expect(after.loading === false, 'the room-loading guard is not left stuck on');
    expect(/check your connection/i.test(after.note), `the screen blames the connection: "${after.note}"`);
    expect(/PRVNI/.test(after.note), 'the screen names the room that failed');

    // The frame loop is what the old code's `screen = 'room'` was protecting: letting the
    // exception unwind out of tickMapLaunch stopped it dead (3 iterations in 1.5s against
    // 20). Returning to the map must not cost what taking the stage was buying.
    await waitFrames(p, 4);
    const loopsAfter = await p.evaluate(() => window.__ff.throttleInfo().loops);
    expect(loopsAfter > loopsBefore + 2, `the frame loop is still running (${loopsBefore} -> ${loopsAfter})`);

    // ── 3. The only exit is a reload, and it works ────────────────────────────
    // Also the proof that the failure was not REMEMBERED: the reload refetches the very
    // assets that failed. There is no in-page recovery to test any more — the screen
    // offers a reload and nothing else, deliberately.
    await p.unroute(FFR);
    await p.unroute(FFT);
    await reloadApp(p);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    expect(!(await p.evaluate(() => window.__ff.fatalShown())), 'the reload clears the failure screen');
    await p.evaluate((n) => {
      void window.__ff.enterRoomAwait(n).catch(() => {});
    }, ROOM);
    await p.waitForFunction(
      (n) => window.__ff.screen() === 'room' && window.__ff.roomNum() === n && !window.__ff.roomLoading(),
      ROOM,
      { timeout: tickBudget(60) },
    );
    expect(true, 'the room enters after a reload with the network back');

    // ── 4. The subtitle index alone ───────────────────────────────────────────
    // Room 2 is likewise cold. Only its .fft is failed, and with a 404 rather than an
    // abort — deliberately, because those two take different routes. An abort throws
    // inside `fetchAsset` and would fail the entry whatever this section is trying to
    // prove; a 404 is an ANSWER, which sails through `fetchAsset` and is caught only by
    // the `requireAsset` guard this section exists for. (Checked by mutation: removing
    // that guard leaves the abort version passing and fails this one.)
    //
    // The FFR arrives, so the room COULD be built. It used to be, with an empty subtitle
    // table — the room then plays through in silence with nothing said, which is what
    // this now refuses.
    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    await p.route('**/data/Title/002.fft', (r) => r.fulfill({ status: 404, body: '' }));
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(2).catch(() => {});
    });
    await settled(p);
    const subs = await p.evaluate(() => ({ screen: window.__ff.screen(), room: window.__ff.roomNum() }));
    expect(subs.screen === 'map', 'a room whose subtitles fail does not enter either');
    expect(subs.room !== 2, 'the half-loadable room is not presented');
    await p.unroute('**/data/Title/002.fft');
    await reloadApp(p);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());

    // ── 5. A 404 is an ANSWER, not a blip ─────────────────────────────────────
    await p.route('**/data/Graphic/003.ffr', (r) => r.fulfill({ status: 404, body: '' }));
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(3).catch(() => {});
    });
    await settled(p);
    const gone = await p.evaluate(() => ({ note: window.__ff.fatalText() }));
    expect(
      !/check your connection/i.test(gone.note),
      `a 404 does not send the player to debug their wifi: "${gone.note}"`,
    );
    expect(/missing from the game files/i.test(gone.note), 'a 404 is reported as a problem with the game');
    await p.unroute('**/data/Graphic/003.ffr');
    await reloadApp(p);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());

    // ── 6-8. The audio a room needs is part of loading it ─────────────────────
    // A room used to be shown the moment it could be DRAWN, with its sound still coming;
    // a package that never arrived was never mentioned, so a room could be played through
    // mute with nothing said. Now the entry waits for all of it and fails if any of it is
    // missing — so each of the three is failed separately here, because they are three
    // different loaders and only one of them (the voices) was ever on the room's own path.
    //
    // Each room is chosen COLD and for a distinct track: room 1 cached rybky04 in §3, so a
    // room sharing that track would be a cache hit and would issue no request to fail.
    for (const [label, room, route] of [
      ['voices', 4, '**/data/Sound/004.ffs'], // VRAK
      ['music', 5, '**/data/Music/rybky03.wav'], // SCHODY — rybky03, not yet fetched
      ['leg-final remarks', 19, '**/data/Sound/x01.ffs'], // LODE — depth 15, the only rooms that load x01
    ]) {
      await p.route(route, (r) => r.abort('failed'));
      await p.evaluate((n) => {
        void window.__ff.enterRoomAwait(n).catch(() => {});
      }, room);
      await settled(p);
      const a = await p.evaluate(() => ({
        screen: window.__ff.screen(),
        note: window.__ff.fatalShown(),
        held: window.__ff.roomAudioPending(),
      }));
      expect(a.screen !== 'room', `a room whose ${label} fail does not enter`);
      expect(a.note, `the player is told the ${label} did not load`);
      // A hold that outlives its load is a room that can never be entered again.
      expect(!a.held, `the audio hold is released after the ${label} failure`);
      await p.unroute(route);
      await reloadApp(p);
      await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    }

    // ── 9. …and with the network back, the same room enters and is heard ──────
    // The counterpart that stops 6-8 from passing against a build that simply refuses
    // every room: the retry has to actually complete, audio and all.
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(4).catch(() => {});
    });
    await p.waitForFunction(
      () => window.__ff.screen() === 'room' && window.__ff.roomNum() === 4 && !window.__ff.roomAudioPending(),
      null,
      { timeout: tickBudget(60) },
    );
    expect(true, 'the same room enters normally once its audio can be fetched');
    expect(!(await p.evaluate(() => window.__ff.fatalShown())), 'no failure screen over a room that did load');

    // ── 10. The DIRECT route reports too ──────────────────────────────────────
    // Entering from inside a room (the dev picker, the story-page chain, SCORE/ZAVER, an
    // Escape restart) takes `startRoom(..., takeStage: true)` instead of the map launch,
    // and that route had NO failure handling: the launch's `load.catch` is what reported
    // a failed entry, and it only exists for launches. After boot nothing hijacks
    // unhandled rejections either, so an FFR that failed here left the player on a room
    // screen showing the room they came from — the reported bug, reached by another door.
    // §9 left us in room 4, so this is genuinely the direct route.
    expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'starting from inside a room');
    await p.route('**/data/Graphic/008.ffr', (r) => r.abort('failed'));
    const before10 = await p.evaluate(() => window.__ff.roomNum());
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(8).catch(() => {});
    });
    await p.waitForFunction(() => window.__ff.fatalShown(), null, { timeout: budget(6000) });
    expect(true, 'a failed entry from inside a room reports it too');
    expect(
      (await p.evaluate(() => window.__ff.roomNum())) === before10,
      'and the room the player came from is not passed off as the room they asked for',
    );
    await p.unroute('**/data/Graphic/008.ffr');

    // ── 11. …but a failure for a room nobody is waiting for stays quiet ───────
    // The mirror of §10, and the trap in it: `curNum` keeps naming the last room BUILT, so
    // it still matches after the player has gone back to the map. Deciding the report on
    // `curNum` ends the session over a download nobody is waiting for — a failure screen
    // on the world map, for a room left minutes ago.
    //
    // Two details this section needs, both learned the hard way. The audio is DELAYED
    // before it is failed, so the room builds and the player leaves before it lands — and
    // the delay is paid THREE times, because `fetchAsset` retries a transport failure
    // twice, so the total is ~3x the delay plus backoff. And the entry is the DIRECT one
    // (from inside a room), because leaving a room entered off the map means abandoning a
    // launch that is still armed, and `beginMapLaunch` then ignores the next entry.
    await reloadApp(p);
    await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(10).catch(() => {});
    });
    await p.waitForFunction(
      () => window.__ff.screen() === 'room' && window.__ff.roomNum() === 10 && !window.__ff.roomAudioPending(),
      null,
      { timeout: tickBudget(60) },
    );
    await p.route('**/data/Sound/009.ffs', async (r) => {
      await new Promise((done) => setTimeout(done, 1200));
      await r.abort('failed').catch(() => {});
    });
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(9).catch(() => {});
    });
    // The room BUILDS well before its audio: that is the window this section needs.
    await p.waitForFunction(() => window.__ff.roomNum() === 9, null, { timeout: budget(8000) });
    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map');
    // The hold has to come off even though the report does not: waiting for it IS the
    // assertion that a room the player walked out of cannot wedge every later entry.
    const released = await observed(
      p.waitForFunction(() => !window.__ff.roomAudioPending(), null, { timeout: budget(12000) }),
    );
    expect(released, 'the hold is released even for a room the player has left');
    expect(
      !(await p.evaluate(() => window.__ff.fatalShown())),
      'a failure for a room the player has left does not end the session',
    );
    await p.unroute('**/data/Sound/009.ffs');
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(3).catch(() => {});
    });
    await p.waitForFunction(
      () => window.__ff.screen() === 'room' && window.__ff.roomNum() === 3 && !window.__ff.roomAudioPending(),
      null,
      { timeout: tickBudget(60) },
    );
    expect(true, 'a later room still enters normally after that');
  },
  // The launch logs the failure it is recovering from, which is diagnostics worth keeping:
  // the note tells the player, the console tells whoever reads the bug report. The fetch
  // errors are the provocation itself, surfacing through the browser.
  { graphics: 'classic', allowErrors: /room launch failed|Failed to fetch|net::ERR|ERR_FAILED|404 \(Not Found\)/ },
);
