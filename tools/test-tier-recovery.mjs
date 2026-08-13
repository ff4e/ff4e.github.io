/**
 * UI test: one network blip must not lock a room out of an art tier.
 *
 * The bug this pins, reported from play on v1.0.18: the graphics setting said "AI
 * upscaled" while the room was plainly drawn in enhanced art, switching the tier away and
 * back changed nothing, and only restarting the app fixed it.
 *
 * Both halves of that are now fixed, and the FIRST half changed shape: the room is no
 * longer drawn in the tier below at all. A failed load stops and asks, because a
 * downgrade the player cannot see and did not choose is the defect, not the mitigation.
 * What this file still owns is the second half — that the failure is not REMEMBERED, so
 * the retry paths genuinely work.
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
import { reloadApp, waitFrames, withApp } from './ui-lib.mjs';

const SCHODY = 5; // the room the blip hits
const OTHER = 6; // a different room, to prove the network is healthy again

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
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction((n) => window.__ff.roomNum() === n, num);
}

async function enterExpectingFailure(p, num) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await p.waitForFunction(() => window.__ff.artFailShown());
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
    // The player is STOPPED and asked, rather than quietly handed the tier below. That
    // is the rule: a failed load is not a downgrade the player did not ask for.
    expect(
      (await p.evaluate(() => (window.__ff.artFailShown ? window.__ff.artFailShown() : false))) === true,
      'the game stops and says the artwork would not load',
    );
    expect(
      (await p.evaluate(() => (window.__ff.artFailTitle ? window.__ff.artFailTitle() : ''))).includes('graphics'),
      'the message is about the room graphics',
    );
    // ...and it does NOT paint the room underneath in the meantime: the hold stays on,
    // so the first frame after a successful retry is the art that was asked for.
    expect(
      (await p.evaluate(() => window.__ff.roomArtPending())) === true,
      'the room is held rather than painted one tier down',
    );

    // The button the screen actually offers. Everything else here is a path a player
    // might stumble onto; this is the one the game TELLS them to take, so it is the one
    // that most has to work.
    await p.click('#art-fail-retry');
    const retriedOk = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded() && !window.__ff.artFailShown())
      .then(() => true, () => false);
    expect(retriedOk, '“Try again” loads the art and takes the screen down');
    // ...and the room, which was paused behind the screen, is running again.
    const ranOn = await p.waitForFunction(() => window.__ff.count() > 0).then(() => true, () => false);
    expect(ranOn, 'the room starts running once its art is up');

    // Switching the tier away and back is the other thing a player tries. Before the
    // fix it did nothing at all, because the poisoned entry outlived it.
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await waitFrames(p, 2);
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    const backOk = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded())
      .then(() => true, () => false);
    expect(backOk, 'switching the tier away and back recovers the AI art');
    expect(
      (await p.evaluate(() => (window.__ff.artFailShown ? window.__ff.artFailShown() : true))) === false,
      'and the failure screen goes away once the art is up',
    );

    // Re-entering the room is the other thing a player tries, and the one that has to
    // work even for a player who never touches the setting.
    await enterRoom(p, OTHER);
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
      (await p.evaluate(() => window.__ff.artFailShown())) === true,
      'and the enhanced tier asks rather than dropping to 1998 bitmaps',
    );

    // The map->room LAUNCH is the path a player actually takes, and it behaves
    // differently from the dev-bar entry: the map stays on screen with the parchment
    // over it and `screen` only flips to 'room' once the room can be painted
    // (beginMapLaunch). A held room therefore leaves the launch mid-flight — so the
    // question is whether the retry finishes it, or strands the player on the map.
    // Route-independent, deliberately: entering from the MAP keeps `screen` on 'map'
    // with the parchment over it until the room can be painted (beginMapLaunch), while
    // the dev-bar route takes the stage immediately. Which one ran depends on where the
    // player was, so what is asserted is the thing both have in common — the player is
    // not playing this room yet.
    const midFlight = await p.evaluate(() => ({
      screen: window.__ff.screen(),
      pending: window.__ff.roomArtPending(),
    }));
    expect(
      !(midFlight.screen === 'room' && !midFlight.pending),
      `the player is not in the room yet (screen=${midFlight.screen}, held=${midFlight.pending})`,
    );
    await p.click('#art-fail-retry');
    const launched = await p
      .waitForFunction((n) => window.__ff.screen() === 'room' && window.__ff.roomNum() === n && window.__ff.enhancedLoaded(), SCHODY)
      .then(() => true, () => false);
    // This also proves the failure was not remembered: the retry refetches the very
    // sprite that failed, and an `enhancedCache` entry written on failure would have
    // handed back the empty result instead.
    expect(launched, '“Try again” finishes the launch and puts the player in the room');

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
