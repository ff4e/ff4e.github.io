/**
 * LODE's falling wreck in the `ai` tier — the frame this tier used to hand back.
 *
 * Until now `aiRoomGateAllows` withheld every frame in which the ship was destroying the
 * background, so room 19 visibly dropped from ×4 to native mid-fall. `AiRoom.syncWreck`
 * replays the recorded swaps into a mutable ×S copy of the background instead. This probe
 * pins that at the only place it can be observed end to end: a real browser, mid-fall.
 *
 * Four things are asserted, in this order, and the order matters — each covers a way the
 * previous one could pass while the feature was broken. Checks 2 and 3 are then repeated a
 * few ticks later, because a replay that mutated the art once and then froze would satisfy
 * all four:
 *
 *  1. The gate is gone: mid-fall the tier still composites, `roomGeom().upscale` stays 4
 *     and the room paints on the GPU. (Pre-change this reads 1.)
 *  2. The ×S ART ACTUALLY CHANGED — `aiWreckDigest()` reports swaps replayed and a moving
 *     background hash. Without this, 1 and 3 would both pass on a pristine background:
 *     the tier would stay at ×4 and simply never show the wreck.
 *  3. CPU↔GPU parity MID-FALL. This is the only check that catches a stale GPU texture:
 *     `GlAiScreen` caches by source object, and a canvas mutated in place keeps its
 *     identity, so without a revision check the GPU renders the undamaged room while
 *     canvas-2D — which re-reads the canvas — looks perfectly correct.
 *  4. Re-entering the room resets the art. `AiRoom` is cached by room name across entries
 *     (LRU 3) while the `Room` is rebuilt, so a wrecked background would otherwise be
 *     waiting for the player when they come back.
 *
 * Note what is NOT the oracle here: AI-CPU vs AI-GPU alone would report agreement for any
 * bug the two share, since both replay through the same functions. The replay's pixel rule
 * is pinned against the FAITHFUL renderer in test/lode-wreck.test.ts, byte-exact. And the
 * enhanced-tier comparison below validates the two REPLAYS against each other — both read
 * the same recorded history, so it cannot say anything about the recording itself.
 *
 * Runs its own ANGLE browser for WebGL2; skips (pass) where WebGL2 is unavailable.
 */
import { exitProbe, gotoApp, launchBrowser, waitRoom, waitTicks } from './ui-lib.mjs';

const MAX_CHANNEL_DELTA = 1; // same gate and same reason as test-gl-room-ai.mjs

const b = await launchBrowser({ gl: true });
const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PE:' + e.message));
p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
await p.addInitScript(() => {
  try {
    const o = JSON.parse(localStorage.getItem('ff.options') || '{}');
    o.introSeen = true;
    localStorage.setItem('ff.options', JSON.stringify(o));
    localStorage.setItem('ff.graphics', 'ai');
    localStorage.setItem('ff.renderer', 'webgl');
  } catch {}
});
await gotoApp(p);
await p.waitForFunction(() => window.__ff && window.__ff.count);

let ok = true;
const expect = (cond, msg) => {
  if (!cond) ok = false;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

async function enterLode() {
  await p.evaluate(() => window.__ff.enterRoomAwait(19));
  await waitRoom(p, 0);
  await p.waitForFunction(() => window.__ff.roomArtPending() === false, { timeout: 30000 });
  await p.waitForFunction(() => window.__ff.aiRoomLoaded(), { timeout: 30000 });
}

await enterLode();

const cap = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  exitProbe(0);
}

// At rest the tier composites and has replayed nothing.
expect(await p.evaluate(() => window.__ff.aiRoomActive()), 'at rest: the ai tier composites LODE');
expect(await p.evaluate(() => window.__ff.aiWreckDigest()) === null, 'at rest: no ×S wreck art allocated');

// ── mid-fall ────────────────────────────────────────────────────────────────
// Phase 3, not 0: the five KresliLod ship sprites differ in art AND size (195x127 down
// to 106x77), and dropping the first one everywhere would let a replay that ignored
// `swap.phase` pass every check in this file.
await p.evaluate(() => window.__ff.dropShip(3));
await p.waitForFunction(() => window.__ff.wreckState().changed > 0, { timeout: 15000 });
const startCount = await p.evaluate(() => window.__ff.count());
await waitTicks(p, startCount, 4); // several ticks in: the sprite has eroded, not just landed

const mid = await p.evaluate(() => ({
  wreck: window.__ff.wreckState(),
  aiActive: window.__ff.aiRoomActive(),
  upscale: window.__ff.roomGeom()?.upscale ?? 0,
  backend: window.__ff.roomBackend(),
  digest: window.__ff.aiWreckDigest(),
  enhDamage: window.__ff.enhWreckDamage(),
}));

// 1. the gate is gone
expect(mid.wreck.phase !== -1 && mid.wreck.changed > 0, `mid-fall: the ship is destroying the background (${mid.wreck.changed} px)`);
expect(mid.aiActive === true, 'mid-fall: the ai tier still composites the frame');
expect(mid.upscale === 4, `mid-fall: the room stays at ×4 (upscale=${mid.upscale})`);
expect(mid.backend === 'webgl', `mid-fall: painted on the GPU (backend=${mid.backend})`);

// 2. the ×S art actually moved, and moved exactly where the ENHANCED tier's does
expect(mid.digest !== null, 'mid-fall: a mutable ×S background exists');
expect((mid.digest?.replayed ?? 0) > 0, `mid-fall: ${mid.digest?.replayed} swaps replayed into it`);
expect((mid.digest?.revision ?? 0) > 0, 'mid-fall: the background carries a cache revision');
// The oracle: EnhancedArtSource replays the SAME recorded history into native truecolor
// art through an implementation that predates this one and knows nothing about ×S. On the
// real shipped art their damage footprints must be the same native rectangle. This is the
// check a CPU↔GPU diff cannot be — both AI backends share one replay.
expect(mid.enhDamage !== null, 'mid-fall: the enhanced tier reports a damage footprint');
// The BOX is geometry — where the ship is and how far it has fallen — so it must match
// exactly; only the cell COUNT is art-dependent (see below).
const box = (d) => (d ? `${d.x},${d.y} ${d.w}x${d.h}` : 'null');
expect(
  box(mid.digest?.damage) === box(mid.enhDamage),
  `mid-fall: ×S damage box ${box(mid.digest?.damage)} matches enhanced ${box(mid.enhDamage)}`,
);
// `cells` is what makes that comparison mean something. A bounding box on its own is far
// too coarse: a replay that erodes the ship wrongly, or applies a tick's two swaps in the
// wrong order, changes very different pixels inside an IDENTICAL box. Counting the
// distinct native cells that differ catches both, and counting CELLS rather than pixels is
// what makes an ×4 replay comparable with a native one at all.
//
// It is a tolerance, not an equality, and deliberately so — do not "tighten" this to ===.
// The two tiers replay the same history into DIFFERENT art: where a swap writes a ship
// colour that the native truecolor background already had, nothing changes and the cell is
// not counted, while the ×4 upscale of those same two pixels can still differ slightly (or
// the reverse). Measured on the shipped art that is a handful of cells in a few thousand
// (~0.1%). The bugs this is here to catch are not subtle by comparison: a broken sprite
// erosion or a reversed batch moves the count by 20-25%.
const aiCells = mid.digest?.damage?.cells ?? 0;
const enhCells = mid.enhDamage?.cells ?? 0;
const cellDrift = enhCells > 0 ? Math.abs(aiCells - enhCells) / enhCells : 1;
expect(aiCells > 100, `mid-fall: the damage is substantial (${aiCells} native cells)`);
expect(
  cellDrift < 0.02,
  `mid-fall: ×S changed ${aiCells} native cells vs the enhanced replay's ${enhCells} ` +
    `(${(cellDrift * 100).toFixed(2)}% drift, tolerance 2%)`,
);

// 3. CPU↔GPU parity, mid-fall — the stale-texture check.
//
//    In STILL WATER, for the same reason tools/test-gl-room-ai.mjs is: the `ai` tier
//    samples the water wobble at ×S on the GPU and at 1998's quantization on canvas-2D,
//    so a wobbling room's BACKGROUND legitimately differs between the two backends —
//    and LODE wobbles (wamp=5 wper=20 wspd=3). Forcing `wamp = 0` for the comparison is
//    what keeps this check as sharp as it was rather than widening MAX_CHANNEL_DELTA
//    past the very asymmetry it exists to catch. It costs this probe nothing: the wreck
//    damage is in the ART, which the override does not touch — a stale GPU texture shows
//    up in still water exactly as it did before.
const par = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
expect(par && par.webgl && !par.noCanvas && !par.dimMismatch, 'mid-fall: parity comparison ran');
if (par && par.max !== undefined) {
  expect(
    par.max <= MAX_CHANNEL_DELTA,
    `mid-fall CPU↔GPU max=${par.max} overPct=${(par.overPct ?? 0).toFixed(4)}% ` +
      `worst at ${JSON.stringify(par.worstAt)} cpu=${JSON.stringify(par.worstCpu)} gpu=${JSON.stringify(par.worstGpu)}`,
  );
}

// ...and the art keeps moving as the ship keeps falling (a one-shot mutation that then
// froze would still satisfy everything above).
await waitTicks(p, await p.evaluate(() => window.__ff.count()), 6);
const later = await p.evaluate(() => window.__ff.aiWreckDigest());
expect(later !== null && later.replayed > mid.digest.replayed, 'the replay keeps up with the fall');
expect(later !== null && later.hash !== mid.digest.hash, 'the ×S background keeps changing as it does');
const par2 = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
if (par2 && par2.max !== undefined) {
  expect(par2.max <= MAX_CHANNEL_DELTA, `later mid-fall CPU↔GPU max=${par2.max}`);
}

// 4. re-entry resets the art
await p.evaluate(() => window.__ff.enterRoomAwait(1));
await waitRoom(p, 0);
await enterLode();
const after = await p.evaluate(() => ({
  digest: window.__ff.aiWreckDigest(),
  swaps: window.__ff.wreckState()?.swaps ?? -1,
}));
expect(after.swaps === 0, `re-entry: the room's swap history is empty again (${after.swaps})`);
// Assert the PIXELS, not the cursor. `replayed === 0` only says the counter was reset, so
// it passes even when the canvas still holds the previous fall's damage — which is exactly
// the bug this check exists to catch, since an AiRoom outlives the Room that wrecked it.
expect(
  after.digest === null || after.digest.damage === null,
  `re-entry: the cached AiRoom's ×S background is pristine (damage=${JSON.stringify(after.digest?.damage)})`,
);
expect(
  after.digest === null || after.digest.replayed === 0,
  `re-entry: and its replay cursor was rewound (replayed=${after.digest?.replayed})`,
);

if (errs.length) {
  ok = false;
  console.log('  console errors:', errs);
}
await b.close().catch(() => {});
console.log(ok ? 'PASS' : 'FAIL');
exitProbe(ok ? 0 : 1);
