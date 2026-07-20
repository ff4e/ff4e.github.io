/**
 * KAJUTA1 (room 45) mechanics (URoom.pas:5007-5080, 9276-9525): disables death lines,
 * and reacts to the gspec=4 screen-shove (the fish apologize + reset gspec). The shove
 * detection itself is host logic, exercised by the UI probe (test-kajuta1.mjs).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { KAJUTA1 } from '../src/rooms/kajuta1.js';

const R = { truhla: 1, papouch: 2, chobot: 4, lebka: 5, malar: 8, velkar: 9 } as const;
const ROOM_MOV = 6;

function kajuta1(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 9; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 20, y: 20 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 3 });
    else items.push({ kind: 'static', x: i, y: 12 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  KAJUTA1.init(s);
  return s;
}

describe('KAJUTA1', () => {
  it('disables the standard death commentary', () => {
    const s = kajuta1();
    expect(s.stdHlaskySmrti).toBe(false);
  });

  it('reacts to the screen-shove (gspec=4): apologizes and marks it handled', () => {
    const s = kajuta1();
    s.room.gspec = 4; // the host slid the view
    KAJUTA1.prog(s); // no dialogue queued -> the else branch fires
    expect(s.vars(0)[ROOM_MOV]).toBe(1);
  });
});
