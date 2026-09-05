/**
 * Measurement: which EDGE should the touch bar occupy in landscape — the left (today) or
 * the top?
 *
 * Scratch tool for `fish_fillets_touchbar_room_aware_edge`. It brings NO scaling maths of
 * its own: it calls `layout.ts`'s `computeStageLayout` / `contentScale` exactly as the
 * running game does in touch mode (`panel = false`, so the mode resolves to `fill`), once
 * with the WIDTH budget the left bar costs and once with the HEIGHT budget the top bar
 * costs, and reports which wins — per room, per device.
 *
 * `tools/test-touchbar-edge.mjs` pins that model against a real browser on both edges
 * the game has today (landscape/left, portrait/top), at drift 0.
 *
 * ── Where the viewports come from ────────────────────────────────────────────
 * **Playwright's own device registry**, not hand-picked numbers: every `hasTouch` entry
 * whose viewport is landscape. 60+ real devices — iPhones, Pixels, Galaxies, Android
 * tablets, iPads, foldables, Kindle — instead of the handful of Apple sizes this started
 * with, which flattered the top bar by missing that Android tablets are 1.60 aspect where
 * iPads are 1.33-1.44.
 *
 * **Browser chrome is the whole question, so it is measured explicitly.** Playwright's
 * phone viewports are already the area the page gets (iPhone 15 landscape is 734x343, not
 * the 852x393 screen), but its tablet entries are full-screen CSS sizes. Chrome for
 * Android on a tablet in landscape spends ~56-80 CSS px on toolbar + tab strip, so every
 * device is ALSO measured with `--chrome` px taken off the height. The top bar competes
 * for exactly the axis the address bar is already eating, so ignoring it would be the one
 * mistake that most flatters the result.
 *
 * Usage:
 *   npx tsx tools/measure-touchbar-edge.mjs               # summary by device class
 *   npx tsx tools/measure-touchbar-edge.mjs --devices     # every device
 *   npx tsx tools/measure-touchbar-edge.mjs --csv         # per room, per device
 *   npx tsx tools/measure-touchbar-edge.mjs --chrome 72   # extra browser chrome, px
 *   npx tsx tools/measure-touchbar-edge.mjs --inset 62    # what-if: a cutout on every viewport
 *   npx tsx tools/measure-touchbar-edge.mjs --native      # the three measured iOS viewports
 */
import { execFileSync } from 'node:child_process';
import { devices } from 'playwright';
import { computeStageLayout, contentScale } from '../src/app/layout.ts';
import { TOUCHBAR_H, TOUCHBAR_LEAD, preferredTouchBarEdge, touchBarLeftW } from '../src/app/touchBarEdge.ts';
import { LAB_NATIVE_DEVICES } from './layoutLabHousings.ts';

// The bar's own size, IMPORTED rather than restated. These used to be two literals copied
// out of index.html, which is how this tool came to disagree with the app by 14px once
// already (ed3ebc4): `--bar-w` is `58 + max(--sa-left, 14)`, a floor and not a sum, and a
// copied `72` cannot know that. Now the only number here is the cutout.
const CELL = 15; // native px per FFR cell

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : dflt;
};
const flag = (name) => process.argv.includes(name);
const CHROME = arg('--chrome', 0);
/**
 * Force a display cutout onto every viewport, css px.
 *
 * Independent of `--native`: this answers "what would THIS browser viewport do if it had an
 * island?", which is a question about the rule, whereas `--native` answers "what does the
 * shipped iOS app actually get?", which is a question about three real phones.
 */
const INSET = arg('--inset', 0);
/**
 * Survey the native iOS viewports instead of Playwright's browser registry.
 *
 * They are a different SIZE as well as a different inset — mobile Safari has already taken
 * the cutout off both sides and ~50px of furniture off the height before the page sees a
 * viewport, so a native row is not a browser row plus a number. See
 * `tools/layoutLabHousings.ts`.
 */
const NATIVE = flag('--native');
/** Tolerance for --per-viewport: how much mean scale the nicer top edge may cost. */
const TOL = arg('--tol', 0);

/**
 * What the bar costs on each edge AT THIS VIEWPORT.
 *
 * This tool surveys LANDSCAPE viewports only, and in landscape a phone's notch or island is
 * on a SIDE — `safe-area-inset-top` is ~0 there. So the cutout is charged to the left edge
 * and the top edge is left alone, which is precisely why it can change the answer: it is a
 * tax on one of the two candidates, not on the screen.
 */
const barW = (v) => touchBarLeftW(v.inset ?? 0);
const barH = () => TOUCHBAR_H;

/** Every landscape touch viewport Playwright knows, deduplicated by size. */
function viewports() {
  if (NATIVE) {
    return LAB_NATIVE_DEVICES.filter((d) => d.land).map((d) => ({
      w: d.land.w,
      h: d.land.h - CHROME,
      names: [d.name],
      klass: 'native',
      // `--inset` still wins if it was given: overriding a measured phone with a number is
      // a legitimate what-if, and silently ignoring the flag would be the surprising choice.
      inset: INSET || d.housing.left,
    }));
  }
  const seen = new Map();
  for (const [name, d] of Object.entries(devices)) {
    if (!d.hasTouch) continue;
    const { width: w, height: h } = d.viewport;
    if (w <= h) continue;
    const vh = h - CHROME;
    if (vh < 200) continue;
    const key = `${w}x${vh}`;
    const short = name.replace(/ landscape$/, '');
    if (seen.has(key)) {
      seen.get(key).names.push(short);
      continue;
    }
    // A browser viewport has NO cutout of its own — the engine subtracted it already — so
    // anything here is the operator asking a what-if, and comes from the flag alone.
    seen.set(key, { w, h: vh, names: [short], klass: classify(short, w, vh), inset: INSET });
  }
  return [...seen.values()].sort((a, b) => a.w / a.h - b.w / b.h);
}

/** Phone / tablet / foldable, by name first and size only as a fallback. */
function classify(name, w, h) {
  if (/fold/i.test(name) && !/cover/i.test(name)) return 'foldable';
  if (/tab|pad|nexus 10|nexus 7|kindle|fire/i.test(name)) return 'tablet';
  return 'phone';
}

function rooms() {
  const out = execFileSync('npx', ['tsx', 'tools/dump-ffr.ts', '--all'], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const list = [];
  for (const line of out.split('\n')) {
    const m = /^\s*✓\s+\d+\s+(\S+)\s+(\d+)x(\d+)\s/.exec(line);
    if (m) list.push({ name: m[1], w: Number(m[2]) * CELL, h: Number(m[3]) * CELL });
  }
  return list;
}

function measure(room, availW, availH) {
  const l = computeStageLayout(availW, availH, 'fill', false);
  const s = contentScale(room.w, room.h, l.scale, l.mode, 1, l.availW, l.availH, l.maxCellPx);
  return { scale: s, drawnH: s * room.h, drawnW: s * room.w };
}

/** Per-room comparison of the two edges on one viewport. */
function compare(all, v) {
  return all.map((r) => {
    const left = measure(r, v.w - barW(v), v.h);
    const top = measure(r, v.w, v.h - barH());
    return {
      room: r,
      v,
      left: left.scale,
      top: top.scale,
      gain: (top.scale / left.scale - 1) * 100,
      // `.stage` is overflow:hidden, so a room taller than the area is CUT, not shrunk.
      // MIN_STAGE_SCALE is deliberately allowed to overflow the height (see its comment),
      // which is how a short viewport gets here.
      topClips: top.drawnH > v.h - barH() + 0.5,
      leftClips: left.drawnH > v.h + 0.5,
    };
  });
}

/**
 * The MEDIAN room's gain, which is the statistic that matters for a per-viewport decision.
 * The mean hides a ~20-point spread: on an iPad gen 7 it reads -4.5%, which sounds like a
 * fair price for the nicer edge, while the median is -8.9% and 41 of the 72 rooms lose
 * more than 8%. Deciding a whole device off the mean put three iPads on the top edge that
 * the per-room numbers say clearly want the left one.
 */
function median(cmp) {
  const g = cmp.map((c) => c.gain).sort((a, b) => a - b);
  return g[Math.floor(g.length / 2)];
}

/**
 * The SHIPPED rule, imported rather than restated: whole room first, then bigger.
 *
 * This tool once carried its own approximation of it (`!topClips && gain >= -tol`), which
 * is how the numbers below could have gone on describing a rule the game no longer ran —
 * and in fact that approximation was closer to the truth than the code was, since the
 * shipped version briefly lacked the whole-room preference. Importing the real function
 * removes the whole class of drift; `tol` is kept only for the exploratory sweeps.
 */
const edgeFor = (c, tol) =>
  tol === 0
    ? // Landscape, so the cutout is on a SIDE: `insetTop` stays 0 and the whole of it goes
      // into `clearLeft`, already floored at the lead — `touchBarLeftW` takes the max, so
      // passing a raw inset below 14 would silently drop the clearance.
      preferredTouchBarEdge(
        c.room.w,
        c.room.h,
        c.v.w,
        c.v.h,
        'fill',
        1,
        0,
        Math.max(c.v.inset ?? 0, TOUCHBAR_LEAD),
      )
    : !c.topClips && c.gain >= -tol
      ? 'top'
      : 'left';

function outcome(cmp, tol) {
  const edges = cmp.map((c) => edgeFor(c, tol));
  let flips = 0;
  for (let i = 1; i < edges.length; i++) if (edges[i] !== edges[i - 1]) flips++;
  const nTop = edges.filter((e) => e === 'top').length;
  let mean = 0;
  cmp.forEach((c, i) => (mean += edges[i] === 'top' ? c.gain : 0));
  return { nTop, flips, mean: mean / cmp.length };
}

const all = rooms();
const vps = viewports();

if (process.argv.includes('--csv')) {
  console.log('device,vw,vh,class,room,nativeW,nativeH,scaleLeft,scaleTop,gainPct,topClips');
  for (const v of vps)
    for (const c of compare(all, v))
      console.log(
        [v.names[0], v.w, v.h, v.klass, c.room.name, c.room.w, c.room.h,
          c.left.toFixed(4), c.top.toFixed(4), c.gain.toFixed(2), c.topClips].join(','),
      );
  process.exit(0);
}

const TOLS = [0, 3, 6, 9, 12];
// The bar's cost is per-viewport once a cutout is in play, so state the range rather than a
// pair of constants that would be a lie on a mixed survey.
const costs = [...new Set(vps.map((v) => `${barW(v)}/${barH()}`))];
console.log(
  `${vps.length} distinct landscape touch viewports from ` +
    (NATIVE ? 'the measured native iOS list (tools/layoutLabHousings.ts)' : "Playwright's device registry") +
    (CHROME ? `, minus ${CHROME}px of browser chrome` : NATIVE ? ', full-bleed' : ', as Playwright reports them') +
    `\nbar: ${costs.join(', ')} px (left/top)` +
    (INSET ? `, with a forced ${INSET}px cutout` : NATIVE ? ', each phone with its own measured cutout' : '') +
    '\n',
);

if (process.argv.includes('--devices')) {
  console.log(
    'size        aspect class     leftCost topCost clip   ' +
      TOLS.map((t) => `T=${t}%`.padStart(9)).join(''),
  );
  for (const v of vps) {
    const cmp = compare(all, v);
    let lc = 0, tc = 0;
    for (const r of all) {
      const none = measure(r, v.w, v.h).scale;
      lc += (measure(r, v.w - barW(v), v.h).scale / none - 1) * 100;
      tc += (measure(r, v.w, v.h - barH()).scale / none - 1) * 100;
    }
    const clips = cmp.filter((c) => c.topClips).length;
    console.log(
      `${String(v.w + 'x' + v.h).padEnd(11)} ${(v.w / v.h).toFixed(2).padStart(5)} ` +
        `${v.klass.padEnd(9)} ${(lc / 72).toFixed(1).padStart(7)}% ${(tc / 72).toFixed(1).padStart(6)}% ` +
        `${String(clips).padStart(2)}/72  ` +
        TOLS.map((t) => {
          const o = outcome(cmp, t);
          return `${o.nTop}t/${o.flips}f`.padStart(9);
        }).join('') +
        `  ${v.names.slice(0, 2).join(', ')}`,
    );
  }
  console.log('\nleftCost/topCost: mean scale change over the 72 rooms vs having NO bar.');
  console.log('Nt = rooms with the bar on top, Nf = edge flips over the 71 room transitions.');
  process.exit(0);
}

if (process.argv.includes('--per-viewport')) {
  // The simpler alternative to the per-room rule: pick ONE edge for the viewport, from the
  // mean over all 72 rooms. The bar then never moves during play, and the decision needs no
  // room awareness at all — which is the architectural obstacle the whole feature otherwise
  // has to solve (`relayout()` never runs on a room change).
  console.log(`PER-VIEWPORT rule — one edge per device, never moves during play (tolerance ${TOL}%)\n`);
  console.log('class      viewports   ->top   ->left   mean scale vs today');
  for (const klass of ['phone', 'foldable', 'tablet']) {
    const group = vps.filter((v) => v.klass === klass);
    if (!group.length) continue;
    let nTop = 0, nLeft = 0, total = 0;
    for (const v of group) {
      const cmp = compare(all, v);
      const med = median(cmp);
      const clips = cmp.some((c) => c.topClips);
      if (!clips && med >= -TOL) { nTop++; total += med; } else nLeft++;
    }
    console.log(
      `${klass.padEnd(10)} ${String(group.length).padStart(9)} ${String(nTop).padStart(6)} ` +
        `${String(nLeft).padStart(7)}   ${(total / group.length >= 0 ? '+' : '') + (total / group.length).toFixed(1)}%`,
    );
  }
  for (const v of vps.filter((x) => x.klass !== 'phone')) {
    const cmp = compare(all, v);
    const med = median(cmp);
    const clips = cmp.some((c) => c.topClips);
    const bad = cmp.filter((c) => c.gain <= -8).length;
    console.log(
      `${String(v.w + 'x' + v.h).padEnd(11)} ${(v.w / v.h).toFixed(2).padStart(5)} ${v.klass.padEnd(9)}` +
        ` median top-vs-left ${((med >= 0 ? '+' : '') + med.toFixed(1) + '%').padStart(6)}` +
        `  rooms losing >8%: ${String(bad).padStart(2)}/72  -> ${!clips && med >= -TOL ? 'TOP' : 'left'}` +
        `   ${v.names.slice(0, 2).join(', ')}`,
    );
  }
  process.exit(0);
}

for (const klass of ['phone', 'foldable', 'tablet']) {
  const group = vps.filter((v) => v.klass === klass);
  if (!group.length) continue;
  console.log(`── ${klass}s (${group.length} viewports, aspect ` +
    `${Math.min(...group.map((v) => v.w / v.h)).toFixed(2)}-${Math.max(...group.map((v) => v.w / v.h)).toFixed(2)}) ──`);
  let lc = 0, tc = 0, clipDev = 0;
  for (const v of group) {
    let a = 0, b = 0;
    for (const r of all) {
      const none = measure(r, v.w, v.h).scale;
      a += (measure(r, v.w - barW(v), v.h).scale / none - 1) * 100;
      b += (measure(r, v.w, v.h - barH()).scale / none - 1) * 100;
    }
    lc += a / 72;
    tc += b / 72;
    if (compare(all, v).some((c) => c.topClips)) clipDev++;
  }
  console.log(`   cost of the bar vs no bar:  LEFT ${(lc / group.length).toFixed(1)}%   TOP ${(tc / group.length).toFixed(1)}%`);
  console.log(`   viewports where a top bar CLIPS at least one room: ${clipDev}/${group.length}`);
  for (const t of TOLS) {
    let allTop = 0, allLeft = 0, mixed = 0, flips = 0, mean = 0;
    for (const v of group) {
      const o = outcome(compare(all, v), t);
      if (o.nTop === 72) allTop++;
      else if (o.nTop === 0) allLeft++;
      else mixed++;
      flips += o.flips;
      mean += o.mean;
    }
    console.log(
      `   T=${String(t + '%').padEnd(4)} all-top ${String(allTop).padStart(2)}   all-left ${String(allLeft).padStart(2)}` +
        `   mixed ${String(mixed).padStart(2)}   mean flips/71 ${(flips / group.length).toFixed(1).padStart(4)}` +
        `   mean scale vs today ${(mean / group.length >= 0 ? '+' : '') + (mean / group.length).toFixed(1)}%`,
    );
  }
  console.log('');
}
