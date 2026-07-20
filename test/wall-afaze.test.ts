/**
 * STEEL red-alert (URoom.pas:26223): the room background is drawn as
 *   Kresli2(Bitmaps[BMP + afaze], Bitmaps[BgBMP + Bgfaze]) —
 * so BOTH the wall foreground and the water-wobble background switch to their alert
 * frames when the wall item's `afaze` is set (Bgfaze === wallItem.afaze in all shipped
 * rooms). This test builds a tiny room with two wall frames + two background frames and
 * proves the renderer follows `afaze` for both layers (regression for the "only the pipes
 * turned red, not the whole room" bug).
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomState } from '../src/render/renderRoom.js';
import { FFR_EXTRA, Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';

const FSIZE = 15;
const W = 6;
const H = 6;
const PX = W * FSIZE;

const WALL0 = 50; // wall foreground, normal
const WALL1 = 51; // wall foreground, alert
const BG0 = 100; // water-wobble background, normal
const BG1 = 101; // water-wobble background, alert
const MASK = 200; // wall transparent pixels -> background shows through

function solid(w: number, h: number, value: number, padded = 0): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded };
}

/** A wall bitmap that is `value` everywhere except a hole around pixel (22,22) (= cell
 *  (1,1)'s centre), where MASK lets the background show through. */
function wallFrame(value: number): FfrBitmap {
  const px = new Uint8Array(PX * PX).fill(value);
  for (let y = 18; y < 27; y++) for (let x = 18; x < 27; x++) px[y * PX + x] = MASK;
  return { w: PX, h: PX, pixels: px, padded: 0 };
}

/** Room: just the wall (item 0), bmp=3, so bitmaps 1/2 are the padded bg frames and
 *  bitmaps 3/4 are the wall frames — mirroring STEEL's layout (bg base = BgBMP = 1). */
function alertRoom(): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 3, mask: MASK, kind: Kind.static, fields: [] };
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0, // no water wobble -> deterministic bg sample
    wper: 1,
    wspd: 1,
    width: W,
    height: H,
    itemCount: 0,
    items: [wall],
    numBmp: 4,
    bitmaps: [
      null,
      solid(PX + 2 * FFR_EXTRA, PX, BG0, FFR_EXTRA), // [1] bg base
      solid(PX + 2 * FFR_EXTRA, PX, BG1, FFR_EXTRA), // [2] bg alert
      wallFrame(WALL0), // [3] wall base
      wallFrame(WALL1), // [4] wall alert
    ],
    heads: { big: [null], small: [null] },
    bodies: { big: [null], small: [null] },
    palette: Array.from({ length: 256 }, (_, i) => ({ r: i, g: i, b: i })),
  };
  return new Room(ffr);
}

function at(screen: ReturnType<typeof renderRoomState>, px: number, py: number): number {
  return screen.px[py * screen.width + px]!;
}

describe('STEEL whole-room red alert (wall + background afaze)', () => {
  it('normal frame draws the base wall and base background', () => {
    const room = alertRoom();
    const s = renderRoomState(room, { count: 0 });
    expect(at(s, 52, 52)).toBe(WALL0); // opaque wall pixel
    expect(at(s, 22, 22)).toBe(BG0); // through the mask hole -> background
  });

  it('alert (wallItem.afaze=1) switches BOTH the wall and the background to their red frames', () => {
    const room = alertRoom();
    room.wallItem.afaze = 1; // STEEL sets Items[0..ItemCount-2].afaze := bgfaze
    const s = renderRoomState(room, { count: 0 });
    expect(at(s, 52, 52)).toBe(WALL1); // wall foreground followed afaze
    expect(at(s, 22, 22)).toBe(BG1); // AND the background followed it (the "whole room" part)
  });
});
