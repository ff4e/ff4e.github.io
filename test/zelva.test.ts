/**
 * ZELVA (room 37) mechanics (URoom.pas:8271-8318, 20957-21281): the telepathic-devil
 * POSSESSION decision (`natvrdo` set when both fish have idled, a floor sits above the
 * chosen fish, and a far reachable target exists), the turtle demanding the fish be
 * released (pozadavek 7) while possessed, the little fish's delayed "it's a turtle!"
 * line, and the gspec=9 push-out marking. RNG is pinned via Math.random where needed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeRoom, type ItemSpec } from './roomBuilder.js';
import { Script } from '../src/core/script.js';
import { Dir } from '../src/core/dir.js';
import { ZELVA } from '../src/rooms/zelva.js';

const R = { zelva: 1, perla: 7, malar: 13, rybka: 17 } as const;
const MAIN_BLBNOUT = 1;
const ZELVA_POZADAVEK = 2;
const MALAR_HLASIT = 1;

interface Spy {
  talk: Array<{ name: string; prior: number }>;
}

/** A ZELVA-shaped room (items 1..17): zelva (1) the turtle, perla (7), malar (13)
 *  little fish, rybka (17) shy fish, plus a big fish. Wide open water so the devil's
 *  pathfinder can reach a target. */
function zelva(): { s: Script; spy: Spy } {
  const items: ItemSpec[] = [];
  for (let i = 1; i <= 17; i++) {
    if (i === R.zelva) items.push({ kind: 'static', x: 15, y: 15 });
    else if (i === R.malar) items.push({ kind: 'little', x: 20, y: 20 });
    else if (i === 14) items.push({ kind: 'big', x: 5, y: 5 }); // big fish
    else items.push({ kind: 'static', x: i, y: 28 });
  }
  const room = makeRoom({ w: 40, h: 32, items });
  const spy: Spy = { talk: [] };
  const s = new Script(room, () => 0, () => false, {
    talkNow: (name, prior) => {
      spy.talk.push({ name, prior });
      return 0;
    },
  });
  ZELVA.init(s);
  return { s, spy };
}

afterEach(() => vi.restoreAllMocks());

describe('ZELVA telepathic possession', () => {
  it('seizes a fish (natvrdo) once both idle, a ceiling is above it, and a far target is reachable', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // → picks the little fish, target (1,1)
    const { s } = zelva();
    s.vars(0)[MAIN_BLBNOUT] = 0; // possession timer elapsed
    s.room.idle.little = 41; // both fish have idled > 40
    s.room.idle.big = 41;
    ZELVA.prog(s);
    expect(s.natvrdo).toBe(1);
    expect(s.tvrdaryba).toBe(1); // the little fish
  });

  it('does not possess while the fish are still active (idle <= 40)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const { s } = zelva();
    s.vars(0)[MAIN_BLBNOUT] = 0;
    s.room.idle.little = 10; // just moved
    s.room.idle.big = 10;
    ZELVA.prog(s);
    expect(s.natvrdo).toBe(0);
  });
});

describe('ZELVA turtle reactions', () => {
  it('demands the fish back (pozadavek 7) while a possession is active', () => {
    const { s } = zelva();
    s.natvrdo = 1;
    ZELVA.prog(s);
    expect(s.vars(R.zelva)[ZELVA_POZADAVEK]).toBe(7);
  });

  it('speaks the little fish\'s delayed "it\'s a turtle!" line when cued', () => {
    const { s, spy } = zelva();
    s.vars(R.malar)[MALAR_HLASIT] = 1;
    ZELVA.prog(s);
    expect(spy.talk).toContainEqual({ name: 'zel-m-tazelva', prior: 1 });
    expect(s.vars(R.malar)[MALAR_HLASIT]).toBe(0);
  });
});

describe('ZELVA push-out', () => {
  it('marks the turtle spec=9 when it is shoved off the edge', () => {
    const { s } = zelva();
    const it = s.item(R.zelva);
    it.x = 40 - 7; // x + a(7) === width(40): at the right edge
    it.dir = Dir.right;
    ZELVA.prog(s);
    expect(it.spec).toBe(9);
  });
});
