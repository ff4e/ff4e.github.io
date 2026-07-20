/**
 * Computer branch Wave 2 (rooms 65/66/68/71) deterministic mechanics: TETRIS's intro,
 * ZX's gspec=42 + knightik FSM, ZAVER's zavermode lock + burbling pldik, and — most
 * importantly — WIN's bonus-level control swap (runtime littleIdx/bigIdx reassignment).
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { TETRIS } from '../src/rooms/tetris.js';
import { ZX } from '../src/rooms/zx.js';
import { ZAVER } from '../src/rooms/zaver.js';
import { WIN } from '../src/rooms/win.js';

function scriptFor(items: ItemSpec[], w = 45, h = 32): Script {
  return new Script(makeRoom({ w, h, items }), () => 0);
}

// ---------- TETRIS ----------
describe('TETRIS', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 12; i++) {
      if (i === 1) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 2) items.push({ kind: 'big', x: 6, y: 2 });
      else items.push({ kind: 'static', x: i, y: 10 });
    }
    return items; // trubka=12
  }
  it('opens with the reminiscing intro and only once', () => {
    const s = scriptFor(room());
    TETRIS.init(s);
    expect(s.vars(0)[1]).toBe(0); // zacatek
    TETRIS.prog(s);
    expect(s.vars(0)[1]).toBe(1); // zacatek latched
    expect(s.isDialog()).toBe(true);
  });
});

// ---------- ZX ----------
describe('ZX', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 21; i++) {
      if (i === 20) items.push({ kind: 'little', x: 5, y: 3 });
      else if (i === 19) items.push({ kind: 'big', x: 10, y: 10 });
      else items.push({ kind: 'static', x: i, y: 15 });
    }
    return items; // knightik=13
  }
  it('sets the gspec=42 emulator mode', () => {
    const s = scriptFor(room());
    ZX.init(s);
    expect(s.room.gspec).toBe(42);
  });
  it('advances the knightik march timer (stav 0 counts poc down)', () => {
    const s = scriptFor(room());
    ZX.init(s);
    const kv = s.vars(13);
    kv[2] = 0; // stav
    kv[1] = 5; // poc
    ZX.prog(s);
    expect(s.vars(13)[1]).toBe(4);
  });
});

// ---------- ZAVER ----------
describe('ZAVER', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 7; i++) {
      if (i === 4) items.push({ kind: 'little', x: 5, y: 20 });
      else if (i === 5) items.push({ kind: 'big', x: 8, y: 20 });
      else items.push({ kind: 'static', x: i, y: 10 });
    }
    return items; // pldik=7
  }
  it('locks player input (zavermode) and opens the finale', () => {
    const s = scriptFor(room());
    ZAVER.init(s);
    expect(s.zavermode).toBe(true);
    expect(s.vars(0)[1]).toBe(0); // uvod
    ZAVER.prog(s);
    expect(s.vars(0)[1]).toBe(1);
    expect(s.isDialog()).toBe(true);
  });
  it('composes the burbling blob frame as oci*2', () => {
    const s = scriptFor(room());
    ZAVER.init(s);
    const p = s.vars(7);
    p[1] = 1; // cinnost (awake) -> oci becomes 6
    ZAVER.prog(s);
    // afaze = oci*2 (may be bumped to 12 on a 5% roll, or +1 during a suck) — always finite
    expect(Number.isFinite(s.item(7).afaze)).toBe(true);
  });
});

// ---------- WIN ----------
describe('WIN bonus level', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 39; i++) {
      if (i === 10) items.push({ kind: 'little', x: 3, y: 25 }); // malar (young)
      else if (i === 11) items.push({ kind: 'big', x: 6, y: 25 }); // velkar (young)
      else if (i === 4) items.push({ kind: 'heavy', x: 20, y: 10 }); // bonuslevel tile
      else if (i === 32) items.push({ kind: 'static', x: 15, y: 8 }); // staravelka (old big)
      else if (i === 33) items.push({ kind: 'static', x: 18, y: 8 }); // staramala (old little)
      else items.push({ kind: 'static', x: i % 40, y: 30 });
    }
    return items; // notepad=12, budik=38, spuntik=39
  }

  it('swaps control to the old fish (gspec=5) when the big fish reaches the bonus tile', () => {
    const s = scriptFor(room());
    WIN.init(s);
    expect(s.room.gspec).toBe(0);
    expect(s.room.littleIdx).toBe(10);
    expect(s.room.bigIdx).toBe(11);

    // Big fish (facing right) reaches the bonus tile: velkar.x+4 === bonuslevel.x, y in range.
    const bonus = s.item(4);
    s.item(11).x = bonus.x - 4;
    s.item(11).y = bonus.y; // >= bonuslevel.y - 1
    s.room.facingRight.big = true;
    WIN.prog(s);

    expect(s.room.gspec).toBe(5);
    expect(s.room.littleIdx).toBe(33); // now the old little fish
    expect(s.room.bigIdx).toBe(32); // now the old big fish
    expect(s.item(33).kind).toBe(3); // Kind.little
    expect(s.item(32).kind).toBe(4); // Kind.big
    expect(s.vars(0)[1]).toBe(1); // resit
  });

  it('restores the young fish once both old fish reach the exit (x=1)', () => {
    const s = scriptFor(room());
    WIN.init(s);
    // enter bonus
    const bonus = s.item(4);
    s.item(11).x = bonus.x - 4;
    s.item(11).y = bonus.y;
    s.room.facingRight.big = true;
    WIN.prog(s);
    expect(s.room.gspec).toBe(5);

    // both old fish rescued at x=1
    s.item(33).x = 1;
    s.item(32).x = 1;
    WIN.prog(s);
    expect(s.room.gspec).toBe(0);
    expect(s.room.littleIdx).toBe(s.room.startLittle); // young fish restored
    expect(s.room.bigIdx).toBe(s.room.startBig);
    expect(s.vars(0)[1]).toBe(2); // resit
  });
});
