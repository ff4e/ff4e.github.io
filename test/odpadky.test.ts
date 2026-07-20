/**
 * ODPADKY (room 41) deterministic mechanics (URoom.pas:6316-6339, 14070-14129):
 * the big fish pulling random faces while `xichtit`, and the shared `oanim` trigger.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { ODPADKY } from '../src/rooms/odpadky.js';

const ROOM_OANIM = 4;
const VELKAR_XICHTIT = 1;

function odpadky(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 7; i++) {
    if (i === 2) items.push({ kind: 'big', x: 10, y: 10 }); // velkar
    else if (i === 1) items.push({ kind: 'little', x: 2, y: 2 });
    else items.push({ kind: 'static', x: i * 2, y: 20 });
  }
  const s = new Script(makeRoom({ w: 30, h: 30, items }), () => 0);
  ODPADKY.init(s);
  return s;
}

describe('ODPADKY big-fish faces', () => {
  it('pulls a face frame while xichtit, resets to neutral otherwise', () => {
    const s = odpadky();
    s.vars(2)[VELKAR_XICHTIT] = 1;
    ODPADKY.prog(s);
    expect(s.xicht('big')).toBeGreaterThanOrEqual(0);
    expect(s.xicht('big')).toBeLessThanOrEqual(10);

    s.vars(2)[VELKAR_XICHTIT] = 0;
    ODPADKY.prog(s);
    expect(s.xicht('big')).toBe(0);
  });

  it('advances a pending oanim (1 -> 3) with its follow-up remark', () => {
    const s = odpadky();
    s.vars(0)[ROOM_OANIM] = 1;
    ODPADKY.prog(s);
    expect(s.vars(0)[ROOM_OANIM]).toBe(3);
  });
});
