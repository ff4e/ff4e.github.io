/**
 * SECRET (room 27) deterministic mechanics (URoom.pas:6899-6995, 16286-16548):
 * the balloon push-spin, the crab's eye-tracking + afaze composition, the drzka
 * setanim trigger, and the shrimp/krabik reactions. The RNG-heavy dialogue is
 * gated on both fish alive + no dialogue; object-block tests close that gate.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { SECRET } from '../src/rooms/secret.js';

const R = {
  drzka: 2,
  scully: 6,
  mulder: 7,
  lbalon: 8,
  balon1: 10,
  balon2: 11,
  krab: 17,
  shrimp: 18,
  krabik: 19,
} as const;
const DRZKA_CINNOST = 1;
const KRAB_BEH = 1;
const KRAB_OCI = 2;
const KRAB_VOCI = 3;
const KRAB_MRAC = 4;
const KRAB_NOHY = 5;

/** A SECRET-shaped room: scully (6) = little, mulder (7) = big, crab (17) mid-room;
 *  balloons/shrimp/krabik as single-cell fillers. */
function secret(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 19; i++) {
    if (i === 6) items.push({ kind: 'little', x: 2, y: 25 });
    else if (i === 7) items.push({ kind: 'big', x: 6, y: 25 });
    else if (i === 17) items.push({ kind: 'static', x: 15, y: 15 }); // krab
    else items.push({ kind: 'static', x: (i % 12) + 1, y: 5 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const s = new Script(room, () => 0);
  SECRET.init(s);
  s.room.alive.little = false; // close the dialogue gate for object tests
  return s;
}

describe('SECRET init', () => {
  it('seeds the room, crab, shrimp and krabik', () => {
    const s = secret();
    const v = s.vars(0);
    expect(v[1]! >= 10 && v[1]! <= 19).toBe(true); // uvod
    expect(v[2]).toBe(-1); // poslvykrik
    expect(v[4]).toBe(1); // venku
    const kv = s.vars(R.krab);
    expect(kv[KRAB_OCI]).toBe(1);
    expect(kv[KRAB_VOCI]).toBe(1);
    expect(kv[KRAB_MRAC]).toBe(1);
    expect(kv[KRAB_NOHY]).toBe(1);
    expect(s.item(R.shrimp).afaze).toBe(4);
  });
});

describe('SECRET balloon spin', () => {
  it('rolls afaze 0..3 with the shove direction (wrapping both ways)', () => {
    const s = secret();
    const b = s.item(R.balon2);
    b.afaze = 0;
    b.dir = Dir.left; // 0 -> 3 (wrap down)
    SECRET.prog(s);
    expect(s.item(R.balon2).afaze).toBe(3);

    b.afaze = 3;
    b.dir = Dir.right; // 3 -> 0 (wrap up)
    SECRET.prog(s);
    expect(s.item(R.balon2).afaze).toBe(0);

    b.afaze = 1;
    b.dir = Dir.right; // 1 -> 2
    SECRET.prog(s);
    expect(s.item(R.balon2).afaze).toBe(2);
  });
});

describe('SECRET crab eyes', () => {
  it('looks left (0) / mid (1) toward the little fish standing over it', () => {
    // The crab is 1-wide at x=15; the 3-wide little fish must overlap it (xdist 0)
    // and be above (ydist <= 0). Overlap constrains scully.x to [13,15], so the
    // reachable gazes are left (scully.x < 15) and mid (scully.x == 15).
    const look = (scullyX: number): number => {
      const s = secret();
      const krab = s.item(R.krab);
      s.item(R.scully).x = scullyX;
      s.item(R.scully).y = krab.y - 1; // directly above
      SECRET.prog(s);
      return s.vars(R.krab)[KRAB_OCI]!;
    };
    expect(look(13)).toBe(0); // left of the crab -> eyes left
    expect(look(15)).toBe(1); // over the crab -> eyes mid
  });

  it('composes afaze = oci + mrac*3 + nohy*6', () => {
    const s = secret();
    const kv = s.vars(R.krab);
    // No fish overlap, even tick (so the random eye-wander block is skipped).
    s.item(R.scully).x = 0; s.item(R.scully).y = 0;
    s.item(R.mulder).x = 0; s.item(R.mulder).y = 0;
    kv[KRAB_BEH] = 0; // -> nohy forced to 1
    kv[KRAB_MRAC] = 1;
    kv[KRAB_OCI] = 2;
    s.count = 2; // even -> no voci wander
    SECRET.prog(s);
    const oci = kv[KRAB_OCI]!, mrac = kv[KRAB_MRAC]!, nohy = kv[KRAB_NOHY]!;
    expect(nohy).toBe(1);
    expect(s.item(R.krab).afaze).toBe(oci + mrac * 3 + nohy * 6);
  });

  it('cycles legs (nohy) when told to run (beh=1)', () => {
    const s = secret();
    const kv = s.vars(R.krab);
    kv[KRAB_NOHY] = 1;
    kv[KRAB_BEH] = 1;
    s.item(R.scully).x = 0; s.item(R.scully).y = 0;
    s.item(R.mulder).x = 0; s.item(R.mulder).y = 0;
    SECRET.prog(s);
    expect(kv[KRAB_NOHY]).toBe(2); // 1 -> 2
    expect(kv[KRAB_BEH]).toBe(0); // consumed
  });
});

describe('SECRET drzka (stone mouth)', () => {
  it('arms the chatter animation on cinnost=1 then plays it', () => {
    const s = secret();
    s.vars(R.drzka)[DRZKA_CINNOST] = 1;
    SECRET.prog(s);
    expect(s.item(R.drzka).anim.length > 0).toBe(true); // setanim installed
    expect(s.vars(R.drzka)[DRZKA_CINNOST]).toBe(2); // advanced to "goanim" state
  });
});

describe('SECRET lbalon scuttles the crab', () => {
  it('makes the crab cycle its legs when the left balloon sits on it', () => {
    const s = secret();
    const krab = s.item(R.krab);
    const lb = s.item(R.lbalon);
    lb.dir = Dir.no;
    lb.x = krab.x;
    lb.y = krab.y + 3; // it.y - 3 === krab.y
    s.vars(R.krab)[KRAB_NOHY] = 1;
    // Keep the fish away so the crab block doesn't override via eye-tracking.
    s.item(R.scully).x = 0; s.item(R.scully).y = 0;
    s.item(R.mulder).x = 0; s.item(R.mulder).y = 0;
    SECRET.prog(s);
    // The lbalon block set beh=1; the later crab block consumed it into a leg-cycle.
    expect(s.vars(R.krab)[KRAB_NOHY]).toBe(2);
    expect(s.vars(R.krab)[KRAB_BEH]).toBe(0);
  });
});
