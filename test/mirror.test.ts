/**
 * ZRC mirror reflection (KresliSpec spec=1 -> KresliZrcadlo, URoom.pas:25822). The
 * mirror's centre pixel is taken as the reflective "glass" colour; each glass pixel
 * at column X+k is then replaced by the pixel at column X+3-k — a horizontal flip
 * that shows the scene to the mirror's left. Renders a room with a coloured block
 * left of a glass mirror and checks a glass pixel is overwritten by the block's
 * colour at the mirrored column; a control without spec=1 leaves the glass intact.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const GLASS = 88; // the mirror's reflective fill colour
const BLOCK = 42; // the colour of the block sitting to the mirror's left
const BG = 50;
/**
 * What the empty backdrop actually renders as. The compositor takes the wobble
 * background from `bitmaps[1 + faze]`, i.e. the same all-255 bitmap it uses as the
 * wall, and blit2 leaves index 0 where the wall is fully transparent — so the empty
 * area is 0, not the `BG` fill above (which this harness never gets to show).
 */
const BACKDROP = 0;

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/**
 * A 10×3-cell room: a BLOCK-coloured item at grid (4,0) (screen x 60..75) and a
 * 30×30 glass mirror at grid (5,0) (screen x 75..105). `mirrorSpec=1` enables the
 * reflection; anything else is the control.
 */
function mirrorRoom(mirrorSpec: number): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const block: FfrItem = { xStart: 4, yStart: 0, bmp: 3, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const glass: FfrItem = { xStart: 5, yStart: 0, bmp: 4, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: 10,
    height: 3,
    itemCount: 2,
    items: [wall, block, glass],
    numBmp: 5,
    // [1] wall (transparent), [2] bg, [3] block (15×30 solid), [4] mirror (30×30 glass).
    bitmaps: [null, solid(150, 45, 255), solid(150, 45, BG), solid(15, 30, BLOCK), solid(30, 30, GLASS)],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
  const room = new Room(ffr);
  room.items[2]!.spec = mirrorSpec; // the mirror
  return room;
}

function px(room: Room, x: number, y: number): number {
  const screen = renderRoomState(room);
  return screen.px[y * screen.width + x]!;
}

describe('ZRC mirror reflection', () => {
  it('overwrites glass with the horizontally-mirrored scene to its left', () => {
    const room = mirrorRoom(1);
    // Glass column 85 reflects source column 75+3-10 = 68, which lies in the block
    // (x 60..75) -> the glass there becomes the block colour.
    expect(px(room, 85, 15)).toBe(BLOCK);
  });

  it('leaves the glass untouched without spec=1 (control)', () => {
    const room = mirrorRoom(0);
    expect(px(room, 85, 15)).toBe(GLASS);
  });

  it('keeps glass where the reflected source is also glass (near the axis)', () => {
    const room = mirrorRoom(1);
    // Column 76 reflects source 75+3-1 = 77, still inside the glass -> stays glass.
    expect(px(room, 76, 15)).toBe(GLASS);
  });

  it('pins the reflection AXIS: src = 2X+3-dest, with X the mirror anchor', () => {
    // The rule is an axis, not "some glass becomes the block colour", so assert the two
    // columns where the reflected image starts and ends. With anchor X=75 the source
    // column is 153-dest; the block occupies x 60..74, so the reflected block lands on
    // dest 79..93 exactly. A one-pixel error in the anchor moves both edges.
    const room = mirrorRoom(1);
    expect(px(room, 93, 15)).toBe(BLOCK); // src 60 = the block's first column
    expect(px(room, 94, 15)).toBe(BACKDROP); // src 59 = just left of the block
    expect(px(room, 79, 15)).toBe(BLOCK); // src 74 = the block's last column
    expect(px(room, 78, 15)).toBe(GLASS); // src 75 = glass reflecting glass
  });

  it('pins the mirror rect ORIGIN, so its top row is reflected too', () => {
    // The rect starts at the item's slid y, so row 0 is inside it. If the anchor drifted
    // down by a pixel the top row would fall outside the rect and stay raw glass.
    const room = mirrorRoom(1);
    expect(px(room, 85, 0)).toBe(BLOCK);
    expect(px(room, 85, 29)).toBe(BLOCK); // and the bottom row of the 30px-tall mirror
  });
});
