/**
 * TRUP (room 46) mechanics (URoom.pas:5624-5649, 11637-11719): disables death lines,
 * and the snowman recoils (thwack sound + hit count) when the little fish bops it.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { TRUP } from '../src/rooms/trup.js';

const R = { ocel: 1, snehulak: 2, big: 4, malar: 5 } as const;
const SNEHULAK_UDER = 2;

interface Spy { snd: Array<{ name: string; prior: number }>; }

function trup(): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 5; i++) {
    if (i === R.big) items.push({ kind: 'big', x: 25, y: 25 });
    else if (i === R.malar) items.push({ kind: 'little', x: 8, y: 12 });
    else if (i === R.snehulak) items.push({ kind: 'static', x: 10, y: 10 });
    else items.push({ kind: 'static', x: 20, y: 20 }); // ocel
  }
  const spy: Spy = { snd: [] };
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0, () => false, {
    snd: (name, prior) => spy.snd.push({ name, prior }),
  });
  TRUP.init(s);
  return { s, spy };
}

describe('TRUP', () => {
  it('disables the standard death commentary', () => {
    const { s } = trup();
    expect(s.stdHlaskySmrti).toBe(false);
  });

  it('bops the snowman when the little fish shoves it from below-left', () => {
    const { s, spy } = trup();
    const sneh = s.item(R.snehulak); // (10,10)
    const malar = s.item(R.malar);
    malar.x = sneh.x - 2; // malar.x+2 === snehulak.x
    malar.y = sneh.y + 2; // malar.y-2 === snehulak.y
    s.room.facingRight.little = true;
    sneh.dir = Dir.no;
    sneh.afaze = 0;
    TRUP.prog(s);
    expect(spy.snd.some((c) => c.name === 'tr-x-koste')).toBe(true);
    expect(s.vars(R.snehulak)[SNEHULAK_UDER]).toBe(1);
  });
});
