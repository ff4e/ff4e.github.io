/**
 * ZDVIZ elevator rope (KresliSpec spec=3 + KresliDvojlano, URoom.pas:25863-25903).
 * After all items are drawn, a gear (item spec=3) and lift (item spec=4) are joined
 * by a double cable (two lines 4px apart) running from the gear pulley (x0+58,
 * y0+27) down to the lift top (dx+43, dy), coloured by a pixel sampled from the
 * gear bitmap at (col 1, row 58). Renders a room with both items and checks the
 * rope pixels appear on top; a control render without the pair draws none.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { Dir } from '../src/core/dir.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const ROPE_COL = 77; // the colour we plant at gear pixel (1,58) of the BASE bitmap
const ROPE_COL_ALT = 78; // …and at the same pixel of the gear's animation-phase bitmap
const BG = 50;

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** Gear bitmap: 15×60 solid, with `col` planted at pixel (col 1, row 58). */
function gearBmp(col: number): FfrBitmap {
  const bm = solid(15, 60, 5);
  (bm.pixels as Uint8Array)[58 * 15 + 1] = col;
  return bm;
}

/**
 * A 12×24-cell room with a gear at (2,2) and a lift at (2,20). Screen anchors:
 * gear (30,30) → rope start (88,57); lift (30,300) → rope end (73,300).
 * `pair` = false parks both items at spec=0 so no rope is drawn (control).
 */
function ropeRoom(pair: boolean): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const gear: FfrItem = { xStart: 2, yStart: 2, bmp: 3, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const lift: FfrItem = { xStart: 2, yStart: 20, bmp: 4, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: 12,
    height: 24,
    itemCount: 2,
    items: [wall, gear, lift],
    numBmp: 6,
    // [1] wall (transparent → bg), [2] bg (uniform), [3] gear base (15×60), [4] lift,
    // [5] the gear's afaze=2 animation frame, sampling a DIFFERENT colour at (1,58).
    bitmaps: [
      null,
      solid(180, 360, 255),
      solid(180, 360, BG),
      gearBmp(ROPE_COL),
      solid(15, 15, 9),
      gearBmp(ROPE_COL_ALT),
    ],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
  const room = new Room(ffr);
  room.items[1]!.spec = pair ? 3 : 0; // gear
  room.items[2]!.spec = pair ? 4 : 0; // lift
  return room;
}

function px(room: Room, x: number, y: number): number {
  const screen = renderRoomState(room);
  return screen.px[y * screen.width + x]!;
}

describe('ZDVIZ elevator rope', () => {
  it('draws the double cable in the gear-sampled colour from pulley to lift', () => {
    const room = ropeRoom(true);
    // First rope row (y=57): both strands sit at x0+58 and +4.
    expect(px(room, 88, 57)).toBe(ROPE_COL);
    expect(px(room, 92, 57)).toBe(ROPE_COL);
    // A few rows down, still near the top, the strands persist.
    expect(px(room, 88, 60)).toBe(ROPE_COL);
    expect(px(room, 92, 60)).toBe(ROPE_COL);
  });

  it('pins the LIFT end of the cable, not just the pulley end', () => {
    // The rope runs (gear.x+58, gear.y+27) -> (lift.x+43, lift.y) = (88,57) -> (73,300),
    // so it LEANS. Asserting only the top few rows (above) cannot see the lift endpoint:
    // 3 rows in, a wrong lift.x still rounds to the same column. Pin the bottom and the
    // middle, where the accumulated slope has actually separated them.
    const room = ropeRoom(true);
    expect(px(room, 73, 300)).toBe(ROPE_COL); // last row, at lift.x + 43
    expect(px(room, 77, 300)).toBe(ROPE_COL); // second strand, 4 px right
    expect(px(room, 82, 150)).toBe(ROPE_COL); // mid-lean
    // A shorter rope (a wrong lift.y) would simply not reach the last row.
    expect(px(room, 70, 300)).not.toBe(ROPE_COL); // lift.x + 40 would land here
  });

  it('samples the rope colour from the gear BASE bitmap, ignoring its animation phase', () => {
    // KresliSpec's spec=3 case reads Bitmaps[BMP] — no afaze. Real gears animate through
    // six phases (src/rooms/zdviz1.ts), so with afaze=0 in the fixture a wrong
    // `bmp + afaze` lookup would be invisible. Give the phase bitmap a different colour
    // at (col 1, row 58) and check the rope still uses the base one.
    const room = ropeRoom(true);
    room.items[1]!.afaze = 2; // gear phase 2 -> bitmaps[3 + 2] = the ALT-coloured gear
    expect(px(room, 88, 57)).toBe(ROPE_COL);
    expect(px(room, 88, 57)).not.toBe(ROPE_COL_ALT);
  });

  it('applies the slide offset to the gear anchor', () => {
    // The anchors are captured at the item's SLID position (it.x * FSIZE + sx). With the
    // gear mid-move one whole cell right, the pulley end moves with it: 30+15 = 45,
    // so the rope starts at 45 + 58 = 103 instead of 88.
    const room = ropeRoom(true);
    room.items[1]!.dir = Dir.right as never;
    const s = renderRoomState(room, { slide: 1 });
    const at = (x: number, y: number): number => s.px[y * s.width + x]!;
    expect(at(103, 57)).toBe(ROPE_COL);
    expect(at(107, 57)).toBe(ROPE_COL); // second strand
    expect(at(88, 57)).not.toBe(ROPE_COL); // the un-slid start is now empty
    expect(at(73, 300)).toBe(ROPE_COL); // the lift end is unmoved
  });

  it('draws no rope when there is no gear+lift pair (control)', () => {
    const room = ropeRoom(false);
    expect(px(room, 88, 57)).not.toBe(ROPE_COL);
    expect(px(room, 92, 57)).not.toBe(ROPE_COL);
  });
});
