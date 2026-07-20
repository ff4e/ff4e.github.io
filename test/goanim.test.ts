/**
 * goanim Anim-string interpreter tests (src/core/script.ts), checked against real
 * strings from the original (URoom.pas): exact per-tick afaze sequences, s/S
 * variable-setting (incl. the uppercase "continue in same tick"), random bounds,
 * endanim, and the malformed-string guard.
 */
import { describe, it, expect } from 'vitest';
import { Script } from '../src/core/script.js';
import type { Room, Item } from '../src/core/room.js';

function makeItem(): Item {
  return {
    afaze: 0,
    vars: Array(16).fill(0),
    anim: '',
    posAnim: 1,
    delAnim: 0,
    labelAnim: 1,
  } as unknown as Item;
}

function makeScript(items: Item[]): Script {
  return new Script({ items } as unknown as Room, () => 0);
}

describe('goanim', () => {
  it("'a0d2a1d2R' cycles frame 0 (held 3 ticks) then frame 1, looping", () => {
    const it = makeItem();
    const s = makeScript([it]);
    s.setanim(0, 'a0d2a1d2R');
    const seq: number[] = [];
    for (let t = 0; t < 8; t++) {
      s.goanim(0);
      seq.push(it.afaze);
    }
    expect(seq).toEqual([0, 0, 0, 1, 1, 1, 0, 0]);
  });

  it("'s4,12d4S3,0S1,4' sets vars, with the two uppercase S in one tick", () => {
    const it = makeItem();
    const s = makeScript([it]);
    s.setanim(0, 's4,12d4S3,0S1,4');
    s.goanim(0);
    expect(it.vars[4]).toBe(12);
    for (let t = 0; t < 6; t++) s.goanim(0);
    expect(it.vars[3]).toBe(0);
    expect(it.vars[1]).toBe(4);
  });

  it('a random Anim keeps afaze within its range over many ticks', () => {
    const it = makeItem();
    const s = makeScript([it]);
    s.setanim(0, 'd?1-50a0a1a2a3d1a3a2a1a0R');
    for (let t = 0; t < 500; t++) {
      s.goanim(0);
      expect(it.afaze).toBeGreaterThanOrEqual(0);
      expect(it.afaze).toBeLessThanOrEqual(3);
    }
  });

  it('endanim reports the end, then the finished anim clears', () => {
    const it = makeItem();
    const s = makeScript([it]);
    s.setanim(0, 'a5');
    s.goanim(0);
    expect(it.afaze).toBe(5);
    expect(s.endanim(0)).toBe(true);
    s.goanim(0);
    expect(it.anim).toBe('');
  });

  it("drops a malformed self-looping string ('LG') without hanging", () => {
    const it = makeItem();
    const s = makeScript([it]);
    s.setanim(0, 'LG');
    s.goanim(0);
    expect(it.anim).toBe('');
  });
});
