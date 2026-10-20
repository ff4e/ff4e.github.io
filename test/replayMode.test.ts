/**
 * The map "Replay" driver itself (`src/app/replayMode.ts`), against a stubbed game.
 *
 * `test/replayRules.test.ts` proves WHY the rules are needed, on the real rooms, but it runs
 * the shared step engine and cannot see this module — it would stay green if
 * `advanceReplay` stopped applying them. This is the other half: the driver, with the
 * engine reduced to the few fields it touches.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const g = vi.hoisted(() => ({
  count: 0,
  room: { anyFishDead: false, facingRight: { little: true, big: true } },
  engine: { active: 'little' as 'little' | 'big', jizda: 0 },
  replaymode: null as { moves: { which: 'little' | 'big'; dir: number }[]; idx: number } | null,
  played: [] as { which: string; dir: number; jizda: number }[],
  result: 'moving' as 'moving' | 'turning' | 'blocked' | 'busy',
}));
vi.mock('../src/app/gameState.js', () => ({
  get count() { return g.count; },
  get engine() { return g.engine; },
  get room() { return g.room; },
  get replaymode() { return g.replaymode; },
  setReplaymode: (v: typeof g.replaymode) => { g.replaymode = v; },
  hracNespi: () => {},
}));
vi.mock('../src/app/mapNav.js', () => ({ showMap: () => {} }));
vi.mock('../src/app/movement.js', () => ({
  tryStep: (which: string, dir: number) => {
    g.played.push({ which, dir, jizda: g.engine.jizda });
    return g.result;
  },
}));

import { advanceReplay, replayAtShowmodeSpot, replaySettleDue } from '../src/app/replayMode.js';

/** One logic tick as `logicTick` drives it: `count` advances, then the driver runs. */
function tick(startedIdle: boolean): void {
  g.count++;
  advanceReplay(startedIdle);
}

beforeEach(() => {
  g.count = 100;
  g.engine = { active: 'little', jizda: 0 };
  g.room = { anyFishDead: false, facingRight: { little: true, big: true } };
  g.replaymode = { moves: [{ which: 'big', dir: 1 }, { which: 'little', dir: 2 }], idx: 0 };
  g.played = [];
  g.result = 'moving';
});

describe('advanceReplay', () => {
  it('never plays on a tick that only became idle, and asks for its settled tick at once', () => {
    g.engine.jizda = 9;
    tick(false); // the landing tick
    expect(g.played).toEqual([]);
    expect(replaySettleDue()).toBe(true);
  });

  it("plays on the settled tick, carrying the landing's jizda like a held key", () => {
    g.engine.jizda = 9;
    tick(false);
    g.engine.jizda = 0; // `advance()` resets it on the settled tick
    tick(true);
    expect(g.played).toEqual([{ which: 'big', dir: 1, jizda: 9 }]);
    expect(g.engine.active).toBe('big');
    expect(g.replaymode?.idx).toBe(1);
    expect(replaySettleDue()).toBe(false);
  });

  it('carries nothing into a tick that did not immediately follow the landing', () => {
    g.engine.jizda = 9;
    tick(false);
    g.count++; // a tick the driver never saw (a fall, say)
    expect(replaySettleDue()).toBe(false);
    g.engine.jizda = 0;
    tick(true);
    expect(g.played[0]!.jizda).toBe(0);
  });

  it('retries a move the engine refused as busy instead of losing it', () => {
    g.result = 'busy';
    tick(true);
    tick(true);
    expect(g.played.map((p) => p.which)).toEqual(['big', 'big']);
    expect(g.replaymode?.idx).toBe(0);
    g.result = 'moving';
    tick(true);
    expect(g.replaymode?.idx).toBe(1);
  });

  it('hands control back when the record runs dry', () => {
    g.replaymode!.idx = 2;
    tick(true);
    expect(g.replaymode).toBeNull();
  });
});

describe('replayAtShowmodeSpot', () => {
  it("applies only the demonstration's unrecorded turn", () => {
    replayAtShowmodeSpot();
    expect(g.room.facingRight).toEqual({ little: true, big: false });
    expect(g.played).toEqual([]);
  });
});
