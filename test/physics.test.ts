/**
 * Deterministic physics/mechanics tests (no browser, no AI): movement, pushing,
 * the light/heavy push rules, gravity/falling, stacking, crushing/death, and
 * exit/win — driven directly against the ported Room physics.
 */
import { describe, it, expect } from 'vitest';
import { Dir } from '../src/core/dir.js';
import { makeRoom, pos } from './roomBuilder.js';

// A 12x8 room; the outer border is solid, floor cells are y=0..7 (wall at y=8).
const W = 12;
const H = 8;

describe('movement', () => {
  it('a fish moves one cell in open water', () => {
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'little', x: 3, y: 3 }] });
    room.buildGrid();
    expect(room.tryMoveFish('little', Dir.right)).toBe(true);
    expect(pos(room, 1).x).toBe(4);
  });

  it('a fish is blocked by the wall', () => {
    // little (3 wide) at x=9 occupies 9,10,11; moving right hits the x=12 wall.
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'little', x: 9, y: 3 }] });
    room.buildGrid();
    expect(room.tryMoveFish('little', Dir.right)).toBe(false);
    expect(pos(room, 1).x).toBe(9);
  });
});

describe('pushing (posun_objekt)', () => {
  it('a fish pushes a light box', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 2, y: 3 }, // occupies 2,3,4
        { kind: 'light', x: 5, y: 3 }, // box index 2
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('little', Dir.right)).toBe(true);
    expect(pos(room, 1).x).toBe(3); // fish advanced
    expect(pos(room, 2).x).toBe(6); // box pushed along
  });

  it('the little fish CANNOT push a heavy box', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 2, y: 3 },
        { kind: 'heavy', x: 5, y: 3 },
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('little', Dir.right)).toBe(false);
    expect(pos(room, 1).x).toBe(2);
    expect(pos(room, 2).x).toBe(5);
  });

  it('the big fish CAN push a heavy box', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'big', x: 2, y: 3 }, // 4x2, row 3 cells 2..5
        { kind: 'heavy', x: 6, y: 3 },
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('big', Dir.right)).toBe(true);
    expect(pos(room, 1).x).toBe(3);
    expect(pos(room, 2).x).toBe(7);
  });

  it('a fish pushes a row of two boxes at once (recursive push)', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'big', x: 1, y: 3 },
        { kind: 'light', x: 5, y: 3 },
        { kind: 'light', x: 6, y: 3 },
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('big', Dir.right)).toBe(true);
    expect(pos(room, 2).x).toBe(6);
    expect(pos(room, 3).x).toBe(7);
  });
});

describe('gravity (padani)', () => {
  it('an unsupported box falls to the floor', () => {
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'light', x: 4, y: 2 }] });
    room.fallToRest();
    expect(pos(room, 1).y).toBe(H - 1); // rests on the bottom wall (y=8)
  });

  it('a box stacks on top of another box', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'light', x: 4, y: H - 1 }, // already on the floor
        { kind: 'light', x: 4, y: 2 }, // falls onto it
      ],
    });
    room.fallToRest();
    expect(pos(room, 1).y).toBe(H - 1); // bottom box unmoved
    expect(pos(room, 2).y).toBe(H - 2); // top box rests one above
  });

  it('a fish does not fall (fish are weightless)', () => {
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'little', x: 4, y: 2 }] });
    room.fallToRest();
    expect(pos(room, 1).y).toBe(2);
    expect(room.anyFishDead).toBe(false);
  });
});

describe('crushing / death', () => {
  it('a heavy box resting on the little fish crushes it', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 4, y: 6 }, // fish on row 6
        { kind: 'heavy', x: 4, y: 5 }, // heavy directly on top of it
      ],
    });
    room.fallToRest();
    expect(room.alive.little).toBe(false);
    expect(room.kostra.little).toBe(true);
    expect(room.anyFishDead).toBe(true);
  });

  it('a light box resting on a fish does NOT crush it', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 4, y: 6 },
        { kind: 'light', x: 4, y: 5 },
      ],
    });
    room.fallToRest();
    expect(room.alive.little).toBe(true);
    expect(room.anyFishDead).toBe(false);
  });

  it('a light box FALLING onto a fish crushes it (moved=2, onLittle)', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 4, y: 6 },
        { kind: 'light', x: 4, y: 2 }, // drops onto the fish
      ],
    });
    room.fallToRest();
    expect(room.alive.little).toBe(false);
    expect(room.anyFishDead).toBe(true);
  });

  it('a crushed fish disintegrates in ~14 ticks (rychlost_rozpadu = 30 from 400)', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 4, y: 6 },
        { kind: 'heavy', x: 4, y: 5 },
      ],
    });
    room.fallToRest();
    expect(room.kostra.little).toBe(true);
    expect(room.rozpad.little).toBe(400); // zac_rozpad
    // 400 / 30 = 13.33 -> still eroding at 13 ticks, fully gone at 14.
    for (let t = 0; t < 13; t++) room.tickRozpad();
    expect(room.rozpad.little).toBeGreaterThan(0);
    room.tickRozpad();
    expect(room.rozpad.little).toBe(0); // gone by the 14th tick, not ~80
  });

  it('a box resting on a crushed fish falls once the skeleton disintegrates', () => {
    // Fish on the floor (row 6, wall at row 7); a heavy box drops onto it.
    const room = makeRoom({
      w: W,
      h: 7, // interior rows 0..6, floor wall at y=7
      items: [
        { kind: 'little', x: 4, y: 6 },
        { kind: 'heavy', x: 4, y: 4 }, // falls onto the fish
      ],
    });
    room.fallToRest();
    expect(room.alive.little).toBe(false);
    expect(room.kostra.little).toBe(true);
    const boxOnSkeleton = pos(room, 2).y; // resting on the fish/skeleton

    // While the skeleton erodes, the box stays put (the skeleton is solid).
    for (let t = 0; t < 20; t++) room.tickRozpad();
    expect(room.rozpad.little).toBe(0);
    expect(pos(room, 2).y).toBe(boxOnSkeleton); // hasn't moved yet

    // Once the skeleton is cleared, the box is unsupported and falls to the floor.
    expect(room.clearErodedSkeletons()).toBe(true);
    expect(room.kostra.little).toBe(false);
    room.fallToRest();
    expect(pos(room, 2).y).toBe(boxOnSkeleton + 1); // dropped into the fish's spot
  });
});

describe('carry / push crush (the `moved` support rule)', () => {
  // "Holding a box and pushing it at the same time kills": a box shoved sideways
  // until it rests directly on the fish (onLittle=2) while moving (moved=1) crushes
  // it (padani, URoom.pas:26670; Moved=1 = pushed sideways, URoom.pas:108).
  it('a box pushed sideways onto the fish crushes it', () => {
    const room = makeRoom({
      w: 14,
      h: 8,
      items: [
        { kind: 'big', x: 0, y: 5 }, // pusher: rows 5-6, cells 0..3
        { kind: 'light', x: 4, y: 6 }, // box on row 6, right of the big fish
        { kind: 'little', x: 5, y: 7 }, // little on row 7 (cells 5,6,7)
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('big', Dir.right)).toBe(true); // box (4,6) -> (5,6), over little (5,7)
    room.fallToRest();
    expect(room.alive.little).toBe(false);
    expect(room.anyFishDead).toBe(true);
  });

  // Counter-case: the very same shove, but the box comes to rest on ANOTHER box
  // (not the fish), so onLittle stays 0 and nobody is crushed.
  it('a box pushed sideways onto another box does NOT crush the fish', () => {
    const room = makeRoom({
      w: 14,
      h: 8,
      items: [
        { kind: 'big', x: 0, y: 5 },
        { kind: 'light', x: 4, y: 6 }, // box to be pushed
        { kind: 'light', x: 5, y: 7 }, // catcher box on the floor at the destination
        { kind: 'little', x: 10, y: 7 }, // little clear of the action
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('big', Dir.right)).toBe(true); // box (4,6) -> (5,6), lands on the catcher
    room.fallToRest();
    expect(room.alive.little).toBe(true);
    expect(room.anyFishDead).toBe(false);
  });

  // "Going down while holding a box crushes too": the fish steps down out from
  // under the box it was carrying; the box falls back onto the fish's new
  // position (moved=2) and crushes it.
  it('a fish moving down under its carried box gets crushed by it', () => {
    const room = makeRoom({
      w: 12,
      h: 10,
      items: [
        { kind: 'little', x: 4, y: 4 }, // fish mid-air on row 4
        { kind: 'light', x: 4, y: 3 }, // box resting on the fish
        { kind: 'static', x: 4, y: 6, cells: [[0, 0], [1, 0], [2, 0]] }, // ledge to step down onto
      ],
    });
    room.buildGrid();
    expect(room.tryMoveFish('little', Dir.down)).toBe(true); // fish 4 -> 5; box left above, falls back on it
    room.fallToRest();
    expect(room.alive.little).toBe(false);
    expect(room.anyFishDead).toBe(true);
  });
});

describe('exit / win (kontroluj_okraje + stav_ven)', () => {
  it('a fish at the edge is detected and exits', () => {
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'little', x: 0, y: 3 }] });
    room.buildGrid();
    const edge = room.checkEdges();
    expect(edge).toEqual({ which: 'little', dir: Dir.left });
    room.exitFish('little');
    expect(room.venku.little).toBe(true);
  });

  it('both fish out => the room is won', () => {
    const room = makeRoom({
      w: W,
      h: H,
      items: [
        { kind: 'little', x: 0, y: 3 }, // left edge
        { kind: 'big', x: W - 4, y: 5 }, // right edge (4 wide)
      ],
    });
    room.buildGrid();
    room.exitFish('little');
    room.exitFish('big');
    expect(room.won).toBe(true);
  });

  it('a fish swum to the edge exits (movement + edge detection integrated)', () => {
    const room = makeRoom({ w: W, h: H, items: [{ kind: 'little', x: 2, y: 3 }] });
    room.buildGrid();
    // No edge yet.
    expect(room.checkEdges()).toBeNull();
    // Swim left to the wall.
    expect(room.tryMoveFish('little', Dir.left)).toBe(true); // x=1
    expect(room.tryMoveFish('little', Dir.left)).toBe(true); // x=0
    expect(pos(room, 1).x).toBe(0);
    const edge = room.checkEdges();
    expect(edge).toEqual({ which: 'little', dir: Dir.left });
    room.exitFish('little');
    expect(room.venku.little).toBe(true);
    expect(room.alive.little).toBe(false); // an exited fish leaves play
  });
});
