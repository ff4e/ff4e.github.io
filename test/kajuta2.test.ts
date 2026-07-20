/**
 * KAJUTA2 (room 49) mechanics (URoom.pas:5081-5145, 9526-9779): the octopus afaze
 * composition (oci + 3*chapadla) and the live parrot's startle when the little fish
 * turns near it (gstav=stav_otocka -> s.turning).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { KAJUTA2 } from '../src/rooms/kajuta2.js';

const R = { chobot: 4, malar: 8, velkar: 9, papzivy: 10 } as const;
const CHOBOT_OCI = 2;
const CHOBOT_CHAPADLA = 1;
const PAPZIVY_CINNOST = 1;

function kajuta2(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 10; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 20, y: 20 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 30, y: 5 });
    else items.push({ kind: 'static', x: i, y: 12 });
  }
  const s = new Script(makeRoom({ w: 40, h: 30, items }), () => 0);
  KAJUTA2.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return s;
}

describe('KAJUTA2 octopus', () => {
  it('composes its afaze as oci + 3*chapadla', () => {
    const s = kajuta2();
    KAJUTA2.prog(s);
    const ch = s.vars(R.chobot);
    expect(s.item(R.chobot).afaze).toBe(ch[CHOBOT_OCI]! + 3 * ch[CHOBOT_CHAPADLA]!);
  });
});

describe('KAJUTA2 live parrot', () => {
  it('is startled out of an idle flap when the little fish turns near it', () => {
    const s = kajuta2();
    s.vars(R.papzivy)[PAPZIVY_CINNOST] = 3; // mid idle flap (1..19)
    s.room.aktivni = 'little';
    s.turning = true; // gstav = stav_otocka
    KAJUTA2.prog(s);
    // cinnost<5 -> 24-cinnost (=21), so it jumps into the startle range (>=20).
    expect(s.vars(R.papzivy)[PAPZIVY_CINNOST]).toBeGreaterThanOrEqual(20);
  });
});
