/**
 * Direct RGBA-plane coverage for the single-pass compositor (RgbaScreen +
 * renderRoomRgba). The existing effect unit tests (mirror, wall-afaze,
 * visibility, …) assert palette *indices* on the IndexedScreen oracle; the
 * whole-room parity gate (render-parity.test.ts) then binds RgbaScreen to that
 * oracle byte-for-byte across every real room. This test additionally asserts on
 * the production RGBA output itself, using a distinguishing palette so the
 * checks stay exact — proving `rgbaAt` sampling and the classic art source end
 * to end on a synthetic room that exercises the wall/bg mask, a masked item, and
 * the spec=1 mirror reflection.
 */
import { describe, it, expect } from 'vitest';
import { Room } from '../src/core/room.js';
import { renderRoomRgba } from '../src/render/renderRoom.js';
import { RgbaScreen } from '../src/render/rgbaScreen.js';
import { ClassicArtSource } from '../src/render/classicArtSource.js';
import { Kind, type FfrRoom, type FfrItem, type FfrBitmap } from '../src/data/ffr.js';
import { rgbaAt, distinguishingPalette, paletteRgba } from './rgbaAt.js';

const BGV = 100;
const BLOCK = 42;
const GLASS = 88;

function solid(w: number, h: number, value: number): FfrBitmap {
  return { w, h, pixels: new Uint8Array(w * h).fill(value), padded: 0 };
}

/**
 * A 10×3-cell room (150×45 px): a BLOCK item at grid (4,0), a 30×30 glass mirror
 * at grid (5,0), on a solid WALL over a BGV background. `mirrorSpec=1` turns on
 * the reflection.
 */
function room(mirrorSpec: number): Room {
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
    // [1] wall (all pixels == mask 255 → fully transparent, shows bg), [2] bg, [3] block, [4] glass.
    bitmaps: [null, solid(150, 45, 255), solid(150, 45, BGV), solid(15, 30, BLOCK), solid(30, 30, GLASS)],
    heads: { big: [], small: [] },
    bodies: { big: [], small: [] },
    palette: distinguishingPalette(),
  };
  const r = new Room(ffr);
  r.items[2]!.spec = mirrorSpec;
  return r;
}

function render(mirrorSpec: number) {
  const r = room(mirrorSpec);
  return renderRoomRgba(r, new ClassicArtSource(r.palette), { count: 0 });
}

describe('RGBA compositor direct output', () => {
  it('paints a masked item over the background in its exact colour', () => {
    const screen = render(0);
    // Block item at grid (4,0) → screen x 60..74, y 0..29.
    expect(rgbaAt(screen, 67, 15)).toEqual(paletteRgba(BLOCK));
  });

  it('reflects the scene into the glass with spec=1 (glass at x85 becomes the block)', () => {
    // Glass at grid (5,0) → x 75..104. drawMirror copies column X+3-k into X+k
    // where the pixel is glass: column 85 reflects source 75+3-10 = 68, inside the
    // block (x 60..74), so that glass pixel takes the block colour.
    expect(rgbaAt(render(1), 85, 15)).toEqual(paletteRgba(BLOCK));
  });

  it('leaves the glass untouched without spec=1 (control)', () => {
    expect(rgbaAt(render(0), 85, 15)).toEqual(paletteRgba(GLASS));
  });

  it('keeps glass where the reflected source is also glass, near the axis', () => {
    // Column 76 reflects source 75+3-1 = 77, still inside the glass → stays glass.
    expect(rgbaAt(render(1), 76, 15)).toEqual(paletteRgba(GLASS));
  });
});

describe('RgbaScreen.copyPixel (truecolor mirror reflection)', () => {
  it('copies the displayed colour, not a palette re-lookup', () => {
    const s = new RgbaScreen(10, 4, new ClassicArtSource(distinguishingPalette()));
    // Paint a truecolor pixel at (2,1) that equals no palette entry (index 7 →
    // {7,248,49}), leaving the index plane at 0. A palette re-lookup would give
    // palette[0]; copyPixel must instead carry the {7,7,7} colour.
    s.blitSpriteRgba(new Uint8Array([7, 7, 7, 255]), 1, 1, 2, 1, false);
    s.copyPixel(5, 1, 2, 1);
    expect(rgbaAt(s, 5, 1)).toEqual({ r: 7, g: 7, b: 7, a: 255 });
  });
});
