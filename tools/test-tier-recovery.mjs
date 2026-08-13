/**
 * UI test: one network blip must not lock a room out of an art tier.
 *
 * The bug this pins, reported from play on v1.0.18: the graphics setting said "AI
 * upscaled" while the room was plainly drawn in enhanced art, switching the tier away and
 * back changed nothing, and only restarting the app fixed it.
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
 * One request is aborted, once, and everything after it is served normally — so anything
 * still broken afterwards is the app remembering, not the network.
 */
import { reloadApp, selectRoom, waitFrames, withApp } from './ui-lib.mjs';

const SCHODY = 5; // the room the blip hits
const OTHER = 6; // a different room, to prove the network is healthy again

/** Abort the FIRST request for `glob`, then serve every later one normally. */
async function blipOnce(p, glob) {
  let armed = true;
  // ONE room's asset, by name. A wildcard (`**/enhanced-ai/**`) hits whatever the boot
  // room asks for first instead, and the probe then silently tests nothing — which is
  // exactly how this repro was first got wrong.
  await p.route(glob, async (r) => {
    if (armed) {
      armed = false;
      await r.abort('connectionfailed');
    } else {
      await r.continue().catch(() => {});
    }
  });
}

/** Wait until the room has finished settling on the tier it will present. */
async function settled(p) {
  await waitFrames(p, 2);
  await p.waitForFunction(() => !window.__ff.roomArtPending()).catch(() => {});
}

await withApp(
  async ({ p, expect, allowed }) => {
    // === AI tier ===============================================================
    await blipOnce(p, `**/enhanced-ai/SCHODY/ai.json`);
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    await selectRoom(p, SCHODY, 1);
    await settled(p);

    expect(
      (await p.evaluate(() => window.__ff.graphics())) === 'ai',
      'the setting still says ai after the blip',
    );
    expect(
      (await p.evaluate(() => window.__ff.aiRoomLoaded())) === false,
      'the blip did cost the room its AI art (the repro is armed)',
    );
    // The player is told, rather than left to wonder why "AI upscaled" looks enhanced.
    // Read through a guard so that on a build without the tell this reports as the
    // missing FEATURE it is, instead of throwing and hiding the assertions below it.
    expect(
      (await p.evaluate(() => (window.__ff.tierNote ? window.__ff.tierNote() : 'no-such-hook'))) === 'failed',
      'the app knows the drawn tier is not the selected one',
    );
    expect(
      (await p.evaluate(() => (window.__ff.tierNoteVisible ? window.__ff.tierNoteVisible() : false))) === true,
      'and says so on screen (the #tier-note toast)',
    );

    // Switching the tier away and back is the first thing a player tries. Before the
    // fix it did nothing at all, because the poisoned entry outlived it.
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await waitFrames(p, 2);
    await p.evaluate(() => window.__ff.setGraphics('ai'));
    const backOk = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded())
      .then(() => true, () => false);
    expect(backOk, 'switching the tier away and back recovers the AI art');
    expect(
      (await p.evaluate(() => (window.__ff.tierNoteVisible ? window.__ff.tierNoteVisible() : false))) === false,
      'and the note goes away once the art is up',
    );

    // Re-entering the room is the other thing a player tries, and the one that has to
    // work even for a player who never touches the setting.
    await selectRoom(p, OTHER, 1);
    await selectRoom(p, SCHODY, 1);
    const reenterOk = await p
      .waitForFunction(() => window.__ff.aiRoomLoaded())
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
    await blipOnce(p, '**/enhanced/SCHODY/obj/snek_10.png');
    await p.evaluate(() => window.__ff.setGraphics('enhanced'));
    await selectRoom(p, SCHODY, 1);
    await settled(p);
    expect(
      (await p.evaluate(() => window.__ff.enhancedLoaded())) === false,
      'the blip did cost the room its enhanced art too (the second repro is armed)',
    );

    await selectRoom(p, OTHER, 1);
    await selectRoom(p, SCHODY, 1);
    const enhOk = await p
      .waitForFunction(() => window.__ff.enhancedLoaded())
      .then(() => true, () => false);
    expect(enhOk, 're-entering the room recovers the enhanced art');

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
