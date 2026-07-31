/**
 * Generate the UWP/Xbox tile + splash PNGs for the packaged console app from the same
 * original SVG icon used by the PWA (public/icons/icon.svg), so the web install and the
 * console app share one visual identity.
 *
 * Uses Playwright (already a dev dependency) to rasterise — the repo deliberately has no
 * native image toolchain. Re-run whenever the icon changes:
 *
 *     node tools/make-xbox-assets.mjs
 *
 * Outputs into xbox/Ff4eXbox/Assets/. These are committed (they are small) so the CI
 * package build does not need a browser download.
 */
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repo, 'xbox', 'Ff4eXbox', 'Assets');
mkdirSync(outDir, { recursive: true });

const BRAND = '#101018';
const svg = readFileSync(join(repo, 'public', 'icons', 'icon.svg'), 'utf8');

/**
 * Every image the manifest references. `pad` is the fraction of the shorter side kept
 * clear around the artwork: wide/splash images need a lot of breathing room so the fish
 * is not cropped by the tile's own padding on the Xbox dashboard.
 */
const TARGETS = [
  { file: 'Square44x44Logo.png', w: 44, h: 44, pad: 0.06 },
  { file: 'Square150x150Logo.png', w: 150, h: 150, pad: 0.1 },
  { file: 'Square310x310Logo.png', w: 310, h: 310, pad: 0.12 },
  { file: 'Wide310x150Logo.png', w: 310, h: 150, pad: 0.12 },
  { file: 'StoreLogo.png', w: 50, h: 50, pad: 0.06 },
  { file: 'SplashScreen.png', w: 620, h: 300, pad: 0.16 },
];

const browser = await chromium.launch();
const page = await browser.newPage();

for (const { file, w, h, pad } of TARGETS) {
  const inset = Math.round(Math.min(w, h) * pad);
  const html = `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:${BRAND};}
  .box{width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;
       background:${BRAND};box-sizing:border-box;padding:${inset}px;}
  .box svg{width:100%;height:100%;display:block;}
</style>
<div class="box">${svg}</div>`;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.locator('.box').screenshot({ path: join(outDir, file) });
  console.log(`  ${file}  ${w}x${h}`);
}

await browser.close();
console.log(`\nWrote ${TARGETS.length} asset(s) to xbox/Ff4eXbox/Assets/`);
