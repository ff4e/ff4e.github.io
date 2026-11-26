// The Apple TV artwork in native/tvos/Assets.xcassets: the layered App Icon and the Top Shelf,
// all of it the game's gold emblem on black — the iOS icon's mark (`tools/build-app-icon.mjs`,
// whose vector reconstruction is imported, not copied) without its blue sea, which on a TV's
// home row read as a blue rounded rectangle (TestFlight build 4).
//
//   node native/tvos/make-art.mjs
//
// The icon is a layered stack, as tvOS requires: an opaque Back layer, pure black, and a Front
// layer holding only the emblem over transparency, so the focus parallax lifts the mark off
// the black. The mark fills most of the layer's height (its ring 86 % across; 62 % read as too
// small on a TV, build 5) but keeps a margin: tvOS enlarges a focused icon and crops its
// edges. The Top Shelf images (shown when the app is in the top row) are the same mark on
// black, a little smaller against their height (70 %). The
// files keep the names and pixel sizes the catalog's Contents.json files name.
//
// Requires the repo's Playwright (a dev dependency already, for the UI suite).
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROW, MARK_DEF, emblem } from '../../tools/build-app-icon.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const brand = join(here, 'Assets.xcassets', 'App Icon & Top Shelf Image.brandassets');

/** A `w`×`h` picture: black (or transparent, `back` null) with the emblem's ring `ring` × h across, centred. */
const doc = (w, h, back, ring) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
     <defs>${MARK_DEF}</defs>
     ${back ? `<rect width="${w}" height="${h}" fill="${back}"/>` : ''}
     ${ring ? emblem((ring * h) / GROW, w / 2, h / 2) : ''}
   </svg>`;

const ICON_RING = 0.86, SHELF_RING = 0.7;
const OUT = [];
for (const [stack, sizes] of [['App Icon', [[400, 240, '1x'], [800, 480, '2x']]], ['App Icon - App Store', [[1280, 768, '1x']]]]) {
  for (const [w, h, scale] of sizes) {
    const dir = join(brand, `${stack}.imagestack`);
    OUT.push({ path: join(dir, 'Back.imagestacklayer', 'Content.imageset', `back@${scale}.png`), w, h, svg: doc(w, h, '#000', 0), alpha: false });
    OUT.push({ path: join(dir, 'Front.imagestacklayer', 'Content.imageset', `front@${scale}.png`), w, h, svg: doc(w, h, null, ICON_RING), alpha: true });
  }
}
for (const [name, w, h] of [['Top Shelf Image', 1920, 720], ['Top Shelf Image Wide', 2320, 720]]) {
  for (const k of [1, 2]) {
    OUT.push({ path: join(brand, `${name}.imageset`, `shelf@${k}x.png`), w: w * k, h: h * k, svg: doc(w * k, h * k, '#000', SHELF_RING), alpha: false });
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { path, w, h, svg, alpha } of OUT) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${alpha ? 'transparent' : '#000'}}svg{display:block;width:${w}px;height:${h}px}</style>${svg}`,
  );
  // Only a Front layer has an alpha channel: the Back layer and the Top Shelf must be opaque.
  writeFileSync(path, await page.screenshot({ omitBackground: alpha, type: 'png' }));
  console.log(`wrote ${relative(root, path)} (${w}×${h})`);
}
await browser.close();
