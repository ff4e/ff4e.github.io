/**
 * `ai`-tier CPU↔GPU room parity, plus the guard that the tier reaches the GPU at all.
 *
 * The AI tier composites at ×S from staged hi-res art, through the SAME room walk
 * (AiRoom.drawInto) on both backends: canvas-2D (Canvas2dAiTarget, the oracle and the
 * no-WebGL2 fallback) and GlAiScreen. This probe renders both for every room and diffs
 * them, exactly as test-gl-room.mjs does for the classic tier.
 *
 * ── Why the comparison is made in STILL WATER ────────────────────────────────
 * The `ai` tier evaluates the water wobble at ×S on the GPU (per scaled row, at a
 * fractional shift, at the sub-tick time) while the canvas-2D fallback keeps the
 * faithful 1998 sampling — so in 70 of the 72 rooms the BACKGROUND legitimately differs
 * between the two backends and cannot be byte-compared. Widening the tolerance to
 * absorb that would throw away the net for everything else in the same motion, so
 * instead the sweep asks for `stillWater`: `wamp = 0` for the duration of the
 * comparison puts both backends on the identical unshifted fetch, and items, fish,
 * mirror, rope, wreck, dissolve, the wall composite and the classic-sprite fallback are
 * held to exactly the gate they always were. Rooms 46 and 66 have `wamp === 0` in the
 * data, so they are compared WITHOUT the override and prove the override is not what is
 * producing the match. Step 6 then covers the wobble itself, which this cannot.
 *
 * ── The gate, and why it is not max === 0 ─────────────────────────────────────
 * The classic/enhanced oracle (RgbaScreen) is pure JS with rounding this repo defines,
 * so those probes can demand byte-equality. This oracle is the BROWSER's canvas-2D
 * `drawImage`, which blends in premultiplied space with rounding no specification pins
 * down, against GL's own blend. A ±1 disagreement on an anti-aliased sprite edge is
 * therefore expected and is not a defect.
 *
 * Measured across all 71 AI-art rooms on this build: 70 rooms are byte-exact (max = 0)
 * and one (room 9) differs by 1 on a single channel of a single pixel. So the gate is
 * simply max ≤ 1 — and that IS the whole gate. An earlier revision also tested
 * `overPct > 0` (the share of channels off by more than 2), which sounds stricter and is
 * unreachable: nothing can exceed 2 once the maximum is 1. It was removed rather than
 * left in to look thorough.
 *
 * The bug this gate was written against is worth recording: the staged art was being
 * decoded to PREMULTIPLIED ImageBitmaps, the GPU multiplied by alpha again, and every
 * anti-aliased edge darkened toward the background — max = 64, but only 0.004 % of
 * pixels, so a "the average looks fine" gate would have shipped it.
 *
 * Runs its own headless Chromium with ANGLE so WebGL2 is available; if the environment
 * has no WebGL2 it skips (pass), so CI without a GPU still passes.
 */
import { exitProbe, gotoApp, launchBrowser, waitRoom } from './ui-lib.mjs';

const MAX_CHANNEL_DELTA = 1; // see the header: browser-vs-GL blend rounding, nothing more

/**
 * Which rooms to compare.
 *
 * The full 72-room sweep costs what it costs because every room must DECODE its ×4 art
 * (~50 MB) before it can be compared, and each comparison then moves two ~20 MB frames
 * through readPixels/getImageData. Measured against `main` on the same machine, running
 * it by default nearly doubled the whole UI suite's CPU: 1140s user vs 592s. That gate's
 * value is that it is cheap enough to run on every change (and PR #6 deliberately made it
 * load-INDEPENDENT), so making it twice as expensive to re-prove a property that does not
 * vary per room is a bad trade.
 *
 * What DOES vary per room is which primitives the compositor reaches and how big the
 * buffer is, so the default set covers every primitive at least once plus both size
 * extremes — named, so the list can be checked rather than trusted:
 *
 *    1 PRVNI     the canonical room: wobbling background + wall
 *    3           the room the present-alignment and cost checks below use
 *    9 ZRC       the spec=1 mirror (chroma-key glass mask, ping-pong pass) — and the ONLY
 *                room in the game with any CPU↔GPU delta at all (1 on one channel)
 *   19 LODE      the wreck: spec=11 hidden items, and the mutable ×S background the
 *                falling ship destroys (AiRoom.syncWreck) — this room is the only one
 *                whose art changes under the texture cache
 *   20 ZDVIZ1    spec=3/4 elevator double rope
 *   28 ZDVIZ2    the same rope with different endpoints (it leans)
 *   33 MIKRO     small backing store (1440x840)
 *   39 NOGROUND  small, square backing store (1140x1140)
 *   42           largest backing store in the game (3180x2340)
 *   56 CHODBA    gspec=2 darkness: full-canvas fill + lit-item-only visibility
 *   66           gspec=42 ZX — withheld from this tier, so it checks the GATE holds
 *   67           second-largest backing store (3120x2220)
 *   68 WIN       gspec=5 young/old fish swap + items with no AI art (classic ×S fallback)
 *   72 SCORE     ships no AI art at all
 *
 * `FF_AI_ROOMS=all` runs all 72. That is what produced the "70 of 71 byte-exact" figure
 * in the header, and it is what to run when the compositor itself changes — as opposed
 * to when something around it does.
 */
const DEFAULT_ROOMS = [1, 3, 9, 19, 20, 28, 33, 39, 42, 56, 66, 67, 68, 72];
const FULL = process.env.FF_AI_ROOMS === 'all';
const ROOM_LIST = FULL ? Array.from({ length: 72 }, (_, i) => i + 1) : DEFAULT_ROOMS;

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
    // This probe is about the ai tier specifically, and about it running on the GPU.
    localStorage.setItem('ff.graphics', 'ai');
    localStorage.setItem('ff.renderer', 'webgl');
  } catch {}
});
await gotoApp(p);

/**
 * Wait until the room is built AND its AI art has landed (the tier holds the frame).
 *
 * Deliberately does NOT wait for the room to settle. The sibling GL probes wait 15 logic
 * ticks before comparing, and copying that here cost 1.2s x 72 rooms = ~86s of pure
 * sleeping — most of this probe's runtime, in a suite whose whole design is a ~3min gate
 * that stays load-INDEPENDENT. It buys nothing for a parity comparison: both backends are
 * driven from the same `room` object inside one evaluate, with the frame state passed in
 * explicitly (fixed fish frames and slide), so whatever the fish happen to be doing, the
 * two sides see it identically. Measured: 141s -> ~35s, with the same 72 rooms compared.
 */
async function enter(num) {
  await p.evaluate((n) => window.__ff.enterRoomAwait(n), num);
  await waitRoom(p, 0);
  await p.waitForFunction(() => window.__ff.roomArtPending() === false);
}

let ok = true;
let tested = 0, noArt = 0, worstMax = 0, worstRoom = 0, exact = 0;
const cpuRooms = [];

await enter(3);
const cap = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
if (!cap || cap.webgl === false) {
  console.log('  SKIP: WebGL2 not available in this environment');
  console.log('PASS');
  await b.close();
  exitProbe(0);
}

for (const num of ROOM_LIST) {
  try {
    await enter(num);
    // 1. The regression this whole path exists for: with renderer=webgl and the art
    //    loaded, the DEFAULT tier must actually paint on the GPU. It used to report
    //    `webgl` while canvas-2D did the painting, in 70 of these 72 rooms.
    const live = await p.evaluate(() => ({
      aiLoaded: window.__ff.aiRoomLoaded(),
      aiActive: window.__ff.aiRoomActive(),
      backend: window.__ff.roomBackend(),
      glActive: window.__ff.glActive(),
    }));
    if (live.aiActive && live.backend !== 'webgl') {
      ok = false;
      cpuRooms.push(num);
      console.log(`  FAIL room ${num}: ai frame painted on ${live.backend}, not the GPU`);
    }
    if (live.aiActive && live.glActive !== (live.backend === 'webgl')) {
      ok = false;
      console.log(`  FAIL room ${num}: glActive()=${live.glActive} contradicts backend=${live.backend}`);
    }

    // 2. CPU↔GPU pixel parity of the ×S composite. A room with no staged AI art has
    //    nothing for this tier to composite (room 72) — it renders through the normal
    //    compositor, which test-gl-room covers.
    if (!live.aiLoaded) { noArt++; continue; }
    const r = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
    if (!r) { ok = false; console.log(`  FAIL room ${num}: no parity result`); continue; }
    if (!r.webgl) { ok = false; console.log(`  FAIL room ${num}: WebGL vanished mid-run`); continue; }
    if (r.noCanvas) { ok = false; console.log(`  FAIL room ${num}: no 2D oracle context`); continue; }
    if (r.dimMismatch) { ok = false; console.log(`  FAIL room ${num}: dim mismatch`); continue; }
    tested++;
    if (r.max === 0) exact++;
    if (r.max > worstMax) { worstMax = r.max; worstRoom = num; }
    if (r.max > MAX_CHANNEL_DELTA) {
      ok = false;
      console.log(
        `  FAIL room ${num}: max=${r.max} overPct=${r.overPct.toFixed(4)}% rmse=${r.rmse.toFixed(3)} ` +
          `worst at ${JSON.stringify(r.worstAt)} cpu=${JSON.stringify(r.worstCpu)} gpu=${JSON.stringify(r.worstGpu)}`,
      );
    }
  } catch (e) {
    ok = false;
    console.log(`  FAIL room ${num}: ${String(e).slice(0, 80)}`);
  }
}

// 3. The room's on-screen geometry must not depend on which backend painted it. The
//    GPU path leaves #screen at NATIVE size (nothing paints into it) while the
//    canvas-2D path sizes it to the ×S backing store; both must still present the same
//    CSS box, or toggling R would nudge the room and everything stacked over it.
try {
  await enter(3);
  const boxes = {};
  for (const mode of ['webgl', 'cpu']) {
    await p.evaluate((m) => window.__ff.setRenderer(m), mode);
    await p.waitForTimeout(300);
    boxes[mode] = await p.evaluate(() => {
      const r = (id) => {
        const e = document.getElementById(id);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.width * 100), Math.round(b.height * 100)];
      };
      return { screen: r('screen'), panel: r('panel') };
    });
  }
  await p.evaluate(() => window.__ff.setRenderer('webgl'));
  if (JSON.stringify(boxes.webgl) !== JSON.stringify(boxes.cpu)) {
    ok = false;
    console.log(`  FAIL layout: webgl=${JSON.stringify(boxes.webgl)} cpu=${JSON.stringify(boxes.cpu)}`);
  }
} catch (e) {
  ok = false;
  console.log(`  FAIL layout: ${String(e).slice(0, 80)}`);
}

// 4. The dissolving skeleton (KresliK's RANDPOLE dither) is the one primitive no
//    resting frame reaches — it needs a crushed fish. Its erosion pattern is a
//    per-original-pixel threshold, so a scale or row/column transposition in the shader
//    is a subtly different pattern the room sweep above cannot see at all.
//
//    Sampled repeatedly as `rozpad` counts down rather than once right after the kill:
//    it starts clamped at 255, where almost every pixel survives and almost any wrong
//    predicate still looks plausible. Walking it through mid-erosion is where a
//    transposition actually shows, and sampling on a schedule (rather than waiting for
//    one exact value) keeps that independent of how loaded the machine is.
//
//    NOTE this only proves the two AI BACKENDS agree. That they agree with the FAITHFUL
//    renderer is pinned in test/roomAi.test.ts, which imports `dissolveKeeps` and
//    compares it against RgbaScreen.blitDisintegrate — the check this probe structurally
//    cannot make, and the one that catches a rule broken identically on both backends.
try {
  await enter(1);
  await p.evaluate(() => window.__ff.killFish('little'));
  let samples = 0;
  let worst = 0;
  for (let i = 0; i < 10; i++) {
    await p.waitForTimeout(120);
    const d = await p.evaluate(() => window.__ff.aiGlParity({ stillWater: true }));
    if (!d || !d.webgl || d.dimMismatch) continue;
    samples++;
    if (d.max > worst) worst = d.max;
    if (d.max > MAX_CHANNEL_DELTA) {
      ok = false;
      console.log(`  FAIL dissolve sample ${i}: max=${d.max} worst at ${JSON.stringify(d.worstAt)}`);
    }
  }
  if (samples === 0) { ok = false; console.log('  FAIL dissolve: no samples taken'); }
  else console.log(`  dissolving skeleton: ${samples} samples across the erosion, worstMax=${worst}`);
} catch (e) {
  ok = false;
  console.log(`  FAIL dissolve: ${String(e).slice(0, 80)}`);
}

// 5. The PRESENT pass. Everything above compares offscreen composites; this is the only
//    check on the pass that actually puts pixels on the screen. It is an ALIGNMENT test,
//    not a pixel one — the GPU box-downsamples and canvas-2D leans on the browser's own
//    minification filter, so they legitimately differ. What cannot legitimately differ is
//    orientation: the identity must score better than the frame flipped or shifted
//    against itself. A wrong Y flip, viewport or footprint fails that; a different filter
//    does not.
try {
  await enter(3);
  const q = await p.evaluate(() => window.__ff.aiPresentCheck());
  if (!q || !q.webgl) {
    ok = false;
    console.log('  FAIL present: no result');
  } else if (q.unsupported || q.noCanvas) {
    ok = false;
    console.log(`  FAIL present: ${q.unsupported ? 'GPU could not size the buffer' : 'no 2D reference context'}`);
  } else {
    const rivals = { flipY: q.flipY, flipX: q.flipX, shiftX: q.shiftX, shiftY: q.shiftY };
    const beaten = Object.entries(rivals).filter(([, v]) => !(q.identity < v));
    // A featureless reference would tie against every rival, so identity winning would
    // prove nothing; require the frame to have real contrast first.
    if (!(q.spread > 4)) {
      ok = false;
      console.log(`  FAIL present: reference frame is featureless (spread ${q.spread.toFixed(2)})`);
    }
    if (beaten.length) {
      ok = false;
      console.log(
        `  FAIL present: identity ${q.identity.toFixed(2)} does not beat ` +
          beaten.map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', '),
      );
    } else {
      console.log(
        `  present alignment ${q.w}x${q.h}: identity ${q.identity.toFixed(2)} vs ` +
          `flipY ${q.flipY.toFixed(2)} flipX ${q.flipX.toFixed(2)} shiftX ${q.shiftX.toFixed(2)} shiftY ${q.shiftY.toFixed(2)}`,
      );
    }
  }
} catch (e) {
  ok = false;
  console.log(`  FAIL present: ${String(e).slice(0, 80)}`);
}


// 6. The water wobble itself — the one thing step 2 deliberately switched off.
//
//    Three questions, none of which a CPU↔GPU comparison can answer any more, and none
//    of which a screenshot can answer at all:
//
//    a) is the GPU drawing the RIGHT curve? Scored against an independent JS
//       reimplementation of BG_FS built from the SOURCE art (`oracleMax`). Compare
//       against the wamp=0 room's score to see the floor: ~1.4/255 comes from the
//       un-premultiply round-trip of reading the wall art back out of a 2D canvas, not
//       from the wobble.
//    b) is it actually the SMOOTH one? `bandedMax` scores the same frame against the
//       faithful banded expectation and must be LARGE — this is the negative control
//       that fails loudly if the shader ever regresses to a per-native-row lookup.
//    c) is it smooth in the PIXELS, with no reference image at all? A banded integer
//       shift makes every output row an exact integer translation of its source row
//       (`exactRows` = 1) with the same estimated shift across all 4 rows of a native
//       band (`bandsVarying` = 0). Both must move decisively off those values.
//
//    Run over the SAME room list as the parity sweep above, not just one room. That
//    matters because step 2 now compares the two backends in still water, so a wobbling
//    background is no longer exercised per-room by anything else — the edge clamp, the
//    interpolation and the ripple term all depend on the room's own art, wall
//    transparency and dimensions. Checking one room would leave 69 unchecked. It is
//    affordable because `aiWobbleCheck` composites the BACKGROUND ONLY and reads it back
//    once, and rooms that do not wobble (46, and 66 which is out of tier) act as the
//    control: they must still read exactly like the old banded world (exactRows 1,
//    bandsVarying 0).
//
//    These three are mutation-checked by tools/mutate-gl-room-ai.mjs, which breaks BG_FS
//    seven ways (centring, interpolation, shift direction, a regression to the 1998
//    sampling, and three on the ripple term) and asserts this step goes red for each. A
//    gate nobody has tried to defeat is a gate nobody knows the strength of.
/**
 * Score one room's water. Returns the probe result, or null if it could not run.
 *
 * The wait for the ripple train is on GAME TICKS, not wall-clock: a train is born at
 * zero height and fades in, so scoring at birth would exercise the shader's ripple term
 * with all-zero inputs and prove nothing — and a fixed `waitForTimeout` delivers a
 * different number of ticks on a loaded machine, which is how a probe like this starts
 * flaking under CI load rather than under a real fault.
 */
async function wobbleAt(num) {
  await enter(num);
  // A room with no staged AI art has no ×S background to score (room 72 ships none).
  if (!(await p.evaluate(() => window.__ff.aiRoomLoaded()))) return { skip: true };
  const wobbles = await p.evaluate(() => window.__ff.water().wamp !== 0);
  if (wobbles) {
    const born = await p.evaluate(() => { window.__ff.startTrainNow(); return window.__ff.count(); });
    const half = await p.evaluate(() => Math.round(window.__ff.rippleTuning().lifeTicks / 2));
    await p.waitForFunction((t) => window.__ff.count() >= t, born + half);
  }
  return p.evaluate(() => window.__ff.aiWobbleCheck({ alpha: 0.5 }));
}

const wobbleRooms = [];
for (const num of ROOM_LIST) {
  try {
    const r = await wobbleAt(num);
    if (r && r.skip) continue;
    if (!r || !r.webgl) { ok = false; console.log(`  FAIL wobble room ${num}: no result`); continue; }
    if (r.unsupported || r.noArt || r.noCanvas) continue; // no AI art / GPU cannot size it
    const fail = (m) => { ok = false; console.log(`  FAIL wobble room ${num}: ${m}`); };
    if (r.scoredRows < 40) continue; // too little clear wall to score this room
    // (a) the curve, in EVERY room: the JS BG_FS oracle is built from this room's own
    //     source art, so a wrong edge clamp or interpolation shows up here room by room.
    if (!(r.oracleMax <= 2)) fail(`GPU differs from the JS BG_FS oracle: max=${r.oracleMax.toFixed(2)}`);
    if (!r.wobbles) {
      // The control rooms. No wave ⇒ the frame must be motionless and unshifted.
      if (r.ripples !== 0) fail(`a wamp=0 room must get no ripples (got ${r.ripples})`);
      if (r.exactRows !== 1 || r.bandsVarying !== 0) {
        fail(`a wamp=0 room must be motionless (exactRows=${r.exactRows} bandsVarying=${r.bandsVarying})`);
      }
      continue;
    }
    wobbleRooms.push(num);
    // (b) …and it is emphatically NOT the banded one.
    if (!(r.bandedMax >= 8)) fail(`still matches the BANDED expectation (max=${r.bandedMax}) — regressed to per-native-row?`);
    if (!(r.exactRows < 0.6)) fail(`${(r.exactRows * 100).toFixed(0)}% of rows are exact integer translations — the shift is not fractional`);
    if (!(r.bandsVarying > 0.25)) fail(`only ${(r.bandsVarying * 100).toFixed(0)}% of native bands vary within themselves — still banded`);
  } catch (e) {
    ok = false;
    console.log(`  FAIL wobble room ${num}: ${String(e).slice(0, 100)}`);
  }
}
console.log(`  wobble checked in ${wobbleRooms.length} wobbling rooms [${wobbleRooms.join(',')}] + the wamp=0 controls`);

// The ripple term needs ONE room to be scored in depth (rippleDelta), because it needs a
// train on screen at real amplitude — see wobbleAt.
try {
  const smooth = await wobbleAt(3);
  if (!smooth || !smooth.webgl || smooth.unsupported || smooth.noArt || smooth.noCanvas) {
    ok = false;
    console.log(`  FAIL wobble: no result (${JSON.stringify(smooth)})`);
  } else {
    const fail = (m) => { ok = false; console.log(`  FAIL wobble: ${m}`); };
    if (!smooth.wobbles) fail('room 3 is expected to wobble');
    // (a) the curve. 2 leaves headroom over the ~1.4 canvas-readback floor without
    //     leaving room for a wrong shift, which scores in the tens (see bandedMax).
    if (!(smooth.oracleMax <= 2)) fail(`GPU differs from the JS BG_FS oracle: max=${smooth.oracleMax.toFixed(2)}`);
    // (b) …and it is emphatically NOT the banded one.
    if (!(smooth.bandedMax >= 8)) fail(`GPU still matches the BANDED expectation (max=${smooth.bandedMax}) — regressed to per-native-row?`);
    // (b2) the ripple trains reached the shader at all. `rippleDelta` scores the same
    //      frame against the wobble WITHOUT them, so a shader that silently ignored uRip
    //      would score at the oracle's own floor and fail here while passing (a).
    if (!(smooth.ripples >= 1)) fail('no ripple train on screen — the ripple term was never exercised');
    if (!(smooth.rippleDelta >= 8)) fail(`the ripple trains moved nothing (rippleDelta=${smooth.rippleDelta.toFixed(2)}) — uRip ignored?`);
    // (c) measured on the pixels alone.
    if (!(smooth.scoredRows > 300)) fail(`too few scorable rows (${smooth.scoredRows})`);
    if (!(smooth.exactRows < 0.6)) fail(`${(smooth.exactRows * 100).toFixed(0)}% of rows are exact integer translations — the shift is not fractional`);
    if (!(smooth.bandsVarying > 0.25)) fail(`only ${(smooth.bandsVarying * 100).toFixed(0)}% of native bands vary within themselves — still banded`);
    console.log(
      `  wobble room 3 (wamp=${smooth.wamp} wper=${smooth.wper} wspd=${smooth.wspd}): ` +
        `oracleMax=${smooth.oracleMax.toFixed(2)} rmse=${smooth.oracleRmse.toFixed(3)} bandedMax=${smooth.bandedMax} ` +
        `exactRows=${smooth.exactRows.toFixed(2)} bandsVarying=${smooth.bandsVarying.toFixed(2)} ` +
        `ripples=${smooth.ripples} rippleDelta=${smooth.rippleDelta.toFixed(1)} (${smooth.scoredRows} rows)`,
    );
  }

} catch (e) {
  ok = false;
  console.log(`  FAIL wobble: ${String(e).slice(0, 120)}`);
}

// The per-frame cost of the two backends is REPORTED, not asserted. An earlier revision
// gated on `gpuMs < cpuMs * 3`, which is a wall-clock ratio measured inside the
// concurrent worker pool — and run-ui-tests.mjs's own rule is that rate-asserting probes
// belong in EXCLUSIVE or nowhere. Adding a probe to the quiet lane to protect a bound
// that was never a real target is a bad trade, so the number is printed for the log and
// tools/bench-ai-room.mjs remains the place that measures it properly.
try {
  await enter(3);
  const bench = await p.evaluate(() => window.__ff.aiRenderBench(30));
  if (bench && bench.gpuMs !== null) {
    console.log(`  frame cost ${bench.w}x${bench.h}: cpu ${bench.cpuMs.toFixed(2)} ms  gpu ${bench.gpuMs.toFixed(2)} ms (report only)`);
  }
} catch { /* reporting only: never fail the probe on a timing read */ }

if (errs.length) { ok = false; console.log('  console errors:', errs.slice(0, 4)); }
console.log(
  `  ai rooms tested=${tested}/${ROOM_LIST.length} (${FULL ? 'full sweep' : 'default set; FF_AI_ROOMS=all for all 72'})` +
    ` byteExact=${exact} noAiArt=${noArt} worstMax=${worstMax} (room ${worstRoom})` +
    (cpuRooms.length ? ` cpuFallbackRooms=[${cpuRooms.join(',')}]` : ''),
);
console.log(ok ? 'PASS' : 'FAIL');
await b.close();
exitProbe(ok ? 0 : 1);
