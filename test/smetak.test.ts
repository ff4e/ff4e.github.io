/**
 * SMETAK (room 43) deterministic mechanics (URoom.pas:5918-5978, 12823-12968):
 * the alarm clock's looping tick sound, and the jellyfish bobbing the ball when
 * parked 3 cells above it.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { SMETAK } from '../src/rooms/smetak.js';

const R = { meduza: 1, mic: 2, budik: 31, malar: 35, velkar: 36 } as const;
const MIC_BEHA = 1;

interface Spy { sndcyc: Array<{ name: string; prior: number }>; }

function smetak(): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 36; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 2 });
    else if (i === R.meduza) items.push({ kind: 'static', x: 15, y: 10 });
    else if (i === R.mic) items.push({ kind: 'static', x: 15, y: 13 }); // 3 below meduza
    else items.push({ kind: 'static', x: (i % 20) + 1, y: 25 });
  }
  const spy: Spy = { sndcyc: [] };
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0, () => false, {
    sndcyc: (name, prior) => spy.sndcyc.push({ name, prior }),
  });
  SMETAK.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return { s, spy };
}

describe('SMETAK alarm clock', () => {
  it('loops the tick sound when it is not already playing', () => {
    const { s, spy } = smetak();
    SMETAK.prog(s);
    expect(spy.sndcyc).toContainEqual({ name: 'sm-x-tiktak', prior: 940 });
  });
});

describe('SMETAK jellyfish + ball', () => {
  it('marks the ball as bobbing while the jellyfish sits 3 cells above it', () => {
    const { s } = smetak();
    // meduza(15,10) is exactly 3 above mic(15,13).
    SMETAK.prog(s);
    expect(s.vars(R.mic)[MIC_BEHA]).toBe(1);
  });
});
