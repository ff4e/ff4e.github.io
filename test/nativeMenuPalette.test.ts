import { describe, expect, it } from 'vitest';
import { menuPalette, roomTone } from '../src/platform/nativeMenuPalette.js';
import { NATIVE_MENU_HUES } from '../src/data/nativeMenuHues.js';
import { ROOMS } from '../src/data/roomTable.js';

const rgba = (...pixels: number[]) => new Uint8ClampedArray(pixels);

describe('native room menu palette', () => {
  it('keeps achromatic rooms in the neutral C palette', () => {
    for (const pixels of [rgba(), rgba(120, 120, 120, 255), rgba(255, 0, 0, 0)]) {
      expect(roomTone(pixels)).toMatchObject({
        hue: null, symbol: null, highlight: null, shade: null, detail: null, outline: null,
        glass: 'rgb(23 29 34 / 45%)',
      });
    }
  });
  it('maps warm, blue and green scenery to colored ink with fixed surface opacity', () => {
    for (const [color, hue] of [
      [rgba(220, 90, 40, 255), 17],
      [rgba(30, 80, 160, 255), 217],
      [rgba(40, 160, 80, 255), 140],
    ] as const) {
      expect(roomTone(color)).toMatchObject({
        hue, symbol: `hsl(${hue} 58% 72%)`, glass: `hsl(${hue} 28% 13% / 45%)`,
        highlight: `hsl(${hue} 42% 88%)`, outline: `hsl(${hue} 30% 16%)`,
      });
    }
  });
  it('ignores highlights, near-black pixels, and transparent scenery gaps', () => {
    const original = rgba(220, 90, 40, 255);
    expect(roomTone(rgba(...original, 255, 255, 255, 255, 2, 0, 0, 255, 0, 0, 255, 100)))
      .toEqual(roomTone(original));
  });
  it('is deterministic and does not mutate its input', () => {
    const pixels = rgba(30, 80, 160, 255, 31, 81, 162, 255);
    const before = pixels.slice();
    expect(roomTone(pixels)).toEqual(roomTone(pixels));
    expect(pixels).toEqual(before);
  });
  it('keeps hues inside the circular range', () => {
    for (let b = 0; b < 256; b++) {
      const hue = roomTone(rgba(255, 0, b, 255)).hue;
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
  it('rejects incomplete pixels', () => {
    expect(() => roomTone(rgba(10, 20, 30))).toThrow('complete RGBA pixels');
  });
  it('covers every shipped room with a valid fixed accent', () => {
    expect(NATIVE_MENU_HUES).toHaveLength(ROOMS.length);
    for (const hue of NATIVE_MENU_HUES) expect(menuPalette(hue).hue).toBe(hue);
    expect(NATIVE_MENU_HUES[5]).toBe(33);
    expect(NATIVE_MENU_HUES[43]).toBe(146);
  });
  it('rejects invalid authored accents', () => {
    for (const hue of [-1, 360, 1.5, NaN]) expect(() => menuPalette(hue)).toThrow('Native menu hue');
  });
});
