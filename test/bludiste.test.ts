/**
 * BLUDISTE (room 31) deterministic mechanics (URoom.pas:8240-8270, 20859-20956):
 * the snail's setanim message trigger (snecek_zprava → a specific anim string),
 * the `rikanka` countdown's fast phase, and the roompole-seeded intro variant.
 * The RNG dialogue is gated on both fish alive + no dialogue; object tests exercise
 * the always-run snail logic and the guarded countdown with the intro skipped.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { BLUDISTE } from '../src/rooms/bludiste.js';

const R = { muchoblud: 1, snecek: 2, big: 3, malar: 4 } as const;
const ROOM_UVOD = 1;
const ROOM_RIKANKA = 4;
const SNECEK_ZPRAVA = 1;

/** A BLUDISTE-shaped room (items 1..4): muchoblud (1), snecek (2), big fish (3),
 *  malar (4) little. */
function bludiste(): Script {
  const items: ItemSpec[] = [
    { kind: 'static', x: 10, y: 10 }, // muchoblud
    { kind: 'static', x: 20, y: 20 }, // snecek
    { kind: 'big', x: 30, y: 5 },
    { kind: 'little', x: 5, y: 5 }, // malar
  ];
  const room = makeRoom({ w: 40, h: 32, items });
  const s = new Script(room, () => 0);
  BLUDISTE.init(s);
  return s;
}

describe('BLUDISTE snail messages', () => {
  it('launches the correct setanim string for each snecek_zprava code', () => {
    const cases: Array<[number, string]> = [
      [1, 'd4a1d1a2'],
      [2, 'd11a1d1a2'],
      [3, 'd3a1d2a0'],
    ];
    for (const [code, animStr] of cases) {
      const s = bludiste();
      s.vars(R.snecek)[SNECEK_ZPRAVA] = code;
      BLUDISTE.prog(s);
      expect(s.item(R.snecek).anim).toBe(animStr);
      expect(s.vars(R.snecek)[SNECEK_ZPRAVA]).toBe(0); // consumed
    }
  });
});

describe('BLUDISTE rikanka countdown', () => {
  it('counts down freely while above 30', () => {
    const s = bludiste();
    s.vars(0)[ROOM_UVOD] = 1; // skip the intro branch
    s.vars(0)[ROOM_RIKANKA] = 100;
    BLUDISTE.prog(s);
    expect(s.vars(0)[ROOM_RIKANKA]).toBe(99);
  });
});

describe('BLUDISTE intro seed', () => {
  it('seeds roompole[0] with a 1-or-2 attempt variant', () => {
    const s = bludiste();
    expect([1, 2]).toContain(s.roompole[0]);
  });
});
