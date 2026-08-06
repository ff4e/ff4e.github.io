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
import { tickSleep, waitRoom, withApp } from './ui-lib.mjs';

const FSIZE = 15;
const HOLD_TICKS = 20; // ~1.6s of GAME time — long enough to climb all three tiers
// Float slop only: dy and dgt are exact functions of the same two engine counters, so
// the measured speeds come out bit-exact (5, 7.5, 15) in practice.
const EPS = 1e-6;
// Two frames drawn at the same game time are only legal if no wall time passed between
// them; this is the gap above which we call the sub-tick clock frozen. rAF frames are
// ~8ms apart at 60Hz and further apart under load, so it never fires on a live clock.
const FROZEN_MS = 4;
// When the jizda speed-up must reach each tier, counted in ticks from the first frame
// of the hold. jizda counts ticks of unobstructed movement and picks 3/2/1 at 0..6 /
// 7..10 / 11+ (URoom.pas:26176-26186), but the tier is LOCKED per cell — so at 3
// ticks/cell the crossing at jizda 7 only takes effect at the cell starting on tick 9,
// and the next cell (2 ticks later, at tick 11) is the first with jizda >= 11. Anchoring
// on the tick axis makes this a check OF the schedule, rather than a restatement of
// whatever cellFrames happens to report.
const TIER_TICKS = { '3->2': 9, '2->1': 11 };

await withApp(async ({ p, expect }) => {
  const key = (type, code) =>
    p.evaluate(({ t, c }) => window.dispatchEvent(new KeyboardEvent(t, { code: c, bubbles: true })), {
      t: type,
      c: code,
    });

  await p.evaluate(() => window.__ff.enterRoomAwait(30)); // RECYCLED — open water
  await waitRoom(p, 0);
  await p.waitForFunction(() => window.__ff.phase() === 'idle');

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

  // The sustained hold is everything from the first frame drawn mid-move to the last:
  // outside it the fish is idle (before the key dispatches, after the key is released).
  const firstMove = log.findIndex((e) => e.ph === 'move');
  const lastMove = log.findLastIndex((e) => e.ph === 'move');
  expect(firstMove >= 0 && lastMove > firstMove, `the hold moved the fish (frames ${log.length})`);
  const span = log.slice(firstMove, lastMove + 1);

  // No stationary frames INSIDE the hold. dispatchHeldMove() re-issues the held key on
  // the same tick a cell completes (main.ts, "no stationary gap between cells"), so a
  // hold flows continuously and an idle frame in the middle is the square-by-square
  // stutter this probe exists to catch. Note this must be checked on the frames rather
  // than folded into the speed bounds below, which only see intervals that are mid-move
  // at BOTH ends and so would step straight over a gap. It is also stricter than the
  // per-frame check it replaces, which tolerated a run of one stationary frame.
  const idleMid = span.filter((e) => e.ph !== 'move').length;
  expect(
    idleMid === 0,
    `no mid-hold stalls — the fish never freezes between cells (${idleMid} idle frames of ${span.length})`,
  );

  // Consecutive frame pairs, in game-time terms.
  const steps = [];
  let sameTime = 0;
  let sameTimeMoved = 0;
  let frozen = 0;
  let worstFrozen = 0;
  for (let i = 1; i < span.length; i++) {
    const a = span[i - 1];
    const b = span[i];
    const dgt = b.n + b.a - (a.n + a.a); // game ticks between the two samples
    const dy = b.y - a.y;
    const dt = b.t - a.t; // wall time, the one clock the game does not derive
    if (dgt <= 0) {
      // Two frames drawn at the same game time. The position is a function of game
      // time, so the fish must not have moved — and, since `alpha` advances with every
      // frame's dt, it must also be that no wall time passed. The second half matters:
      // without it a build that dropped sub-tick interpolation entirely (alpha pinned
      // to 0) would satisfy every speed bound below — each tick advancing exactly one
      // tier step — while the fish visibly teleported cell to cell. Confirmed by
      // mutation: that build passes this probe without this check and fails with it.
      sameTime++;
      if (Math.abs(dy) > EPS) sameTimeMoved++;
      if (dt >= FROZEN_MS) {
        frozen++;
        worstFrozen = Math.max(worstFrozen, dt);
      }
      continue;
    }
    steps.push({
      dgt,
      v: Math.abs(dy) / dgt,
      lo: FSIZE / Math.max(a.cf, b.cf), // slowest tier either end was in
      hi: FSIZE / Math.min(a.cf, b.cf), // fastest tier either end was in
    });
  }
  expect(
    sameTimeMoved === 0,
    `the fish never moves without game time passing (${sameTimeMoved} of ${sameTime} zero-tick frames moved)`,
  );
  expect(
    frozen === 0,
    `the sub-tick interpolation clock advances every frame — the fish glides between ` +
      `ticks rather than jumping on them (${frozen} frames redrawn at the same game time` +
      (worstFrozen ? `, worst ${worstFrozen.toFixed(1)}ms apart` : '') +
      ')',
  );

  const mid = steps;
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
    `no slow intervals — the fish keeps up with its speed tier every tick (${stalls} below bound` +
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

  // ...on the jizda schedule, and not merely at some point during the hold. Measured on
  // the tick axis, so this checks WHEN the speed-up engages rather than trusting
  // whatever cellFrames reported at the time.
  const n0 = span[0].n;
  const tiers = [];
  for (let i = 1; i < span.length; i++) {
    if (span[i].cf !== span[i - 1].cf) tiers.push({ step: `${span[i - 1].cf}->${span[i].cf}`, at: span[i].n - n0 });
  }
  const seen = tiers.map((t) => `${t.step}@tick+${t.at}`).join(' ');
  expect(
    tiers.length === 2 && tiers[0].step === '3->2' && tiers[1].step === '2->1',
    `the speed-up steps 3 -> 2 -> 1 exactly once each (${seen || 'no tier changes'})`,
  );
  expect(
    tiers.length === 2 && tiers[0].at === TIER_TICKS['3->2'] && tiers[1].at === TIER_TICKS['2->1'],
    `each tier engages on its jizda tick (${seen}, expected 3->2@tick+${TIER_TICKS['3->2']} 2->1@tick+${TIER_TICKS['2->1']})`,
  );
});
