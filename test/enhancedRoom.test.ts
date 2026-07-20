/**
 * Enhanced-path integration through the single compositor (P2): render a
 * hand-built eligible room via renderRoomRgba + EnhancedArtSource and prove the
 * one pass swaps the background for FFNG truecolor while drawing the (unmapped)
 * item classic on top — no second render, no pixel diff. The index plane keeps
 * the exact classic structure.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomRgba } from '../src/render/renderRoom.js';
import { EnhancedArtSource, type EnhancedArt } from '../src/render/enhancedArtSource.js';
import { FFR_EXTRA, Kind, type FfrRoom, type FfrItem, type FfrBitmap, type FfrPaletteEntry } from '../src/data/ffr.js';
import { rgbaAt } from './rgbaAt.js';

const FSIZE = 15;
const W = 6;
const H = 6;
const PX = W * FSIZE;

const WALL = 50;
const ITEM = 70;
const BG = 100;
const MASK = 200;

function palette(): FfrPaletteEntry[] {
  const p: FfrPaletteEntry[] = [];
  for (let i = 0; i < 256; i++) p.push({ r: i, g: 255 - i, b: (i * 7) & 255 });
  return p;
}

function solid(w: number, h: number, value: number, padded = 0): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded };
}

/** Wall bitmap: WALL everywhere, with a MASK hole around cell (1,1). */
function wallBmp(): FfrBitmap {
  const px = new Uint8Array(PX * PX).fill(WALL);
  for (let y = 15; y < 30; y++) for (let x = 15; x < 30; x++) px[y * PX + x] = MASK;
  return { w: PX, h: PX, pixels: px, padded: 0 };
}

function buildRoom(): Room {
  const wall: FfrItem = { xStart: 0, yStart: 0, bmp: 2, mask: MASK, kind: Kind.static, fields: [] };
  const obj: FfrItem = { xStart: 3, yStart: 3, bmp: 3, mask: MASK, kind: Kind.static, fields: [{ x: 0, y: 0 }] };
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
    itemCount: 1,
    items: [wall, obj],
    numBmp: 3,
    bitmaps: [
      null,
      solid(PX + 2 * FFR_EXTRA, PX, BG, FFR_EXTRA), // [1] bg base
      wallBmp(), // [2] wall
      solid(FSIZE, FSIZE, ITEM), // [3] the object sprite
    ],
    palette: palette(),
  } as unknown as FfrRoom;
  return new Room(ffr);
}

/** Solid-colour enhanced art: wall = one colour, bg = another. */
function art(wall: [number, number, number], bg: [number, number, number]): EnhancedArt {
  const wallA = new Uint8Array(PX * PX * 4);
  const bgA = new Uint8Array(PX * PX * 4);
  for (let i = 0; i < PX * PX; i++) {
    wallA[i * 4] = wall[0];
    wallA[i * 4 + 1] = wall[1];
    wallA[i * 4 + 2] = wall[2];
    wallA[i * 4 + 3] = 255;
    bgA[i * 4] = bg[0];
    bgA[i * 4 + 1] = bg[1];
    bgA[i * 4 + 2] = bg[2];
    bgA[i * 4 + 3] = 255;
  }
  return { w: PX, h: PX, wall: [wallA], bg: [bgA] };
}

describe('enhanced integration (renderRoomRgba + EnhancedArtSource)', () => {
  it('swaps wall/bg for FFNG truecolor and keeps the (unmapped) item classic', () => {
    const room = buildRoom();
    const pal = room.palette;
    const src = new EnhancedArtSource(pal, art([11, 22, 33], [44, 55, 66]), [], null);
    const s = renderRoomRgba(room, src, { count: 0 });

    // Opaque wall pixel (top-left, no item) -> FFNG wall colour; idx = WALL.
    expect(rgbaAt(s, 2, 2)).toEqual({ r: 11, g: 22, b: 33, a: 255 });
    expect(s.getIndex(2, 2)).toBe(WALL);

    // Wall mask-hole pixel (cell 1,1) -> FFNG background colour; idx = BG.
    expect(rgbaAt(s, 22, 22)).toEqual({ r: 44, g: 55, b: 66, a: 255 });
    expect(s.getIndex(22, 22)).toBe(BG);

    // The item (no enhanced sprite mapped) stays classic: cell (3,3) keeps palette[ITEM].
    const ox = 3 * FSIZE + 5;
    const oy = 3 * FSIZE + 5;
    const c = pal[ITEM]!;
    expect(rgbaAt(s, ox, oy)).toEqual({ r: c.r, g: c.g, b: c.b, a: 255 });
    expect(s.getIndex(ox, oy)).toBe(ITEM);
  });

  it('falls back to the classic background when the master dims mismatch', () => {
    const room = buildRoom();
    // A master whose dimensions don't match the room → paintBackground returns
    // false → classic (palette) background.
    const mismatched: EnhancedArt = { w: 999, h: 999, wall: [new Uint8Array(4)], bg: [new Uint8Array(4)] };
    const src = new EnhancedArtSource(room.palette, mismatched, [], null);
    const s = renderRoomRgba(room, src, { count: 0 });
    const c = room.palette[WALL]!;
    expect(rgbaAt(s, 2, 2)).toEqual({ r: c.r, g: c.g, b: c.b, a: 255 });
  });
});
