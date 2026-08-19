/**
 * UI test: one network blip must not lock a room out of an art tier.
 *
 * The bug this pins, reported from play on v1.0.18: the graphics setting said "AI
 * upscaled" while the room was plainly drawn in enhanced art, switching the tier away and
 * back changed nothing, and only restarting the app fixed it.
 *
 * Both halves of that are now fixed, and both changed shape. A failed load no longer
 * draws the room in the tier below at all — a downgrade the player cannot see and did not
 * choose is the defect, not the mitigation — and it no longer tries to recover in place
 * either: the game stops on its one failure screen, whose only exit is a reload.
 *
 * So what this file owns is the pair. That a blip STOPS the game rather than quietly
 * degrading it, and that the failure is not REMEMBERED — which, with recovery-in-place
 * gone, is now measured the way a player would: reload, and the room is fine. That is a
 * weaker-looking assertion than the old "Try again" one and is actually the same claim,
 * because a remembered failure survives in the module-level caches this bug was about,
 * not on disk.
 *
 * The cause was a cache that remembered a failure it had learned nothing from.
 * `loadAiRoom` caught every error — including a transient `fetch` failure — and resolved
 * `null`, so `ensureAiRoom`'s `pending.catch(() => aiRoomCache.delete(jmeno))` could never
 * fire: the promise did not reject, it fulfilled with null. That null stayed in
 * `aiRoomCache` for the rest of the session, every later entry joined it, and nothing
 * cleared it (setGraphics nulls `aiRoom`, not the cache). `ensureEnhancedArt` had the
 * same shape one tier down, written out explicitly: `catch { enhancedCache.set(jmeno,
 * { art: null, objects: [] }) }`.
 *
 * ── What this probe measures, and what it must not ─────────────────────────────
 * The oracle is `aiRoomLoaded()` / `enhancedLoaded()`, NOT the canvas width. Width is
 * tempting (the ×4 composite is a bigger backing store) and wrong: it varies by room
 * size, so it reads as a tier change when the room changed. That misreading is what sent
 * the first investigation of this bug down the wrong path.
 *
 * Requests are aborted only until the retry budget is spent, and everything after that is
 * served normally — so anything still broken afterwards is the app remembering, not the
 * network. (The single-blip case, which the retry now hides entirely, is
 * `test-asset-retry.mjs`.)
 */
import { budget, reloadApp, waitFrames, withApp } from './ui-lib.mjs';

const SCHODY = 5; // the room the blip hits

/**
 * Fail every request for `glob` until the retry budget is spent, then serve normally.
 *
 * This used to abort exactly ONE request, and that stopped being a repro when
 * `fetchAsset` gained its retry: a single blip is now covered before anything is
 * degraded, so there was nothing left for this probe to recover FROM. That case did not
 * disappear, it moved — `test-asset-retry.mjs` owns it, and asserts the player never
 * sees it.
 *
 * What is left here is the case retry cannot fix: an outage that outlasts the budget.
 * The art really does fail, the room really is drawn one tier down, and the question is
 * whether the app can ever get back — which is what this file has always been about.
 * ATTEMPTS is deliberately budget + 1 so the load fails even if the budget grows by one;
 * everything after is served normally, so anything still broken is the app remembering.
 */
const ATTEMPTS = 4; // the initial request + 2 retries, + 1 of headroom

async function outage(p, glob) {
  let left = ATTEMPTS;
  // ONE room's asset, by name. A wildcard (`**/enhanced-ai/**`) hits whatever the boot
  // room asks for first instead, and the probe then silently tests nothing — which is
  // exactly how this repro was first got wrong.
  await p.route(glob, async (r) => {
    if (left > 0) {
      left--;
      await r.abort('connectionfailed');
    } else {
      await r.continue().catch(() => {});
    }
  });
}

/**
 * Enter a room whose art is expected to FAIL, and wait for the game to say so.
 *
 * Not `selectRoom`, and the reason is the behaviour under test: a failed load holds the
 * art, and `renderLoop`'s `simPaused` stops the clock while the art is held — correctly,
 * since a room must not run its scripts before it can be drawn. So `count` stays 0 and
 * every count-based wait in ui-lib.mjs would sit here until its backstop. The failure
 * screen appearing is the event to wait on.
 */
/**
 * Enter a room through the game, not through the developer dropdown.
 *
 * `selectRoom` drives `#room` in the dev bar, and the failure screen is a MODAL overlay
 * that covers it — correctly, since the player is being asked a question. Playwright's
 * actionability check then waits for a control that is deliberately unreachable, which
 * showed up as this probe passing alone and timing out under load. Nothing about the
 * behaviour under test needs the dropdown.
 */
async function enterRoom(p, num) {
  await p.evaluate((n) => {
    void window.__ff.enterRoomAwait(n).catch(() => {});
  }, num);
  try {
    await p.waitForFunction((n) => window.__ff.roomNum() === n, num, { timeout: budget(15000) });
  } catch (e) {
    // A room entry now fetches its audio as well as its art (roomLoad.ts), so there are
    // more ways for one to stall than there were — and "waitForFunction timed out" says
    // nothing about which. Report the state rather than the timeout.
    const st = await p.evaluate(() => ({
      room: window.__ff.roomNum(),
      screen: window.__ff.screen(),
      loading: window.__ff.roomLoading(),
      art: window.__ff.roomArtPending(),
      audio: window.__ff.roomAudioPending(),
      fatal: window.__ff.fatalShown(),
      msg: window.__ff.fatalText(),
    }));
    throw new Error(`entering room ${num} stalled: ${JSON.stringify(st)} (${e.message.split('\n')[0]})`);
  }
}

async function enterExpectingFailure(p, num) {
  // Not awaited to completion: a failed entry never completes, so the promise is left to
  // reject and the screen is what is waited on.
  await p.evaluate((n) => {
    void window.__ff.enterRoomAwait(n).catch(() => {});
  }, num);
  await p.waitForFunction(() => window.__ff.fatalShown());
  await waitFrames(p, 2);
}

await withApp(
  async ({ p, expect, allowed }) => {
    // === AI tier ===============================================================
    await outage(p, `**/enhanced-ai/SCHODY/ai.json`);
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    await enterExpectingFailure(p, SCHODY);

    expect(
      (await p.evaluate(() => window.__ff.graphics())) === 'ai',
      'the setting still says ai after the blip',
    );
    expect(
      (await p.evaluate(() => window.__ff.aiRoomLoaded())) === false,
      'the blip did cost the room its AI art (the repro is armed)',
    );
    // The player is STOPPED and told, rather than quietly handed the tier below. That is
    // the rule: a failed load is not a downgrade the player did not ask for.
    expect(
      (await p.evaluate(() => window.__ff.fatalShown())) === true,
      'the game stops and says the artwork would not load',
    );
    expect(
      /artwork/i.test(await p.evaluate(() => window.__ff.fatalText())),
      `the message names what failed: "${await p.evaluate(() => window.__ff.fatalText())}"`,
    );
    // ...and it does NOT paint the room underneath in the meantime: the hold stays on, so
    // there is never a frame of the tier below on screen.
    expect(
      (await p.evaluate(() => window.__ff.roomArtPending())) === true,
      'the room is held rather than painted one tier down',
    );

    // ── The cache assertion, made BEFORE any reload ──────────────────────────
    // This is the one that actually pins the original bug, and it has to happen here.
    // `aiRoomCache` / `enhancedCache` are module-scope Maps: a page reload erases them
    // unconditionally, so "fail, reload, it works" would pass identically with the
    // retract-on-failure code deleted — a test that proves the browser can restart, not
    // that the app forgot. So: with the outage over and the SAME page still running, ask
    // for the room again. A cache entry written on failure is still there and would hand
    // back the same empty result.
    //
    // `enterRoomAwait` rather than a click: the fatal screen is opaque and covers the
    // dev bar, correctly — the player is being told the session is over. The hook is not
    // blocked by it, and what is under test is the loader, not the overlay.
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await p.evaluate(() => {
      void window.__ff.enterRoomAwait(5).catch(() => {});
    });
    const forgot = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded(), null, { timeout: budget(15000) })
      .then(() => true, () => false);
    expect(forgot, 'the failure was not remembered: asking again on the SAME page loads the art');

    // Only now the reload, which is what the screen offers the player.
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await reloadApp(p);
    await enterRoom(p, SCHODY);
    const recovered = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded())
      .then(() => true, () => false);
    expect(recovered, 'and a reload — the screen\u2019s only exit — plays the room too');
    expect(
      (await p.evaluate(() => window.__ff.fatalShown())) === false,
      'and the failure screen is gone with it',
    );
    // Re-entering within that same session must not resurrect it — this is the cache
    // assertion proper, made against a page that has NOT been reloaded since the load
    // succeeded. Via the MAP rather than via another room: leaving is what matters (it
    // drops `aiRoom`, so the re-entry has to go back through `aiRoomCache`), and a second
    // room would cost another ~8 MB of art and audio for nothing.
    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map');
    await enterRoom(p, SCHODY);
    const reenterOk = await p
      .waitForFunction((n) => window.__ff.roomNum() === n && window.__ff.aiRoomLoaded(), SCHODY)
      .then(() => true, () => false);
    expect(reenterOk, 're-entering the room keeps the AI art');

    // === Enhanced tier =========================================================
    // Same defect, one tier down, and worth pinning separately: here a blip on a single
    // OBJECT SPRITE rejects out of loadEnhancedObjects and lands in the same catch, so it
    // used to cost the room its background masters too — the whole room fell back to
    // 1998 bitmaps for the session.
    // A fresh page, because the AI half already warmed SCHODY's ENHANCED art: the ai
    // tier loads the enhanced art as well (enhancedArtActive() covers both), so without
    // this the blip route below would never be hit and the probe would assert nothing.
    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await reloadApp(p);
    await outage(p, '**/enhanced/SCHODY/obj/snek_10.png');
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await enterExpectingFailure(p, SCHODY);
    expect(
      (await p.evaluate(() => window.__ff.enhancedLoaded())) === false,
      'one failed OBJECT SPRITE stops the room too (the second repro is armed)',
    );
    expect(
      (await p.evaluate(() => window.__ff.fatalShown())) === true,
      'and the enhanced tier stops rather than dropping to 1998 bitmaps',
    );

    // The map->room LAUNCH is the path a player actually takes, and it behaves
    // differently from the dev-bar entry: the map stays on screen with the parchment
    // over it and `screen` only flips to 'room' once the room can be painted
    // (beginMapLaunch). What is asserted is the thing both routes have in common — the
    // player is not playing this room.
    const midFlight = await p.evaluate(() => ({
      screen: window.__ff.screen(),
      pending: window.__ff.roomArtPending(),
    }));
    expect(
      !(midFlight.screen === 'room' && !midFlight.pending),
      `the player is not in the room (screen=${midFlight.screen}, held=${midFlight.pending})`,
    );

    await p.unrouteAll({ behavior: 'ignoreErrors' });
    await reloadApp(p);
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await enterRoom(p, SCHODY);
    const launched = await p
      .waitForFunction((n) => window.__ff.roomNum() === n && window.__ff.enhancedLoaded(), SCHODY)
      .then(() => true, () => false);
    expect(launched, 'a reload puts the player in the room, sprite and all');

    // The failures were real ones, deliberately provoked — assert they happened rather
    // than merely tolerating them (see withApp's allowErrors).
    expect(
      allowed.some((t) => /ERR_CONNECTION_FAILED|Failed to load resource/.test(t)),
      'the aborted requests were actually seen by the page',
    );
  },
  {
    graphics: 'ai',
    // The aborted fetches Chromium reports for the requests this probe kills on purpose.
    allowErrors: /ERR_CONNECTION_FAILED|Failed to load resource/,
  },
);
