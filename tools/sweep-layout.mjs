/**
 * Sweep: do the layout properties actually HOLD? — DEV ONLY.
 *
 * The companion to `tools/layout-lab.html`, and the two catch different things. The lab is
 * for the eye, which is the method that found both of the defects this task exists for.
 * This is for the cases the eye will never reach: every room against a grid of viewports,
 * for both models, reporting each property as "held over N combinations, N stated" or as a
 * counter-example with the exact numbers.
 *
 * **A passing hand-picked test does not count, and neither does a doc comment.** Both
 * shipped defects were asserted correct by a comment, with a unit test whose viewport
 * happened to agree — `test/layout.test.ts:135` asserts
 * `stageW + gap + panelW + 2*STAGE_EDGE*scale <= w`, which is the formula restated with the
 * constant on both sides and so cannot tell a good value from a bad one.
 *
 * ── The properties ───────────────────────────────────────────────────────────
 * The first three are here because each would have caught a defect that shipped.
 *
 *   whole     the whole room is on screen whenever a layout exists that would show it
 *             — 669x280, where 52px of a level was drawn off screen.
 *   reserve   the margin held back from each edge is the SAME at every viewport, rather
 *             than appearing and vanishing either side of a floor — 1491 vs 1557, where it
 *             is 21px per side and then 0.
 *   monotone  growing the viewport never shrinks the room — Martin's requirement
 *             (2026-08-31). Checked on both axes, 1px apart.
 *   contained nothing runs off the viewport — the property the reserve exists FOR, and
 *             which nothing has ever tested.
 *   centred   the room sits on the screen's centre, not on what the furniture left over
 *             (#126), except where it has no slack to do so.
 *   touching  the room reaches the available area in at least one axis, bar the reserve.
 *             Already holds on the shipped model over 3,083,040 combinations — kept as a
 *             net, since it is the property that catches a layout that simply gives up.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *   npx tsx tools/sweep-layout.mjs                    # both models, default grid
 *   npx tsx tools/sweep-layout.mjs --step 4           # finer viewport grid (slower)
 *   npx tsx tools/sweep-layout.mjs --target touch     # one target
 *   npx tsx tools/sweep-layout.mjs --margin 0         # price the candidate's reserve
 *   npx tsx tools/sweep-layout.mjs --strip 56         # price a different touch strip
 *   npx tsx tools/sweep-layout.mjs --mono             # worst CUMULATIVE monotonicity loss
 *   npx tsx tools/sweep-layout.mjs --cost             # room size, candidate vs shipped
 *   npx tsx tools/sweep-layout.mjs --strip-curve      # room size against strip size
 */
import { layoutRoom, TARGET_DEFAULTS } from './layoutCandidate.ts';
import { layoutRoomShipped } from './layoutShipped.ts';
import { LAB_ROOMS, LAB_SIZES } from './layoutLabRooms.ts';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : d;
};
const str = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d;
};

const STEP = arg('--step', 8);
const MARGIN = arg('--margin', 12);
const STRIP_LEFT = arg('--strip', 72);
const STRIP_TOP = arg('--strip-top', 66);
const ONLY_TARGET = str('--target', null);
const ONLY_MODEL = str('--model', null);

/**
 * The rectangle set. 63 distinct sizes rather than 72 rooms: a property either holds for a
 * rectangle or it does not, and the nine duplicates cost 14% of the run for nothing. The
 * COST report uses all 72, because a player walks through 72 rooms and the two give
 * different means.
 */
const SIZES = LAB_SIZES;

/**
 * The viewport grid. Deliberately reaches below the stage box in both axes — that is where
 * `MIN_STAGE_SCALE`'s floor and `stageBox*`'s `max` start to bind, and it is the region
 * both shipped defects live in. A device registry would have missed 669x280 entirely; it
 * is a desktop window Martin happened to drag to.
 */
function viewports() {
  const out = [];
  for (let w = 240; w <= 2560; w += STEP) {
    for (let h = 200; h <= 1440; h += STEP) out.push([w, h]);
  }
  return out;
}

/** One (target, strip edge) case. PC has no strip; touch and TV have two edges each. */
function cases() {
  const all = [
    { target: 'pc', edge: 'none', strip: 0, margin: MARGIN, mode: 'medium' },
    { target: 'pc', edge: 'none', strip: 0, margin: MARGIN, mode: 'fixed' },
    { target: 'pc', edge: 'none', strip: 0, margin: MARGIN, mode: 'fill' },
    { target: 'touch', edge: 'left', strip: STRIP_LEFT, margin: MARGIN, mode: 'fill' },
    { target: 'touch', edge: 'top', strip: STRIP_TOP, margin: MARGIN, mode: 'fill' },
    { target: 'tv', edge: 'left', strip: TARGET_DEFAULTS.tv.strip, margin: TARGET_DEFAULTS.tv.margin, mode: 'fill' },
    { target: 'tv', edge: 'top', strip: TARGET_DEFAULTS.tv.strip, margin: TARGET_DEFAULTS.tv.margin, mode: 'fill' },
  ];
  return ONLY_TARGET ? all.filter((c) => c.target === ONLY_TARGET) : all;
}

function req(c, size, w, h) {
  return {
    viewportW: w,
    viewportH: h,
    roomW: size.w,
    roomH: size.h,
    target: c.target,
    mode: c.mode,
    stripEdge: c.edge,
    stripPx: c.strip,
    marginPx: c.margin,
    dpr: 1,
  };
}

/**
 * A property's verdict. `n` is stated with every result on purpose: "held" without the
 * count it held over is exactly the claim a doc comment makes.
 */
function tally() {
  return { n: 0, fails: 0, worst: null, byCase: new Map() };
}

function note(t, fails, detail, severity = 1) {
  t.n++;
  if (!fails) return;
  t.fails++;
  t.byCase.set(detail.case, (t.byCase.get(detail.case) ?? 0) + 1);
  if (!t.worst || severity > t.worst.severity) t.worst = { ...detail, severity };
}

function run(model, place) {
  const vps = viewports();
  const props = {
    whole: tally(),
    reserve: tally(),
    monotone: tally(),
    contained: tally(),
    centred: tally(),
    touching: tally(),
  };

  for (const c of cases()) {
    const stripW = c.edge === 'left' ? c.strip : 0;
    const stripH = c.edge === 'top' ? c.strip : 0;
    for (const size of SIZES) {
      // Monotonicity needs the neighbouring viewport, so the grid is walked in order and
      // each point is compared with the one 1px smaller on each axis. A grid STEP larger
      // than 1 still finds violations — the shipped one spans 155px — but the worst SINGLE
      // step is only visible at 1px, so both are measured.
      for (const [w, h] of vps) {
        const r = place(req(c, size, w, h));
        if (!(r.contentScale > 0) || !Number.isFinite(r.contentScale)) continue;

        // whole — is any of the room off screen, when a smaller scale would have shown it?
        note(props.whole, r.cut && r.fitScale > 0, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail: `${r.cutW.toFixed(1)}x${r.cutH.toFixed(1)} native px hidden; fitScale ${r.fitScale.toFixed(4)} would have shown it whole`,
        }, r.cutW + r.cutH);

        // contained — does anything run off the viewport at all? Sub-native-pixel
        // overshoot is not a defect (property 2 in PLAN.md): there is no such thing as
        // half a pixel of wall, and rejecting it is how a 0.22px rounding became a rule.
        const off = Math.min(r.gapLeft, r.gapRight, r.gapTop, r.gapBottom);
        const offNative = -off / (r.contentScale || 1);
        note(props.contained, offNative >= 1, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail: `${(-off).toFixed(2)} css px (${offNative.toFixed(2)} native) off the viewport`,
        }, offNative);

        // reserve — the margin must be the same at every viewport. Half a pixel of slack
        // for rounding; anything more is the reserve decaying, which is the 1491/1557 case
        // the old native-px `STAGE_EDGE` produced.
        const near = Math.min(r.gapLeft, r.gapRight, r.gapTop, r.gapBottom);
        note(props.reserve, near < c.margin - 0.51, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail: `smallest gap ${near.toFixed(2)}px, wanted ${c.margin}`,
        }, c.margin - near);

        // centred (#126) — the room's centre is the screen's centre, unless it has no
        // slack, in which case it is pinned clear of the furniture. Both are correct.
        //
        // "Slack" has to include the model's own reserve: a candidate room whose gaps are
        // exactly the margin is against the edge of the space it is allowed, and asking it
        // to centre further would be asking it to spend the reserve. Measuring slack as
        // `gap > 0` instead reported 12% false failures.
        const slackFloor = c.margin + 0.51;
        const centreErr = Math.abs(r.roomX + r.drawnW / 2 + (r.panelW + r.gap) / 2 - w / 2);
        const noSlack =
          r.gapLeft <= slackFloor ||
          r.gapRight <= slackFloor ||
          r.gapTop <= slackFloor ||
          r.gapBottom <= slackFloor;
        note(props.centred, centreErr > 0.51 && !noSlack, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail: `${centreErr.toFixed(1)}px off centre with slack to spare`,
        }, centreErr);

        // touching — the room reaches the area it was given in at least one axis. A layout
        // that fills neither has simply declined space it had.
        const fillsW = r.drawnW >= r.roomAvailW - 0.51;
        const fillsH = r.drawnH >= r.roomAvailH - 0.51;
        const capped = r.contentScale < r.fitScale - 1e-9; // a fit mode's bound, not a defect
        note(props.touching, !fillsW && !fillsH && !capped, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail: `fills neither axis: ${r.drawnW.toFixed(0)}x${r.drawnH.toFixed(0)} in ${r.roomAvailW.toFixed(0)}x${r.roomAvailH.toFixed(0)}`,
        }, 1);

        // monotone — one px wider and one px taller must never be smaller.
        const wider = place(req(c, size, w + 1, h));
        const taller = place(req(c, size, w, h + 1));
        const dW = wider.contentScale / r.contentScale - 1;
        const dH = taller.contentScale / r.contentScale - 1;
        const bad = Math.min(dW, dH);
        note(props.monotone, bad < -1e-9, {
          case: `${c.target}/${c.edge}/${c.mode}`,
          size: `${size.w}x${size.h}`,
          vp: `${w}x${h}`,
          detail:
            dW <= dH
              ? `+1px WIDER costs ${(dW * 100).toFixed(3)}% (${r.contentScale.toFixed(5)} -> ${wider.contentScale.toFixed(5)})`
              : `+1px TALLER costs ${(dH * 100).toFixed(3)}% (${r.contentScale.toFixed(5)} -> ${taller.contentScale.toFixed(5)})`,
        }, -bad);
      }
    }
  }
  return props;
}

const NAMES = {
  whole: 'the whole room is on screen',
  reserve: 'the reserve is the same at every viewport',
  monotone: 'a bigger viewport never gives a smaller room',
  contained: 'nothing runs off the viewport',
  centred: 'the room is centred on the screen (#126)',
  touching: 'the room reaches its area in at least one axis',
};

function report(label, props) {
  console.log(`\n══ ${label} ═══════════════════════════════════════════`);
  for (const [k, t] of Object.entries(props)) {
    const pct = t.n ? ((t.fails / t.n) * 100).toFixed(4) : '0';
    if (t.fails === 0) {
      console.log(`  ✓ ${NAMES[k].padEnd(48)} held over ${t.n.toLocaleString()} combinations`);
    } else {
      console.log(`  ✗ ${NAMES[k].padEnd(48)} FAILED ${t.fails.toLocaleString()} of ${t.n.toLocaleString()} (${pct}%)`);
      const where = [...t.byCase.entries()].sort((a, b) => b[1] - a[1]);
      console.log(`      in: ${where.map(([c, n]) => `${c} ${n.toLocaleString()}`).join(', ')}`);
      const w = t.worst;
      console.log(`      worst: ${w.case}  room ${w.size}  viewport ${w.vp}`);
      console.log(`             ${w.detail}`);
    }
  }
}

/**
 * How much a room can lose CUMULATIVELY by growing the window, which is the number that
 * matters and which a per-1px check understates badly.
 *
 * A 1px step can only ever cost a fraction of a percent, so "fails 0.8% of combinations at
 * -0.062%" reads like a rounding artefact. It is not: the same effect applied over a range
 * of heights compounds. For each (case, room, width) this walks the height upward and
 * records the largest drop from the best scale seen so far, and vice versa — which is
 * exactly what a player does when they drag a window edge.
 */
function monoReport() {
  console.log('\n══ worst CUMULATIVE loss from growing the window ════════');
  console.log('  (the largest drop below the best size already seen, walking one axis)\n');
  const models = [
    ['shipped', layoutRoomShipped],
    ['candidate', layoutRoom],
  ].filter(([n]) => !ONLY_MODEL || ONLY_MODEL === n);

  for (const [name, place] of models) {
    for (const c of cases()) {
      let worstH = { d: 0 };
      let worstW = { d: 0 };
      for (const size of SIZES) {
        for (let w = 240; w <= 2560; w += STEP) {
          let best = 0;
          let bestAt = 0;
          for (let h = 200; h <= 1440; h += STEP) {
            const s = place(req(c, size, w, h)).contentScale;
            if (!(s > 0)) continue;
            if (s > best) {
              best = s;
              bestAt = h;
            } else if (best > 0) {
              const d = s / best - 1;
              if (d < worstH.d) worstH = { d, size: `${size.w}x${size.h}`, w, from: bestAt, to: h };
            }
          }
        }
        for (let h = 200; h <= 1440; h += STEP) {
          let best = 0;
          let bestAt = 0;
          for (let w = 240; w <= 2560; w += STEP) {
            const s = place(req(c, size, w, h)).contentScale;
            if (!(s > 0)) continue;
            if (s > best) {
              best = s;
              bestAt = w;
            } else if (best > 0) {
              const d = s / best - 1;
              if (d < worstW.d) worstW = { d, size: `${size.w}x${size.h}`, h, from: bestAt, to: w };
            }
          }
        }
      }
      const fh = worstH.d < 0
        ? `${(worstH.d * 100).toFixed(2)}%  ${worstH.size} at width ${worstH.w}, height ${worstH.from} -> ${worstH.to}`
        : 'never';
      const fw = worstW.d < 0
        ? `${(worstW.d * 100).toFixed(2)}%  ${worstW.size} at height ${worstW.h}, width ${worstW.from} -> ${worstW.to}`
        : 'never';
      console.log(`  ${name} ${c.target}/${c.edge}/${c.mode}`);
      console.log(`    growing the HEIGHT costs  ${fh}`);
      console.log(`    growing the WIDTH costs   ${fw}`);
    }
    console.log('');
  }
}

/**
 * How much room size the candidate gives up (or gains) against the shipped model.
 *
 * Split on whether the SHIPPED layout was showing the whole room, and that split is the
 * whole point: where the shipped model draws a room larger than the screen it is not
 * winning, it is hiding part of the level, so a raw mean over every viewport reports the
 * defect as if it were a benefit. Measured over a 32px grid, the shipped model cuts the
 * room on ~10% of combinations, and those alone drag the mean from about -1% to -5%.
 */
function costReport() {
  console.log('\n══ room size: candidate vs shipped ══════════════════════');
  console.log('  (all 72 rooms — a player walks through 72, not 63)');
  console.log('  TV is omitted: the shipped model has no TV, so there is nothing to compare to.\n');
  for (const c of cases()) {
    if (c.target === 'tv') continue;
    let sum = 0;
    let n = 0;
    let cutSum = 0;
    let cutN = 0;
    let worst = { d: Infinity };
    let best = { d: -Infinity };
    let wins = 0;
    for (const room of LAB_ROOMS) {
      for (const [w, h] of viewports()) {
        const r = req(c, room, w, h);
        const sr = layoutRoomShipped(r);
        const kr = layoutRoom(r);
        if (!(sr.contentScale > 0) || !(kr.contentScale > 0)) continue;
        const d = kr.contentScale / sr.contentScale - 1;
        if (sr.cut) {
          cutSum += d;
          cutN++;
          continue;
        }
        sum += d;
        n++;
        if (d > 1e-9) wins++;
        if (d < worst.d) worst = { d, room: room.name, vp: `${w}x${h}` };
        if (d > best.d) best = { d, room: room.name, vp: `${w}x${h}` };
      }
    }
    const tot = n + cutN;
    console.log(`  ${`${c.target}/${c.edge} ${c.mode}`.padEnd(22)}`);
    console.log(`    where shipped showed the WHOLE room (${((n / tot) * 100).toFixed(1)}% of combinations)`);
    console.log(`      mean ${((sum / n) * 100).toFixed(2)}%   candidate bigger in ${((wins / n) * 100).toFixed(1)}%`);
    console.log(`      worst ${(worst.d * 100).toFixed(2)}% (${worst.room} at ${worst.vp}), best +${(best.d * 100).toFixed(2)}% (${best.room} at ${best.vp})`);
    console.log(`    where shipped CUT the room (${((cutN / tot) * 100).toFixed(1)}%) — not a size comparison`);
    console.log(`      the candidate is ${((cutSum / cutN) * 100).toFixed(1)}% smaller there because it is showing all of it\n`);
  }
}

/** What a strip size costs, per target — the cost curve PLAN.md asks for. */
function stripCurve() {
  console.log('\n══ what a strip costs, mean room scale over the 72 rooms ══');
  console.log('  (candidate model; against the same viewport with no strip at all)\n');
  const grids = {
    phone: [[734, 343], [782, 358], [844, 390]],
    tablet: [[1024, 696], [1180, 748], [1366, 952]],
    tv: [[1280, 720], [1920, 1080]],
  };
  for (const [klass, vps] of Object.entries(grids)) {
    console.log(`  ${klass}`);
    console.log(`    strip     bar LEFT      bar TOP`);
    for (const strip of [0, 40, 48, 56, 64, 72, 80, 96]) {
      const cost = (edge) => {
        let sum = 0;
        let n = 0;
        for (const room of LAB_ROOMS) {
          for (const [w, h] of vps) {
            const base = layoutRoom({
              viewportW: w, viewportH: h, roomW: room.w, roomH: room.h,
              target: klass === 'tv' ? 'tv' : 'touch', mode: 'fill',
              stripEdge: edge, stripPx: 0, marginPx: MARGIN, dpr: 1,
            }).contentScale;
            const s = layoutRoom({
              viewportW: w, viewportH: h, roomW: room.w, roomH: room.h,
              target: klass === 'tv' ? 'tv' : 'touch', mode: 'fill',
              stripEdge: edge, stripPx: strip, marginPx: MARGIN, dpr: 1,
            }).contentScale;
            sum += s / base - 1;
            n++;
          }
        }
        return (sum / n) * 100;
      };
      console.log(`    ${String(strip).padStart(3)}px   ${cost('left').toFixed(2).padStart(8)}%   ${cost('top').toFixed(2).padStart(8)}%`);
    }
    console.log('');
  }
}

// ── main ────────────────────────────────────────────────────────────────────
const combos = viewports().length * SIZES.length * cases().length;
console.log(
  `sweep-layout: ${SIZES.length} rectangles x ${viewports().length.toLocaleString()} viewports ` +
    `(${STEP}px grid) x ${cases().length} cases = ${combos.toLocaleString()} combinations per model`,
);
console.log(`margin ${MARGIN}px, strip ${STRIP_LEFT} left / ${STRIP_TOP} top`);

if (flag('--mono')) {
  monoReport();
} else if (flag('--cost')) {
  costReport();
} else if (flag('--strip-curve')) {
  stripCurve();
} else {
  const t0 = Date.now();
  if (ONLY_MODEL !== 'candidate') report('shipped — src/app/layout.ts', run('shipped', layoutRoomShipped));
  if (ONLY_MODEL !== 'shipped') report('candidate — tools/layoutCandidate.ts', run('candidate', layoutRoom));
  console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
