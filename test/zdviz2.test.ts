/**
 * ZDVIZ2 (room 28) deterministic mechanics (URoom.pas:6132-6178, 13409-13561):
 * the gear rotation (shared with ZDVIZ1) and the old man's wave/shout state
 * machine. The RNG-heavy story dialogue is gated on both fish being alive + no
 * active dialogue, so tests that target the always-run blocks kill the little fish
 * first to close that gate.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { ZDVIZ2 } from '../src/rooms/zdviz2.js';

const R = { vytah: 1, stroj: 2, dedek: 6, malar: 7, velkar: 8, hlava: 9 } as const;
const MLUVI = 1;
const POHLSE = 2;
const MAVANI = 3;

/** A ZDVIZ2-shaped room: 1 vytah, 2 stroj (at X=vytah.X-1), 6 dedek, 7 malar
 *  (little), 8 velkar (big), 9 hlava; 3-5 are fillers. */
function zdviz2(): Script {
  const room = makeRoom({
    w: 30,
    h: 30,
    items: [
      { kind: 'heavy', x: 10, y: 10 }, // 1: vytah
      { kind: 'static', x: 9, y: 10 }, // 2: stroj (gear) — X = vytah.X-1
      { kind: 'static', x: 20, y: 2 }, // 3: filler
      { kind: 'static', x: 22, y: 2 }, // 4: filler
      { kind: 'static', x: 24, y: 2 }, // 5: filler
      { kind: 'static', x: 15, y: 5 }, // 6: dedek
      { kind: 'little', x: 2, y: 20 }, // 7: malar (little fish)
      { kind: 'big', x: 6, y: 20 }, // 8: velkar (big fish)
      { kind: 'static', x: 15, y: 27 }, // 9: hlava
    ],
  });
  const s = new Script(room, () => 0);
  ZDVIZ2.init(s);
  return s;
}

describe('ZDVIZ2 init', () => {
  it('zeroes the room flags, marks the gear/lift specs, seeds dedek', () => {
    const s = zdviz2();
    const v = s.vars(0);
    for (let i = 1; i <= 8; i++) expect(v[i]).toBe(0);
    expect(s.item(R.vytah).spec).toBe(4);
    expect(s.item(R.stroj).spec).toBe(3);
    const d = s.vars(R.dedek);
    expect(d[MLUVI]).toBe(0);
    expect(d[POHLSE]).toBe(0);
    expect(d[MAVANI]! >= 1 && d[MAVANI]! <= 3).toBe(true); // nah(1,3)
  });
});

describe('ZDVIZ2 gear (stroj) rotation', () => {
  function gearAfter(afaze0: number, strojDir: number, vytahDir: number): number {
    const s = zdviz2();
    s.room.alive.little = false; // close the dialogue gate
    const stroj = s.item(R.stroj);
    const vytah = s.item(R.vytah);
    stroj.x = vytah.x - 1;
    stroj.afaze = afaze0;
    stroj.dir = strojDir;
    vytah.dir = vytahDir;
    ZDVIZ2.prog(s);
    return s.item(R.stroj).afaze;
  }

  it('advances and wraps identically to ZDVIZ1', () => {
    expect(gearAfter(0, Dir.no, Dir.down)).toBe(2);
    expect(gearAfter(0, Dir.up, Dir.no)).toBe(1);
    expect(gearAfter(5, Dir.up, Dir.no)).toBe(0); // wrap +1
    expect(gearAfter(0, Dir.no, Dir.up)).toBe(5); // wrap -1
    expect(gearAfter(0, Dir.down, Dir.no)).toBe(4); // wrap -2
    expect(gearAfter(3, Dir.no, Dir.no)).toBe(3); // unchanged
  });
});

describe('ZDVIZ2 dedek (old man) animation', () => {
  /** Prep a room with the dialogue gate closed and dedek in a known state. */
  function dedekRoom(mluvi: number, mavani: number, dir: number): Script {
    const s = zdviz2();
    s.room.alive.little = false;
    const d = s.vars(R.dedek);
    d[MLUVI] = mluvi;
    d[MAVANI] = mavani;
    d[POHLSE] = 0;
    s.item(R.dedek).dir = dir;
    return s;
  }

  it('animates the wave frame from the speaking priority (mavani > 0)', () => {
    let s = dedekRoom(101, 5, Dir.no);
    ZDVIZ2.prog(s);
    expect(s.item(R.dedek).afaze).toBe(1); // mluvi 101 -> frame 1
    expect(s.vars(R.dedek)[MAVANI]).toBe(4); // decremented

    s = dedekRoom(102, 5, Dir.no);
    ZDVIZ2.prog(s);
    expect(s.item(R.dedek).afaze).toBe(2); // mluvi 102 -> frame 2
    expect(s.vars(R.dedek)[MAVANI]).toBe(4);

    s = dedekRoom(0, 5, Dir.no);
    ZDVIZ2.prog(s);
    expect(s.item(R.dedek).afaze).toBe(0); // silent -> frame 0
    expect(s.vars(R.dedek)[MAVANI]).toBe(5); // NOT decremented in the else/default
  });

  it('resets the wave countdown when it reaches 0 (frame keyed on mluvi=102)', () => {
    let s = dedekRoom(102, 0, Dir.no);
    ZDVIZ2.prog(s);
    expect(s.item(R.dedek).afaze).toBe(1); // mavani==0 branch: 102 -> 1
    let m = s.vars(R.dedek)[MAVANI]!;
    expect(m >= 1 && m <= 3).toBe(true); // reseeded via nah(1,3)

    s = dedekRoom(101, 0, Dir.no);
    ZDVIZ2.prog(s);
    expect(s.item(R.dedek).afaze).toBe(0); // mavani==0 branch: not 102 -> 0
    m = s.vars(R.dedek)[MAVANI]!;
    expect(m >= 1 && m <= 3).toBe(true);
  });

  it('latches pohlse once the old man has been nudged (dir != no)', () => {
    const s = dedekRoom(0, 5, Dir.up);
    expect(s.vars(R.dedek)[POHLSE]).toBe(0);
    ZDVIZ2.prog(s);
    expect(s.vars(R.dedek)[POHLSE]).toBe(1);
  });
});
