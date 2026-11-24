// Placeholder Apple TV artwork for native/tvos/Assets.xcassets, from the web's own art: the
// app icon (`public/app-icon.png`) over a sea-blue back layer for the layered App Icon, and
// the title cover (`public/cover.webp`) on black for the Top Shelf. PLACEHOLDERS: the real
// store artwork (a parallax icon drawn in layers, a Top Shelf picture) replaces these PNGs one
// for one, keeping their names and pixel sizes; the catalog's Contents.json files stay. Run
// again only to regenerate the placeholders:
//
//   node native/tvos/make-placeholder-art.mjs
//
// macOS only: sips decodes and scales the PNG and the WebP; the PNGs are written here (zlib).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const pub = join(here, '..', '..', 'public');
const brand = join(here, 'Assets.xcassets', 'App Icon & Top Shelf Image.brandassets');
const tmp = mkdtempSync(join(tmpdir(), 'ff4e-tvart-'));
const SEA = [0x0b, 0x3a, 0x5a];

/** `[w, h]` of an image file. */
function dims(src) {
  const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', src], { encoding: 'utf8' });
  return [Number(/pixelWidth: (\d+)/.exec(out)[1]), Number(/pixelHeight: (\d+)/.exec(out)[1])];
}

/** `src` scaled to `w`×`h` by sips, as straight RGBA. */
function load(src, w, h) {
  const bmp = join(tmp, 'x.bmp');
  execFileSync('sips', ['-s', 'format', 'bmp', '-z', String(h), String(w), src, '--out', bmp], { stdio: 'ignore' });
  const b = readFileSync(bmp);
  const off = b.readUInt32LE(10), bw = b.readInt32LE(18), bh0 = b.readInt32LE(22), bpp = b.readUInt16LE(28);
  const bh = Math.abs(bh0), stride = Math.ceil((bw * bpp) / 32) * 4, px = new Uint8Array(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    const row = off + (bh0 < 0 ? y : bh - 1 - y) * stride; // BGR(A), bottom-up unless the height is negative
    for (let x = 0; x < bw; x++) {
      const p = row + (x * bpp) / 8, q = (y * bw + x) * 4;
      px[q] = b[p + 2];
      px[q + 1] = b[p + 1];
      px[q + 2] = b[p];
      px[q + 3] = bpp === 32 ? b[p + 3] : 255;
    }
  }
  return { w: bw, h: bh, px };
}

/** A `w`×`h` canvas of `rgb` (transparent when null), with `img` (if any) drawn centred over it. */
function compose(w, h, rgb, img) {
  const px = new Uint8Array(w * h * 4);
  if (rgb) for (let i = 0; i < w * h; i++) px.set([...rgb, 255], i * 4);
  if (img) {
    const ox = Math.round((w - img.w) / 2), oy = Math.round((h - img.h) / 2);
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 4, d = ((y + oy) * w + x + ox) * 4, a = img.px[s + 3] / 255;
        for (let c = 0; c < 3; c++) px[d + c] = Math.round(img.px[s + c] * a + px[d + c] * (1 - a));
        px[d + 3] = Math.max(px[d + 3], img.px[s + 3]);
      }
  }
  return { w, h, px };
}

function png({ w, h, px }, file) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), crc = Buffer.alloc(4), td = Buffer.concat([Buffer.from(type), data]);
    len.writeUInt32BE(data.length);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(px.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  writeFileSync(file, Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
  console.log(`${file.slice(brand.length + 1)}  ${w}×${h}`);
}

const icon = join(pub, 'app-icon.png'), cover = join(pub, 'cover.webp');
// The layered icons: an opaque back layer (tvOS requires one) and the icon in front of it.
const STACKS = [['App Icon', [[400, 240, '1x'], [800, 480, '2x']]], ['App Icon - App Store', [[1280, 768, '1x']]]];
for (const [stack, sizes] of STACKS) {
  for (const [w, h, scale] of sizes) {
    const dir = join(brand, `${stack}.imagestack`);
    png(compose(w, h, SEA, null), join(dir, 'Back.imagestacklayer', 'Content.imageset', `back@${scale}.png`));
    const s = Math.round(h * 0.75);
    png(compose(w, h, null, load(icon, s, s)), join(dir, 'Front.imagestacklayer', 'Content.imageset', `front@${scale}.png`));
  }
}
// The Top Shelf: the title cover on the splash's black, as large as fits 90 % × 80 % of it.
const [cw0, ch0] = dims(cover);
for (const [name, w, h] of [['Top Shelf Image', 1920, 720], ['Top Shelf Image Wide', 2320, 720]]) {
  for (const k of [1, 2]) {
    const f = Math.min((0.9 * w * k) / cw0, (0.8 * h * k) / ch0);
    png(compose(w * k, h * k, [0, 0, 0], load(cover, Math.round(cw0 * f), Math.round(ch0 * f))), join(brand, `${name}.imageset`, `shelf@${k}x.png`));
  }
}
rmSync(tmp, { recursive: true });
