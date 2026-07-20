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
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const ROPE_COL = 77; // the colour we plant at gear pixel (1,58)
const BG = 50;

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** Gear bitmap: 15×60 solid, with the rope colour planted at pixel (col 1, row 58). */
function gearBmp(): FfrBitmap {
  const bm = solid(15, 60, 5);
  (bm.pixels as Uint8Array)[58 * 15 + 1] = ROPE_COL;
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
    numBmp: 5,
    // [1] wall (transparent → bg), [2] bg (uniform), [3] gear (15×60), [4] lift.
    bitmaps: [null, solid(180, 360, 255), solid(180, 360, BG), gearBmp(), solid(15, 15, 9)],
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

  it('draws no rope when there is no gear+lift pair (control)', () => {
    const room = ropeRoom(false);
    expect(px(room, 88, 57)).not.toBe(ROPE_COL);
    expect(px(room, 92, 57)).not.toBe(ROPE_COL);
  });
});
