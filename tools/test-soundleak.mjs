/**
 * A room change must not leave the PREVIOUS room's sound playing under the new one.
 *
 * `enterRoom` flips `screen` to 'room' and runs its KillSnd synchronously (Spust,
 * UMain.pas:248), but `loadRoom` then AWAITS the new room's core assets — and until
 * `buildRoom` swaps them in, `room`/`activeScript`/`engine` are still the room the
 * player just left. The render loop kept ticking that outgoing script, which the
 * original cannot do: Spust destroys the room and builds the next one without ever
 * re-entering Jedeme.
 *
 * Any script that re-arms a looping effect on `!playing(p)` then restarted it AFTER
 * the KillSnd that was meant to silence it — and a room change never kills again
 * (buildRoom only re-kills on a RESTART), so the loop simply ran on for the rest of
 * the session. Reported from play as MOTOR's engine (motor.ts:84) droning on in the
 * next room; the same line exists in SMETAK (smetak.ts:204), BARELY (barely.ts:309)
 * and BATYSKAF (batyskaf.ts:108).
 *
 * SMETAK is the deterministic witness: its alarm clock loops `sm-x-tiktak` on
 * priority 940 from the first tick in the room, with no puzzle to solve first. The
 * load window is held open by gating the next room's .ffr, so this does not race the
 * machine — without the fix it fails every time, not one run in ten.
 */
import { selectRoom, withApp } from './ui-lib.mjs';

const SMETAK = 43; // "Real Chaos" — the ticking alarm clock, prior 940
const TIKTAK = 940;
const UTES = 7; // any other room; its .ffr is the one we hold
const KUFRIK = 2; // the briefcase story demo lives here
const PRVNI = 1; // the room entered while the demo's assets are still in flight

await withApp(
  async ({ p, expect }) => {
    await selectRoom(p, SMETAK);
    // The wait is the assertion: the clock loop is armed by SMETAK's own prog().
    await p.waitForFunction((prior) => window.__ff.playingPrior(prior), TIKTAK);

    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map');
    expect(
      !(await p.evaluate((prior) => window.__ff.playingPrior(prior), TIKTAK)),
      'leaving for the map silences the clock (KillSnd)',
    );

    // Hold the next room's core asset so its load spans many logic ticks — the window
    // in which the OUTGOING room was still being simulated.
    let release;
    const held = new Promise((r) => (release = r));
    await p.route(`**/data/Graphic/00${UTES}.ffr`, async (route) => {
      await held;
      await route.continue().catch(() => {});
    });

    await p.evaluate(() => window.__ff.clearSoundLog());
    const before = await p.evaluate(() => ({
      count: window.__ff.count(),
      loops: window.__ff.throttleInfo().loops,
    }));
    const entering = selectRoom(p, UTES);
    await p.waitForFunction(() => window.__ff.roomLoading());
    // Wait on the RENDER loop, not on wall time: `count` staying put only means
    // anything if the loop really ran while it stayed put. A plain sleep would let a
    // starved machine report a frozen clock that was never asked to tick — the one way
    // this probe could pass without exercising the bug.
    const loops0 = await p.evaluate(() => window.__ff.throttleInfo().loops);
    await p.waitForFunction((n) => window.__ff.throttleInfo().loops > n + 30, loops0);

    const mid = await p.evaluate(() => ({
      loading: window.__ff.roomLoading(),
      count: window.__ff.count(),
      loops: window.__ff.throttleInfo().loops,
      sounds: window.__ff.soundLog().map((e) => e.name),
    }));
    expect(mid.loading, 'the .ffr gate held the room load open');
    expect(
      mid.count === before.count,
      `the outgoing room's clock is stopped during the change (count ${before.count} -> ${mid.count} over ${mid.loops - before.loops} loop iterations)`,
    );
    expect(
      mid.sounds.length === 0,
      `no sound starts while the room is being swapped (got ${JSON.stringify(mid.sounds)})`,
    );

    release();
    await entering;
    await p.unroute(`**/data/Graphic/00${UTES}.ffr`).catch(() => {});

    const after = await p.evaluate((prior) => ({
      playing: window.__ff.playingPrior(prior),
      room: window.__ff.roomNum(),
      sounds: window.__ff.soundLog().map((e) => e.name),
    }), TIKTAK);
    expect(
      !after.playing,
      `SMETAK's clock is not sounding in room ${after.room} (log ${JSON.stringify(after.sounds)})`,
    );

    // And the new room is genuinely live and ticking again, so the guard above is a
    // pause for the swap and not a stuck clock.
    const resumed = await p.evaluate(() => window.__ff.count());
    await p.waitForFunction((n) => window.__ff.count() > n, resumed);

    // === The same rule for the other thing that lands late: the KUFRIK cutscene. ===
    //
    // startCutscene() fetches 5.3 MB of story assets (demo.pck alone is 4.9 MB) once
    // per session, and nothing in DoneKufrDemo ever stops the looping 'kufrik' track it
    // starts. Leave the room during that fetch and the demo used to install itself —
    // and its music — over wherever the player went, after showMap()'s KillSnd.
    //
    // The room->room path is the sharp case: `screen` is back on 'room' by then, so
    // only "a room change is in flight" (roomLoading) or "one completed" (roomLoadSeq)
    // can tell this launch it is stale.
    let releaseDemo;
    let sawDemoRequest;
    const demoHeld = new Promise((r) => (releaseDemo = r));
    // Resolved by the route handler, so "the fetch has started" is an event we await
    // rather than a flag we poll.
    const demoRequested = new Promise((r) => (sawDemoRequest = r));
    await p.route('**/data/Intro/demo.pck', async (route) => {
      sawDemoRequest();
      await demoHeld;
      await route.continue().catch(() => {});
    });

    await selectRoom(p, KUFRIK);
    await p.evaluate(() => window.__ff.startCutscene());
    // The wait is the assertion: the story assets really are in flight (they are cached
    // per session, so this is the one launch that can be held).
    await demoRequested;

    await p.evaluate(() => window.__ff.showMap());
    await p.waitForFunction(() => window.__ff.screen() === 'map');

    let releasePrvni;
    const prvniHeld = new Promise((r) => (releasePrvni = r));
    await p.route('**/data/Graphic/001.ffr', async (route) => {
      await prvniHeld;
      await route.continue().catch(() => {});
    });
    const entering2 = selectRoom(p, PRVNI);
    await p.waitForFunction(() => window.__ff.roomLoading());

    releaseDemo(); // the story assets land mid-swap, into a room that is not KUFRIK
    const loopsBefore = await p.evaluate(() => window.__ff.throttleInfo().loops);
    await p.waitForFunction((n) => window.__ff.throttleInfo().loops > n + 30, loopsBefore);

    const demo = await p.evaluate(() => ({
      cutscene: window.__ff.cutsceneActive(),
      music: window.__ff.music(),
    }));
    expect(!demo.cutscene, 'the KUFRIK demo does not install itself over the room being entered');
    expect(demo.music !== 'kufrik', `the demo's music does not start either (music='${demo.music}')`);

    releasePrvni();
    await entering2;
    await p.unroute('**/data/Graphic/001.ffr').catch(() => {});
    await p.unroute('**/data/Intro/demo.pck').catch(() => {});

    const settled = await p.evaluate(() => ({
      cutscene: window.__ff.cutsceneActive(),
      music: window.__ff.music(),
      room: window.__ff.roomNum(),
    }));
    expect(
      !settled.cutscene && settled.music !== 'kufrik',
      `room ${settled.room} is free of the abandoned demo (music='${settled.music}')`,
    );
  },
  // Pin the tier: `ai` would add its own art hold on top of the load window and blur
  // which of the two this probe is exercising.
  { graphics: 'classic' },
);
