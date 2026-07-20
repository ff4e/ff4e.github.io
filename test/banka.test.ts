/**
 * BANKA (room 57) mechanics (URoom.pas:6458-6628, 14578-15346 + PrgPldici 2150-2437):
 * the biggest room in the game. These tests exercise the deterministic bits — the
 * blinking indicator, the skeleton's slow decay, the barrier marking, and the fact
 * that the whole menagerie (incl. the pldik blob cellular automaton) runs for many
 * ticks without throwing (grid-bounds safety, no NaN afaze).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { BANKA } from '../src/rooms/banka.js';

const R = {
  room: 0,
  room_nep: 15,
  klicka: 1,
  malar: 2,
  velkar: 3,
  zataras: 7,
  kostra: 35,
  kostra_citac: 1,
  pldicek: 51,
} as const;

function banka(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 78; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 3, y: 3 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 6, y: 3 });
    else items.push({ kind: 'static', x: (i % 20) * 2 + 2, y: 22 });
  }
  const s = new Script(makeRoom({ w: 45, h: 30, items }), () => 0);
  s.room.aktivni = 'little';
  BANKA.init(s);
  return s;
}

describe('BANKA blinking indicator', () => {
  it('klicka alternates afaze with count parity', () => {
    const s = banka();
    s.count = 4;
    BANKA.prog(s);
    expect(s.item(R.klicka).afaze).toBe(0);
    s.count = 5;
    BANKA.prog(s);
    expect(s.item(R.klicka).afaze).toBe(1);
  });
});

describe('BANKA barrier', () => {
  it('marks the "cannot swim past" comment used once shoved', () => {
    const s = banka();
    s.item(R.zataras).dir = Dir.left;
    BANKA.prog(s);
    expect(s.vars(R.room)[R.room_nep]).toBe(1);
  });
});

describe('BANKA skeleton', () => {
  it('advances one decay frame when its timer expires', () => {
    const s = banka();
    const it = s.item(R.kostra);
    it.afaze = 0;
    s.vars(R.kostra)[R.kostra_citac] = 0;
    BANKA.prog(s);
    expect(it.afaze).toBe(1);
  });
});

describe('BANKA blob colony', () => {
  it('runs the whole room (incl. the pldik automaton) 400 ticks without throwing', () => {
    const s = banka();
    expect(() => {
      for (let t = 0; t < 400; t++) {
        s.count = t;
        BANKA.prog(s);
      }
    }).not.toThrow();
    // every pldik item must carry a finite frame
    for (let i = R.pldicek; i <= R.pldicek + 26; i++)
      expect(Number.isFinite(s.item(i).afaze)).toBe(true);
  });
});
