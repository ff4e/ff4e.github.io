/**
 * Hacky fishing-hook state machine (URoom.pas:23749). Deterministic unit tests
 * with an injected RNG and a mock host that records hooked kills.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { HookSystem, type HookHost } from '../src/core/hooks.js';
import type { Room } from '../src/core/room.js';

/** A 30x30 room: little fish (3x1) at (5,10) facing right, big (4x2) at (20,15). */
function room(): Room {
  return makeRoom({
    w: 30,
    h: 30,
    facing: { small: true, big: true },
    items: [
      { kind: 'little', x: 5, y: 10 },
      { kind: 'big', x: 20, y: 15 },
    ],
  });
}

/** A host that kills like the engine: zije:=false, kostra:=false. */
function mockHost(r: Room): { host: HookHost; killed: string[] } {
  const killed: string[] = [];
  const host: HookHost = {
    killByHook(which) {
      r.alive[which] = false;
      r.kostra[which] = false;
      killed.push(which);
    },
  };
  return { host, killed };
}

/** A fixed RNG returning the queued values (then 0). */
function seq(...vals: number[]): (n: number) => number {
  let i = 0;
  return () => vals[i++] ?? 0;
}

describe('HookSystem.add', () => {
  it('adds up to 10 hooks, only while a fish is alive', () => {
    const r = room();
    const { host } = mockHost(r);
    const hs = new HookSystem(host);
    for (let i = 0; i < 12; i++) hs.add(r);
    expect(hs.count).toBe(10); // capped
    // With both fish dead, no more can be added.
    const r2 = room();
    r2.alive.little = false;
    r2.alive.big = false;
    const hs2 = new HookSystem(mockHost(r2).host);
    hs2.add(r2);
    expect(hs2.count).toBe(0);
  });
});

describe('HookSystem.tick — targeting (stav 0)', () => {
  it('locks onto the little fish at its leading edge and starts descending', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    hs.tick(r, seq(0, 4)); // rnd(2)=0 -> little; rnd(8)=4 -> rychlost 7
    const h = hs.snapshot[0]!;
    expect(h.stav).toBe(1);
    expect(h.cil).toBe('little');
    expect(h.x).toBe(5 + 3); // facing right -> X + width(3)
    expect(h.y).toBe(0);
    expect(h.rychlost).toBe(7);
  });

  it('targets the big fish when the coin-flip says so', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    hs.tick(r, seq(1, 0)); // rnd(2)=1 -> big
    const h = hs.snapshot[0]!;
    expect(h.cil).toBe('big');
    expect(h.x).toBe(20 + 4); // big width 4, facing right
  });
});

describe('HookSystem.tick — descent (stav 1)', () => {
  it('descends and CATCHES the little fish, killing it (stav 3)', () => {
    const r = room();
    const { host, killed } = mockHost(r);
    const hs = new HookSystem(host);
    hs.add(r);
    hs.tick(r, seq(0, 7)); // little, rychlost 10 (fast)
    // little fish top = 10*15 = 150px; catch when y+8 > 150+15=165 -> y>157.
    for (let t = 0; t < 40 && hs.snapshot[0]!.stav === 1; t++) hs.tick(r, seq());
    const h = hs.snapshot[0]!;
    expect(h.stav).toBe(3); // caught
    expect(killed).toEqual(['little']);
    expect(r.alive.little).toBe(false);
    expect(r.kostra.little).toBe(false); // hooked, NOT a skeleton
    expect(h.y).toBe(10 * 15 - 15); // snapped to the fish top
  });

  it('MISSES (stav 2) if the fish turns away mid-descent', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    hs.tick(r, seq(0, 0)); // little, rychlost 3
    hs.tick(r, seq()); // one descent step
    r.facingRight.little = false; // the fish turns -> edge column moves
    hs.tick(r, seq());
    expect(hs.snapshot[0]!.stav).toBe(2);
  });

  it('MISSES if the fish dies (e.g. crushed) mid-descent', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    hs.tick(r, seq(0, 0));
    r.alive.little = false;
    hs.tick(r, seq());
    expect(hs.snapshot[0]!.stav).toBe(2);
  });
});

describe('HookSystem.tick — retract/drag (stav 2 / 3)', () => {
  it('retract (stav 2) rises back to idle (stav 0) above the ceiling', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    const h = hs.snapshot[0]! as { stav: number; y: number; rychlost: number };
    h.stav = 2;
    h.y = 5;
    h.rychlost = 3;
    hs.tick(r, seq()); // y -= 3+2 = 5 -> 0; still >=0, stays stav 2
    expect(h.stav).toBe(2);
    hs.tick(r, seq()); // y -= 5 -> -5 < 0 -> stav 0
    expect(h.stav).toBe(0);
  });

  it('caught drag (stav 3) pulls up 15px/tick and resets past -60', () => {
    const r = room();
    const hs = new HookSystem(mockHost(r).host);
    hs.add(r);
    const h = hs.snapshot[0]! as { stav: number; y: number };
    h.stav = 3;
    h.y = 0;
    expect(hs.busy).toBe(true);
    for (let t = 0; t < 5 && h.stav === 3; t++) hs.tick(r, seq()); // 0 -> -75
    expect(h.stav).toBe(0);
    expect(hs.busy).toBe(false);
  });
});
