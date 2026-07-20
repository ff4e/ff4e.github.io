/**
 * PUCLIK (room 42) deterministic mechanics (URoom.pas:5356-5394, 10486-10652):
 * the 20-piece picture solved-check (all pieces at their correct relative offset ->
 * `hotovo`), and the blob's ripple when pushed (`vlnit`).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { PUCLIK } from '../src/rooms/puclik.js';

const R = { prvni: 1, pld: 25, malar: 32, velkar: 33 } as const;
const PRVNI_HOTOVO = 1;
const PLD_VLNIT = 2;

/** Build PUCLIK with the 20 picture pieces (1..20) either solved (all at their
 *  correct relative offsets from piece 1) or scrambled. */
function puclik(solved: boolean): Script {
  const bx = 5;
  const by = 25; // base piece origin
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 33; i++) {
    if (i >= 1 && i <= 20) {
      const k = i - 1; // 0..19 = pom1 + pom2*4
      const pom1 = k % 4;
      const pom2 = Math.floor(k / 4);
      const x = bx + pom1 * 4;
      const y = by - pom2 * 4;
      // Scramble by displacing a single non-base piece (index 10) out of place.
      if (!solved && i === 10) items.push({ kind: 'static', x: x + 2, y });
      else items.push({ kind: 'static', x, y });
    } else if (i === R.malar) items.push({ kind: 'little', x: 2, y: 2 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 35, y: 2 });
    else items.push({ kind: 'static', x: (i % 10) + 1, y: 30 });
  }
  const s = new Script(makeRoom({ w: 45, h: 32, items }), () => 0);
  PUCLIK.init(s);
  s.room.alive.little = false; // close the dialogue gate
  return s;
}

describe('PUCLIK picture solved-check', () => {
  it('flags hotovo when all 20 pieces sit at their correct offsets', () => {
    const s = puclik(true);
    PUCLIK.prog(s);
    expect(s.vars(R.prvni)[PRVNI_HOTOVO]).toBe(1);
  });

  it('leaves hotovo clear while the pieces are scrambled', () => {
    const s = puclik(false);
    PUCLIK.prog(s);
    expect(s.vars(R.prvni)[PRVNI_HOTOVO]).toBe(0);
  });
});

describe('PUCLIK blob', () => {
  it('starts rippling (vlnit=8) when shoved', () => {
    const s = puclik(true);
    s.item(R.pld).dir = Dir.left;
    PUCLIK.prog(s);
    expect(s.vars(R.pld)[PLD_VLNIT]).toBeGreaterThan(0);
  });
});
