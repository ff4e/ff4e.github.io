/**
 * Where a controller's selection can go on the world map, and where it goes next.
 *
 * The map is played with a pointer: a click on a room node or a corner button. A
 * controller has no pointer, so the map keeps one SELECTED target at all times instead
 * and the stick moves it. This is the geometry half of that — pure functions over the
 * map's own data, so it can be tested without a canvas. Which target is selected, and
 * what pressing Ⓐ on it does, is `src/app/mapSelect.ts`.
 *
 * The selectable set is exactly what a click can reach: the nodes `WorldMap.hitTest`
 * answers for (reachable or solved, on an enabled branch) and the corner buttons
 * `cornerAction` answers for. Exit is left out because it is left unwired on the web —
 * there is no tab to close (`mapNav.ts`).
 */
import { BRANCHES, KULXY, N_BRANCHES, branchEnabled, computeResena } from '../data/world.js';
import { MAP_H, MAP_W, type MapAction } from './worldMap.js';

export type MapTarget =
  | { kind: 'node'; room: number; x: number; y: number }
  | { kind: 'corner'; action: MapAction; x: number; y: number };

export type MapStep = 'up' | 'down' | 'left' | 'right';

/** A room node's centre in map space (KULXY, the same table `hitTest` measures from). */
export function nodeCenter(room: number): { x: number; y: number } {
  return { x: KULXY[(room - 1) * 2]!, y: KULXY[(room - 1) * 2 + 1]! };
}

/** Every room node a click could reach right now, with its centre. */
export function selectableNodes(
  solved: ReadonlySet<number>,
  cheated: ReadonlySet<number>,
): Extract<MapTarget, { kind: 'node' }>[] {
  const resena = computeResena(solved, cheated);
  const out: Extract<MapTarget, { kind: 'node' }>[] = [];
  for (let b = 0; b < N_BRANCHES; b++) {
    if (!branchEnabled(resena, b)) continue;
    const br = BRANCHES[b]!;
    for (let j = 0; j < br.length; j++) {
      if (resena[b]![j] === 0) continue; // hidden: not clickable either
      const room = br.start + j;
      out.push({ kind: 'node', room, ...nodeCenter(room) });
    }
  }
  return out;
}

/**
 * The centroid of each corner button's region, scanned once from the mask through the
 * same lookup a click uses. Exit is skipped (unwired on the web).
 */
export function cornerCentroids(
  cornerAt: (x: number, y: number) => MapAction | null,
): Extract<MapTarget, { kind: 'corner' }>[] {
  const sum = new Map<MapAction, { x: number; y: number; n: number }>();
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const action = cornerAt(x, y);
      if (!action || action === 'exit') continue;
      const s = sum.get(action) ?? { x: 0, y: 0, n: 0 };
      s.x += x;
      s.y += y;
      s.n++;
      sum.set(action, s);
    }
  }
  return [...sum.entries()].map(([action, s]) => ({
    kind: 'corner' as const,
    action,
    x: Math.round(s.x / s.n),
    y: Math.round(s.y / s.n),
  }));
}

/**
 * The target a push in `dir` lands on: the nearest one genuinely in that direction,
 * preferring targets in line with the push over ones off to the side. Null when nothing
 * lies that way, so the selection stays put rather than wrapping somewhere surprising.
 */
export function nearestInDirection<T extends { x: number; y: number }>(
  from: { x: number; y: number },
  targets: readonly T[],
  dir: MapStep,
): T | null {
  const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  let best: T | null = null;
  let bestScore = Infinity;
  for (const t of targets) {
    const dx = t.x - from.x;
    const dy = t.y - from.y;
    const along = dx * vx + dy * vy;
    if (along <= 2) continue; // behind, beside, or the target itself
    const across = Math.abs(dx * vy - dy * vx);
    const score = along + across * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = t;
    }
  }
  return best;
}
