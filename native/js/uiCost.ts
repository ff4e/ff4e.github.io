/**
 * What drawing the UI layer cost, by phase: the work a menu's first frame can stall on
 * (rasterising its shapes, its glyphs and its icons, and making its textures) against the
 * drawing itself. `uiLayer.ts` resets it before each paint and reports it when a menu opens
 * (`console.log`, which on an Apple TV is the device console), so a slow first menu says
 * which phase was slow. The menu smoke reads it to bound a first open's cost.
 *
 * The same phases are what a REHEARSAL spends its budget on: `rehearse` runs a paint whose
 * only purpose is to fill those caches, and stops it (`OutOfBudget`) before the next thing it
 * would rasterise once the budget is spent — so the menus can be made ready a few
 * milliseconds a frame, and whatever was left is picked up by the next frame's rehearsal.
 */

export type CostPhase = 'shapes' | 'glyphs' | 'icons' | 'surface';

export interface Cost {
  /** Milliseconds spent in each phase, and how many things it made. */
  readonly ms: Record<CostPhase, number>;
  readonly n: Record<CostPhase, number>;
  /** The shapes' rasterised pixels (their masks' areas). */
  shapePx: number;
}

const fresh = (): Cost => ({ ms: { shapes: 0, glyphs: 0, icons: 0, surface: 0 }, n: { shapes: 0, glyphs: 0, icons: 0, surface: 0 }, shapePx: 0 });

let cost: Cost = fresh();
let depth = 0;
/** A rehearsal's budget and what it has spent, in ms; no budget outside one. */
let budget = Infinity;
let spent = 0;

/** A rehearsal ran out of budget: it stops, nothing half-made is kept. */
class OutOfBudget extends Error {}

/** Start counting afresh (a paint begins). */
export function resetCost(): void {
  cost = fresh();
}

/** What was counted since the last reset. */
export function currentCost(): Cost {
  return cost;
}

/**
 * Run `f`, counting its time to `phase`. Nested phases (an icon's masks are textures, too)
 * count only to the outermost, so the phases add up to no more than the paint.
 */
export function costed<T>(phase: CostPhase, f: () => T): T {
  if (depth++ > 0) {
    try {
      return f();
    } finally {
      depth--;
    }
  }
  if (spent >= budget) {
    depth--;
    throw new OutOfBudget();
  }
  const t0 = __native.now();
  try {
    return f();
  } finally {
    depth--;
    const ms = __native.now() - t0;
    spent += ms;
    cost.ms[phase] += ms;
    cost.n[phase]++;
  }
}

/**
 * Run `paint` for its caches alone, spending at most about `budgetMs` (> 0) on what it makes:
 * true when it finished, false when it stopped for the budget (run it again later — what it
 * made so far is kept, so each run gets further). The first thing it makes always runs, so a
 * thing dearer than the budget still gets made.
 */
export function rehearse(paint: () => void, budgetMs: number): boolean {
  budget = Math.max(Number.MIN_VALUE, budgetMs);
  spent = 0;
  try {
    paint();
    return true;
  } catch (e) {
    if (e instanceof OutOfBudget) return false;
    throw e;
  } finally {
    budget = Infinity;
  }
}

/** `c` as one log line's worth: each phase that did anything, its time and its count. */
export function describeCost(c: Cost, totalMs: number): string {
  const parts = (Object.keys(c.ms) as CostPhase[])
    .filter((p) => c.n[p] > 0)
    .map((p) => `${p} ${c.ms[p].toFixed(1)} ms (${c.n[p]}${p === 'shapes' ? `, ${(c.shapePx / 1e6).toFixed(2)} Mpx` : ''})`);
  const rest = totalMs - (Object.values(c.ms) as number[]).reduce((a, b) => a + b, 0);
  return `${totalMs.toFixed(1)} ms: ${[...parts, `drawing ${Math.max(0, rest).toFixed(1)} ms`].join(', ')}`;
}
