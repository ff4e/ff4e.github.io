import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseFfp, PANEL_W } from '../src/data/ffp.js';
import { decodePng } from '../src/render/pngDecode.js';

describe('native menu artwork', () => {
  it('ships only original, opaque Options-panel pixels', () => {
    const bytes = readFileSync(new URL('../public/native-menu/stone.png', import.meta.url));
    expect(bytes.length).toBeLessThan(20_000);
    const { w, h, rgba } = decodePng(bytes);
    expect([w, h]).toEqual([146, 33]);
    const panel = parseFfp(readFileSync(new URL('../public/data/Menu/panel.ffp', import.meta.url)));
    const expected = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = 4 + x;
        const sy = 286 + y;
        const index = panel.images[4]![sy * PANEL_W + sx]!;
        expected.set([...panel.palette.subarray(index * 3, index * 3 + 3), 255], (y * w + x) * 4);
      }
    }
    expect(rgba).toEqual(expected);
  });
});
