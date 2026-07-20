/**
 * World-map corner "buttons" (UMain.pas PaintBox1MouseMove:1636): the mask
 * colour under the cursor selects intro/exit/credits/options. Verifies the
 * palette-index → action mapping and that non-corner pixels return null.
 */
import { describe, it, expect } from 'vitest';
import { WorldMap, MAP_W, MAP_H } from '../src/render/worldMap.js';
import type { Bmp } from '../src/data/bmp.js';

function solid(idx: number): Bmp {
  return {
    w: MAP_W,
    h: MAP_H,
    pixels: new Uint8Array(MAP_W * MAP_H).fill(idx),
    palette: Array.from({ length: 256 }, () => ({ r: 0, g: 0, b: 0 })),
  };
}

/** A mask whose four corners carry the action indices, rest is a neutral index. */
function cornerMask(): Bmp {
  const m = solid(200); // a non-action, non-branch fill
  const put = (x: number, y: number, idx: number) => (m.pixels[y * MAP_W + x] = idx);
  put(10, 10, 12); // clNavy → intro (top-left)
  put(630, 10, 9); // clTeal → exit (top-right)
  put(10, 470, 4); // clOlive → credits (bottom-left)
  put(630, 470, 10); // clGreen → options (bottom-right)
  return m;
}

function makeMap(): WorldMap {
  const nodes = [solid(0), solid(0), solid(0), solid(0), solid(0)];
  return new WorldMap(solid(0), solid(1), cornerMask(), nodes);
}

describe('world-map corner actions', () => {
  it('maps each corner colour to its action', () => {
    const map = makeMap();
    expect(map.cornerAction(10, 10)).toBe('intro');
    expect(map.cornerAction(630, 10)).toBe('exit');
    expect(map.cornerAction(10, 470)).toBe('credits');
    expect(map.cornerAction(630, 470)).toBe('options');
  });

  it('returns null off the corners and out of bounds', () => {
    const map = makeMap();
    expect(map.cornerAction(320, 240)).toBeNull(); // neutral fill
    expect(map.cornerAction(-1, 0)).toBeNull();
    expect(map.cornerAction(0, MAP_H)).toBeNull();
  });
});
