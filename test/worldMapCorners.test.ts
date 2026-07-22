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

describe('world-map controller selection helpers', () => {
  it('gives corner centroids for each action except exit', () => {
    const corners = makeMap().cornerCentroids();
    const actions = corners.map((c) => c.action).sort();
    expect(actions).toEqual(['credits', 'intro', 'options']); // no 'exit' (no-op on web)
    // Single-pixel mask corners → centroid is exactly that pixel.
    expect(corners.find((c) => c.action === 'intro')).toMatchObject({ x: 10, y: 10 });
    expect(corners.find((c) => c.action === 'options')).toMatchObject({ x: 630, y: 470 });
  });

  it('enumerates selectable nodes matching hitTest, with their centres', () => {
    const map = makeMap();
    const nodes = map.selectableNodes(new Set(), new Set());
    expect(nodes.length).toBeGreaterThan(0); // at least the start room is reachable
    for (const n of nodes) {
      // Each selectable node is where hitTest finds it, and nodeCenter agrees.
      expect(map.hitTest(n.x, n.y, new Set(), new Set())).toBe(n.room);
      expect(map.nodeCenter(n.room)).toEqual({ x: n.x, y: n.y });
    }
  });

  it('draws a selection ring around the selected node', () => {
    const map = makeMap();
    const room = map.selectableNodes(new Set(), new Set())[0]!.room;
    const plain = map.render(new Set(), 0, undefined, new Set(), null, true, true, null);
    const ringed = map.render(new Set(), 0, undefined, new Set(), null, true, true, room);
    // The ring changes pixels near the node; the buffers must differ.
    expect(Buffer.compare(Buffer.from(plain.buffer), Buffer.from(ringed.buffer))).not.toBe(0);
    // A pixel on the ring circle (centre + radius 13) is the bright cyan.
    const { x, y } = map.nodeCenter(room);
    const i = ((y) * MAP_W + (x + 13)) * 4;
    expect([ringed[i], ringed[i + 1], ringed[i + 2]]).toEqual([120, 230, 255]);
  });
});
