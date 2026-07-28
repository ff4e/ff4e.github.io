/**
 * UI test: movement smoothness. Holding a direction must glide the fish continuously —
 * no stationary stalls between cells, no position jumps at the acceleration tier changes.
 * Uses the render-position harness (__ff.smoothOn()/smoothLog()), which records the
 * active fish's interpolated on-screen position every rendered frame.
 *
 * ── Why this measures GAME time, not frames ───────────────────────────────────
 * This probe used to assert on the displacement in each RENDERED frame ("< half a
 * cell"). That is a statement about the machine, not the game: `loop()` runs at most
 * one logic step per frame and drops any backlog, so a loaded machine delivers fewer
 * frames, each covering more game ticks, and the per-frame delta grows — a false
 * "teleport" (observed: 8.80px, 13.48px and 18.77px against a 7.50px bound, on runs
 * where nothing was wrong with the game). Being in the runner's EXCLUSIVE lane did not
 * fix it: that guarantees no other PROBE, not a quiet machine.
 *
 * The samples carry their own game-time coordinate (`n` + `a` = count + alpha), and the
 * rendered position is by construction a function of exactly that — `slide =
 * (animFrame + alpha) / cellFrames`. So dividing displacement by the game time between
 * two samples yields the fish's speed in px per game TICK, which is invariant under
 * frame drops. And that speed is not merely bounded, it is KNOWN: it must equal
 * FSIZE / cellFrames, the tier the engine locked in for the cell in flight
 * (jizda 0..6 -> 3, 7..10 -> 2, 11+ -> 1 ticks/cell).
 *
 * So we assert the exact thing instead of a proxy, which is both load-independent and
 * much tighter than the bound it replaces: at the top tier it allows 15px per game
 * tick where "half a cell per rendered frame" allowed ~36px per game tick at 60fps,
 * and at the bottom tier 5px against that same ~36. A stall and a teleport become the
 * two sides of one assertion.
 */
import { waitRoom, withApp, tickSleep } from './ui-lib.mjs';

const FSIZE = 15;
const HOLD_TICKS = 20; // ~1.6s of GAME time — long enough to climb all three tiers
// Float slop only: dy and dgt are exact functions of the same two engine counters, so
// the measured speeds come out bit-exact (5, 7.5, 15) in practice.
const EPS = 1e-6;

await withApp(async ({ p, expect }) => {
  const key = (type, code) =>
    p.evaluate(({ t, c }) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })), {
      t: type,
      c: code,
    });

  await p.evaluate(() => window.__ff.enterRoomAwait(30)); // RECYCLED — open water
  await waitRoom(p, 0);
  await p.waitForFunction(() => window.__ff.phase() === 'idle', { timeout: 5000 });

  // Still worth a quiet page: anything streaming or decoding (enhanced art, audio)
  // costs rendered frames, and while a dropped frame no longer breaks the assertions
  // it does cost SAMPLES. The room load itself is awaited above; this waits for
  // whatever the boot left in flight. (The harness deliberately no longer boots via
  // `networkidle`, which used to provide this incidentally for all the probes at a
  // cost none of the others needed to pay.)
  await p.waitForLoadState('networkidle');

  await p.evaluate(() => window.__ff.smoothOn());
  await key('keydown', 'KeyK'); // down through open water
  await tickSleep(p, HOLD_TICKS);
  await key('keyup', 'KeyK');
  await tickSleep(p, 4);

  const log = await p.evaluate(() => window.__ff.smoothLog());

  // Consecutive frame pairs, in game-time terms.
  const steps = [];
  let sameTime = 0;
  let sameTimeMoved = 0;
  for (let i = 1; i < log.length; i++) {
    const a = log[i - 1];
    const b = log[i];
    const dgt = b.n + b.a - (a.n + a.a); // game ticks between the two samples
    const dy = b.y - a.y;
    if (dgt <= 0) {
      // Two frames drawn at the same game time. The position is a function of game
      // time, so this is only legal if the fish did not move.
      sameTime++;
      if (Math.abs(dy) > EPS) sameTimeMoved++;
      continue;
    }
    steps.push({
      dgt,
      v: Math.abs(dy) / dgt,
      lo: FSIZE / Math.max(a.cf, b.cf), // slowest tier either end was in
      hi: FSIZE / Math.min(a.cf, b.cf), // fastest tier either end was in
      moving: a.ph === 'move' && b.ph === 'move',
    });
  }
  expect(
    sameTimeMoved === 0,
    `the fish never moves without game time passing (${sameTimeMoved} of ${sameTime} zero-tick frames moved)`,
  );

  // Assess only the sustained hold: both ends of the interval mid-move, so the partial
  // intervals in which a move starts or ends are excluded (their average speed is
  // legitimately below the tier's).
  const mid = steps.filter((s) => s.moving);
  const heldTicks = mid.reduce((s, x) => s + x.dgt, 0);
  // One logic step per frame at most, so there is at least one sample per game tick
  // however loaded the machine is — this floor is not a frame-rate assumption.
  expect(mid.length >= 15, `sustained-hold intervals (${mid.length})`);
  expect(
    heldTicks >= HOLD_TICKS * 0.6,
    `the sustained hold covers real game time (${heldTicks.toFixed(1)} of ${HOLD_TICKS} ticks)`,
  );

  // The one invariant, both directions. Below the tier speed is a stall (the fish
  // freezing between cells); above it is a teleport (a jump at a tier change).
  let slowest = Infinity;
  let fastest = 0;
  let stalls = 0;
  let jumps = 0;
  let worstStall = null;
  let worstJump = null;
  for (const s of mid) {
    if (s.v < s.lo - EPS) {
      stalls++;
      if (!worstStall || s.v < worstStall.v) worstStall = s;
    }
    if (s.v > s.hi + EPS) {
      jumps++;
      if (!worstJump || s.v > worstJump.v) worstJump = s;
    }
    slowest = Math.min(slowest, s.v);
    fastest = Math.max(fastest, s.v);
  }
  expect(
    stalls === 0,
    `no mid-hold stalls — the fish keeps up with its speed tier every tick (${stalls} slow intervals` +
      (worstStall ? `, worst ${worstStall.v.toFixed(2)} < ${worstStall.lo.toFixed(2)} px/tick` : '') +
      ')',
  );
  expect(
    jumps === 0,
    `no teleport jumps — the fish never outruns its speed tier (${jumps} fast intervals` +
      (worstJump ? `, worst ${worstJump.v.toFixed(2)} > ${worstJump.hi.toFixed(2)} px/tick` : '') +
      ')',
  );

  // And the hold really does accelerate through the tiers: 5 -> 7.5 -> 15 px/tick.
  expect(
    Math.abs(slowest - FSIZE / 3) < EPS,
    `the hold starts at the slow tier (${slowest.toFixed(2)} px/tick, expected ${(FSIZE / 3).toFixed(2)})`,
  );
  expect(
    Math.abs(fastest - FSIZE) < EPS,
    `and reaches the top tier (${fastest.toFixed(2)} px/tick, expected ${FSIZE})`,
  );
});
