/**
 * VLADOVA (room 50) mechanics (URoom.pas:5650-5725, 11720-11999): four distinct
 * chatter topics seeded in init, and the diamond twinkle FSM stepping its afaze.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { VLADOVA } from '../src/rooms/vladova.js';

const R = { malar: 3, velkar: 4, diamant1: 15 } as const;
const KEC1 = 2, KEC2 = 3, KEC3 = 4, KEC4 = 5;
const DIAMANT1_FAZE = 1;

function vladova(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 23; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 34, y: 2 });
    else items.push({ kind: 'static', x: (i % 20) + 1, y: 25 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  VLADOVA.init(s);
  return s;
}

describe('VLADOVA', () => {
  it('seeds four distinct chatter topics', () => {
    const s = vladova();
    const topics = [s.vars(0)[KEC1], s.vars(0)[KEC2], s.vars(0)[KEC3], s.vars(0)[KEC4]];
    expect(new Set(topics).size).toBe(4);
  });

  it('steps a twinkling diamond afaze up while sparkling', () => {
    const s = vladova();
    s.vars(R.diamant1)[DIAMANT1_FAZE] = 1; // in the up-phase
    s.item(R.diamant1).afaze = 0;
    VLADOVA.prog(s);
    expect(s.item(R.diamant1).afaze).toBe(1); // inc'd
  });
});
