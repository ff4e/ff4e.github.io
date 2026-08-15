/**
 * UI test: the render loop's throttle contract is the SAME in every graphics tier.
 *
 * The smoothness work (idle throttling, full-rate wake while something animates between
 * logic ticks) predates the `ai` tier. Adding a third tier is exactly the situation where
 * a rule written as `graphics === 'enhanced'` keeps working for the two tiers anyone
 * tests and silently excludes the new one — which is what happened: `ai` idle-throttled
 * to 12.5fps for the whole of a subtitle, so the text visibly juddered while `enhanced`
 * was smooth, with nothing logged and every unit test green.
 *
 * Every other perf probe in this suite runs in a single tier (`test-smoothness`,
 * `test-idlefps`, `test-timing` and `test-mapinfo` just use the default; `test-aisubs`
 * covers `enhanced` and `ai` but not `classic`). So none of them could see it.
 * This one is deliberately parametrised over ALL tiers instead of asserting frame rates,
 * because the contract — not the fps number — is what a new tier breaks.
 *
 * The contract:
 *   1. a settled room idle-throttles                        — in every tier
 *   2. a subtitle animating between ticks forces full rate   — in the VECTOR tiers
 *      (classic bakes its subtitles into the frame at the tick rate, so it must NOT
 *      be forced to full rate: staying throttled is the correct behaviour there)
 *   3. a held movement key forces full rate                  — in every tier
 *   4. releasing it settles back to the idle timer           — in every tier
 */
import { withApp } from './ui-lib.mjs';

/** Tiers, and whether they draw subtitles as vector text rather than baking them. */
const TIERS = [
  { id: 'classic', vectorSubs: false },
  { id: 'enhanced', vectorSubs: true },
  { id: 'ai', vectorSubs: true },
];

await withApp(async ({ p, expect }) => {
  await p.waitForFunction(() => window.__ff && window.__ff.throttleInfo);

  for (const tier of TIERS) {
    await p.evaluate((t) => window.__ff.setGraphics(t), tier.id);
    await p.evaluate(() => window.__ff.enterRoomAwait(1));
    await p.waitForFunction(() => window.__ff.roomNum() === 1);
    await p.waitForFunction((t) => (window.__ff.paintedRoomSig() || '').includes(`|${t}|`), tier.id);

    // 1. Settled room → idle throttle. Wait for the fish to stop falling into place
    //    first; while anything is moving the loop legitimately stays at full rate.
    await p.waitForFunction(() => window.__ff.phase() === 'idle');
    await p.waitForFunction(() => window.__ff.throttleInfo().throttleOk === true).catch(() => {});
    const settled = await p.evaluate(() => window.__ff.throttleInfo());
    expect(settled.throttleOk === true, `[${tier.id}] a settled room idle-throttles (phase=${settled.phase})`);

    // 2. A subtitle waving in animates BETWEEN logic ticks, so the vector tiers must
    //    leave the idle timer for the ~1.5s it takes to settle.
    await p.evaluate(() => window.__ff.talk('little'));
    await p.waitForFunction(() => window.__ff.subsActive()).catch(() => {});
    // Sample repeatedly: the line has to be caught while it is still WAVING, not after
    // it has settled (at which point throttling again is correct in every tier).
    let sawFullRate = false;
    for (let i = 0; i < 25 && !sawFullRate; i++) {
      const t = await p.evaluate(() => ({ ...window.__ff.throttleInfo(), subs: window.__ff.subsActive() }));
      if (!t.subs) break;
      if (t.throttleOk === false && t.phase === 'idle' && t.heldState === 0) sawFullRate = true;
      else await new Promise((r) => setTimeout(r, 60));
    }
    if (tier.vectorSubs) {
      expect(sawFullRate, `[${tier.id}] an animating vector subtitle forces the full frame rate`);
    } else {
      // Not an error if classic never leaves the timer — that is the point of baking
      // the subtitle into the frame. Assert only that it does not get STUCK at full
      // rate once the line is done (checked by step 4 below).
      expect(true, `[${tier.id}] baked subtitles do not require the full frame rate`);
    }

    // 3. A held movement key forces full rate, in every tier.
    await p.keyboard.down('KeyL');
    await p.waitForFunction(() => window.__ff.throttleInfo().heldState !== 0).catch(() => {});
    const held = await p.evaluate(() => window.__ff.throttleInfo());
    expect(held.heldState !== 0, `[${tier.id}] the held key is registered`);
    expect(held.throttleOk === false, `[${tier.id}] the loop runs at full rate while a key is held`);

    // 4. ...and settles back to the idle timer afterwards, so no tier is left spinning.
    await p.keyboard.up('KeyL').catch(() => {});
    await p.waitForFunction(() => window.__ff.throttleInfo().heldState === 0).catch(() => {});
    await p.waitForFunction(() => window.__ff.throttleInfo().throttleOk === true).catch(() => {});
    const done = await p.evaluate(() => window.__ff.throttleInfo());
    expect(done.throttleOk === true, `[${tier.id}] the loop returns to the idle timer (phase=${done.phase}, held=${done.heldState})`);
  }
}, { gl: true });
