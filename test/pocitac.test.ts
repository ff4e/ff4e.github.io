/**
 * POCITAC (room 38) deterministic mechanics (URoom.pas:7828-7860, 19061-19144):
 * the two computer-musing timers count down, and roompole[0] alternates the exchange.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { POCITAC } from '../src/rooms/pocitac.js';

const ROOM_UVOD = 1;
const ROOM_OPOC1 = 3;
const ROOM_OPOC2 = 4;

function pocitac(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 8; i++) {
    if (i === 7) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === 8) items.push({ kind: 'big', x: 25, y: 2 });
    else items.push({ kind: 'static', x: i * 2, y: 20 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  POCITAC.init(s);
  return s;
}

describe('POCITAC timers', () => {
  it('counts down both computer-musing timers each tick', () => {
    const s = pocitac();
    s.vars(0)[ROOM_UVOD] = 1; // skip intro
    s.vars(0)[ROOM_OPOC1] = 50;
    s.vars(0)[ROOM_OPOC2] = 80;
    POCITAC.prog(s);
    expect(s.vars(0)[ROOM_OPOC1]).toBe(49);
    expect(s.vars(0)[ROOM_OPOC2]).toBe(79);
  });

  it('alternates roompole[0] between the two musings', () => {
    const s = pocitac();
    s.vars(0)[ROOM_UVOD] = 1;
    s.vars(0)[ROOM_OPOC1] = 1; // → hits 0 this tick, fires a musing
    s.roompole[0] = 1;
    POCITAC.prog(s);
    expect(s.roompole[0]).toBe(2); // 3 - 1
  });
});
