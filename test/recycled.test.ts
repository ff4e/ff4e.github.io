/**
 * RECYCLED (room 30) deterministic mechanics (URoom.pas:8368-8402, 21469-21593):
 * the steel-roller hoist flag, the grumpy crab's fall counter (`dopad`), its
 * doze/wake (`spi`) transition, and the room's proximity counter (`pobliz`). The
 * RNG-heavy dialogue is gated on both fish alive + no dialogue; these tests close
 * that gate (kill the little fish) and exercise the always-run object logic.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { RECYCLED } from '../src/rooms/recycled.js';

const R = { valec: 3, krab: 5, malar: 6, velkar: 7 } as const;
const KRAB_SPI = 1;
const KRAB_DOPAD = 2;
const ROOM_ZVEDNOUT = 1;
const ROOM_POBLIZ = 4;

/** A RECYCLED-shaped room: malar (6) little, velkar (7) big, valec (3) roller,
 *  krab (5) mid-room; other slots are single-cell fillers. */
function recycled(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 7; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 2, y: 25 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 6, y: 25 });
    else if (i === R.krab) items.push({ kind: 'static', x: 15, y: 15 });
    else if (i === R.valec) items.push({ kind: 'heavy', x: 20, y: 20 });
    else items.push({ kind: 'static', x: i, y: 3 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const s = new Script(room, () => 0);
  RECYCLED.init(s);
  s.room.alive.little = false; // close the dialogue gate for object tests
  return s;
}

describe('RECYCLED crab + roller mechanics', () => {
  it('marks the hoist when the roller is pushed up', () => {
    const s = recycled();
    expect(s.vars(0)[ROOM_ZVEDNOUT]).toBe(0);
    s.item(R.valec).dir = Dir.up;
    RECYCLED.prog(s);
    expect(s.vars(0)[ROOM_ZVEDNOUT]).toBe(1);
  });

  it("resets the crab's fall counter while it falls, else increments it", () => {
    const s = recycled();
    const kr = s.vars(R.krab);
    kr[KRAB_DOPAD] = 500;
    s.item(R.krab).dir = Dir.down;
    RECYCLED.prog(s);
    expect(kr[KRAB_DOPAD]).toBe(0); // falling → reset

    s.item(R.krab).dir = Dir.no;
    RECYCLED.prog(s);
    expect(kr[KRAB_DOPAD]).toBe(1); // at rest → count up
  });

  it('wakes the sleeping crab (spi) when it is nudged into motion', () => {
    const s = recycled();
    const kr = s.vars(R.krab);
    expect(kr[KRAB_SPI]).toBe(0); // starts asleep
    s.item(R.krab).dir = Dir.left; // shoved
    RECYCLED.prog(s);
    expect(kr[KRAB_SPI]).toBeGreaterThan(0); // now awake (and ticking)
  });

  it('accumulates pobliz while a fish stands on the crab, resets when away', () => {
    const s = recycled();
    const krab = s.item(R.krab);
    // Park the big fish onto the crab cell.
    s.item(R.velkar).x = krab.x;
    s.item(R.velkar).y = krab.y;
    RECYCLED.prog(s);
    expect(s.vars(0)[ROOM_POBLIZ]).toBeGreaterThan(0);

    // Move it far away → the counter resets.
    s.item(R.velkar).x = 0;
    s.item(R.velkar).y = 0;
    RECYCLED.prog(s);
    expect(s.vars(0)[ROOM_POBLIZ]).toBe(0);
  });
});
