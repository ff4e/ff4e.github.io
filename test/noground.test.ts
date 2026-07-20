/**
 * NOGROUND (room 39) deterministic mechanics (URoom.pas:6630-6653, 15348-15383):
 * the `smet` rubbish-heap countdown and the one-shot intro flag.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { NOGROUND } from '../src/rooms/noground.js';

const ROOM_UVOD = 1;
const ROOM_SMET = 2;

function noground(): Script {
  const items: ItemSpec[] = [
    { kind: 'static', x: 10, y: 10 },
    { kind: 'big', x: 6, y: 6 }, // velkar (2)
    { kind: 'little', x: 2, y: 2 }, // malar (3)
  ];
  const s = new Script(makeRoom({ w: 30, h: 30, items }), () => 0);
  NOGROUND.init(s);
  return s;
}

describe('NOGROUND', () => {
  it('counts down the rubbish-heap timer once the intro is past', () => {
    const s = noground();
    s.vars(0)[ROOM_UVOD] = 1; // intro done
    s.vars(0)[ROOM_SMET] = 5;
    NOGROUND.prog(s);
    expect(s.vars(0)[ROOM_SMET]).toBe(4);
  });

  it('fires the intro exactly once', () => {
    const s = noground();
    s.vars(0)[ROOM_UVOD] = 0;
    NOGROUND.prog(s);
    expect(s.vars(0)[ROOM_UVOD]).toBe(1);
  });
});
