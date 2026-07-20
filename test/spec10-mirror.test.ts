/**
 * spec=10 horizontal mirror (KresliObjekt rev, URoom.pas:25787): items with spec=10 are
 * drawn flipped left-right (KresliRev, anchored in [x, x+w-1]). Used by DRAKAR1's band
 * vikings (hlavni/melodak2) and PARTY2's direction-mirrored porthole figures. A spec=0
 * item is drawn normally. This builds an asymmetric sprite and proves the flip.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const W = 8;
const H = 4;
const PX = W * FSIZE;

const BGCOL = 20; // wall background fill
const LEFTC = 60; // sprite's left-edge colour
const RIGHTC = 70; // sprite's right-edge colour
const MASK = 200;

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** A FSIZE-wide sprite: leftmost column LEFTC, rightmost column RIGHTC, the middle MASK
 *  (transparent). Normal blit keeps LEFT on the left; a mirrored blit swaps them. */
function asymSprite(): FfrBitmap {
  const px = new Uint8Array(FSIZE * FSIZE).fill(MASK);
  for (let y = 0; y < FSIZE; y++) {
    px[y * FSIZE + 0] = LEFTC;
    px[y * FSIZE + (FSIZE - 1)] = RIGHTC;
  }
  return { w: FSIZE, h: FSIZE, pixels: px, padded: 0 };
}

/** Room: wall (bmp=1) + a normal (spec=0) item at cell (2,1) + a mirrored (spec=10) item
 *  at cell (5,1), both drawn from the same asymmetric sprite (bitmaps[2]). */
function mirrorRoom(): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: MASK, kind: Kind.static, fields: [] };
  const normal: FfrItem = { xStart: 2, yStart: 1, bmp: 2, mask: MASK, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const mirrored: FfrItem = { xStart: 5, yStart: 1, bmp: 2, mask: MASK, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0,
    wper: 1,
    wspd: 1,
    width: W,
    height: H,
    itemCount: 2,
    items: [wall, normal, mirrored],
    numBmp: 2,
    bitmaps: [null, solid(PX, PX, BGCOL), asymSprite()],
    heads: { big: [null], small: [null] },
    bodies: { big: [null], small: [null] },
    palette: Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i })),
  };
  return new Room(ffr);
}

function px(screen: ReturnType<typeof renderRoomState>, x: number, y: number): number {
  return screen.px[y * screen.width + x]!;
}

describe('spec=10 horizontal mirror', () => {
  it('draws a spec=0 item normally and a spec=10 item flipped left-right', () => {
    const room = mirrorRoom();
    room.items[2]!.spec = 10; // the mirrored item
    const s = renderRoomState(room, { count: 0 });

    const y = 1 * FSIZE + 7; // mid-height of row 1
    const normalX = 2 * FSIZE; // item at cell 2
    const mirrorX = 5 * FSIZE; // item at cell 5

    // Normal item: LEFT colour on its left edge, RIGHT colour on its right edge.
    expect(px(s, normalX + 0, y)).toBe(LEFTC);
    expect(px(s, normalX + FSIZE - 1, y)).toBe(RIGHTC);

    // Mirrored item: swapped — LEFT colour now on the right edge, RIGHT on the left.
    expect(px(s, mirrorX + 0, y)).toBe(RIGHTC);
    expect(px(s, mirrorX + FSIZE - 1, y)).toBe(LEFTC);
  });

  it('without spec=10 the same item is not mirrored (control)', () => {
    const room = mirrorRoom();
    room.items[2]!.spec = 0; // no mirror
    const s = renderRoomState(room, { count: 0 });
    const y = 1 * FSIZE + 7;
    const mirrorX = 5 * FSIZE;
    expect(px(s, mirrorX + 0, y)).toBe(LEFTC);
    expect(px(s, mirrorX + FSIZE - 1, y)).toBe(RIGHTC);
  });
});
