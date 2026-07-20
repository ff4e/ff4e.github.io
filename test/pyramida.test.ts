/**
 * PYRAMIDA (room 25) deterministic mechanics (URoom.pas:5869-5915, 12639-12822):
 * the pharaoh statue, the ticking stela's afaze timeline, and the worm that crawls
 * by writing its own X/Y. The RNG-heavy dialogue is gated on both fish alive + no
 * dialogue, so the object-block tests kill the little fish to close that gate.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { PYRAMIDA } from '../src/rooms/pyramida.js';

const R = { faraon: 3, stela: 11, cerv: 18 } as const;
const FARAON_DELAY = 1;
const STELA_KONST = 1;
const STELA_FAZE = 2;
const STELA_DELAY = 3;
const CERV_STAV = 1;
const CERV_MEZ = 2;

/** A PYRAMIDA-shaped room: malar (1) = little fish, big fish at 2, faraon (3),
 *  deska2/1/3 (5/6/7), stela (11), cerv (18); the rest are fillers. */
function pyramida(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 18; i++) {
    if (i === 1) items.push({ kind: 'little', x: 30, y: 23 });
    else if (i === 2) items.push({ kind: 'big', x: 4, y: 23 });
    else if (i === 18) items.push({ kind: 'static', x: 20, y: 16 }); // cerv
    else items.push({ kind: 'static', x: (i % 15) + 2, y: 10 });
  }
  const room = makeRoom({ w: 40, h: 30, items });
  const s = new Script(room, () => 0);
  PYRAMIDA.init(s);
  s.room.alive.little = false; // close the story-dialogue gate
  return s;
}

describe('PYRAMIDA init', () => {
  it('seeds the props', () => {
    const s = pyramida();
    expect(s.vars(R.faraon)[FARAON_DELAY]! >= 100 && s.vars(R.faraon)[FARAON_DELAY]! <= 299).toBe(true);
    const sv = s.vars(R.stela);
    expect(sv[STELA_KONST]).toBe(10);
    expect(sv[STELA_FAZE]).toBe(0);
    expect(sv[STELA_DELAY]).toBe(0);
    const cv = s.vars(R.cerv);
    expect(cv[CERV_STAV]).toBe(-5);
    expect(cv[CERV_MEZ]! >= 0 && cv[CERV_MEZ]! <= 14).toBe(true);
  });
});

describe('PYRAMIDA faraon (pharaoh)', () => {
  it('snaps to frame 2 when shoved', () => {
    const s = pyramida();
    s.item(R.faraon).dir = Dir.right;
    PYRAMIDA.prog(s);
    expect(s.item(R.faraon).afaze).toBe(2);
    // delay was armed to random(20)+15 (15..34) then decremented the same tick.
    expect(s.vars(R.faraon)[FARAON_DELAY]! >= 14 && s.vars(R.faraon)[FARAON_DELAY]! <= 33).toBe(true);
  });

  it('counts its delay down then cycles the idle frame', () => {
    const s = pyramida();
    const fv = s.vars(R.faraon);
    fv[FARAON_DELAY] = 5;
    PYRAMIDA.prog(s);
    expect(fv[FARAON_DELAY]).toBe(4); // ticking down

    fv[FARAON_DELAY] = 0;
    s.item(R.faraon).afaze = 0;
    PYRAMIDA.prog(s);
    expect(s.item(R.faraon).afaze).toBe(1); // 0 -> 1 (blink)

    fv[FARAON_DELAY] = 0;
    s.item(R.faraon).afaze = 1;
    PYRAMIDA.prog(s);
    expect(s.item(R.faraon).afaze).toBe(0); // 1 -> 0
  });
});

describe('PYRAMIDA stela (obelisk timeline)', () => {
  it('resets when nudged, then re-arms from faze 0', () => {
    const s = pyramida();
    const sv = s.vars(R.stela);
    sv[STELA_FAZE] = 7;
    sv[STELA_DELAY] = 100;
    s.item(R.stela).afaze = 4;
    s.item(R.stela).dir = Dir.down;
    PYRAMIDA.prog(s);
    // reset -> faze 0 case runs -> a big delay armed, faze advanced to 1.
    expect(s.item(R.stela).afaze).toBe(0);
    expect(sv[STELA_FAZE]).toBe(1);
    expect(sv[STELA_DELAY]! >= 10 * 50).toBe(true);
  });

  it('walks the faze timeline (faze 1 -> frame 1, faze 2 -> frame 2)', () => {
    const s = pyramida();
    const sv = s.vars(R.stela);
    sv[STELA_FAZE] = 1;
    sv[STELA_DELAY] = 0;
    PYRAMIDA.prog(s);
    expect(s.item(R.stela).afaze).toBe(1);
    expect(sv[STELA_FAZE]).toBe(2);

    sv[STELA_DELAY] = 0; // faze is now 2
    PYRAMIDA.prog(s);
    expect(s.item(R.stela).afaze).toBe(2);
    expect(sv[STELA_DELAY]! >= 20 && sv[STELA_DELAY]! <= 49).toBe(true); // random(30)+20
  });
});

describe('PYRAMIDA cerv (worm)', () => {
  it('crawls up-left at stav 28 (writes its own X/Y)', () => {
    const s = pyramida();
    const cv = s.vars(R.cerv);
    cv[CERV_STAV] = 27; // ++ -> 28 this tick
    const x0 = s.item(R.cerv).x;
    const y0 = s.item(R.cerv).y;
    PYRAMIDA.prog(s);
    expect(cv[CERV_STAV]).toBe(28);
    expect(s.item(R.cerv).x).toBe(x0 - 1);
    expect(s.item(R.cerv).y).toBe(y0 - 1);
    expect(s.item(R.cerv).afaze).toBe(0);
  });

  it('crawls down-right at stav 32 while below its limit, else resets', () => {
    const s = pyramida();
    const cv = s.vars(R.cerv);
    // Below the limit (y < mez): move down-right, stav stays 32.
    cv[CERV_STAV] = 32;
    cv[CERV_MEZ] = 100;
    const x0 = s.item(R.cerv).x;
    const y0 = s.item(R.cerv).y;
    PYRAMIDA.prog(s);
    expect(s.item(R.cerv).x).toBe(x0 + 1);
    expect(s.item(R.cerv).y).toBe(y0 + 1);
    expect(cv[CERV_STAV]).toBe(32);

    // At/above the limit (y >= mez): reset to stav 0.
    cv[CERV_STAV] = 32;
    cv[CERV_MEZ] = 3; // item y is well above 3
    PYRAMIDA.prog(s);
    expect(cv[CERV_STAV]).toBe(0);
  });

  it('at stav 30 retreats (stav->0) when it has crawled past its limit', () => {
    const s = pyramida();
    const cv = s.vars(R.cerv);
    cv[CERV_STAV] = 29; // ++ -> 30
    cv[CERV_MEZ] = 5;
    s.item(R.cerv).y = 20; // y > mez
    PYRAMIDA.prog(s);
    expect(cv[CERV_STAV]).toBe(0);
  });
});
