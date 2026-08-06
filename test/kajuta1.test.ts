/**
 * KAJUTA1 (room 45) mechanics (URoom.pas:5007-5080, 9276-9525): disables death lines,
 * and reacts to the gspec=4 screen-shove (the fish apologize + reset gspec). The shove
 * detection itself is host logic, exercised by the UI probe (test-kajuta1.mjs).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { pinRandomRange } from './rng.js';
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
    // One line ABOVE the block under test, prog() re-arms the shove on a 1-in-100 draw
    // (kajuta1.ts:197, URoom.pas:9378) and that would overwrite gspec back to 3. Keep
    // every draw high so it cannot fire: the arming is not what this test is about.
    pinRandomRange(0.5, 1);
    KAJUTA1.prog(s); // no dialogue queued -> the else branch fires
    expect(s.vars(0)[ROOM_MOV]).toBe(1);
  });

  it('re-arms the shove on the 1-in-100 draw, which pre-empts the gspec=4 reaction', () => {
    const s = kajuta1();
    s.room.gspec = 4;
    // The other side of the same draw: every draw low, so `random(100) < 1` fires.
    pinRandomRange(0, 0.005);
    KAJUTA1.prog(s);
    expect(s.room.gspec).toBe(3); // armed again, so the gspec=4 branch is skipped
    expect(s.vars(0)[ROOM_MOV]).toBe(0); // no apology this tick
  });
});
