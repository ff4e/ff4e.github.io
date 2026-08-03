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
import { applyWreckSwapScaled, wreckSwapRect, type AiWreckSurface } from '../src/render/roomAi.js';
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

// ---------------------------------------------------------------------------
// The `ai` tier's ×S replay (AiRoom.syncWreck -> applyWreckSwapScaled, roomAi.ts).
//
// The oracle here is the FAITHFUL renderer, not the other AI backend. This task takes
// over a frame the faithful compositor used to own, so that is the comparison that means
// something — and PR #11's lesson is that a CPU↔GPU parity probe cannot catch a bug that
// is identical on both sides (both call this same function).
//
// The fixture's ×S art is built as an EXACT ×S expansion of the room's own palette
// bitmaps, which makes the comparison byte-exact rather than approximate: every native
// pixel of the faithful background must equal all S×S pixels of the ×S background. That
// pins the coordinate arithmetic (including the `- FFR_EXTRA` padded-column offset), the
// block expansion, the direction of the exchange and the erosion trail all at once.
//
// It is asserted MID-FALL — after the second tick, the state the test above proves has an
// eroded sprite and a trail. A resting LODE has an empty swap list and proves nothing.
// ---------------------------------------------------------------------------

const S = 4;

/** An exact ×S expansion of a palette bitmap region, as straight opaque RGBA. */
function scaledArt(
  bmp: FfrBitmap,
  pal: ReturnType<typeof palette>,
  x0: number,
  y0: number,
  w: number,
  h: number,
): AiWreckSurface {
  const data = new Uint8ClampedArray(w * S * h * S * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = pal[bmp.pixels[(y0 + y) * bmp.w + (x0 + x)]!]!;
      for (let by = 0; by < S; by++) {
        for (let bx = 0; bx < S; bx++) {
          const o = ((y * S + by) * (w * S) + x * S + bx) * 4;
          data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 255;
        }
      }
    }
  }
  return { data, w: w * S, h: h * S, ox: 0, oy: 0 };
}

describe('LODE falling wreck at ×S (the `ai` tier)', () => {
  it('replays the swaps into ×S art so every S×S block matches the faithful background', () => {
    const room = wreckRoom();
    const script = primeDrop(room);
    const pal = room.palette;

    // Snapshot the PRISTINE art before any swap: Room clones a bitmap on its first
    // destructive write, so this has to happen before the ticks.
    const bgArt = scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const sprites = new Map<number, AiWreckSurface>();
    for (let phase = 0; phase < 5; phase++) {
      const b = room.bitmaps[3 + phase]!;
      sprites.set(phase, scaledArt(b, pal, 0, 0, b.w, b.h));
    }

    script.tickShodLod();
    script.tickShodLod(); // MID-FALL: the sprite has eroded and left a trail

    for (const swap of room.wreckSwaps) {
      const spr = sprites.get(swap.phase)!;
      applyWreckSwapScaled(bgArt, spr, swap, S, bgArt.w, bgArt.h);
    }

    const faithful = renderRoomRgba(room, new ClassicArtSource(pal));
    let mismatches = 0;
    let firstBad = '';
    for (let y = 0; y < H && mismatches === 0; y++) {
      for (let x = 0; x < W; x++) {
        const want = rgbaAt(faithful, x, y);
        for (let by = 0; by < S; by++) {
          for (let bx = 0; bx < S; bx++) {
            const o = ((y * S + by) * bgArt.w + x * S + bx) * 4;
            if (
              bgArt.data[o] !== want.r || bgArt.data[o + 1] !== want.g ||
              bgArt.data[o + 2] !== want.b || bgArt.data[o + 3] !== 255
            ) {
              if (!firstBad) {
                firstBad = `native (${x},${y}) block (${bx},${by}): got ` +
                  `${bgArt.data[o]},${bgArt.data[o + 1]},${bgArt.data[o + 2]},${bgArt.data[o + 3]} ` +
                  `want ${want.r},${want.g},${want.b},255`;
              }
              mismatches++;
            }
          }
        }
      }
    }
    expect(firstBad).toBe('');
    expect(mismatches).toBe(0);

    // ...and the wreck really is visible here, so the sweep above is not vacuously green.
    expect(room.wreckSwaps.some((s) => s.pixels.length > 0)).toBe(true);
    expect(rgbaAt(faithful, 11, 2)).toEqual({ ...pal[SHIP_2]!, a: 255 });
  });

  it('stays byte-exact for the WHOLE fall, including the y=436 clear-out row', () => {
    // The mid-fall case above never reaches the bottom of the fall band, so on its own it
    // leaves Delphi's `dy > 436` cut-off unpinned — and that guard is a magic number the
    // engine and this replay both carry. Running to padalod = -1 walks the ship through
    // every row it can touch, so a wrong cut-off (or a lost final erase pass) shows up as
    // a background that no longer matches the faithful one.
    const room = wreckRoom();
    const script = primeDrop(room);
    const pal = room.palette;
    const bgArt = scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const sprites = new Map<number, AiWreckSurface>();
    for (let phase = 0; phase < 5; phase++) {
      const b = room.bitmaps[3 + phase]!;
      sprites.set(phase, scaledArt(b, pal, 0, 0, b.w, b.h));
    }

    while (script.padalod !== -1) script.tickShodLod();
    expect(script.lodniY).toBe(437);
    for (const swap of room.wreckSwaps) {
      applyWreckSwapScaled(bgArt, sprites.get(swap.phase)!, swap, S, bgArt.w, bgArt.h);
    }

    const faithful = renderRoomRgba(room, new ClassicArtSource(pal));
    let bad = 0;
    for (let y = 0; y < H && bad === 0; y++) {
      for (let x = 0; x < W; x++) {
        const want = rgbaAt(faithful, x, y);
        for (let by = 0; by < S; by++) {
          for (let bx = 0; bx < S; bx++) {
            const o = ((y * S + by) * bgArt.w + x * S + bx) * 4;
            if (
              bgArt.data[o] !== want.r || bgArt.data[o + 1] !== want.g ||
              bgArt.data[o + 2] !== want.b || bgArt.data[o + 3] !== 255
            ) bad++;
          }
        }
      }
    }
    expect(bad).toBe(0);
    // The trail the engine leaves behind survives to the end (as the faithful test above
    // asserts on the index plane), so this sweep is not comparing two pristine images.
    expect(rgbaAt(faithful, 10, 1)).toEqual({ ...pal[SHIP]!, a: 255 });
  });

  it('erodes the ×S sprite in step with the palette sprite (the trail comes from this)', () => {
    const room = wreckRoom();
    const script = primeDrop(room);
    const pal = room.palette;
    const bgArt = scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const spr = scaledArt(room.bitmaps[3]!, pal, 0, 0, 2, 1);

    script.tickShodLod();
    for (const swap of room.wreckSwaps) applyWreckSwapScaled(bgArt, spr, swap, S, bgArt.w, bgArt.h);

    // The palette sprite's first pixel became the MASK the background carried there;
    // the ×S sprite must carry the SAME colour, in every pixel of its block.
    expect(room.bitmaps[3]!.pixels[0]).toBe(MASK);
    for (let by = 0; by < S; by++) {
      for (let bx = 0; bx < S; bx++) {
        const o = (by * spr.w + bx) * 4;
        expect([spr.data[o], spr.data[o + 1], spr.data[o + 2], spr.data[o + 3]])
          .toEqual([pal[MASK]!.r, pal[MASK]!.g, pal[MASK]!.b, 255]);
      }
    }
  });

  it('confines a swap to the ship footprint (the rect the canvas actually reads back)', () => {
    const room = wreckRoom();
    const script = primeDrop(room);
    script.tickShodLod();
    const swap = room.wreckSwaps.find((s) => s.pixels.length > 0)!;
    // 2x1 sprite at padded column 20 => art column 10, row 1.
    expect(wreckSwapRect(swap, 2 * S, 1 * S, S, W * S, H * S))
      .toEqual({ x: 10 * S, y: 1 * S, w: 2 * S, h: 1 * S });
    // A swap that changed nothing has no rect at all, so it costs no readback.
    expect(wreckSwapRect({ x: 20, y: 5, phase: 0, width: 2, pixels: [] }, 2 * S, 1 * S, S, W * S, H * S))
      .toBeNull();
  });

  it('writes opaque pixels even where the ×S sprite is transparent', () => {
    // BG_FS writes outColor.a = 1.0 while canvas-2D keeps whatever alpha the background
    // carries, so a sub-255 alpha here makes the two `ai` backends disagree — and a ×S
    // block around an opaque native pixel can pick one up from an anti-aliased edge.
    const room = wreckRoom();
    const script = primeDrop(room);
    const pal = room.palette;
    const bgArt = scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const spr = scaledArt(room.bitmaps[3]!, pal, 0, 0, 2, 1);
    for (let i = 3; i < spr.data.length; i += 4) spr.data[i] = 0; // fully transparent art

    script.tickShodLod();
    for (const swap of room.wreckSwaps) applyWreckSwapScaled(bgArt, spr, swap, S, bgArt.w, bgArt.h);

    const o = ((1 * S) * bgArt.w + 10 * S) * 4;
    expect(bgArt.data[o + 3]).toBe(255);
    expect(bgArt.data[o]).toBe(pal[SHIP]!.r); // the RGB still came from the sprite
    expect(spr.data[3]).toBe(255);
  });
});
