/**
 * Native menu texture from ALTAR's original panel.ffp (GPL-2.0-or-later).
 * Run: npx tsx tools/build-native-menu-art.ts
 * Take the unlettered stone below the subtitle buttons, without repainting it.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseFfp, PANEL_W } from '../src/data/ffp.js';
import { encodePng } from '../src/render/png.js';

const panel = parseFfp(readFileSync(new URL('../public/data/Menu/panel.ffp', import.meta.url)));
const [left, top, width, height] = [4, 286, 146, 33];
const w = width;
const h = height;
const rgba = new Uint8Array(w * h * 4);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const sx = left + x;
    const sy = top + y;
    const color = panel.images[4]![sy * PANEL_W + sx]!;
    const out = (y * w + x) * 4;
    rgba.set(panel.palette.subarray(color * 3, color * 3 + 3), out);
    rgba[out + 3] = 255;
  }
}
const dir = new URL('../public/native-menu/', import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL('stone.png', dir), encodePng(rgba, w, h));
console.log(`native-menu/stone.png: ${w}x${h}, original options-panel pixels`);
