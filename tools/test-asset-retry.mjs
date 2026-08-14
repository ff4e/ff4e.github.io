/**
 * UI test: a single network blip is invisible to the player.
 *
 * #66 made a blip RECOVERABLE — the failure is no longer remembered, so re-entering the
 * room or switching the tier gets the art back. This is the next step: the player should
 * not have to do either. The retry inside `fetchAsset` should have covered it before
 * they noticed.
 *
 * The distinction from `test-tier-recovery.mjs` matters, and the two are deliberately
 * both here. That probe aborts a request and asserts the game can RECOVER; this one
 * aborts a request and asserts there was nothing to recover FROM. If the retry were
 * deleted, that probe would still pass.
 *
 * ── The case this must not break ──────────────────────────────────────────────
 * A 404 here is usually correct: no `ai.json` means the room has no AI art and falls
 * back BY DESIGN. So the second half serves a 404 for a room's manifest and asserts it is
 * asked for ONCE — the trap being a retry policy that cannot tell
 * "missing" from "failed" and makes every fallback room pay three requests plus backoff
 * on every entry, for ever.
 *
 * Oracle is `__ff.aiRoomLoaded()` and the request log, never canvas width — width varies
 * by room size and reads as a tier change when the room changed.
 */
import { selectRoom, waitFrames, withApp } from './ui-lib.mjs';

const SCHODY = 5; // has AI art; the room the blip hits
// The room whose AI art is made ABSENT, by answering 404 for its manifest.
//
// This used to be SCORE, which shipped with no AI art at all — until it was staged
// (tools/stage-score.ts) and all 72 rooms had it. Serving the 404 ourselves is the
// better test regardless: it says exactly what is being asserted instead of depending on
// a room happening to lack art, and it cannot rot the next time the tier gains coverage.
const ABSENT = 6; // KOSTE
const ABSENT_NAME = 'KOSTE';

await withApp(
  async ({ p, expect, allowed }) => {
    const urls = [];
    p.on('request', (r) => urls.push(r.url()));
    const asked = (frag) => urls.filter((u) => u.includes(frag)).length;

    // === One blip, then a healthy network: the player sees nothing ===
    // Exactly one request is aborted. Everything after it is served normally, so if the
    // art is missing at the end it is the app failing to retry, not the network.
    let armed = true;
    await p.route('**/enhanced-ai/SCHODY/ai.json', async (r) => {
      if (armed) {
        armed = false;
        await r.abort('connectionfailed');
      } else {
        await r.continue().catch(() => {});
      }
    });

    await selectRoom(p, SCHODY, 1);
    await p.waitForFunction(() => !window.__ff.roomArtPending()).catch(() => {});
    await waitFrames(p, 4);

    expect(armed === false, 'the blip actually fired (the repro is armed)');
    expect(
      await p.evaluate(() => window.__ff.aiRoomLoaded()),
      'one blip: the room has its AI art anyway — the retry covered it',
    );
    // ...and because it was covered, the player was never told anything was wrong.
    expect(
      (await p.evaluate(() => window.__ff.artFailShown())) === false,
      'one blip: the player is never shown a failure screen, because nothing failed',
    );

    // === A room with no AI art is asked ONCE, not four times ===
    // 404 is an ANSWER — "there is nothing here" — and answers are never retried. This is
    // the case a naive retry policy would make every fallback room pay for, on every
    // entry, for ever.
    await p.route(`**/enhanced-ai/${ABSENT_NAME}/ai.json`, (r) => r.fulfill({ status: 404, body: '' }));
    urls.length = 0;
    await selectRoom(p, ABSENT, 1);
    await p.waitForFunction(() => !window.__ff.roomArtPending()).catch(() => {});
    await waitFrames(p, 30);

    const n = asked(`/enhanced-ai/${ABSENT_NAME}/ai.json`);
    expect(n === 1, `absent art is requested once, not retried (saw ${n})`);
    expect(
      (await p.evaluate(() => window.__ff.aiRoomLoaded())) === false,
      `absent art: ${ABSENT_NAME} draws one tier down, as a room with no AI art always has`,
    );
    // THE safety property of the whole design. Absent art is not a failure: the server
    // answered, and the answer was "there is nothing here". Several rooms ship that way
    // — SCORE has no enhanced art, CHODBA and WIN draw a classic background by design,
    // 21 sprites are unstaged — so a failure screen here would appear permanently, in
    // rooms that are working exactly as intended, with a retry that could never help.
    expect(
      (await p.evaluate(() => window.__ff.artFailShown())) === false,
      'absent art: NO failure screen — it falls back silently, as it always has',
    );
    expect(
      (await p.evaluate(() => window.__ff.roomArtPending())) === false,
      'absent art: the room is presented rather than held',
    );

    // === The `classic` tier must never see this screen ===
    // It prefetches the enhanced art to warm the cache for a later tier switch and holds
    // nothing for it, so a failure there is not a failure the player is experiencing:
    // the room renders from bundled FFR data and is completely playable. A modal whose
    // only control is "Try again" would, offline, lock them out of a working game.
    await p.evaluate(() => window.__ff.setGraphics('classic'));
    // Every request killed, not just the first: the point is that a SUSTAINED failure
    // of art this tier does not paint is still invisible to the player.
    await p.route('**/enhanced/ZDVIZ1/**', (r) => r.abort('connectionfailed'));
    await selectRoom(p, 20, 1);
    // Long enough for the retry budget to be SPENT (2 retries, ~250ms + ~1000ms) and the
    // failure to actually land. Asserting sooner passes while the load is merely still
    // in flight — which is how this check first passed against a deliberately broken
    // build, and is worth more than the seconds it costs.
    await p.waitForTimeout(3000);
    expect(
      (await p.evaluate(() => window.__ff.artFailShown())) === false,
      'classic tier: a failed enhanced prefetch shows NO screen — that art is never drawn',
    );
    expect(
      (await p.evaluate(() => window.__ff.roomArtPending())) === false,
      'classic tier: and the room is not held',
    );
    expect(
      (await p.evaluate(() => window.__ff.count())) > 0,
      'classic tier: the room is running normally',
    );
    await p.unroute('**/enhanced/ZDVIZ1/**').catch(() => {});

    // The abort was provoked on purpose; assert it was seen rather than merely tolerated.
    expect(
      allowed.some((t) => /ERR_CONNECTION_FAILED|Failed to load resource/.test(t)),
      'the aborted request was actually seen by the page',
    );
  },
  {
    graphics: 'ai',
    allowErrors: /ERR_CONNECTION_FAILED|Failed to load resource/,
  },
);
