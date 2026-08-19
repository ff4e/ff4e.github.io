/**
 * UI test: async room-load hand-off (the `roomLoading` guard).
 *
 * enterRoom() flips screen='room' synchronously but loadRoom() fetches the room's
 * FFR/FFT/FFS asynchronously; until buildRoom() runs, the `room`/`ffr` globals still
 * hold the PREVIOUS room. Two regressions this pins:
 *
 *  1) Stale-room flash (v1.0.4): while the new room's assets are in flight the stage
 *     must be cleared to black, NOT show the previous room's frame (the reported bug
 *     was the boot room UTES flashing for 1-2s on a slow first click).
 *  2) Wedged-black hardening (v1.0.5): if the load THROWS after boot, the guard must
 *     still clear (loadRoom's finally), so the stage recovers to the previous room
 *     rather than staying black forever (the global unhandledrejection recovery only
 *     runs during boot).
 *
 * Oracle: the CPU 2D stage (#screen). In cpu mode the room paints there and the
 * roomLoading branch fills it #000; in WebGL mode the same guard hides #screen-gl
 * instead (line-shared code path, plus the test-gl-* parity suite). We drive a
 * throttled / failed FFR fetch via page routing to open the async window on demand.
 */
import { tickSleep, waitFrames, waitRoom, withApp } from './ui-lib.mjs';

// Fraction of non-black pixels on #screen: ~0 while the stage is cleared black,
// large once a room's tiles are painted. Reads the whole frame once and samples a
// sparse grid so it stays cheap regardless of the backing-store resolution.
const stageFill = (p) =>
  p.evaluate(() => {
    const c = document.querySelector('#screen');
    const g = c.getContext('2d');
    const W = c.width,
      H = c.height;
    const img = g.getImageData(0, 0, W, H).data;
    const px = W * H;
    const step = Math.max(1, Math.floor(px / 4000));
    let nonBlack = 0,
      total = 0;
    for (let i = 0; i < px; i += step) {
      total++;
      const o = i * 4;
      if (img[o] > 16 || img[o + 1] > 16 || img[o + 2] > 16) nonBlack++;
    }
    return nonBlack / total;
  });

const ffrGlob = (n) => `**/Graphic/${String(n).padStart(3, '0')}.ffr`;

await withApp(
  async ({ p, expect }) => {
    await p.waitForFunction(() => window.__ff && typeof window.__ff.enterRoom === 'function');

    // --- Establish a bright, fully-loaded "previous" room (ZDVIZ1, gold). ---
    await p.evaluate(() => window.__ff.enterRoomAwait(20));
    await waitRoom(p, 0);
    await tickSleep(p, 4);
    const prevFill = await stageFill(p);
    expect(prevFill > 0.1, `previous room paints visible content on #screen (fill ${prevFill.toFixed(3)})`);

    // === 1) Stale-room flash: hold room 30's FFR in flight, enter it, sample mid-load. ===
    await p.route(ffrGlob(30), async (r) => {
      await new Promise((x) => setTimeout(x, 2000));
      r.continue();
    });
    await p.evaluate(() => {
      window.__rp = window.__ff.enterRoom(30).then(
        () => 'ok',
        () => 'err',
      );
    });
    // Wait for the loading STATE rather than for a slice of the 2000ms throttle — the
    // condition the sample below depends on is `roomLoading`, so wait on that — and then
    // for the frames that clear the stage, since the sample reads pixels.
    await p.waitForFunction(() => window.__ff.roomLoading()).catch(() => {});
    await waitFrames(p, 3);
    expect((await p.evaluate(() => window.__ff.screen())) === 'room', 'screen switches to room synchronously on enter');
    const loadingFill = await stageFill(p);
    expect(
      loadingFill < 0.02,
      `stage is cleared black while the new room loads — no stale-room flash (fill ${loadingFill.toFixed(3)})`,
    );
    // ...and the black stage is not what the player is looking at: the post-boot
    // loading overlay is armed on room entry and covers it once the wait is real
    // (2000ms here, well past the ~200ms threshold).
    await p.waitForFunction(() => window.__ff.loadingVisible());
    expect(true, 'the loading overlay covers a slow room entry');

    // Let the throttled load finish: the freshly-built room now paints.
    expect((await p.evaluate(() => window.__rp)) === 'ok', 'the throttled room load resolves');
    await waitRoom(p, 0);
    await tickSleep(p, 4);
    const loadedFill = await stageFill(p);
    expect(loadedFill > 0.1, `the newly-loaded room paints once its assets arrive (fill ${loadedFill.toFixed(3)})`);
    expect(!(await p.evaluate(() => window.__ff.loadingVisible())), 'the overlay comes down once the room is presented');
    await p.unroute(ffrGlob(30));

    // === 2) Hardening: a FAILED load must clear the guard (finally), not wedge black. ===
    // Serve room 40's FFR as a 200 with a garbage body so parseFfr() throws inside
    // loadRoom's try (a realistic corrupt/truncated-asset path). A 200 avoids the
    // browser console error a failed resource load would otherwise emit.
    //
    // Held for 2000ms first, so the failure lands with the loading overlay ALREADY UP.
    // Failing immediately would resolve before the 200ms arm and the overlay assertion
    // below would pass without the overlay ever having been shown — i.e. vacuously.
    await p.route(ffrGlob(40), async (r) => {
      await new Promise((x) => setTimeout(x, 2000));
      await r.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'not a valid ffr' }).catch(() => {});
    });
    const failStarted = p.evaluate(() =>
      window.__ff.enterRoom(40).then(
        () => 'ok',
        () => 'err',
      ),
    );
    await p.waitForFunction(() => window.__ff.loadingVisible());
    expect(true, 'the overlay is up while the doomed load is in flight');
    const failRes = await failStarted;
    expect(failRes === 'err', 'a failed room load rejects (loadRoom rethrows after finally)');
    await tickSleep(p, 4);
    const recoveredFill = await stageFill(p);
    expect(
      recoveredFill > 0.1,
      `after a failed load the stage recovers to the previous room, not wedged black (fill ${recoveredFill.toFixed(3)})`,
    );
    // ...and the overlay must not be left up over that recovered frame: loadRoom's
    // finally clears the guard on the failure path too, and the overlay follows it.
    expect(
      !(await p.evaluate(() => window.__ff.loadingVisible())),
      'a failed load dismisses the loading overlay rather than stranding it',
    );
    await p.unroute(ffrGlob(40));
  },
  // The room-entry failure path logs which room failed, now that the screen does not.
  { cpu: true, allowErrors: /asset failed|Failed to fetch|net::ERR|ERR_FAILED|404/ },
);
