/**
 * Rasterise the PWA app icons from the source SVGs (public/icons/*.svg) into the
 * PNG sizes the web app manifest / apple-touch / Windows-MSIX toolchain need.
 *
 * Uses headless Chromium (already a dev dependency via Playwright) so there is no
 * extra native image dependency. Regenerate whenever the source SVG changes:
 *   node tools/make-pwa-icons.mjs
 *
 * Outputs (public/icons/):
 *   icon-180.png            apple-touch-icon (iOS)
 *   icon-192.png            manifest "any" (min PWA-installable size)
 *   icon-512.png            manifest "any" (large)
 *   icon-512-maskable.png   manifest "maskable" (full-bleed, safe-zone content)
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const iconsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
const baseSvg = readFileSync(join(iconsDir, 'icon.svg'), 'utf8');
const maskSvg = readFileSync(join(iconsDir, 'icon-maskable.svg'), 'utf8');

const JOBS = [
  { file: 'icon-180.png', size: 180, svg: baseSvg },
  { file: 'icon-192.png', size: 192, svg: baseSvg },
  { file: 'icon-512.png', size: 512, svg: baseSvg },
  { file: 'icon-512-maskable.png', size: 512, svg: maskSvg },
];

const browser = await chromium.launch();
try {
  for (const job of JOBS) {
    const page = await browser.newPage({ viewport: { width: job.size, height: job.size }, deviceScaleFactor: 1 });
    // Inline the SVG at the exact target size; margin:0 so the screenshot is edge-to-edge.
    const sized = job.svg.replace(/width="\d+"/, `width="${job.size}"`).replace(/height="\d+"/, `height="${job.size}"`);
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}</style>${sized}`, {
      waitUntil: 'networkidle',
    });
    const buf = await page.screenshot({ clip: { x: 0, y: 0, width: job.size, height: job.size }, omitBackground: false });
    writeFileSync(join(iconsDir, job.file), buf);
    console.log(`wrote public/icons/${job.file} (${job.size}x${job.size}, ${buf.length} bytes)`);
    await page.close();
  }
} finally {
  await browser.close();
}
