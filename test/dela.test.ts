/**
 * DELA (room 47) mechanics (URoom.pas:6035-6068, 13204-13285): the staggered cannon-
 * fuse afaze cycles and the lone-little-fish edge aside (busy) once the big fish is out.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { DELA } from '../src/rooms/dela.js';

const R = { delo1: 2, delo3: 6, malar: 10, velkar: 11, delo2: 13, delo4: 14 } as const;
const ROOM_JO = 4;

function dela(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 14; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 1, y: 20 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 15, y: 2 });
    else items.push({ kind: 'static', x: (i % 12) + 1, y: 10 });
  }
  const s = new Script(makeRoom({ w: 30, h: 30, items }), () => 0);
  DELA.init(s);
  return s;
}

describe('DELA cannon fuses', () => {
  it('cycles each cannon afaze on its staggered count%4 phase', () => {
    const s = dela(); // count = 0
    DELA.prog(s);
    expect(s.item(R.delo3).afaze).toBe(2); // count%4=0 -> 2
    expect(s.item(R.delo1).afaze).toBe(0); // (count+1)%4=1 -> 0
    expect(s.item(R.delo2).afaze).toBe(1); // (count+3)%4=3 -> 1
  });
});

describe('DELA lone little fish', () => {
  it('gives a one-off aside at a side edge once the big fish has swum out', () => {
    const s = dela();
    s.room.exitFish('big'); // big fish swims out (alive=false, venku=true)
    s.item(R.malar).x = 1; // at the left edge (<2)
    DELA.prog(s);
    expect(s.vars(0)[ROOM_JO]).toBe(1);
  });
});
