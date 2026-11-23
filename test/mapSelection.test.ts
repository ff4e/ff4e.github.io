/**
 * Where a controller's selection can go on the world map (src/render/mapSelection.ts).
 *
 * The selectable set must be exactly what a click can reach — `WorldMap.hitTest` at each
 * node's own centre — or the controller could open a room the mouse cannot, or miss one it
 * can. And a push must land on something genuinely that way, preferring what is in line.
 */
import { describe, expect, it } from 'vitest';
import { cornerCentroids, nearestInDirection, nodeCenter, selectableNodes } from '../src/render/mapSelection.js';
import { BRANCHES, N_BRANCHES, branchEnabled, computeResena } from '../src/data/world.js';

describe('selectableNodes', () => {
  it('is exactly the reachable-or-solved nodes on enabled branches', () => {
    for (const solved of [new Set<number>(), new Set([1, 2, 3]), new Set([1, 2, 3, 4, 5, 6, 7, 8])]) {
      const resena = computeResena(solved, new Set());
      const want: number[] = [];
      for (let b = 0; b < N_BRANCHES; b++) {
        if (!branchEnabled(resena, b)) continue;
        for (let j = 0; j < BRANCHES[b]!.length; j++) if (resena[b]![j] !== 0) want.push(BRANCHES[b]!.start + j);
      }
      const got = selectableNodes(solved, new Set()).map((t) => t.room);
      expect(got).toEqual(want);
      expect(got.length).toBeGreaterThan(0);
    }
  });

  it('places each node at its KULXY centre', () => {
    for (const t of selectableNodes(new Set([1, 2]), new Set())) expect({ x: t.x, y: t.y }).toEqual(nodeCenter(t.room));
  });
});

describe('cornerCentroids', () => {
  it('finds each wired corner, and leaves Exit out', () => {
    // A stand-in mask: four quadrant corners.
    const at = (x: number, y: number) =>
      x < 50 && y < 50 ? 'intro' : x > 590 && y < 50 ? 'exit' : x < 50 && y > 430 ? 'credits' : x > 590 && y > 430 ? 'options' : null;
    const cs = cornerCentroids(at);
    expect(cs.map((c) => c.action).sort()).toEqual(['credits', 'intro', 'options']);
    const intro = cs.find((c) => c.action === 'intro')!;
    expect(intro.x).toBeLessThan(50);
    expect(intro.y).toBeLessThan(50);
  });
});

describe('nearestInDirection', () => {
  const pts = [
    { id: 'right-near-off', x: 40, y: 30 },
    { id: 'right-far-inline', x: 60, y: 0 },
    { id: 'up', x: 0, y: -40 },
    { id: 'left', x: -30, y: 2 },
  ];
  const from = { x: 0, y: 0 };

  it('lands on what is that way, preferring what is in line', () => {
    expect(nearestInDirection(from, pts, 'right')?.id).toBe('right-far-inline');
    expect(nearestInDirection(from, pts, 'up')?.id).toBe('up');
    expect(nearestInDirection(from, pts, 'left')?.id).toBe('left');
    expect(nearestInDirection(from, pts, 'down')?.id).toBe('right-near-off');
  });

  it('stays put when nothing lies that way', () => {
    expect(nearestInDirection(from, [{ x: 0, y: 0 }, { x: 1, y: 5 }], 'right')).toBeNull();
  });
});

describe('selectionRingPixels', () => {
  it('is a binary-alpha ring, so every backend draws it byte for byte', async () => {
    const { selectionRingPixels } = await import('../src/render/mapPaintAi.js');
    const { rgba, half } = selectionRingPixels();
    const n = half * 2;
    expect(rgba.length).toBe(n * n * 4);
    const alphas = new Set<number>();
    for (let i = 3; i < rgba.length; i += 4) alphas.add(rgba[i]!);
    expect([...alphas].sort((a, b) => a - b)).toEqual([0, 255]);
    // Hollow and symmetric: the centre is clear, and a pixel and its mirror agree.
    expect(rgba[(half * n + half) * 4 + 3]).toBe(0);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      expect(rgba[(y * n + x) * 4 + 3]).toBe(rgba[((n - 1 - y) * n + (n - 1 - x)) * 4 + 3]);
    }
  });
});
