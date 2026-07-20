/**
 * BATHROOM (room 40) deterministic mechanics (URoom.pas:7675-7714, 18732-18853):
 * the topic `switch` toggle when the `kdy` timer elapses, and the whirlpool anim tick.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { BATHROOM } from '../src/rooms/bathroom.js';

const R = { malar: 1, velkar: 2, whirlpool: 9, sprc: 15 } as const;
const ROOM_SWITCH = 1;
const ROOM_KDY = 2;

function bathroom(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 15; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 20, y: 20 }); // below-right of sprc
    else if (i === R.velkar) items.push({ kind: 'big', x: 25, y: 25 });
    else if (i === R.sprc) items.push({ kind: 'static', x: 5, y: 5 });
    else items.push({ kind: 'static', x: i, y: 12 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  BATHROOM.init(s);
  return s;
}

describe('BATHROOM topic switch', () => {
  it('toggles the switch (1<->2) and resets kdy when the timer elapses', () => {
    const s = bathroom();
    const before = s.vars(0)[ROOM_SWITCH]!;
    s.vars(0)[ROOM_KDY] = 0;
    BATHROOM.prog(s);
    expect(s.vars(0)[ROOM_SWITCH]).toBe(3 - before);
    expect(s.vars(0)[ROOM_KDY]).toBeGreaterThan(0);
  });
});
