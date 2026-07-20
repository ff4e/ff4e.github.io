/**
 * KNIHOVNA ("The Hall of Ali-baba") stress-test: exercises the mechanics added
 * for this room — the global arrays (`roompole` rotation + `globpole` crystal
 * phase), the `universal` agent animating a chosen object, `.dir`-driven door
 * frames, and the `setBusy` primitive. Asserted values are deterministic (each
 * is written before any random branch that could change it).
 */
import { describe, it, expect } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { KNIHOVNA } from '../src/rooms/knihovna.js';

const R_universal = 1;

/** A KNIHOVNA-shaped room: 44 items so indices 1..44 (incl. crystals 35..44) exist. */
function knihovnaScript(): Script {
  const items = Array.from({ length: 44 }, (_, i) => ({
    kind: 'static' as const,
    x: 1 + (i % 18),
    y: 1 + Math.floor(i / 18),
  }));
  const room = makeRoom({ w: 24, h: 20, items });
  const s = new Script(room, () => 0);
  KNIHOVNA.init(s);
  return s;
}

describe('KNIHOVNA global arrays', () => {
  it('roompole[1] rotates the dialogue selector each cycle', () => {
    const s = knihovnaScript();
    s.vars(0)[1] = 0; // room_cas = 0 -> enter the rotation branch this tick
    s.vars(0)[2] = 0; // room_zakaz = 0
    s.roompole[1] = 0;
    s.item(8).y = 19; // keep velkar from flipping zakaz mid-tick
    KNIHOVNA.prog(s);
    expect(s.roompole[1]).toBe(1); // 0 -> 1
  });

  it('roompole rotation skips the forbidden slot when zakaz is set', () => {
    const s = knihovnaScript();
    s.vars(0)[1] = 0; // room_cas = 0
    s.vars(0)[2] = 1; // room_zakaz = 1
    s.roompole[1] = 2; // 2 % 4 === 2 -> the skipped slot
    s.item(8).y = 19;
    KNIHOVNA.prog(s);
    expect(s.roompole[1]).toBe(0); // 2 -> (+1 skip) 3 -> next 4 % 4 = 0
  });

  it('globpole drives each crystal frame (base + phase mapping)', () => {
    const s = knihovnaScript();
    s.globpole[0] = 2; // crystal 0 phase (1..5 -> +1 => 3)
    s.globpole[10] = 8; // crystal 0 base frame
    KNIHOVNA.prog(s);
    expect(s.item(35).afaze).toBe(11); // 8 + (phase 3 <= 3 ? 3)
  });

  it('a crystal past its peak folds the phase back down', () => {
    const s = knihovnaScript();
    s.globpole[0] = 5; // -> +1 => 6, mapped as 7-6 = 1
    s.globpole[10] = 12;
    KNIHOVNA.prog(s);
    expect(s.item(35).afaze).toBe(13); // 12 + 1
  });
});

describe('KNIHOVNA universal agent', () => {
  it('plays the opening frame on the chosen object', () => {
    const s = knihovnaScript();
    s.vars(R_universal)[2] = 1; // co = 1 (in 1..3 -> afaze := co)
    s.vars(R_universal)[1] = 3; // kdo = item 3
    KNIHOVNA.prog(s);
    expect(s.item(3).afaze).toBe(1);
    expect(s.vars(R_universal)[2]).toBe(2); // co advanced
  });

  it('resets the object when the sequence ends', () => {
    const s = knihovnaScript();
    s.vars(R_universal)[2] = 7; // co = 7 -> the else (end) branch
    s.vars(R_universal)[1] = 2; // kdo = item 2
    s.item(2).afaze = 5;
    KNIHOVNA.prog(s);
    expect(s.item(2).afaze).toBe(0);
    expect(s.vars(R_universal)[2]).toBe(0);
  });
});

describe('KNIHOVNA doors and busy primitive', () => {
  it('a db door frame follows its pending push direction', () => {
    const s = knihovnaScript();
    s.item(19).dir = Dir.no;
    s.item(22).dir = Dir.right;
    KNIHOVNA.prog(s);
    expect(s.item(19).afaze).toBe(0); // db1 at rest
    expect(s.item(22).afaze).toBe(1); // db2 being pushed
  });

  it('setBusy writes the fish talking flag', () => {
    const s = knihovnaScript();
    s.setBusy('big', 1);
    expect(s.busy('big')).toBe(1);
    s.setBusy('big', 0);
    expect(s.busy('big')).toBe(0);
  });
});
