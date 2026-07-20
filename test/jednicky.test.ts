/**
 * JEDNICKY (room 36) deterministic mechanics (URoom.pas:7525-7602, 18267-18474):
 * the little fish's hustle counter (`fofr`, +1 per move on gfaze==0), the clam's
 * refuse-trigger (cinnost 101 → restart the gape animation), the escalating
 * `jestejednu` creep toward its trigger points, and the pearls' globpole shimmer.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { JEDNICKY } from '../src/rooms/jednicky.js';

const R = { malar: 1, velkar: 2, zeva: 3, perla1: 11 } as const;
const ROOM_UVOD = 1;
const ROOM_JESTEJEDNU = 4;
const MALAR_FOFR = 1;
const ZEVA_CINNOST = 1;
const ZEVA_FAZE = 2;

/** A JEDNICKY-shaped room (items 1..24): malar (1) little, velkar (2) big, zeva (3)
 *  clam, perla1..14 (11..24) the pearls, others fillers. */
function jednicky(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 24; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 5, y: 5 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 5 });
    else if (i === R.zeva) items.push({ kind: 'static', x: 6, y: 5 }); // next to malar (dist<3)
    else items.push({ kind: 'static', x: ((i * 2) % 30) + 1, y: 25 });
  }
  const room = makeRoom({ w: 40, h: 32, items });
  const s = new Script(room, () => 0);
  JEDNICKY.init(s);
  return s;
}

describe('JEDNICKY hustle counter', () => {
  it('bumps the little fish fofr once per move (gfaze==0)', () => {
    const s = jednicky();
    const before = s.vars(R.malar)[MALAR_FOFR]!;
    s.item(R.malar).dir = Dir.left;
    s.gfaze = 0; // first tick of the move
    JEDNICKY.prog(s);
    expect(s.vars(R.malar)[MALAR_FOFR]).toBe(before + 1);

    // Mid-move ticks (gfaze != 0) do not double-count.
    s.gfaze = 3;
    JEDNICKY.prog(s);
    expect(s.vars(R.malar)[MALAR_FOFR]).toBe(before + 1);
  });
});

describe('JEDNICKY clam refuse trigger', () => {
  it('restarts the gape animation when its cinnost is set to 101 (via prom)', () => {
    const s = jednicky();
    const z = s.vars(R.zeva);
    z[ZEVA_CINNOST] = 101; // the jed-x-nedam line wrote this through prom
    JEDNICKY.prog(s);
    expect(z[ZEVA_CINNOST]).toBe(1); // → normal gape
    expect(z[ZEVA_FAZE]).toBe(1); // from the start
  });

  it('routes cinnost 102 to the wide-yawn animation', () => {
    const s = jednicky();
    s.vars(R.zeva)[ZEVA_CINNOST] = 102;
    JEDNICKY.prog(s);
    expect(s.vars(R.zeva)[ZEVA_CINNOST]).toBe(2);
  });
});

describe('JEDNICKY jestejednu creep', () => {
  it('creeps a negative jestejednu up toward its -1 trigger point', () => {
    const s = jednicky();
    s.vars(0)[ROOM_UVOD] = 1; // skip the intro so no dialogue is queued
    s.vars(0)[ROOM_JESTEJEDNU] = -30;
    JEDNICKY.prog(s);
    expect(s.vars(0)[ROOM_JESTEJEDNU]).toBe(-29);
  });
});

describe('JEDNICKY pearl shimmer', () => {
  it('drives each pearl afaze from its globpole cursor and recycles at 6', () => {
    const s = jednicky();
    s.globpole[0] = -1; // → 0 after the tick's increment
    s.globpole[1] = 0; // → 1
    s.globpole[2] = 5; // → 6: recycle to a fresh negative delay, afaze 0
    JEDNICKY.prog(s);
    expect(s.item(R.perla1 + 0).afaze).toBe(1); // globpole 0 → afaze 1
    expect(s.item(R.perla1 + 1).afaze).toBe(2); // globpole 1 → afaze 2
    expect(s.item(R.perla1 + 2).afaze).toBe(0); // globpole 6 → recycle, afaze 0
    expect(s.globpole[2]).toBeLessThan(0); // reset to a negative wait
  });
});
