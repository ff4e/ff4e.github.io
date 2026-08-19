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
 *  2. Network off, enter room 1: still on the MAP, room 7 not presented, note shown,
 *     wording blames the connection, launch disarmed, frame loop still running.
 *  3. Dismiss, a second attempt is accepted, and Try again enters the room for real.
 *  4. The SUBTITLE index alone failing also fails the entry — it used to fall back to an
 *     empty table and play the room through in silence.
 *  5. A 404 is not a blip: different wording, and no retry button, because retrying an
 *     answer cannot help.
 */
import { budget, reloadApp, tickBudget, waitFrames, withApp } from './ui-lib.mjs';

/** Room 1 = PRVNI. Unvisited on a fresh profile, and never fetched by boot. */
const ROOM = 1;
const FFR = '**/data/Graphic/001.ffr';
const FFT = '**/data/Title/001.fft';
/** Boot's own room. Its assets ARE cached, which is exactly why it is not the subject. */
const BOOT_ROOM = 7;

/**
 * Wait until the entry has RESOLVED one way or the other — the note went up, or the screen
 * went to a room. Deliberately not "wait for the note": against the old behaviour that
 * would time out after 72 seconds and report nothing about the wrong room being shown,
 * which is the finding this probe exists to make. Settle first, assert second.
 */
const settled = (p) =>
  p.waitForFunction(() => window.__ff.loadNoteShown() || window.__ff.screen() === 'room', null, {
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
      note: window.__ff.loadNoteText(),
      loading: window.__ff.roomLoading(),
    }));

    expect(after.screen === 'map', 'the player stays on the world map');
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
    expect(/check your connection/i.test(after.note), `the note blames the connection: "${after.note}"`);
    expect(/PRVNI/.test(after.note), 'the note names the room that failed');

    // The frame loop is what the old code's `screen = 'room'` was protecting: letting the
    // exception unwind out of tickMapLaunch stopped it dead (3 iterations in 1.5s against
    // 20). Returning to the map must not cost what taking the stage was buying.
    await waitFrames(p, 4);
    const loopsAfter = await p.evaluate(() => window.__ff.throttleInfo().loops);
    expect(loopsAfter > loopsBefore + 2, `the frame loop is still running (${loopsBefore} -> ${loopsAfter})`);

    // ── 3. Dismiss, retry, and a real entry ───────────────────────────────────
    expect(
      await p.evaluate(() => document.getElementById('load-note-retry')?.hidden === false),
      'a transient failure offers Try again',
    );

    // A second attempt, still offline. This is what shows the map is genuinely USABLE
    // rather than merely painted: the entry has to be accepted, which it is not while the
    // launch is still armed (every input guard reads `mapLaunching()`). The note is
    // dismissed through its own button first, so its return is evidence of the second
    // attempt and not a leftover from the first.
    await p.click('#load-note-x');
    expect(!(await p.evaluate(() => window.__ff.loadNoteShown())), 'Dismiss takes the note down');
    await p.evaluate((n) => {
      void window.__ff.enterRoomAwait(n).catch(() => {});
    }, ROOM);
    await settled(p);
    expect(
      (await p.evaluate(() => window.__ff.screen())) === 'map',
      'a second attempt while still offline is accepted, and still keeps the player on the map',
    );

    await p.unroute(FFR);
    await p.unroute(FFT);
    await p.click('#load-note-retry');
    await p.waitForFunction(
      (n) => window.__ff.screen() === 'room' && window.__ff.roomNum() === n && !window.__ff.roomLoading(),
      ROOM,
      { timeout: tickBudget(40) },
    );
    expect(true, 'Try again enters the room once the network is back');
    expect(!(await p.evaluate(() => window.__ff.loadNoteShown())), 'the note is gone after a successful entry');

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
    await p.click('#load-note-x');

    // ── 5. A 404 is an ANSWER, not a blip ─────────────────────────────────────
    await p.route('**/data/Graphic/003.ffr', (r) => r.fulfill({ status: 404, body: '' }));
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(3).catch(() => {});
    });
    await settled(p);
    const gone = await p.evaluate(() => ({
      note: window.__ff.loadNoteText(),
      retry: document.getElementById('load-note-retry')?.hidden === false,
    }));
    expect(
      !/check your connection/i.test(gone.note),
      `a 404 does not send the player to debug their wifi: "${gone.note}"`,
    );
    expect(/missing from the game files/i.test(gone.note), 'a 404 is reported as a problem with the game');
    expect(!gone.retry, 'a permanent failure offers no Try again, because retrying an answer cannot help');
    await p.unroute('**/data/Graphic/003.ffr');
    await p.click('#load-note-x');

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
      await p.evaluate(() => window.__ff.showMap());
      await p.waitForFunction(() => window.__ff.screen() === 'map' && window.__ff.mapPresented());
      await p.route(route, (r) => r.abort('failed'));
      await p.evaluate((n) => {
        void window.__ff.enterRoomAwait(n).catch(() => {});
      }, room);
      await settled(p);
      const a = await p.evaluate(() => ({
        screen: window.__ff.screen(),
        note: window.__ff.loadNoteShown(),
        held: window.__ff.roomAudioPending(),
      }));
      expect(a.screen === 'map', `a room whose ${label} fail does not enter`);
      expect(a.note, `the player is told the ${label} did not load`);
      // A hold that outlives its load is a room that can never be entered again.
      expect(!a.held, `the audio hold is released after the ${label} failure`);
      await p.unroute(route);
      await p.click('#load-note-x');
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
    expect(!(await p.evaluate(() => window.__ff.loadNoteShown())), 'no note is left over a room that did load');
  },
  // The launch logs the failure it is recovering from, which is diagnostics worth keeping:
  // the note tells the player, the console tells whoever reads the bug report. The fetch
  // errors are the provocation itself, surfacing through the browser.
  { graphics: 'classic', allowErrors: /room launch failed|Failed to fetch|net::ERR|ERR_FAILED|404 \(Not Found\)/ },
);
