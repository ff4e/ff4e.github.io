/**
 * SCHODY ("Plants on the Stairs") stress-test: exercises mechanics the earlier
 * dialogue rooms lack — the FArray grid-cell query (`s.farray`) and the slug's
 * per-tick state-machine animation that reads the grid and the push state.
 *
 * The asserted frames are deterministic: SCHODY writes `afaze` before any
 * random branch that could change it, so these hold regardless of RNG.
 */
import { describe, it, expect } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { makeRoom } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { ITEM_WATER, ITEM_WALL } from '../src/core/room.js';
import { SCHODY } from '../src/rooms/schody.js';

const noTalk = () => 0;

/**
 * A SCHODY-shaped room: the slug (plzik) is item index 1 and the snail (snecek)
 * is index 8, matching the r_SCHODY_* constants. Six filler statics (2..7) park
 * in column 1, out of the slug's query cell, so the snail lands on index 8.
 */
function schodyRoom(plzik: [number, number], walls?: [number, number][]): Script {
  const fillers = Array.from({ length: 6 }, (_, i) => ({ kind: 'static' as const, x: 1, y: 1 + i }));
  const room = makeRoom({
    w: 24,
    h: 20,
    walls,
    items: [
      { kind: 'static', x: plzik[0], y: plzik[1] }, // 1: plzik (slug)
      ...fillers, // 2..7
      { kind: 'static', x: 20, y: 2 }, // 8: snecek (snail)
    ],
  });
  const s = new Script(room, noTalk);
  SCHODY.init(s);
  return s;
}

describe('FArray grid query (s.farray)', () => {
  it('reports water, wall and item occupants of a cell', () => {
    const room = makeRoom({ w: 10, h: 10, walls: [[4, 4]], items: [{ kind: 'static', x: 6, y: 6 }] });
    const s = new Script(room, noTalk);
    expect(s.farray(2, 2)).toBe(ITEM_WATER); // empty interior
    expect(s.farray(4, 4)).toBe(ITEM_WALL); // an interior wall cell
    expect(s.farray(-1, 5)).toBe(ITEM_WALL); // the outer border
    expect(s.farray(6, 6)).toBe(1); // the static item (index 1)
  });
});

describe('SCHODY slug (plzik) state machine', () => {
  it('reacts to water below it via the grid query (afaze 4)', () => {
    const s = schodyRoom([5, 5]); // (6,7) is open water
    s.item(1).dir = Dir.no;
    SCHODY.prog(s);
    expect(s.item(1).afaze).toBe(4);
  });

  it('stays at rest over solid ground (afaze 0)', () => {
    const s = schodyRoom([5, 5], [[6, 7]]); // solid cell below-right
    s.item(1).dir = Dir.no;
    SCHODY.prog(s);
    expect(s.item(1).afaze).toBe(0);
  });

  it('shows its pushed frame while being moved (afaze 5)', () => {
    // Solid below-right so the water branch does not override the push state.
    const s = schodyRoom([5, 5], [[6, 7]]);
    s.item(1).dir = Dir.right; // being pushed
    SCHODY.prog(s);
    expect(s.item(1).afaze).toBe(5);
  });

  it('runs a full tick without touching item positions (animation only)', () => {
    const s = schodyRoom([5, 5]);
    const before = { x: s.item(1).x, y: s.item(1).y };
    SCHODY.prog(s);
    expect({ x: s.item(1).x, y: s.item(1).y }).toEqual(before);
  });
});
