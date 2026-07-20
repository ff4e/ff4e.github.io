/**
 * BARELY (room 44) deterministic mechanics (URoom.pas:8478-8605, 21882-22464):
 * the gspec=9 barrel push-out marking, the snake's composed afaze (4*huba+streva),
 * and the shark-"killer" grin timer. The RNG dialogue is gated on both fish alive +
 * no dialogue; object tests close that gate and drive the always-run creatures.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { BARELY } from '../src/rooms/barely.js';

const R = { barel: 1, had: 5, killer: 8, little: 20, big: 21 } as const;
const HAD_STREVA = 1;
const HAD_HUBA = 2;
const KILLER_USMEV = 2;

interface Spy { snd: Array<{ name: string; prior: number }>; }

function barely(): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 21; i++) {
    if (i === R.little) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.big) items.push({ kind: 'big', x: 34, y: 2 });
    else if (i === R.barel) items.push({ kind: 'heavy', x: 15, y: 15 });
    else items.push({ kind: 'static', x: (i % 12) * 3 + 1, y: 25 });
  }
  const spy: Spy = { snd: [] };
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0, () => false, {
    snd: (name, prior) => spy.snd.push({ name, prior }),
  });
  BARELY.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return { s, spy };
}

describe('BARELY barrel push-out', () => {
  it('marks the barrel spec=9 when shoved off the edge', () => {
    const { s } = barely();
    const it = s.item(R.barel);
    it.x = 40 - 9; // x + a(9) === width(40)
    it.dir = Dir.right;
    BARELY.prog(s);
    expect(it.spec).toBe(9);
  });
});

describe('BARELY snake', () => {
  it('composes its afaze as 4*huba + streva', () => {
    const { s } = barely();
    BARELY.prog(s);
    const ha = s.vars(R.had);
    expect(s.item(R.had).afaze).toBe(4 * ha[HAD_HUBA]! + ha[HAD_STREVA]!);
  });
});

describe('BARELY killer shark', () => {
  it('shows the wagging-tail frame while grinning (usmev), no new grin sound', () => {
    const { s, spy } = barely();
    s.vars(R.killer)[KILLER_USMEV] = 5; // mid-grin
    BARELY.prog(s);
    // While usmev>0 the afaze is just the tail flag (0/1) and no grin sound is (re)started.
    expect([0, 1]).toContain(s.item(R.killer).afaze);
    expect(spy.snd.some((c) => c.name.startsWith('bar-x-gr'))).toBe(false);
    expect(s.vars(R.killer)[KILLER_USMEV]).toBe(4);
  });
});
