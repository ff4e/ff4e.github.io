/**
 * The `main.ts` region cycle, guarded so it can only shrink.
 *
 * ── Why this number and not a line count ──────────────────────────────────────
 * `test/file-budgets.test.ts` caps how big the hot files get. This caps something the
 * line count cannot see: whether they could be SPLIT at all.
 *
 * `main.ts` is navigated by regions (the `//#region` markers behind the README map). Ask
 * which regions reference which and the file's shape becomes measurable — a DAG of
 * regions is a set of modules waiting to be written, while a CYCLE is a knot. ESM does
 * allow circular imports, but `main.ts` is a top-level-`await` module whose evaluation
 * order is load-bearing (AGENTS.md, "the module-evaluation trap"), so paying for a cycle
 * there means either circular imports across that boundary or a host object injected at
 * every seam — more machinery than the single mapped file it would replace.
 *
 * At the split (PR #44) the number was **20 of 32 regions in one component**, and that is
 * the whole reason the file is navigated by a maintained line-range map instead of being
 * a directory of self-describing modules. So the map is not the fix; it is the symptom.
 *
 * ── How to use it ────────────────────────────────────────────────────────────
 * `node tools/region-graph.mjs --edges` prints the graph, the component and every edge
 * inside it with the symbols carrying it. The census at the top of that output is a plan:
 * most of these edges are one shared symbol, so they come apart one small PR at a time.
 *
 * The ceiling ratchets DOWN only. Cut a seam, watch the number fall, lower it here in the
 * same PR. Raising it means a change re-tangled the file, which is a thing to argue for in
 * a PR description rather than to discover months later.
 */
import { describe, it, expect } from 'vitest';
import { analyse } from '../tools/region-graph.mjs';

/**
 * Largest strongly-connected component of the region graph, in regions.
 *
 * 20 at the split — every one of these regions could reach every other, so none of them
 * could leave the file on its own.
 *
 * 11 once the player's options moved to `src/app/playerSettings.ts` — the biggest single
 * drop, from one of the smallest regions, because everything reads the subtitle language.
 * 14 with the render settings in `src/app/renderSettings.ts`, 15 with the stage
 * geometry and the tick constants in `src/app/stageGeometry.ts`,
 * and 17 before that, when the frame clock moved to `src/app/frameClock.ts`. `wake()` alone was eight
 * edges into frame pacing from regions with no interest in requestAnimationFrame, and
 * removing it freed the whole frame layer: the painter, the pacing and `loop()` are all
 * outside every cycle now.
 */
const MAX_CYCLE = 10;

/**
 * Edges inside that component. Tracked alongside the cycle because the cycle is a step
 * function: a PR can remove a dozen edges and leave the component the same size, and
 * without this number that PR looks like it achieved nothing.
 */
const MAX_CORE_EDGES = 49;

describe('src/app/main.ts region graph', () => {
  const report = analyse();

  it(`has no cycle larger than ${MAX_CYCLE} regions`, () => {
    expect(
      report.largestCycle,
      `The region cycle is ${report.largestCycle} regions, over the ${MAX_CYCLE} ceiling:\n` +
        `  ${report.cycle.join(' ↔ ')}\n` +
        'Something now couples regions that were separable. `node tools/region-graph.mjs --edges` ' +
        'names the symbols carrying each edge.',
    ).toBeLessThanOrEqual(MAX_CYCLE);
  });

  it(`has no more than ${MAX_CORE_EDGES} edges inside that cycle`, () => {
    expect(
      report.coreEdges,
      `${report.coreEdges} edges inside the cycle, over the ${MAX_CORE_EDGES} ceiling. ` +
        'Run `node tools/region-graph.mjs --edges`.',
    ).toBeLessThanOrEqual(MAX_CORE_EDGES);
  });

  it('the ceilings track the code, so progress is recorded rather than banked', () => {
    // Without this the numbers only ever record the high-water mark, and the next PR
    // cannot tell an untangled seam from an untouched one.
    const slack = [
      report.largestCycle < MAX_CYCLE ? `MAX_CYCLE: cycle is ${report.largestCycle}, lower it` : '',
      report.coreEdges < MAX_CORE_EDGES ? `MAX_CORE_EDGES: edges are ${report.coreEdges}, lower it` : '',
    ].filter(Boolean);

    expect(slack.join('\n'), 'these ceilings have gone slack; ratchet them down in this PR').toBe('');
  });

  it('measures the regions the README map is generated from, not a private copy of them', () => {
    // The predecessor of this tool carried its own hard-coded line ranges and started
    // lying the first time an edit moved a line. Both now read the same markers.
    expect(report.regions).toBeGreaterThan(0);
    expect(report.lines).toBeGreaterThan(1000);
  });
});
