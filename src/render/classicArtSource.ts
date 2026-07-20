/**
 * Classic (256-colour) art source — the palette-look implementation of the
 * ArtSource interface, the counterpart to EnhancedArtSource. Every element is
 * drawn from the FFR bitmaps sampled through the room palette, via the shared
 * classic draw helpers in renderRoom.ts. This is the deterministic reference
 * look (and, on an RgbaScreen, byte-for-byte identical to IndexedScreen + toRgba).
 */
import { classicBackground, classicItem, classicFish, type FishFrame } from './renderRoom.js';
import { buildPaletteLut, type ArtSource } from './artSource.js';
import type { CompositeTarget } from './framebuffer.js';
import type { FfrBitmap } from '../data/ffr.js';
import type { Room, Item } from '../core/room.js';

export class ClassicArtSource implements ArtSource {
  readonly lut: Uint8Array;

  constructor(palette: Room['palette']) {
    this.lut = buildPaletteLut(palette);
  }

  paintBackground(screen: CompositeTarget, room: Room, wall: FfrBitmap, bg: FfrBitmap, count: number): void {
    classicBackground(screen, room, wall, bg, count);
  }

  drawItem(screen: CompositeTarget, room: Room, item: Item, _index: number, sx: number, sy: number): void {
    classicItem(screen, room, item, sx, sy);
  }

  drawFish(
    screen: CompositeTarget,
    room: Room,
    which: 'little' | 'big',
    item: Item,
    sx: number,
    sy: number,
    frame: FishFrame,
  ): void {
    classicFish(screen, room, which, item, sx, sy, frame);
  }
}
