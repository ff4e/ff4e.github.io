/**
 * MAPA (room 51) mechanics (URoom.pas:8403-8437, 21594-21709): the gspec=9 map push-out
 * marking, and the snails freezing (afaze 2) while their line plays / one is pushed.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { MAPA } from '../src/rooms/mapa.js';

const R = { mapous: 2, little: 3, big: 4, sneci: 17 } as const;
const SNECI_MLUVI = 1;

function mapa(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 25; i++) {
    if (i === R.little) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.big) items.push({ kind: 'big', x: 34, y: 2 });
    else if (i === R.mapous) items.push({ kind: 'heavy', x: 15, y: 15 });
    else items.push({ kind: 'static', x: (i % 20) + 1, y: 25 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  MAPA.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return s;
}

describe('MAPA push-out', () => {
  it('marks the map spec=9 when shoved off the edge', () => {
    const s = mapa();
    const it = s.item(R.mapous);
    it.x = 40 - 7; // x + a(7) === width(40)
    it.dir = Dir.right;
    MAPA.prog(s);
    expect(it.spec).toBe(9);
  });
});

describe('MAPA snails', () => {
  it('freezes every snail at afaze 2 while the snail line is playing', () => {
    const s = mapa();
    s.vars(R.sneci)[SNECI_MLUVI] = 1;
    MAPA.prog(s);
    for (let i = 0; i <= 8; i++) expect(s.item(R.sneci + i).afaze).toBe(2);
    void Dir;
  });
});
