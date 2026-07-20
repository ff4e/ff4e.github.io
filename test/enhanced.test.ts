/**
 * EnhancedArtSource unit invariants (synthetic art, no external assets). The
 * source is one of the two ArtSource implementations; its draw methods paint the
 * FFNG truecolor art where available and delegate to the shared classic helpers
 * otherwise. Tests assert on the RgbaScreen the methods draw into.
 */
import { describe, it, expect } from 'vitest';
import { RgbaScreen } from '../src/render/rgbaScreen.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { EnhancedArtSource, type EnhancedArt, type FishSprites } from '../src/render/enhancedArtSource.js';
import { rgbaAt } from './rgbaAt.js';
import { FFR_EXTRA, type FfrBitmap, type FfrPaletteEntry } from '../src/data/ffr.js';
import type { Room, Item } from '../src/core/room.js';

const FSIZE = 15;
const BLACK = { r: 0, g: 0, b: 0, a: 255 }; // palette index 0 = the untouched background

function palette(): FfrPaletteEntry[] {
  return Array.from({ length: 256 }, (_, i) => ({ r: i, g: (i * 2) & 255, b: (i * 3) & 255 }));
}
function screen(w: number, h: number): RgbaScreen {
  return new RgbaScreen(w, h, new ClassicArtSource(palette()));
}

describe('EnhancedArtSource.drawItem', () => {
  function sprite(rc: number, gc: number, bc: number) {
    const w = 2;
    const h = 2;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      const left = i % w === 0;
      rgba[i * 4] = left ? rc : 250;
      rgba[i * 4 + 1] = gc;
      rgba[i * 4 + 2] = bc;
      rgba[i * 4 + 3] = 255;
    }
    return { w, h, rgba };
  }
  const item = (over: Record<string, unknown>): Item =>
    ({ x: 2, y: 3, afaze: 0, dir: 0, spec: 0, visible: true, kind: 1, bmp: 1, ...over }) as unknown as Item;
  // Empty bitmaps → the classic fallback (classicItem) finds no bitmap and draws nothing.
  const room = { gspec: 0, bitmaps: [] } as unknown as Room;

  it('draws the mapped truecolor sprite for the item afaze at item.x*FSIZE', () => {
    const src = new EnhancedArtSource(palette(), null, [{ item: 1, frames: [sprite(200, 0, 0), sprite(0, 0, 200)] }], null);
    const s = screen(60, 60);
    src.drawItem(s, room, item({ afaze: 1 }), 1, 0, 0);
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE)).toEqual({ r: 0, g: 0, b: 200, a: 255 }); // frame 1 = blue
  });

  it('does not mirror a statically-mirrored spec=10 item (pre-mirrored FFNG art)', () => {
    const src = new EnhancedArtSource(palette(), null, [{ item: 1, frames: [sprite(200, 0, 0)] }], null);
    const s = screen(60, 60);
    src.drawItem(s, room, item({ spec: 10, initSpec: 10 }), 1, 0, 0);
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE).r).toBe(200); // as-is: left column keeps the left colour
  });

  it('mirrors a dynamically-flipped spec=10 figure (base FFNG art) to match the classic KresliRev', () => {
    const src = new EnhancedArtSource(palette(), null, [{ item: 1, frames: [sprite(200, 0, 0)] }], null);
    const s = screen(60, 60);
    // initSpec !== 10 → the art is base-oriented, so spec=10 flips it: the sprite's
    // right column (250) lands on the left anchor.
    src.drawItem(s, room, item({ spec: 10, initSpec: 11 }), 1, 0, 0);
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE).r).toBe(250);
  });

  it('draws every object bound to one item index (stacked sprites, e.g. PARTY1 cabin body + windows)', () => {
    // A: solid red. B: blue only on the right column (left column transparent).
    const A = { w: 2, h: 2, rgba: new Uint8Array([200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0, 255, 200, 0, 0, 255]) };
    const B = { w: 2, h: 2, rgba: new Uint8Array([0, 0, 0, 0, 0, 0, 200, 255, 0, 0, 0, 0, 0, 0, 200, 255]) };
    const src = new EnhancedArtSource(palette(), null, [{ item: 1, frames: [A] }, { item: 1, frames: [B] }], null);
    const s = screen(60, 60);
    src.drawItem(s, room, item({}), 1, 0, 0);
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE).r).toBe(200); // left column: A (red) shows where B is transparent
    expect(rgbaAt(s, 2 * FSIZE + 1, 3 * FSIZE).b).toBe(200); // right column: B (blue) drawn on top
  });

  it('falls back to classic (no truecolor) for spec=1 mirror, fish kind, and unmapped items', () => {
    const src = new EnhancedArtSource(palette(), null, [{ item: 1, frames: [sprite(200, 0, 0)] }], null);
    const cases: Array<[Record<string, unknown>, number]> = [
      [{ spec: 1 }, 1],
      [{ kind: 3 }, 1],
      [{ kind: 4 }, 1],
      [{}, 99],
    ];
    for (const [over, index] of cases) {
      const s = screen(60, 60);
      src.drawItem(s, room, item(over), index, 0, 0);
      expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE)).toEqual(BLACK); // classicItem drew nothing
    }
  });
});

describe('EnhancedArtSource.drawFish', () => {
  function spr(r: number) {
    const rgba = new Uint8Array(2 * 2 * 4);
    for (let i = 0; i < 4; i++) {
      rgba[i * 4] = r;
      rgba[i * 4 + 3] = 255;
    }
    return { w: 2, h: 2, rgba };
  }
  function fish(): FishSprites {
    const mk = () => {
      const m = new Map<string, ReturnType<typeof spr>>();
      m.set('body_rest_00.png', spr(100));
      m.set('head_pushing.png', spr(200));
      return m;
    };
    return { small: { left: mk(), right: mk() }, big: { left: mk(), right: mk() } };
  }
  const room = (over: Record<string, unknown>): Room =>
    ({
      gspec: 0,
      venku: { little: false, big: true },
      alive: { little: true, big: false },
      facingRight: { little: false, big: false },
      kostra: { little: false, big: false },
      rozpad: { little: 0, big: 0 },
      bodies: { small: [], big: [] },
      heads: { small: [], big: [] },
      ...over,
    }) as unknown as Room;
  const item = { x: 2, y: 3, dir: 0, mask: 0 } as unknown as Item;
  const af = (b: number, h: number) => ({ bodyFrame: b, headFrame: h });

  it('draws the mapped truecolor body at the fish anchor', () => {
    const s = screen(90, 90);
    new EnhancedArtSource(palette(), null, [], fish()).drawFish(s, room({}), 'little', item, 0, 0, af(1, 0));
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE).r).toBe(100);
  });

  it('overlays the head when headFrame maps (pushing over body)', () => {
    const s = screen(90, 90);
    new EnhancedArtSource(palette(), null, [], fish()).drawFish(s, room({}), 'little', item, 0, 0, af(1, 1));
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE).r).toBe(200); // head red over body red
  });

  it('falls back to classic (nothing drawn) for an exited fish', () => {
    const s = screen(90, 90);
    const src = new EnhancedArtSource(palette(), null, [], fish());
    src.drawFish(s, room({ venku: { little: true, big: true } }), 'little', item, 0, 0, af(1, 0));
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE)).toEqual(BLACK);
  });

  it('falls back to classic for an unmapped (skeleton, frame 19) pose', () => {
    const s = screen(90, 90);
    // FFNG has no body_19; classicFish then finds no bodies[19] → draws nothing.
    new EnhancedArtSource(palette(), null, [], fish()).drawFish(s, room({}), 'little', item, 0, 0, af(19, 0));
    expect(rgbaAt(s, 2 * FSIZE, 3 * FSIZE)).toEqual(BLACK);
  });
});

describe('EnhancedArtSource.paintBackground', () => {
  const W = 8;
  const H = 4;
  const MASK = 255;
  function classicWall(): FfrBitmap {
    const px = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px[y * W + x] = x < W / 2 ? 5 : MASK;
    return { w: W, h: H, pixels: px, padded: 0 };
  }
  function classicBg(): FfrBitmap {
    return { w: W + 2 * FFR_EXTRA, h: H, pixels: new Uint8Array((W + 2 * FFR_EXTRA) * H).fill(100), padded: FFR_EXTRA };
  }
  function art(wall: [number, number, number], bg: [number, number, number]): EnhancedArt {
    const wallA = new Uint8Array(W * H * 4);
    const bgA = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      wallA[i * 4] = wall[0];
      wallA[i * 4 + 1] = wall[1];
      wallA[i * 4 + 2] = wall[2];
      wallA[i * 4 + 3] = 255;
      bgA[i * 4] = bg[0];
      bgA[i * 4 + 1] = bg[1];
      bgA[i * 4 + 2] = bg[2];
      bgA[i * 4 + 3] = 255;
    }
    return { w: W, h: H, wall: [wallA], bg: [bgA] };
  }
  const baseRoom = { gspec: 0, wallItem: { afaze: 0, mask: MASK }, wamp: 0, wper: 1, wspd: 1, palette: palette() };

  it('swaps FFNG wall (opaque) and bg (masked) for a gspec=0 master; idx keeps classic structure', () => {
    const s = screen(W, H);
    new EnhancedArtSource(palette(), art([11, 22, 33], [44, 55, 66]), [], null).paintBackground(
      s,
      baseRoom as unknown as Room,
      classicWall(),
      classicBg(),
      0,
    );
    expect(rgbaAt(s, 1, 1)).toEqual({ r: 11, g: 22, b: 33, a: 255 });
    expect(s.getIndex(1, 1)).toBe(5);
    expect(rgbaAt(s, 6, 1)).toEqual({ r: 44, g: 55, b: 66, a: 255 });
    expect(s.getIndex(6, 1)).toBe(100);
  });

  it('falls back to the classic background for a darkness (gspec=2) room', () => {
    const darkRoom = { ...baseRoom, gspec: 2 } as unknown as Room;
    const s = screen(W, H);
    new EnhancedArtSource(palette(), art([1, 2, 3], [4, 5, 6]), [], null).paintBackground(s, darkRoom, classicWall(), classicBg(), 0);
    // classicBackground fills with darkestIndex(palette): index 0 = {0,0,0}.
    expect(rgbaAt(s, 3, 2)).toEqual(BLACK);
    expect(s.getIndex(3, 2)).toBe(0);
  });
});
