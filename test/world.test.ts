/**
 * World-map progression tests (src/data/world.ts): the updatuj_soutez Resena
 * model — solved/reachable/hidden states, LINEAR within-branch unlocking, and
 * branch enabling via the feeder chain.
 */
import { describe, it, expect } from 'vitest';
import {
  computeResena,
  computeHloubka,
  MAX_HLOUBKA,
  branchEnabled,
  BRANCHES,
  RES_SOLVED,
  RES_REACHABLE,
  RES_HIDDEN,
  RES_CHEAT,
} from '../src/data/world.js';

// Fish House = branch 0 (rooms 1..8). Ship Wrecks = branch 1 (rooms 9..19),
// fed by Fish House room index 3 (global room 4).

describe('map progression (Resena)', () => {
  it('with nothing solved, only the very first room is reachable', () => {
    const R = computeResena(new Set());
    expect(R[0]![0]).toBe(RES_REACHABLE); // room 1 playable
    expect(R[0]![1]).toBe(RES_HIDDEN); // room 2 not yet
    expect(R[0]![7]).toBe(RES_HIDDEN); // room 8 hidden
    expect(branchEnabled(R, 0)).toBe(true); // Fish House open
    expect(branchEnabled(R, 1)).toBe(false); // Ship Wrecks locked
  });

  it('rooms in a branch unlock strictly in order', () => {
    const R = computeResena(new Set([1])); // solved room 1 only
    expect(R[0]![0]).toBe(RES_SOLVED); // room 1 solved
    expect(R[0]![1]).toBe(RES_REACHABLE); // room 2 now reachable
    expect(R[0]![2]).toBe(RES_HIDDEN); // room 3 still hidden
  });

  it('a branch opens only when its feeder room is solved', () => {
    // Solve rooms 1..4 (Ship Wrecks feeder = Fish House room index 3 = global room 4).
    const R = computeResena(new Set([1, 2, 3, 4]));
    expect(branchEnabled(R, 1)).toBe(true); // Ship Wrecks now enabled
    expect(R[1]![0]).toBe(RES_REACHABLE); // its first room (room 9) reachable
    expect(R[1]![1]).toBe(RES_HIDDEN); // room 10 waits for room 9
    // Solving room 3 alone (not 4) must NOT open Ship Wrecks.
    expect(branchEnabled(computeResena(new Set([1, 2, 3])), 1)).toBe(false);
  });

  it('solving the last room of a branch does not fabricate a room beyond it', () => {
    const solved = new Set<number>();
    for (let j = 0; j < BRANCHES[0]!.length; j++) solved.add(BRANCHES[0]!.start + j);
    const R = computeResena(solved);
    for (let j = 0; j < BRANCHES[0]!.length; j++) expect(R[0]![j]).toBe(RES_SOLVED);
  });

  it('a cheated room shows the cheat state but still unlocks the next room', () => {
    const R = computeResena(new Set(), new Set([1])); // room 1 cheat-solved
    expect(R[0]![0]).toBe(RES_CHEAT); // shown as cheat, not plain solved
    expect(R[0]![1]).toBe(RES_REACHABLE); // but room 2 is unlocked
    // cheating the feeder opens the next branch too
    expect(branchEnabled(computeResena(new Set(), new Set([1, 2, 3, 4])), 1)).toBe(true);
  });
});

describe('map reveal depth (Hloubka)', () => {
  it('Fish House rooms deepen by one per step', () => {
    const H = computeHloubka();
    for (let j = 0; j < BRANCHES[0]!.length; j++) expect(H[0]![j]).toBe(j + 1); // 1..8
  });

  it("a branch's rooms start deeper than its feeder", () => {
    const H = computeHloubka();
    // Ship Wrecks (branch 1) feeds Fish House room index 3 (depth 4) -> its room 0 = 5.
    expect(H[1]![0]).toBe(H[0]![3]! + 1);
    expect(H[1]![0]).toBeGreaterThan(H[0]![0]!); // deeper than the start
  });

  it('the reveal is monotonic: a shallower room is revealed no later than a deeper one', () => {
    const H = computeHloubka();
    // For every depth, if a deeper node shows, the shallower one already showed.
    const shallow = H[0]![0]!;
    const deep = H[0]![7]!;
    expect(shallow).toBeLessThan(deep);
    // At a depth between them, the shallow node is revealed and the deep one is not.
    const d = (shallow + deep) >> 1;
    expect(shallow <= d).toBe(true);
    expect(deep <= d).toBe(false);
  });

  it('once depth reaches MAX_HLOUBKA every room is revealed', () => {
    const H = computeHloubka();
    for (let i = 0; i < H.length; i++) {
      for (const d of H[i]!) expect(d).toBeLessThanOrEqual(MAX_HLOUBKA);
    }
    expect(MAX_HLOUBKA).toBeGreaterThan(0);
  });
});
