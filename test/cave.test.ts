/**
 * Cave branch (rooms 59-64) deterministic mechanics. These exercise the non-RNG
 * per-item FSMs (which run every tick regardless of dialogue) and the two structural
 * facts that matter: ZAVAL's roompole restart-latch arithmetic and GRAL's gspec=9 +
 * vytlacit set-up from the 4-cell chalice count.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { ZAVAL } from '../src/rooms/zaval.js';
import { TRUHLA } from '../src/rooms/truhla.js';
import { BOTTLES } from '../src/rooms/bottles.js';
import { GRAL } from '../src/rooms/gral.js';
import { JESKYNE } from '../src/rooms/jeskyne.js';

function scriptFor(items: ItemSpec[], w = 40, h = 30): Script {
  return new Script(makeRoom({ w, h, items }), () => 0);
}

// ---------- ZAVAL ----------
describe('ZAVAL', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 12; i++) {
      if (i === 1) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 2) items.push({ kind: 'big', x: 6, y: 2 });
      else items.push({ kind: 'static', x: i, y: 20 });
    }
    return items;
  }

  it('resets roompole[1] on the first attempt, increments it on later ones', () => {
    const s1 = scriptFor(room());
    s1.pokus = 1;
    s1.roompole[1] = 5;
    ZAVAL.init(s1);
    expect(s1.roompole[1]).toBe(0);

    const s2 = scriptFor(room());
    s2.pokus = 2;
    s2.roompole[1] = 5; // carried over from the previous attempt
    ZAVAL.init(s2);
    expect(s2.roompole[1]).toBe(6);
  });

  it('shares the first gem bitmap across all gems and twinkles them', () => {
    const s = scriptFor(room());
    s.item(3).bmp = 77;
    ZAVAL.init(s);
    expect(s.item(5).bmp).toBe(77);
    // a gem whose timer is about to tick up advances its frame
    s.globpole[4] = 0; // -> becomes 1 -> afaze++
    const before = s.item(4).afaze;
    ZAVAL.prog(s);
    expect(s.item(4).afaze).toBe(before + 1);
  });
});

// ---------- TRUHLA ----------
describe('TRUHLA', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 24; i++) {
      if (i === 22) items.push({ kind: 'little', x: 2, y: 2 });
      else items.push({ kind: 'static', x: i % 30, y: 15 });
    }
    return items; // prsten=21, koruna1=23, koruna2=24
  }

  it("advances a crown's lightning strike deterministically (blesk=1)", () => {
    const s = scriptFor(room());
    TRUHLA.init(s);
    const kv = s.vars(23);
    kv[1] = 1; // blesk
    s.item(23).afaze = 1;
    TRUHLA.prog(s);
    expect(s.item(23).afaze).toBe(2);
    TRUHLA.prog(s);
    expect(s.item(23).afaze).toBe(3);
    TRUHLA.prog(s);
    expect(s.vars(23)[1]).toBe(2); // strike finished
  });
});

// ---------- BOTTLES ----------
describe('BOTTLES', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 31; i++) {
      if (i === 1) items.push({ kind: 'little', x: 2, y: 2 });
      else if (i === 2) items.push({ kind: 'big', x: 6, y: 2 });
      else items.push({ kind: 'static', x: i % 20, y: 20 });
    }
    return items; // sklebak=10, zlaty=11, lebzna=31
  }

  it('runs the totem laugh (cinnost 10 -> 11) and the settle counter (100->101, 120->0)', () => {
    const s = scriptFor(room());
    BOTTLES.init(s);
    const cv = s.vars(10);
    cv[1] = 10;
    BOTTLES.prog(s);
    expect(cv[1]).toBe(11);

    cv[1] = 100;
    BOTTLES.prog(s);
    expect(cv[1]).toBe(101); // afaze=0 then inc
    cv[1] = 120;
    BOTTLES.prog(s);
    expect(cv[1]).toBe(0);
  });

  it('rolls the skull eye on odd ticks', () => {
    const s = scriptFor(room());
    BOTTLES.init(s);
    s.item(31).afaze = 0;
    s.count = 1;
    BOTTLES.prog(s);
    expect(s.item(31).afaze).toBe(1);
  });
});

// ---------- GRAL ----------
describe('GRAL', () => {
  function room(): ItemSpec[] {
    const chalice: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 8; i++) {
      if (i === 1) items.push({ kind: 'static', x: 5, y: 5 }); // light
      else if (i === 2) items.push({ kind: 'static', x: 20, y: 4 }); // aura
      else if (i === 5) items.push({ kind: 'little', x: 30, y: 25 });
      else if (i === 6) items.push({ kind: 'big', x: 33, y: 25 });
      else if (i === 3 || i === 4) items.push({ kind: 'heavy', x: 10 + i, y: 10, cells: chalice });
      else items.push({ kind: 'static', x: i, y: 26 }); // dark=7, item 8
    }
    return items;
  }

  it('sets gspec=9 and vytlacit to the count of 4-cell chalices', () => {
    const s = scriptFor(room());
    GRAL.init(s);
    expect(s.room.gspec).toBe(9);
    expect(s.room.vytlacit).toBe(2); // items 3 and 4 are 4-cell
  });

  it('caches the light/dark bitmaps into roompole once and cycles the aura', () => {
    const s = scriptFor(room());
    s.item(1).bmp = 40; // light bmp
    s.item(7).bmp = 60; // dark bmp
    GRAL.init(s);
    expect(s.roompole[2]).toBe(40);
    expect(s.roompole[3]).toBe(60);

    s.item(2).afaze = 11;
    GRAL.prog(s);
    expect(s.item(2).afaze).toBe(0); // wrapped
  });

  it('shows the light bitmap for the chalice under the aura', () => {
    const s = scriptFor(room());
    s.item(1).bmp = 40;
    s.item(7).bmp = 60;
    GRAL.init(s);
    const aura = s.item(2);
    s.item(4).x = aura.x;
    s.item(4).y = aura.y + 1; // chalice 4 sits right under the aura
    GRAL.prog(s);
    expect(s.item(4).bmp).toBe(40); // light
    expect(s.item(3).bmp).toBe(60); // the other chalice stays dark
  });
});

// ---------- JESKYNE ----------
describe('JESKYNE', () => {
  function room(): ItemSpec[] {
    const items: ItemSpec[] = [];
    for (let i = 1; i <= 11; i++) {
      if (i === 2) items.push({ kind: 'little', x: 5, y: 20 });
      else if (i === 3) items.push({ kind: 'big', x: 8, y: 20 });
      else items.push({ kind: 'static', x: i, y: 10 });
    }
    return items; // netopyr=1, tycka=4, das=5, blbec=8, rybka=9, vaza=11
  }

  it('cycles the chomping skull (das) frames', () => {
    const s = scriptFor(room());
    JESKYNE.init(s);
    const das = s.item(5);
    das.afaze = 5;
    JESKYNE.prog(s);
    expect(das.afaze).toBe(0);
    das.afaze = 8;
    JESKYNE.prog(s);
    expect(das.afaze).toBe(5);
  });

  it('mirrors the straining bat onto the pole and vase', () => {
    const s = scriptFor(room());
    JESKYNE.init(s);
    // Pin the bat (pole+vase+bat in the lift position) with wings ready to strain.
    s.item(4).x = 10; s.item(4).y = 15; // tycka
    s.item(11).x = 18; s.item(11).y = 16; // vaza
    s.item(1).x = 18; s.item(1).y = 19; // netopyr
    const nv = s.vars(1);
    nv[1] = 0; // kridla (ready)
    nv[3] = 0; // vzpira
    JESKYNE.prog(s);
    // Straining sets netopyr.afaze to oci+2 (2 or 3) -> pole & vase both show frame 1.
    expect([2, 3]).toContain(s.item(1).afaze);
    expect(s.item(4).afaze).toBe(1); // tycka
    expect(s.item(11).afaze).toBe(1); // vaza
  });

  it('advances the cave-fish (rybka) through its emergence phase', () => {
    const s = scriptFor(room());
    JESKYNE.init(s);
    const rv = s.vars(9);
    rv[1] = -5; // in the -10..0 window
    JESKYNE.prog(s);
    expect(s.item(9).afaze).toBe(1);
    expect(rv[1]).toBe(-4);
  });
});
