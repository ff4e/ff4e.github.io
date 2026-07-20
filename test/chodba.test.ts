/**
 * CHODBA (room 56) deterministic mechanics (URoom.pas:5271-5354, 10209-10484):
 * the room starts lit with an always-visible switch, the light switch toggles the
 * room between lit (gspec 0) and dark (gspec 2), and every glowing part (dogs, doors,
 * hatches) raises spec=2 + a glow frame while dark.
 */
import { describe, it, expect } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { CHODBA } from '../src/rooms/chodba.js';

const R = {
  rightpes: 1,
  leftpes: 2,
  vypinac: 3,
  malar: 4,
  velkar: 5,
  dvere1: 12,
  poklop1: 19,
} as const;

function chodba(): Script {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 19; i++) {
    if (i === R.malar) items.push({ kind: 'little', x: 5, y: 5 });
    else if (i === R.velkar) items.push({ kind: 'big', x: 10, y: 5 });
    else items.push({ kind: 'static', x: (i % 8) * 3 + 2, y: 20 });
  }
  const s = new Script(makeRoom({ w: 30, h: 34, items }), () => 0);
  CHODBA.init(s);
  return s;
}

describe('CHODBA init', () => {
  it('starts lit (gspec 0) with an always-visible switch (spec 2)', () => {
    const s = chodba();
    expect(s.room.gspec).toBe(0);
    expect(s.item(R.vypinac).spec).toBe(2);
  });
});

describe('CHODBA light switch', () => {
  it('toggles the room dark (gspec 2) when shoved, then lit again', () => {
    const s = chodba();
    s.gfaze = 0;
    // stav 0 -> 1: a left/right shove starts the click
    s.item(R.vypinac).dir = Dir.left;
    CHODBA.prog(s);
    expect(s.room.gspec).toBe(0);
    // stav 1 -> 2: auto-advances to darkness
    CHODBA.prog(s);
    expect(s.room.gspec).toBe(2);
    // stav 2 -> 0: another shove restores the light
    s.item(R.vypinac).dir = Dir.right;
    CHODBA.prog(s);
    expect(s.room.gspec).toBe(0);
  });
});

describe('CHODBA darkness glow', () => {
  it('makes the dogs glow (spec 2, faze+3) while dark', () => {
    const s = chodba();
    s.room.gspec = 2;
    CHODBA.prog(s);
    expect(s.item(R.rightpes).spec).toBe(2);
    expect(s.item(R.leftpes).spec).toBe(2);
    // right dog faze cycles 0->1 on the first tick, so afaze = faze(1) + 3
    expect(s.item(R.rightpes).afaze).toBe(4);
  });

  it('doors/hatches glow (spec 2, faze+2) while dark and stay plain when lit', () => {
    const s = chodba();
    s.room.gspec = 2;
    CHODBA.prog(s);
    expect(s.item(R.dvere1).spec).toBe(2);
    expect(s.item(R.poklop1).spec).toBe(2);
    s.room.gspec = 0;
    CHODBA.prog(s);
    expect(s.item(R.dvere1).spec).toBe(0);
    expect(s.item(R.poklop1).spec).toBe(0);
  });
});
