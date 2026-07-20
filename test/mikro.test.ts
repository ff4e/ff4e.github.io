/**
 * MIKRO (room 33) deterministic mechanics (URoom.pas:6176-6255, 13562-13844): the
 * roller-obstacle remark (`prekazka`), the crabs' chatter flag tracking `talking`,
 * the crab boldness reset when the fish shush them (`okrikla`), and the horse's
 * pause-timer idle. RNG dialogue is gated on both fish alive + no dialogue; object
 * tests drive the always-run creature logic (and close the gate where needed).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { MIKRO } from '../src/rooms/mikro.js';

const R = { malar: 1, velkar: 2, valec: 3, kun: 5, krab4: 8, krab1: 12 } as const;
const ROOM_OKRIKLA = 1;
const ROOM_PREKAZKA = 5;
const KUN_PAUZA = 1;
const DRZEJ = 1;
const KECA = 2;

/** A MIKRO-shaped room (items 1..12). `talking` lets a test mark crab voices as
 *  sounding (priorities 101..104). */
function mikro(talking: (p: number) => boolean = () => false): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 12; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 2 });
    else if (i === R.valec) items.push({ kind: 'heavy', x: 15, y: 15 });
    else items.push({ kind: 'static', x: (i % 8) * 2 + 1, y: 25 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const s = new Script(room, () => 0, () => false, {}, talking);
  MIKRO.init(s);
  return s;
}

describe('MIKRO roller obstacle', () => {
  it('remarks once when the roller comes to rest at (7,9)', () => {
    const s = mikro();
    const valec = s.item(R.valec);
    valec.x = 7;
    valec.y = 9;
    valec.dir = Dir.no;
    MIKRO.prog(s);
    expect(s.vars(0)[ROOM_PREKAZKA]).toBe(1);
  });
});

describe('MIKRO chattering crabs', () => {
  it('marks a crab as chattering (keca) while its voice is sounding', () => {
    const s = mikro((p) => p === 104); // crab4 is talking
    MIKRO.prog(s);
    expect(s.vars(R.krab4)[KECA]).toBe(1);
  });

  it('holds a silent crab quiet when it has no boldness (drzej 0)', () => {
    const s = mikro(); // nobody talking
    s.vars(R.krab4)[DRZEJ] = 0; // can't twitter this tick
    MIKRO.prog(s);
    expect(s.vars(R.krab4)[KECA]).toBe(0);
  });

  it('resets crab boldness to 1 when the fish shush the room (okrikla)', () => {
    const s = mikro();
    s.room.alive.little = false; // close the room dialogue gate so okrikla persists
    s.vars(0)[ROOM_OKRIKLA] = 1;
    s.vars(R.krab1)[DRZEJ] = 7;
    MIKRO.prog(s);
    expect(s.vars(R.krab1)[DRZEJ]).toBe(1);
  });
});

describe('MIKRO horse idle', () => {
  it('counts down its pause timer before the next head-toss', () => {
    const s = mikro();
    s.vars(R.kun)[KUN_PAUZA] = 5;
    MIKRO.prog(s);
    expect(s.vars(R.kun)[KUN_PAUZA]).toBe(4);
  });
});
