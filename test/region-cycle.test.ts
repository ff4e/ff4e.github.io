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
 * the whole reason the file was navigated by a maintained line-range map instead of being
 * a directory of self-describing modules. The map was not the fix; it was the symptom —
 * and once the cycle came apart the map could go, which it has.
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
import { analyse, readRegions } from '../tools/region-graph.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
const MAX_CYCLE = 5;

/**
 * Edges inside that component. Tracked alongside the cycle because the cycle is a step
 * function: a PR can remove a dozen edges and leave the component the same size, and
 * without this number that PR looks like it achieved nothing.
 */
const MAX_CORE_EDGES = 12;

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

  it('measures the markers in the file, not a private copy of them', () => {
    // The predecessor of this tool carried its own hard-coded line ranges and started
    // lying the first time an edit moved a line.
    expect(report.regions).toBeGreaterThan(0);
    expect(report.lines).toBeGreaterThan(1000);
  });
});

/**
 * The markers themselves.
 *
 * These two checks used to live in `test/gen-map.test.ts`, next to the generator that
 * turned the markers into a README table. That generator is gone — `src/app/` is mapped
 * by directory now — but the markers stayed, and without these they would be the only
 * documentation in the repo that nothing verifies. An anchor is a promise that you can
 * grep this name and land in this region; the promise is worth exactly as much as the
 * check behind it.
 */
describe('src/app/main.ts region markers', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'main.ts'), 'utf8');
  const lines = src.split('\n');
  const regions = readRegions(src);

  it('main.ts still declares its regions', () => {
    expect(regions.length).toBeGreaterThan(10);
  });

  it('every anchor occurs inside the region that names it', () => {
    const problems: string[] = [];
    for (const r of regions)
      for (const anchor of r.anchors) {
        // Anchors are written for a human (`loop()`, `await FontData.load`); match the
        // leading identifier, which is the part you would actually grep for.
        const name = anchor.replace(/\(.*/, '').replace(/[^\w$].*$/, '');
        if (name.length < 3) continue;
        const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`);
        // slice(r.start), not slice(r.start - 1): the marker line itself CONTAINS the
        // anchor name, so including it made every anchor match itself and the check
        // could never fail. It was written that way, and passed vacuously, for as long
        // as it existed.
        if (!lines.slice(r.start, r.end).some((l) => re.test(l)))
          problems.push(`\`${name}\` is not in ${r.start}-${r.end} ("${r.name}")`);
      }
    expect(
      problems,
      `a //#region marker names an anchor that is not in its region:\n  ${problems.join('\n  ')}\n` +
        '  The code moved, or the anchor was renamed — update the marker in main.ts.',
    ).toEqual([]);
  });

  it('every region has a name and a description', () => {
    const thin = regions
      .filter((r) => !r.name || !r.desc)
      .map((r) => `line ${r.start}: "${r.name}"`);
    expect(thin, `region markers missing a name or description:\n  ${thin.join('\n  ')}`).toEqual([]);
  });
});
