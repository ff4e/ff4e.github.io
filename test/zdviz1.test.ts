/**
 * ZDVIZ1 (room 20) deterministic mechanics — the elevator/gear/painter logic that
 * doesn't depend on RNG (URoom.pas:6069-6128, 13286-13408). The story dialogue is
 * gated on both fish being alive + no active dialogue; every test that targets the
 * always-run blocks (gear, elevator latch, painter ride-counters) kills the little
 * fish first so that gate is closed and no RNG/dialogue runs.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { ZDVIZ1 } from '../src/rooms/zdviz1.js';

const R = { vytah: 1, stroj: 2, dedek: 5, malar: 6, velkar: 7 } as const;
const DEDEK_MLUVI = 1;
const JEDE = 1;

/** A ZDVIZ1-shaped room: 1 vytah, 2 stroj, 3 shelka, 4 hlavicka, 5 dedek, 6 malar
 *  (little), 7 velkar (big), 8 llebka. The lift sits mid-room; the gear is one
 *  cell to its left (X = vytah.X-1), matching the gear's activation condition. */
function zdviz1(): Script {
  const room = makeRoom({
    w: 30,
    h: 30,
    items: [
      { kind: 'heavy', x: 10, y: 10 }, // 1: vytah (elevator)
      { kind: 'static', x: 9, y: 10 }, // 2: stroj (gear) — X = vytah.X-1
      { kind: 'static', x: 20, y: 2 }, // 3: shelka
      { kind: 'static', x: 22, y: 2 }, // 4: hlavicka
      { kind: 'static', x: 24, y: 2 }, // 5: dedek
      { kind: 'little', x: 2, y: 20 }, // 6: malar (little fish)
      { kind: 'big', x: 6, y: 20 }, // 7: velkar (big fish)
      { kind: 'static', x: 26, y: 2 }, // 8: llebka
    ],
  });
  const s = new Script(room, () => 0);
  ZDVIZ1.init(s);
  return s;
}

describe('ZDVIZ1 init', () => {
  it('seeds the ride targets in range and marks the gear/lift specs', () => {
    const s = zdviz1();
    const v = s.vars(0);
    expect(v[4]! >= 3 && v[4]! <= 17).toBe(true); // jizdam = random(15)+3
    expect(v[5]! >= 10 && v[5]! <= 59).toBe(true); // jizdav = random(50)+10
    expect(v[6]).toBe(0); // huhuh
    expect(s.item(R.vytah).spec).toBe(4);
    expect(s.item(R.stroj).spec).toBe(3);
    expect(s.vars(R.dedek)[DEDEK_MLUVI]).toBe(0);
    expect(s.vars(R.malar)[JEDE]).toBe(0);
    expect(s.vars(R.velkar)[JEDE]).toBe(0);
  });
});

describe('ZDVIZ1 gear (stroj) rotation', () => {
  /** Run one prog() with the gear at X=vytah.X-1 and given dir combo; return the
   *  resulting gear afaze (starting from afaze0). Dialogue is disabled. */
  function gearAfter(afaze0: number, strojDir: number, vytahDir: number): number {
    const s = zdviz1();
    s.room.alive.little = false; // close the story-dialogue gate
    const stroj = s.item(R.stroj);
    const vytah = s.item(R.vytah);
    stroj.x = vytah.x - 1;
    stroj.afaze = afaze0;
    stroj.dir = strojDir;
    vytah.dir = vytahDir;
    ZDVIZ1.prog(s);
    return s.item(R.stroj).afaze;
  }

  it('advances +1/+2 and -1/-2 per the lift-vs-gear direction pairs', () => {
    expect(gearAfter(0, Dir.no, Dir.down)).toBe(2); // +2
    expect(gearAfter(0, Dir.up, Dir.no)).toBe(1); // +1
    expect(gearAfter(3, Dir.no, Dir.up)).toBe(2); // -1
    expect(gearAfter(3, Dir.down, Dir.no)).toBe(1); // -2
    expect(gearAfter(3, Dir.no, Dir.no)).toBe(3); // else: unchanged
  });

  it('wraps the 6-frame cycle (afaze stays in 0..5)', () => {
    expect(gearAfter(5, Dir.up, Dir.no)).toBe(0); // 5+1 -> 0
    expect(gearAfter(5, Dir.no, Dir.down)).toBe(1); // 5+2 -> 1
    expect(gearAfter(0, Dir.no, Dir.up)).toBe(5); // 0-1 -> 5
    expect(gearAfter(0, Dir.down, Dir.no)).toBe(4); // 0-2 -> 4
  });

  it('does nothing unless the gear sits at X = vytah.X-1', () => {
    const s = zdviz1();
    s.room.alive.little = false;
    const stroj = s.item(R.stroj);
    const vytah = s.item(R.vytah);
    stroj.x = vytah.x - 2; // not adjacent
    stroj.afaze = 3;
    stroj.dir = Dir.no;
    vytah.dir = Dir.down;
    ZDVIZ1.prog(s);
    expect(s.item(R.stroj).afaze).toBe(3); // untouched
  });
});

describe('ZDVIZ1 elevator intro latch', () => {
  it('latches roompole[0] from 0 to 1 the first time the lift rises', () => {
    const s = zdviz1();
    s.room.alive.little = false;
    expect(s.roompole[0]).toBe(0);
    s.item(R.vytah).dir = Dir.up;
    ZDVIZ1.prog(s);
    expect(s.roompole[0]).toBe(1);
    s.item(R.vytah).dir = Dir.up;
    ZDVIZ1.prog(s);
    expect(s.roompole[0]).toBe(1); // one-way latch, stays 1
  });
});

describe('ZDVIZ1 painter ride-counter', () => {
  it('increments malar_jede only while the little fish rides the lift upward', () => {
    const s = zdviz1();
    s.room.alive.little = false;
    const vytah = s.item(R.vytah);
    const malar = s.item(R.malar);
    // In-bounds and rising -> increments each tick.
    malar.x = vytah.x + 1;
    malar.y = vytah.y + 2;
    vytah.dir = Dir.up;
    ZDVIZ1.prog(s);
    ZDVIZ1.prog(s);
    expect(s.vars(R.malar)[JEDE]).toBe(2);
    // Lift not moving up -> no increment.
    vytah.dir = Dir.no;
    ZDVIZ1.prog(s);
    expect(s.vars(R.malar)[JEDE]).toBe(2);
    // Rising but the fish stepped off the platform -> no increment.
    vytah.dir = Dir.up;
    malar.x = vytah.x + 10;
    ZDVIZ1.prog(s);
    expect(s.vars(R.malar)[JEDE]).toBe(2);
  });
});
