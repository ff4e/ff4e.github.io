import { describe, expect, it } from 'vitest';
import { Script } from '../src/core/script.js';
import { Room, forEachWreckPixel, wreckFrame, wreckObject, type WreckSwap } from '../src/core/room.js';
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
import { applyWreckBatch, applyWreckSwapScaled, planWreckBatch, wreckSwapRect, type AiWreckSurface } from '../src/render/roomAi.js';
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

function wreckRoom(shipH = 1): Room {
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
  // Phase 0 is the original 2x1 [SHIP, SHIP_2] sprite every existing assertion is written
  // against. The other four carry DISTINCT colours so a replay that ignores `phase` and
  // always reaches for frame 0 produces different pixels; `shipH` makes the sprite tall
  // enough for a tick's erase and draw footprints to OVERLAP, which is what makes the
  // order swaps are applied in observable at all.
  const shipFrame = (phase: number): FfrBitmap => ({
    w: 2,
    h: shipH,
    // Every pixel distinct beyond row 0, deliberately. Identical rows make the exchange
    // order-INDEPENDENT (swapping a row with an identical one is a no-op either way), and
    // a fixture like that cannot see a batch applied backwards. Row 0 keeps the original
    // [SHIP, SHIP_2] so every assertion written against the 1-row ship is untouched.
    pixels: new Uint8Array(
      Array.from({ length: 2 * shipH }, (_, i) =>
        phase === 0 ? (i < 2 ? [SHIP, SHIP_2][i]! : 100 + i) : 30 + phase * 10 + i),
    ),
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
      shipFrame(0),
      shipFrame(1),
      shipFrame(2),
      shipFrame(3),
      shipFrame(4),
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

function primeDrop(room: Room, phase = 0): Script {
  const script = new Script(room, () => 0);
  script.padalod = phase + 100;   // shodLod stores kterou+100; the first tick strips the 100
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

const wreckShipArt: EnhancedObject = {
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
    const source = new EnhancedArtSource(room.palette, enhancedArt(), [wreckShipArt], null);

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
      new EnhancedArtSource(room.palette, enhancedArt(), [wreckShipArt], null),
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
// eroded sprite and a trail — and again over the whole fall. A resting LODE has an empty
// swap list and proves nothing.
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
    // The mid-fall case above never reaches the bottom of the fall band. Running to
    // padalod = -1 walks the ship through every row it can touch, including the final
    // off-screen pass that records no pixels at all, so a lost last erase — or any drift
    // in how the engine's `y > 436` cut-off interacts with the replay, which deliberately
    // does not restate it — shows up as a background that no longer matches the faithful
    // one.
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

  it('clips to the ×S art rather than writing past its edges', () => {
    // The window handed to a swap is derived from the art size, so a swap that reaches
    // past the art must be cut at the art, not at the window. Nothing in a shipped room
    // reaches this — LODE's fall band is well inside its background — but it is the only
    // bound the function itself owns (Delphi's y>436 cut-off is applied when the swap is
    // RECORDED, so this must not restate it), and an unbounded write here corrupts
    // whatever the ×S buffer neighbours.
    const room = wreckRoom();
    const script = primeDrop(room);
    const pal = room.palette;
    script.tickShodLod();
    const swap = room.wreckSwaps.find((sw) => sw.pixels.length > 0)!;

    // Art declared as ending ABOVE this swap's row (1) and LEFT of its column (10).
    const shortArt = () => scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const pristine = scaledArt(room.bitmaps[1]!, pal, FFR_EXTRA, 0, W, H);
    const spr = () => scaledArt(room.bitmaps[3]!, pal, 0, 0, 2, 1);

    const tooLow = shortArt();
    applyWreckSwapScaled(tooLow, spr(), swap, S, tooLow.w, 1 * S); // art ends at native row 1
    expect(Buffer.from(tooLow.data).equals(Buffer.from(pristine.data))).toBe(true);

    const tooFarRight = shortArt();
    applyWreckSwapScaled(tooFarRight, spr(), swap, S, 10 * S, tooFarRight.h); // ends at col 10
    expect(Buffer.from(tooFarRight.data).equals(Buffer.from(pristine.data))).toBe(true);

    // ...and with the real art size it DOES write, so the two assertions above are not
    // just observing a swap that does nothing.
    const full = shortArt();
    applyWreckSwapScaled(full, spr(), swap, S, full.w, full.h);
    expect(Buffer.from(full.data).equals(Buffer.from(pristine.data))).toBe(false);
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

// ---------------------------------------------------------------------------
// The ×S replay AS PRODUCTION RUNS IT: a windowed readback of several swaps at once.
//
// The sweeps above call applyWreckSwapScaled with a full-art surface (`ox`/`oy` = 0) and
// one swap at a time. That is not what ships. `AiRoom.syncWreck` reads back only the UNION
// of the pending swaps' footprints, applies them all into that one sub-rectangle, and
// writes it back — so the `- bg.ox` / `- bg.oy` translation and the union bounds are the
// coordinate system the game actually uses, and they were reachable only from the browser
// probe. Replaying through the same shape here puts them under the byte-exact faithful
// oracle instead.
// ---------------------------------------------------------------------------

/** Copy a sub-rectangle out of a ×S surface, as syncWreck's getImageData does. */
function windowOf(src: AiWreckSurface, x: number, y: number, w: number, h: number): AiWreckSurface {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let r = 0; r < h; r++) {
    const from = ((y + r) * src.w + x) * 4;
    data.set(src.data.subarray(from, from + w * 4), r * w * 4);
  }
  return { data, w, h, ox: x, oy: y };
}

/** Write a window back, as syncWreck's putImageData does. */
function blitBack(dst: AiWreckSurface, win: AiWreckSurface): void {
  for (let r = 0; r < win.h; r++) {
    const to = ((win.oy + r) * dst.w + win.ox) * 4;
    dst.data.set(win.data.subarray(r * win.w * 4, (r + 1) * win.w * 4), to);
  }
}

/**
 * A replayer that consumes `room.wreckSwaps` exactly as `AiRoom.syncWreck` does: plan the
 * pending batch, read back the ONE window that covers it, apply the batch into that
 * window, write it back, advance the cursor.
 *
 * It drives `planWreckBatch` and `applyWreckBatch` themselves rather than reimplementing
 * them, so the rules they own — the union rect, the cursor, and above all the ORDER swaps
 * are applied in — are under test here and not merely mirrored.
 *
 * Call it after each tick to reproduce the shipping rhythm (one pass per frame, so a
 * batch is a tick's erase-here / draw-one-row-down pair), or once at the end to check that
 * batching is an optimisation rather than a behaviour.
 */
function makeReplayer(bg: AiWreckSurface, sprites: Map<number, AiWreckSurface>) {
  let cursor = 0;
  return (swaps: readonly WreckSwap[]): void => {
    const batch = planWreckBatch(swaps, cursor, (phase) => sprites.get(phase) ?? null, S, bg.w, bg.h);
    if (batch.rect) {
      const win = windowOf(bg, batch.rect.x, batch.rect.y, batch.rect.w, batch.rect.h);
      applyWreckBatch(win, batch.pending, S, bg.w, bg.h);
      blitBack(bg, win);
    }
    cursor = batch.cursor;
  };
}

/** Every ×S pixel of `art` must equal the faithful renderer's native pixel under it. */
function expectMatchesFaithful(art: AiWreckSurface, faithful: ReturnType<typeof renderRoomRgba>): void {
  let bad = 0;
  let first = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const want = rgbaAt(faithful, x, y);
      for (let by = 0; by < S; by++) {
        for (let bx = 0; bx < S; bx++) {
          const o = ((y * S + by) * art.w + x * S + bx) * 4;
          if (
            art.data[o] !== want.r || art.data[o + 1] !== want.g ||
            art.data[o + 2] !== want.b || art.data[o + 3] !== 255
          ) {
            if (!first) first = `native (${x},${y}) block (${bx},${by}): got ${art.data[o]},${art.data[o + 1]},${art.data[o + 2]} want ${want.r},${want.g},${want.b}`;
            bad++;
          }
        }
      }
    }
  }
  expect(first).toBe('');
  expect(bad).toBe(0);
}

describe('LODE wreck: the ×S replay as syncWreck actually runs it', () => {
  /**
   * Copy the room's art BEFORE anything falls. `Room` clones a bitmap on its first
   * destructive write, so reading `room.bitmaps` after a tick hands back the already-
   * wrecked pixels — staging from those compares the replay against itself and passes
   * whatever the replay does.
   */
  function pristine(room: Room) {
    const copy = (b: FfrBitmap): FfrBitmap => ({ ...b, pixels: b.pixels.slice() });
    return {
      pal: room.palette,
      bg: copy(room.bitmaps[1]!),
      ships: Array.from({ length: 5 }, (_, phase) => copy(room.bitmaps[3 + phase]!)),
    };
  }

  /** A fresh ×S staging of that pristine art: background plus the per-phase sprite set. */
  function stage(art: ReturnType<typeof pristine>): { bg: AiWreckSurface; sprites: Map<number, AiWreckSurface> } {
    const sprites = new Map<number, AiWreckSurface>();
    art.ships.forEach((b, phase) => sprites.set(phase, scaledArt(b, art.pal, 0, 0, b.w, b.h)));
    return { bg: scaledArt(art.bg, art.pal, FFR_EXTRA, 0, W, H), sprites };
  }

  it('is byte-exact when replayed tick by tick through WINDOWED readbacks', () => {
    // A 3-row ship falling one row per tick makes a tick's erase (here) and draw (one row
    // down) footprints OVERLAP while sitting at DIFFERENT positions, which is what makes
    // the order they are applied in observable. Replaying per tick is also the shipping
    // rhythm: syncWreck runs once per frame, so a batch is exactly that pair.
    const room = wreckRoom(3);
    const script = primeDrop(room);
    const { bg, sprites } = stage(pristine(room));
    const replay = makeReplayer(bg, sprites);

    for (let t = 0; t < 6; t++) {
      script.tickShodLod();
      replay(room.wreckSwaps);
    }
    expect(room.wreckSwaps.length).toBeGreaterThan(6);
    expectMatchesFaithful(bg, renderRoomRgba(room, new ClassicArtSource(room.palette)));
  });

  it('gives the same result however the pending swaps are batched', () => {
    // syncWreck batches whatever is pending, which is two swaps per tick in flight but can
    // be more after a paused frame. Batching must be an optimisation, never a behaviour:
    // one window for six swaps has to land the same pixels as six windows of one.
    const room = wreckRoom(3);
    const script = primeDrop(room);
    const art = pristine(room);
    for (let t = 0; t < 6; t++) script.tickShodLod();

    const stepwise = stage(art);
    const stepReplay = makeReplayer(stepwise.bg, stepwise.sprites);
    for (let k = 1; k <= room.wreckSwaps.length; k++) stepReplay(room.wreckSwaps.slice(0, k));

    const atOnce = stage(art);
    makeReplayer(atOnce.bg, atOnce.sprites)(room.wreckSwaps);

    expect(Buffer.from(atOnce.bg.data).equals(Buffer.from(stepwise.bg.data))).toBe(true);
    expectMatchesFaithful(stepwise.bg, renderRoomRgba(room, new ClassicArtSource(room.palette)));
  });

  it('replays the phase each swap recorded, not always the first sprite', () => {
    // Every other test drops phase 0, so a replay that ignored `swap.phase` entirely would
    // look perfect. The five shipped ship sprites differ in both art and size.
    const room = wreckRoom(3);
    const script = primeDrop(room, 3);
    const art = pristine(room);
    for (let t = 0; t < 5; t++) script.tickShodLod();
    expect(room.wreckSwaps.every((sw) => sw.phase === 3)).toBe(true);

    const { bg, sprites } = stage(art);
    makeReplayer(bg, sprites)(room.wreckSwaps);
    expectMatchesFaithful(bg, renderRoomRgba(room, new ClassicArtSource(room.palette)));

    // ...and the fixture really does distinguish the phases, so the sweep above is a test.
    expect(sprites.get(3)!.data[0]).not.toBe(sprites.get(0)!.data[0]);
  });
});

// ---------------------------------------------------------------------------
// planWreckBatch — what a syncWreck pass applies, in what order, and how far the cursor
// is allowed to move. Extracted from syncWreck precisely so it can be tested: the method
// itself needs a canvas, and vitest runs in node with no DOM.
//
// The cursor rules matter more than they look. Consuming a swap that was never applied
// loses its damage permanently and silently, and because the exchange is destructive and
// order-dependent, applying a LATER swap over a skipped earlier one is worse than doing
// nothing — the background ends up wrong rather than merely incomplete.
// ---------------------------------------------------------------------------
describe('planWreckBatch (roomAi.ts)', () => {
  const surface = (w: number, h: number): AiWreckSurface =>
    ({ data: new Uint8ClampedArray(w * h * 4), w, h, ox: 0, oy: 0 });
  const swap = (y: number, phase = 0, pixels: number[] = [0, 1]): WreckSwap =>
    ({ x: 20, y, phase, width: 2, pixels });
  const ART_W = W * S, ART_H = H * S;
  const plan = (swaps: WreckSwap[], from: number, spriteFor: (p: number) => AiWreckSurface | null) =>
    planWreckBatch(swaps, from, spriteFor, S, ART_W, ART_H);
  const always = () => surface(2 * S, 1 * S);

  it('keeps the recorded order and unions every footprint into one rect', () => {
    const swaps = [swap(1), swap(2), swap(3)];
    const b = plan(swaps, 0, always);
    expect(b.pending.map((p) => p.swap)).toEqual(swaps);      // order IS the rule
    expect(b.cursor).toBe(3);
    // Columns 10..11 native for all three; rows 1..3 plus the sprite's one row.
    expect(b.rect).toEqual({ x: 10 * S, y: 1 * S, w: 2 * S, h: 3 * S });
  });

  it('consumes swaps that changed nothing without drawing', () => {
    // applyWreckSwap records the final off-screen pass with an empty pixel list; retrying
    // it forever would mean the cursor never advances again.
    const b = plan([swap(1, 0, []), swap(2, 0, [])], 0, always);
    expect(b.pending).toEqual([]);
    expect(b.rect).toBeNull();
    expect(b.cursor).toBe(2);
  });

  it('STOPS at a swap whose sprite is unavailable, and does not consume it', () => {
    // The bug this guards: advancing past an unresolvable swap drops its damage for good,
    // so a transient failure (a canvas context the browser declined) would permanently
    // corrupt the room. Stopping means the next frame retries.
    const swaps = [swap(1, 0), swap(2, 1), swap(3, 0)];
    const b = plan(swaps, 0, (phase) => (phase === 1 ? null : always()));
    expect(b.pending.map((p) => p.swap)).toEqual([swaps[0]]);
    expect(b.cursor).toBe(1);                                  // parked ON the failure
    // ...and once the sprite is available the rest is replayed, still in order.
    const again = plan(swaps, b.cursor, always);
    expect(again.pending.map((p) => p.swap)).toEqual([swaps[1], swaps[2]]);
    expect(again.cursor).toBe(3);
  });

  it('resumes from the cursor rather than replaying the history', () => {
    const swaps = [swap(1), swap(2), swap(3)];
    const b = plan(swaps, 2, always);
    expect(b.pending.map((p) => p.swap)).toEqual([swaps[2]]);
    expect(b.cursor).toBe(3);
    expect(plan(swaps, 3, always).pending).toEqual([]);         // nothing left to do
  });

  it('sizes the union from EACH swap\'s own sprite, which differ per phase', () => {
    // The five shipped ship sprites are 195x127 down to 106x77. Unioning with one sprite's
    // size would leave a taller or wider swap partly outside the window it is applied into.
    const big = surface(8 * S, 6 * S);
    const small = surface(2 * S, 1 * S);
    const b = plan([swap(1, 0), swap(1, 1)], 0, (p) => (p === 0 ? small : big));
    expect(b.rect).toEqual({ x: 10 * S, y: 1 * S, w: 8 * S, h: 6 * S });
  });
});

// ---------------------------------------------------------------------------
// The two bindings every wreck replay depends on (core/room.ts). Both are silent when
// wrong — the wrong item renders an undamaged room, the wrong phase renders a correctly
// placed wreck in another ship's colours — and neither is visible to a check based on
// WHERE the damage landed, which is what the browser probe compares. So they are pinned
// here, on the rule itself.
// ---------------------------------------------------------------------------
describe('wreck object/frame binding (core/room.ts)', () => {
  const objects = [
    { item: 1, frames: ['other-a', 'other-b'] },
    { item: 15, frames: ['ship0', 'ship1', 'ship2', 'ship3', 'ship4'] },
  ];
  const ITEM_COUNT = 16; // the ship is itemCount - 1, the mask is one past it

  it('binds the ship to item itemCount - 1', () => {
    expect(wreckObject(objects, ITEM_COUNT)?.item).toBe(15);
    expect(wreckObject(objects, ITEM_COUNT)?.frames).toHaveLength(5);
    expect(wreckObject(objects, 2)?.item).toBe(1);          // follows itemCount, not a constant
    expect(wreckObject(objects, 99)).toBeNull();            // absent ⇒ no replay, not a throw
    expect(wreckObject([], ITEM_COUNT)).toBeNull();
  });

  it('selects the frame the swap phase names, not the first one', () => {
    // The mutation this kills: `frames[0]` instead of `frames[phase]`. Every fall uses ONE
    // phase for its whole duration, so a tier that ignored `phase` still produces damage in
    // exactly the right place — just drawn from the wrong ship.
    expect(wreckFrame(objects, ITEM_COUNT, 0)).toBe('ship0');
    expect(wreckFrame(objects, ITEM_COUNT, 3)).toBe('ship3');
    expect(wreckFrame(objects, ITEM_COUNT, 4)).toBe('ship4');
    expect(wreckFrame(objects, ITEM_COUNT, 5)).toBeNull();  // past the end ⇒ null, not undefined
    expect(wreckFrame(objects, 99, 0)).toBeNull();
  });

  it('agrees with the room the engine actually builds', () => {
    // Ties the constants above to the real fixture rather than to a guess: LODE stages the
    // ship under item 15 with itemCount 16, and `applyWreckSwap` reads items[itemCount-1]
    // as the ship and items[itemCount] as the mask.
    const room = wreckRoom();
    expect(room.itemCount).toBe(16);
    expect(room.items[room.itemCount - 1]).toBe(room.items[15]);
  });
});


// ---------------------------------------------------------------------------
// forEachWreckPixel — the shared decode both replays read a recorded swap through.
// Its placement and its offset arithmetic are covered by the byte-exact sweeps above (a
// mutation of either turns them red). What those cannot reach is the sprite-bounds guard:
// a swap is always replayed against the same phase's sprite it was recorded from, so the
// sizes agree and the guard never fires in a shipped room. It still has to be there —
// neither replay bounds-checks the sprite offset it computes from `i`/`j`, so a staged
// sprite smaller than the recording bitmap would read and write past the end of it.
// ---------------------------------------------------------------------------
describe('forEachWreckPixel (core/room.ts)', () => {
  const collect = (swap: WreckSwap, w: number, h: number) => {
    const out: [number, number, number, number][] = [];
    forEachWreckPixel(swap, w, h, (i, j, dx, dy) => out.push([i, j, dx, dy]));
    return out;
  };

  it('decodes row-major over swap.width and unpads the background column', () => {
    // pixel 5 with width 2 => row 2, col 1; the background is stored with FFR_EXTRA
    // columns of padding each side, so column x+j is art column x+j-FFR_EXTRA.
    expect(collect({ x: 20, y: 7, phase: 0, width: 2, pixels: [0, 5] }, 2, 3)).toEqual([
      [0, 0, 20 - FFR_EXTRA, 7],
      [2, 1, 21 - FFR_EXTRA, 9],
    ]);
  });

  it('skips any pixel that falls outside the REPLAYING sprite', () => {
    // Recorded against a 4-wide, 3-tall bitmap; replayed against a 2x1 sprite. Only the
    // pixels inside the smaller sprite may be emitted — the rest would index past its end.
    const swap = { x: 20, y: 0, phase: 0, width: 4, pixels: [0, 1, 2, 3, 4, 8] } as WreckSwap;
    expect(collect(swap, 4, 3).length).toBe(6);        // all of them fit the real bitmap
    expect(collect(swap, 2, 1)).toEqual([              // ...but not a 2x1 sprite
      [0, 0, 20 - FFR_EXTRA, 0],
      [0, 1, 21 - FFR_EXTRA, 0],
    ]);
  });

  it('emits nothing for a swap that changed nothing', () => {
    expect(collect({ x: 20, y: 3, phase: 0, width: 2, pixels: [] }, 2, 1)).toEqual([]);
  });
});
