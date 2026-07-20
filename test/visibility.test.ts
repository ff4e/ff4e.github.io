/**
 * Item visibility rule (Priprav, URoom.pas:26251): outside the gspec=2 darkness
 * rooms, an item with `spec === 11` is NOT drawn. LODE uses this to hide its
 * on-demand falling-ship sprite + full-width mask (which otherwise render as a black
 * blob over the sunken ship); the PARTY rooms use it to hide window figures until
 * they pop into a window. This renders a tiny room and checks the pixels directly.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
// (background wiring in the harness is incidental; tests compare visible vs hidden)
const FG = 100; // the test item's solid colour
const ITEM_MASK = 254; // the item's transparent index (unused by our solid bitmap)

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** A 6×6-cell room: transparent wall over a uniform BG, plus one static item at (2,2). */
function tinyRoom(itemSpec: number): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const item: FfrItem = {
    xStart: 2,
    yStart: 2,
    bmp: 3,
    mask: ITEM_MASK,
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
    width: 6,
    height: 6,
    itemCount: 1,
    items: [wall, item],
    numBmp: 4,
    // [1] wall (all transparent → shows bg), [2] bg (uniform BG), [3] item (solid FG).
    bitmaps: [null, solid(90, 90, 255), solid(90, 90, 50), solid(FSIZE, FSIZE, FG)],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
  const room = new Room(ffr);
  room.items[1]!.spec = itemSpec;
  return room;
}

/** The palette index at the centre of grid cell (cx,cy). */
function centrePx(room: Room, spec: number, cx: number, cy: number): number {
  const screen = renderRoomState(tinyRoom(spec));
  void room;
  const x = cx * FSIZE + 7;
  const y = cy * FSIZE + 7;
  return screen.px[y * screen.width + x]!;
}

describe('renderer honours spec=11 invisibility', () => {
  it('draws a normal (spec=0) item but hides a spec=11 item at the same cell', () => {
    const at = (spec: number): number => {
      const screen = renderRoomState(tinyRoom(spec));
      const x = 2 * FSIZE + 7;
      const y = 2 * FSIZE + 7;
      return screen.px[y * screen.width + x]!;
    };
    const visible = at(0);
    const hidden = at(11);
    expect(visible).toBe(FG); // spec=0 → the item is drawn
    expect(hidden).not.toBe(FG); // spec=11 → the item is NOT drawn (shows through)
  });

  it('the decision keys off spec alone (via the centrePx helper)', () => {
    const dummy = tinyRoom(0);
    expect(centrePx(dummy, 0, 2, 2)).toBe(FG);
    expect(centrePx(dummy, 11, 2, 2)).not.toBe(FG);
  });
});
