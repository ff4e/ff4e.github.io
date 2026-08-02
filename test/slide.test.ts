/**
 * Slide interpolation (Priprav, URoom.pas:26167-26283 via `gfaze`): an item with a
 * pending `dir` is drawn part-way to its destination, offset by
 *
 *     shift = round(slide * FSIZE)   along   dx_dir[dir] / dy_dir[dir]
 *
 * (URoom.pas:62-63 for the direction deltas). This is presentation only — the item's
 * grid cell does not change until the move commits — so it is invisible to every
 * physics test, and it was the ONE rule in the room walk with no dedicated pin.
 *
 * It is pinned here because `renderInto` and `AiRoom.drawInto` are being unified into a
 * single `walkRoom`: once a rule has one implementation, comparing the faithful and AI
 * paths against each other proves nothing (see the note on `dissolveKeeps` in
 * aiTarget.ts — a parity probe cannot catch a refactor that moves the oracle). Every
 * expectation below is therefore hand-computed from the formula above, never read back
 * from either renderer.
 *
 * The AI (S×) side of the same rule is pinned in test/roomAi.test.ts, section 9.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const FG = 100; // the sliding item's solid colour
const BG = 50; // the background fill (the wall bitmap is fully transparent)

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** An 8×8-cell room with one static item occupying exactly the cell (2,2). */
function slideRoom(): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const item: FfrItem = {
    xStart: 2,
    yStart: 2,
    bmp: 3,
    mask: 254, // unused: the item bitmap is solid FG
    kind: Kind.static,
    fields: [{ x: 0, y: 0 }],
  };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: 8,
    height: 8,
    itemCount: 1,
    items: [wall, item],
    numBmp: 4,
    bitmaps: [null, solid(120, 120, 255), solid(120, 120, BG), solid(FSIZE, FSIZE, FG)],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
  return new Room(ffr);
}

/** The drawn item's top-left corner, found by scanning for FG. */
function itemOrigin(dir: number, slide: number): { x: number; y: number } {
  const room = slideRoom();
  room.items[1]!.dir = dir as never;
  const s = renderRoomState(room, { slide });
  let minX = Infinity;
  let minY = Infinity;
  for (let y = 0; y < s.height; y++) {
    for (let x = 0; x < s.width; x++) {
      if (s.px[y * s.width + x] !== FG) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
    }
  }
  return { x: minX, y: minY };
}

// The item's resting top-left, with no pending move.
const REST = { x: 2 * FSIZE, y: 2 * FSIZE };

describe('slide interpolation (round(slide * FSIZE) along dx_dir/dy_dir)', () => {
  it('does not move an item with no pending dir, whatever the slide', () => {
    expect(itemOrigin(Dir.no, 0)).toEqual(REST);
    expect(itemOrigin(Dir.no, 0.5)).toEqual(REST);
    expect(itemOrigin(Dir.no, 1)).toEqual(REST);
  });

  it('offsets a pending move along dx_dir/dy_dir, and only along it', () => {
    // dx_dir = (0,0,0,-1,1), dy_dir = (0,-1,1,0,0) — URoom.pas:62-63. At slide=1 the
    // shift is a whole cell (FSIZE), so each direction lands on its neighbouring cell.
    expect(itemOrigin(Dir.right, 1)).toEqual({ x: REST.x + FSIZE, y: REST.y });
    expect(itemOrigin(Dir.left, 1)).toEqual({ x: REST.x - FSIZE, y: REST.y });
    expect(itemOrigin(Dir.down, 1)).toEqual({ x: REST.x, y: REST.y + FSIZE });
    expect(itemOrigin(Dir.up, 1)).toEqual({ x: REST.x, y: REST.y - FSIZE });
  });

  it('ROUNDS the partial shift (half up), it does not truncate', () => {
    // slide=0.5 -> 0.5*15 = 7.5 -> round = 8. Truncating or flooring would give 7, so
    // this is the assertion that distinguishes the actual rule from the near misses.
    expect(itemOrigin(Dir.right, 0.5).x).toBe(REST.x + 8);
    expect(itemOrigin(Dir.left, 0.5).x).toBe(REST.x - 8);
    // slide=0.1 -> 1.5 -> 2 (again a .5 case, rounded up).
    expect(itemOrigin(Dir.right, 0.1).x).toBe(REST.x + 2);
    // slide=0.3 -> 4.5 -> 5.
    expect(itemOrigin(Dir.down, 0.3).y).toBe(REST.y + 5);
    // A value that is not a .5 boundary, to pin the scale itself: 0.4*15 = 6.
    expect(itemOrigin(Dir.right, 0.4).x).toBe(REST.x + 6);
  });

  it('scales by FSIZE, so slide runs the item exactly one cell over [0,1]', () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((s) => itemOrigin(Dir.right, s).x - REST.x);
    expect(xs).toEqual([0, 4, 8, 11, 15]); // round(15*[0,.25,.5,.75,1])
  });
});
