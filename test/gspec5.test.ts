/**
 * gspec=5 (WIN "Favorites" bonus level, URoom.pas:26259-26265). The controllable pair
 * is reassigned to the "old fish" (littleIdx/bigIdx), but the render still draws the
 * animated fish BODY for the YOUNG fish (startLittle/startBig, who sit still) and draws
 * the controlled old fish as their plain item sprites. This test proves that inversion:
 * with littleIdx pointing at the old item, the fish body still appears at the young
 * fish's cell and the old item renders as its own bitmap.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState, TL_ZAKLAD, type FishFrame } from '../src/render/renderRoom.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const BG = 50;
const FISHBODY = 140; // the young fish's body sprite colour
const OLD_L = 100; // the old little fish's item bitmap colour
const OLD_B = 110; // the old big fish's item bitmap colour

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/** Body-frame table: frame TL_ZAKLAD[0] (the resting base pose) is the fish body colour. */
function bodyFrames(): (FfrBitmap | null)[] {
  const out: (FfrBitmap | null)[] = [null];
  for (let i = 1; i <= 23; i++) out.push(solid(FSIZE, FSIZE, i === TL_ZAKLAD[0] ? FISHBODY : 9));
  return out;
}

/** Young little fish (2,2), young big fish (2,4), old-little item (4,2), old-big (4,4). */
function bonusRoom(): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 1, mask: 255, kind: Kind.static, fields: [] };
  const youngLittle: FfrItem = { xStart: 2, yStart: 2, bmp: 0, mask: 254, kind: Kind.little, fields: [{ x: 0, y: 0 }] };
  const youngBig: FfrItem = { xStart: 2, yStart: 4, bmp: 0, mask: 254, kind: Kind.big, fields: [{ x: 0, y: 0 }] };
  const oldLittle: FfrItem = { xStart: 4, yStart: 2, bmp: 2, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const oldBig: FfrItem = { xStart: 4, yStart: 4, bmp: 3, mask: 254, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: false, big: false },
    wamp: 0,
    wper: 0,
    wspd: 0,
    width: 6,
    height: 6,
    itemCount: 4,
    items: [wall, youngLittle, youngBig, oldLittle, oldBig],
    numBmp: 4,
    // [1] wall/background (BG), [2] old-little sprite (OLD_L), [3] old-big sprite (OLD_B).
    bitmaps: [null, solid(90, 90, BG), solid(FSIZE, FSIZE, OLD_L), solid(FSIZE, FSIZE, OLD_B)],
    heads: { big: [null], small: [null] },
    bodies: { big: bodyFrames(), small: bodyFrames() },
    palette: Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i })),
  };
  return new Room(ffr);
}

function centre(screen: ReturnType<typeof renderRoomState>, cx: number, cy: number): number {
  const x = cx * FSIZE + 7;
  const y = cy * FSIZE + 7;
  return screen.px[y * screen.width + x]!;
}

const anim: { little: FishFrame; big: FishFrame } = {
  little: { bodyFrame: TL_ZAKLAD[0], headFrame: 0 },
  big: { bodyFrame: TL_ZAKLAD[0], headFrame: 0 },
};

describe('gspec=5 bonus-level fish/sprite inversion', () => {
  it('draws the young fish as bodies and the old (controlled) fish as item sprites', () => {
    const room = bonusRoom();
    // Enter the bonus: control swaps to the old fish; the young stay at startLittle/Big.
    room.gspec = 5;
    room.littleIdx = 3; // old little item
    room.bigIdx = 4; // old big item

    const s = renderRoomState(room, { fishAnim: anim });

    // Fish body appears at the YOUNG fish cells (2,2)/(2,4), NOT the old cells.
    expect(centre(s, 2, 2)).toBe(FISHBODY);
    expect(centre(s, 2, 4)).toBe(FISHBODY);
    // The controlled old fish render as their plain item bitmaps.
    expect(centre(s, 4, 2)).toBe(OLD_L);
    expect(centre(s, 4, 4)).toBe(OLD_B);
  });

  it('outside the bonus (gspec=0) draws the fish at littleIdx/bigIdx as usual', () => {
    const room = bonusRoom(); // gspec=0, littleIdx=1, bigIdx=2 (the young fish are the fish)
    const s = renderRoomState(room, { fishAnim: anim });
    expect(centre(s, 2, 2)).toBe(FISHBODY); // young little = the fish
    expect(centre(s, 4, 2)).toBe(OLD_L); // old-little item drawn as a plain sprite
  });
});
