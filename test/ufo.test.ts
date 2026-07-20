/**
 * UFO (room 22) dialogue state machine (URoom.pas:8023-8043, 19850-19912). Each
 * fired branch queues speech, so noDialog() goes false; the tests drain the queue
 * with clearDialog() between ticks to step the machine deterministically. Both
 * fish are kept alive (the whole block is gated on that + no dialogue).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { UFO } from '../src/rooms/ufo.js';

const R = { uvod: 1, hlaska1: 2, hlaska2: 3, hlaskacount: 4, dlouha: 15 } as const;

/** A UFO-shaped room: little + big fish at items 1/2, fillers 3-14, dlouha at 15. */
function ufo(pokus = 1): Script {
  const items = [
    { kind: 'little' as const, x: 2, y: 2 },
    { kind: 'big' as const, x: 6, y: 2 },
  ];
  for (let i = 3; i <= 14; i++) items.push({ kind: 'static' as const, x: i, y: 20 });
  items.push({ kind: 'static' as const, x: 20, y: 5 }); // 15: dlouha
  const room = makeRoom({ w: 30, h: 30, items });
  const s = new Script(room, () => 0);
  s.pokus = pokus;
  UFO.init(s);
  return s;
}

describe('UFO init', () => {
  it('sets the intro variant from the attempt number and seeds the remarks', () => {
    expect(ufo(1).vars(0)[R.uvod]).toBe(1);
    expect(ufo(2).vars(0)[R.uvod]).toBe(2);
    for (let t = 0; t < 20; t++) {
      const u = ufo(5).vars(0)[R.uvod]!;
      expect(u >= 0 && u <= 3).toBe(true); // random(4) on later attempts
    }
    const v = ufo(1).vars(0);
    expect(v[R.hlaska1]! === 1 || v[R.hlaska1]! === 2).toBe(true);
    expect(v[R.hlaska2]).toBe(3 - v[R.hlaska1]!); // the other of {1,2}
    expect(v[R.hlaskacount]).toBe(-1);
  });
});

describe('UFO intro', () => {
  it('fires the intro once, queues speech, then clears uvod', () => {
    const s = ufo(1);
    expect(s.noDialog()).toBe(true);
    UFO.prog(s);
    expect(s.vars(0)[R.uvod]).toBe(0); // consumed
    expect(s.isDialog()).toBe(true); // it queued lines
  });
});

describe('UFO remarks', () => {
  it('gates the first remark on the long wreck being pushed down (dlouha.Y > 9)', () => {
    const s = ufo(1);
    UFO.prog(s); // burn the intro
    s.clearDialog();
    const h1 = s.vars(0)[R.hlaska1]!;

    // dlouha still high (Y <= 9): the remark is withheld.
    s.item(R.dlouha).y = 8;
    UFO.prog(s);
    expect(s.vars(0)[R.hlaska1]).toBe(h1); // unchanged
    expect(s.vars(0)[R.hlaskacount]).toBe(-1);
    expect(s.noDialog()).toBe(true); // nothing queued

    // dlouha pushed down (Y > 9): the remark fires and arms the cooldown.
    s.item(R.dlouha).y = 10;
    UFO.prog(s);
    expect(s.vars(0)[R.hlaska1]).toBe(0); // consumed
    const hc = s.vars(0)[R.hlaskacount]!;
    expect(hc >= 1000 && hc <= 2999).toBe(true); // 1000 + random(2000)
    expect(s.isDialog()).toBe(true);
  });

  it('fires the second remark when the cooldown counts down to 0', () => {
    const s = ufo(1);
    UFO.prog(s); // intro
    s.clearDialog();
    s.item(R.dlouha).y = 10;
    UFO.prog(s); // hlaska1
    s.clearDialog();
    const h2 = s.vars(0)[R.hlaska2]!;

    // Short-circuit the long cooldown to 1; this tick decrements it to 0 and fires.
    s.vars(0)[R.hlaskacount] = 1;
    UFO.prog(s);
    expect(s.vars(0)[R.hlaska2]).toBe(0); // consumed
    expect(s.vars(0)[R.hlaskacount]).toBe(-1); // disarmed
    expect(h2 === 1 || h2 === 2).toBe(true);
    expect(s.isDialog()).toBe(true);
  });
});
