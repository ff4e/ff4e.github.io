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
 * back BY DESIGN. So the second half enters a room whose AI art is legitimately absent
 * and asserts it is asked for ONCE — the trap being a retry policy that cannot tell
 * "missing" from "failed" and makes every fallback room pay three requests plus backoff
 * on every entry, for ever.
 *
 * Oracle is `__ff.aiRoomLoaded()` and the request log, never canvas width — width varies
 * by room size and reads as a tier change when the room changed.
 */
import { selectRoom, waitFrames, withApp } from './ui-lib.mjs';

const SCHODY = 5; // has AI art; the room the blip hits
const SCORE = 72; // the one room of the 72 with no AI art at all — the 404 that is correct

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
      (await p.evaluate(() => window.__ff.tierNote())) === 'ok',
      'one blip: no tier note, because nothing ended up degraded',
    );

    // === A room with no AI art is asked ONCE, not four times ===
    urls.length = 0;
    await selectRoom(p, SCORE, 1);
    await p.waitForFunction(() => !window.__ff.roomArtPending()).catch(() => {});
    await waitFrames(p, 30);

    const n = asked('/enhanced-ai/SCORE/ai.json');
    expect(n === 1, `absent art is requested once, not retried (saw ${n})`);
    expect(
      (await p.evaluate(() => window.__ff.aiRoomLoaded())) === false,
      'absent art: SCORE still has none, as it always has',
    );
    expect(
      (await p.evaluate(() => window.__ff.tierNote())) === 'ok',
      'absent art: still no note — permanent, and nothing the player can act on',
    );

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
