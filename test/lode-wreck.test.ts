import { describe, expect, it } from 'vitest';
import { Script } from '../src/core/script.js';
import { Room } from '../src/core/room.js';
import { StepEngine } from '../src/core/stepEngine.js';
import { FFR_EXTRA, Kind, type FfrBitmap, type FfrItem, type FfrRoom } from '../src/data/ffr.js';
import { LODE_ROOM } from '../src/rooms/lode.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import {
  EnhancedArtSource,
  type EnhancedArt,
  type EnhancedObject,
} from '../src/render/enhancedArtSource.js';
import { renderRoomRgba, renderRoomState } from '../src/render/renderRoom.js';
import { rgbaAt } from './rgbaAt.js';

const W = 690;
const H = 570;
const MASK = 247;
const BG = 10;
const SHIP = 20;
const SHIP_2 = 21;

function solid(w: number, h: number, value: number, padded = 0): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded };
}

function palette() {
  return Array.from({ length: 256 }, (_, i) => ({ r: i, g: (i * 3) & 255, b: 255 - i }));
}

function wreckRoom(): Room {
  const wall: FfrItem = {
    xStart: 0,
    yStart: 0,
    bmp: 2,
    mask: MASK,
    kind: Kind.static,
    fields: [],
  };
  const wreck: FfrItem = {
    xStart: 0,
    yStart: 0,
    bmp: 3,
    mask: MASK,
    kind: Kind.light,
    fields: [{ x: 0, y: 0 }],
  };
  const mask: FfrItem = {
    xStart: 0,
    yStart: 20,
    bmp: 8,
    mask: MASK,
    kind: Kind.light,
    fields: [{ x: 0, y: 0 }],
  };
  const shipFrame = (): FfrBitmap => ({
    w: 2,
    h: 1,
    pixels: new Uint8Array([SHIP, SHIP_2]),
    padded: 0,
  });
  const item = (index: number): FfrItem => ({
    xStart: index,
    yStart: index,
    bmp: 9, // deliberately unmapped: only the wreck/mask need render bitmaps
    mask: MASK,
    kind: index === 13 ? Kind.little : index === 14 ? Kind.big : Kind.static,
    fields: [{ x: 0, y: 0 }],
  });
  const items = [wall, ...Array.from({ length: 14 }, (_, i) => item(i + 1)), wreck, mask];
  const background = solid(W + 2 * FFR_EXTRA, H, BG, FFR_EXTRA);
  // Swapping the first ship pixel with a mask-coloured background erodes it:
  // the next erase pass skips the now-mask sprite pixel, leaving a trail.
  background.pixels[background.w + 20] = MASK;
  const ffr: FfrRoom = {
    toc: 0,
    descriptionRaw: '',
    descriptionCz: '',
    descriptionEn: '',
    startFacingRight: { small: true, big: true },
    wamp: 0,
    wper: 1,
    wspd: 1,
    width: W / 15,
    height: H / 15,
    itemCount: 16,
    items,
    numBmp: 9,
    bitmaps: [
      null,
      background,
      solid(W, H, MASK),
      shipFrame(),
      shipFrame(),
      shipFrame(),
      shipFrame(),
      shipFrame(),
      // The real LODE mask is only 130 rows even though Delphi addresses row 135
      // for screen y=436; the port safely treats that out-of-range row as blocked.
      solid(W, 130, MASK),
      null,
    ],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: palette(),
    bytesConsumed: 0,
  };
  const room = new Room(ffr);
  room.items[15]!.spec = 11;
  room.items[16]!.spec = 11;
  return room;
}

function primeDrop(room: Room): Script {
  const script = new Script(room, () => 0);
  script.padalod = 100;
  script.lodniX = 20;
  script.lodniY = 0;
  script.lodniDX = 0;
  script.lodniDY = 1;
  return script;
}

function rgba(r: number, g: number, b: number, a = 255): Uint8Array {
  return new Uint8Array([r, g, b, a, 0, 0, 0, 0]);
}

function enhancedArt(): EnhancedArt {
  const wall = new Uint8Array(W * H * 4);
  const bg = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    wall.set([1, 2, 3, 255], i * 4);
    bg.set([4, 5, 6, 255], i * 4);
  }
  return { w: W, h: H, wall: [wall], bg: [bg] };
}

const wreckObject: EnhancedObject = {
  item: 15,
  frames: Array.from({ length: 5 }, () => ({
    w: 2,
    h: 1,
    rgba: new Uint8Array([...rgba(200, 30, 40).slice(0, 4), ...rgba(30, 200, 40).slice(0, 4)]),
  })),
};

describe('LODE falling wreck', () => {
  it('performs the priming/move swaps, erodes into a trail, and clears naturally at Delphi y=436', () => {
    const room = wreckRoom();
    const script = primeDrop(room);

    script.tickShodLod();
    expect(script.padalod).toBe(0);
    expect(script.lodniY).toBe(1);
    expect(room.wreckSwaps).toEqual([{ x: 20, y: 1, phase: 0, width: 2, pixels: [0, 1] }]);
    expect(renderRoomState(room).getIndex(10, 1)).toBe(SHIP);
    expect(renderRoomState(room).getIndex(11, 1)).toBe(SHIP_2);

    script.tickShodLod();
    expect(script.lodniY).toBe(2);
    expect(room.wreckSwaps).toHaveLength(3);
    const frame = renderRoomState(room);
    expect(frame.getIndex(10, 1)).toBe(SHIP); // trail: the first sprite pixel eroded to MASK
    expect(frame.getIndex(11, 1)).toBe(BG);
    expect(frame.getIndex(10, 2)).toBe(BG);
    expect(frame.getIndex(11, 2)).toBe(SHIP_2);
    expect(room.bitmaps[3]!.pixels[0]).toBe(MASK);

    while (script.padalod !== -1) script.tickShodLod();
    expect(script.padalod).toBe(-1);
    expect(script.lodniY).toBe(437);
    expect(room.wreckSwaps.at(-1)?.pixels).toEqual([]);
    const cleared = renderRoomState(room);
    expect(cleared.getIndex(11, 435)).toBe(BG); // the non-eroded moving pixel was erased
    expect(cleared.getIndex(10, 1)).toBe(SHIP); // the intentional erosion trail remains
  });

  it('replays the same destructive swaps through the enhanced compositor', () => {
    const room = wreckRoom();
    const script = primeDrop(room);
    const source = new EnhancedArtSource(room.palette, enhancedArt(), [wreckObject], null);

    script.tickShodLod();
    let frame = renderRoomRgba(room, source);
    expect(rgbaAt(frame, 10, 1)).toEqual({ r: 200, g: 30, b: 40, a: 255 });
    expect(rgbaAt(frame, 11, 1)).toEqual({ r: 30, g: 200, b: 40, a: 255 });
    expect(frame.getIndex(10, 1)).toBe(SHIP);

    script.tickShodLod();
    frame = renderRoomRgba(room, source);
    expect(rgbaAt(frame, 10, 1)).toEqual({ r: 200, g: 30, b: 40, a: 255 }); // enhanced trail
    expect(rgbaAt(frame, 11, 1)).toEqual({ r: 4, g: 5, b: 6, a: 255 });
    expect(rgbaAt(frame, 11, 2)).toEqual({ r: 30, g: 200, b: 40, a: 255 });
    expect(frame.getIndex(11, 2)).toBe(SHIP_2);

    const replayed = renderRoomRgba(
      room,
      new EnhancedArtSource(room.palette, enhancedArt(), [wreckObject], null),
    );
    expect(Buffer.from(replayed.rgba).equals(Buffer.from(frame.rgba))).toBe(true);

    const classic = renderRoomRgba(room, new ClassicArtSource(room.palette));
    expect(classic.getIndex(11, 2)).toBe(frame.getIndex(11, 2));
  });

  it('starts the visible wreck through the real LODE sink-to-shodit chain', () => {
    const room = wreckRoom();
    const script = new Script(room, () => 1, () => false, { talkNow: () => 1 });
    let seed = 0x12345678;
    script.random = (n: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return n <= 0 ? 0 : seed % n;
    };
    LODE_ROOM.init(script);

    let visible = false;
    for (let count = 1; count <= 20_000 && !visible; count++) {
      script.count = count;
      LODE_ROOM.prog!(script);
      script.dialogy(count);
      script.tickShodLod();
      visible = room.wreckSwaps.some((swap) => swap.pixels.length > 0);
    }

    expect(visible).toBe(true);
    expect(script.padalod).not.toBe(-1);
    expect(room.wreckSwaps.some((swap) => swap.pixels.length > 0)).toBe(true);
  });

  it('continues falling while the room win countdown is active', () => {
    const room = wreckRoom();
    const script = primeDrop(room);
    const engine = new StepEngine(room, script, { name: 'LODE-test', init: () => {}, prog: () => {} }, {
      random: () => 0,
    });
    room.venku.little = true;
    room.venku.big = true;

    engine.runScript(1, 0);

    expect(script.padalod).toBe(0);
    expect(script.lodniY).toBe(1);
    expect(room.wreckSwaps.some((swap) => swap.pixels.length > 0)).toBe(true);
  });
});
