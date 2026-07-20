/**
 * Computer branch Wave 1 (rooms 67/69/70/72) deterministic mechanics: PUZZLE's water
 * glitch + fidget counter, WARCR2's unit "move" bark, DISKETA's gspec=9 push-out + virus
 * frame composition, and SCORE's block-row win + creature FSMs.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { PUZZLE } from '../src/rooms/puzzle.js';
import { WARCR2 } from '../src/rooms/warcr2.js';
import { DISKETA } from '../src/rooms/disketa.js';
import { SCORE } from '../src/rooms/score.js';

interface Spy {
  snd: Array<{ name: string; prior: number }>;
}

function withSpy(items: ItemSpec[], w = 45, h = 30): { s: Script; spy: Spy } {
  const spy: Spy = { snd: [] };
  const s = new Script(makeRoom({ w, h, items }), () => 0, () => false, {
    snd: (name, prior) => spy.snd.push({ name, prior: prior ?? 0 }),
  });
  return { s, spy };
}

// ---------- PUZZLE ----------
describe('PUZZLE', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 19; i++) {
      if (i === 18) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 19) items.push({ kind: 'big', x: 6, y: 2 });
      else items.push({ kind: 'static', x: i, y: 10 });
    }
    return items;
  }

  it('jitters the water while the computer speaks, then restores it', () => {
    const { s } = withSpy(room());
    s.wamp = 3;
    s.wper = 2;
    PUZZLE.init(s); // stores oldwamp=3, oldwper=2
    const v = s.vars(0);
    v[5] = 1; // mluveni != 0
    PUZZLE.prog(s);
    expect(s.wamp).toBeGreaterThanOrEqual(4);
    expect(s.wamp).toBeLessThanOrEqual(7);
    expect(s.wper).toBeGreaterThanOrEqual(1);
    expect(s.wper).toBeLessThanOrEqual(4);
    v[5] = 0; // mluveni == 0
    PUZZLE.prog(s);
    expect(s.wamp).toBe(3);
    expect(s.wper).toBe(2);
  });

  it("counts only the little fish's own deliberate moves", () => {
    const { s } = withSpy(room());
    PUZZLE.init(s);
    s.room.aktivni = 'little';
    s.gfaze = 0;
    s.item(18).dir = Dir.left;
    const before = s.vars(18)[1]!;
    PUZZLE.prog(s);
    expect(s.vars(18)[1]).toBe(before + 1);
  });
});

// ---------- WARCR2 ----------
describe('WARCR2', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 23; i++) {
      if (i === 16) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 17) items.push({ kind: 'big', x: 40, y: 2 });
      else items.push({ kind: 'static', x: i, y: 25 });
    }
    return items; // knight1=1, knight2=21, archer1=22, archer2=23
  }

  it('barks a "move" line (prior 501) when a knight is shoved', () => {
    const { s, spy } = withSpy(room());
    WARCR2.init(s);
    s.item(1).dir = Dir.left; // knight1 shoved, hybese starts 0
    WARCR2.prog(s);
    const bark = spy.snd.find((e) => e.prior === 501);
    expect(bark, 'a knight move bark fired').toBeTruthy();
    expect(bark!.name.startsWith('war-k-move')).toBe(true);
  });
});

// ---------- DISKETA ----------
describe('DISKETA', () => {
  function room(): ItemSpec[] {
    const disk: [number, number][] = [];
    for (let x = 0; x < 10; x++) for (let y = 0; y < 10; y++) disk.push([x, y]);
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 12; i++) {
      if (i === 1) items.push({ kind: 'heavy', x: 0, y: 5, cells: disk }); // disketa 10x10 at left edge
      else if (i === 8) items.push({ kind: 'little', x: 20, y: 2 });
      else if (i === 9) items.push({ kind: 'big', x: 24, y: 2 });
      else items.push({ kind: 'static', x: 15 + i, y: 15 });
    }
    return items; // vir1=5, svab=10, vir2=12
  }

  it('sets gspec=9 and marks the floppy disk exiting at the edge (Spec9 10x10)', () => {
    const { s } = withSpy(room());
    DISKETA.init(s);
    expect(s.room.gspec).toBe(9);
    s.atRest = true; // gstav = stav_klid
    DISKETA.prog(s);
    expect(s.item(1).spec).toBe(9); // disketa touches x=0
    expect(s.item(1).dir).toBe(Dir.left);
  });

  it('composes a virus frame as huba*3 + oci', () => {
    const { s } = withSpy(room());
    DISKETA.init(s);
    const v = s.vars(5); // vir1
    v[1] = 2; // stav = talking
    v[2] = 1; // oci
    v[3] = 2; // huba
    DISKETA.prog(s);
    // in talking state huba toggles/stays and afaze = huba*3 + oci
    expect(s.item(5).afaze).toBe(v[3]! * 3 + v[2]!);
  });
});

// ---------- SCORE ----------
describe('SCORE', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 14; i++) {
      if (i === 11) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 12) items.push({ kind: 'big', x: 6, y: 2 });
      else items.push({ kind: 'static', x: i, y: 20 });
    }
    return items; // prvnikostka=1 (+2..5 blocks), krab=7, chobka=8, rejnok=9, sasanka=14
  }

  it('solves the block row and wins after the countdown', () => {
    const { s } = withSpy(room());
    SCORE.init(s);
    // Align blocks 2..5 in a row to the right of prvnikostka(1).
    const base = s.item(1);
    base.x = 10;
    base.y = 8;
    for (let k = 1; k <= 4; k++) {
      const b = s.item(1 + k);
      b.x = base.x + 4 * k;
      b.y = base.y;
      b.dir = Dir.no;
    }
    let won = false;
    s.onWin = () => (won = true);
    SCORE.prog(s); // detects solved -> odpocet=20
    expect(s.vars(1)[1]).toBe(19); // 20, then decremented once this same tick
    for (let t = 0; t < 25 && !won; t++) SCORE.prog(s);
    expect(won).toBe(true);
  });

  it('animates the crab: shoved down toggles 7<->9', () => {
    const { s } = withSpy(room());
    SCORE.init(s);
    const krab = s.item(7);
    krab.dir = Dir.down;
    krab.afaze = 7;
    SCORE.prog(s);
    expect(krab.afaze).toBe(9);
  });
});
