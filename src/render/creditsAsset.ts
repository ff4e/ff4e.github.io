/**
 * Load one end-credits image — a lossless WebP — as the indexed bitmap the roll wants.
 *
 * The credits were the last uncompressed art the site fetched: `CredStat1.BMP` plus a
 * scroll strip, 2.41 MB of 8-bit palette bitmap with no compression, for one click on
 * the credits corner. They are text on flat colour, which a lossless codec eats:
 * `tools/build-credits-webp.py` re-encodes the same pixels to 0.12 MB (19.7x), and
 * `tools/stage-pages-assets.mjs` stops publishing the BMPs.
 *
 * Lossless is not caution, it is the smaller file — lossy WebP lands at 213 kB against
 * lossless's 122 kB here, because a photographic codec has nothing to discard in flat
 * colour and spends its bits on the edges of text. So nothing was traded for the bytes.
 *
 * ── Why this returns a `Bmp` and not RGBA ─────────────────────────────────────
 * `credits.ts` is untouched by any of this, deliberately. It composites on palette
 * INDICES — `transp` and `black` are the static frame's corner pixels, the test is
 * `s !== transp`, and the strip is looked up in the STATIC image's palette
 * (UMain.pas:1171,1179-1181). That is the faithful tier's whole claim, and
 * `creditsAi.ts` states it: the hi-res tier may composite two <img> layers on the GPU,
 * but this one "must stay index-exact".
 *
 * WebP has no indexed mode, so the index plane cannot survive the file. It is rebuilt
 * here instead, exactly, because the palette is injective (`CREDITS_PALETTE`, generated
 * and pinned). The result is byte-identical to `parseBmp` of the original, so the change
 * stops at this module's boundary — nothing downstream can drift.
 *
 * The failure mode is the point: a colour the palette does not contain THROWS
 * (`rgbaToIndexed`), so a browser that ever decoded these differently would fail through
 * the asset door and be seen, rather than roll the credits in quietly wrong colours.
 */
import { rgbaToIndexed } from '../data/bmp.js';
import type { Bmp } from '../data/bmp.js';
import { CREDITS_PALETTE } from '../data/creditsPalette.js';
import { decodeAsset } from './assetFetch.js';
import type { AssetTier } from './assetFetch.js';

/** `CREDITS_PALETTE` (0xRRGGBB, index order) in the shape `Bmp` carries. */
export const creditsPalette = (): { r: number; g: number; b: number }[] =>
  CREDITS_PALETTE.map((c) => ({ r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff }));

/**
 * Decode image bytes to top-down RGBA.
 *
 * `createImageBitmap` rather than an `<img>`: it takes the blob directly, needs no
 * object URL to revoke, and reports a decode failure as a rejected promise instead of an
 * event that cannot say what went wrong. The canvas is thrown away with the function —
 * only the indexed copy is kept, which is a quarter of the size.
 */
async function decodeRgba(blob: Blob): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = new OffscreenCanvas(w, h);
    // `willReadFrequently` is deliberately NOT set: this is read exactly once, and the
    // hint costs a software-rasterised canvas for a single readback.
    const g = canvas.getContext('2d', { alpha: false, colorSpace: 'srgb' });
    if (!g) throw new Error('no 2d context for the credits');
    // The bitmap must land on the canvas untouched, or the indices cannot be recovered:
    // any smoothing would invent colours the palette does not contain.
    g.imageSmoothingEnabled = false;
    g.drawImage(bitmap, 0, 0);
    return { w, h, rgba: g.getImageData(0, 0, w, h, { colorSpace: 'srgb' }).data };
  } finally {
    bitmap.close();
  }
}

/**
 * Turn fetched credits bytes into the indexed bitmap the roll wants.
 *
 * Takes a `Blob` rather than fetching one, so the tier stays a literal at the call site
 * in `mapNav.ts` — this module is loaded at two different tiers (the static frame is
 * `shouldHave`, the optional port strip is `niceToHave`) and a door called with a tier
 * held in a variable is exactly what `test/asset-tier-discipline.test.ts` forbids, and
 * rightly: the policy is meant to be reviewable by reading the call site.
 *
 * The decode failure is wrapped as transient by `decodeAsset` — including the throw from
 * `rgbaToIndexed`, which is the one that matters here.
 */
export async function decodeCreditsImage(url: string, blob: Blob, tier: AssetTier): Promise<Bmp> {
  return decodeAsset(url, tier, async () => {
    const { w, h, rgba } = await decodeRgba(blob);
    // A decode that produced no pixels is a corrupt file, not an absent one — the
    // decoder is the only thing that can tell, and it did.
    if (!w || !h) throw new Error(`${url}: credits art decoded to nothing`);
    return rgbaToIndexed(rgba, w, h, creditsPalette());
  });
}
