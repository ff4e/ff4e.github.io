/**
 * The credits WebP path against the bitmaps it replaced.
 *
 * `tools/build-credits-webp.py` re-encodes the three end-credits bitmaps as lossless
 * WebP (2.41 MB -> 0.12 MB for what a session fetches) and `src/render/creditsAsset.ts`
 * rebuilds the palette indices from the decoded colour, so that `credits.ts` — which
 * composites on INDICES, not colours (UMain.pas:1171,1179-1181) — is untouched.
 *
 * That recovery is exact only because the palette is INJECTIVE. It is a property of a
 * 1998 asset, not something the code can arrange, so it is pinned here rather than
 * assumed: if it ever stopped holding, the roll would render in silently wrong colours
 * and no other test in this repo would notice.
 *
 * The oracle is the ORIGINAL. Every expectation below is read out of the committed BMPs
 * at test time, so a regenerated palette module or a re-encoded strip is checked against
 * ALTAR's bytes and not against itself.
 *
 * What this cannot reach is the browser's WebP decoder, which needs a browser. That half
 * is covered twice over: `build-credits-webp.py --check` decodes the committed files and
 * asserts the index plane comes back identical, and `rgbaToIndexed` THROWS on a colour
 * outside the palette — so a browser that decoded these differently would fail loudly
 * through the asset door, which the credits probes in `tools/test-asset-tiers.mjs`,
 * `test-intro.mjs` and `test-map-loading.mjs` already walk into.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { bmpToRgba, parseBmp, rgbaToIndexed, type Bmp } from '../src/data/bmp.js';
import { CREDITS_PALETTE } from '../src/data/creditsPalette.js';

const MENU = join('public', 'data', 'Menu');
/** The static frame first: its palette is the one the renderer draws both images through. */
const ASSETS = ['CredStat1', 'CredMov', 'CredMov_port'];

const bmpOf = (name: string): Bmp => parseBmp(readFileSync(join(MENU, `${name}.BMP`)));
const palette = (): { r: number; g: number; b: number }[] =>
  CREDITS_PALETTE.map((c) => ({ r: (c >> 16) & 0xff, g: (c >> 8) & 0xff, b: c & 0xff }));

describe('the credits palette', () => {
  it('is what the static frame carries', () => {
    expect(palette()).toEqual(bmpOf('CredStat1').palette);
  });

  // The renderer looks the SCROLL STRIP up in the STATIC frame's palette. Today all three
  // agree, which is why one compiled table can serve them all; a strip that drifted would
  // roll in the wrong colours with nothing else to catch it.
  for (const name of ASSETS) {
    it(`is byte-identical to the one in ${name}.BMP`, () => {
      expect(bmpOf(name).palette).toEqual(palette());
    });
  }

  it('is injective, which is what makes colour -> index recoverable', () => {
    const seen = new Map<number, number>();
    for (let i = 0; i < CREDITS_PALETTE.length; i++) {
      const c = CREDITS_PALETTE[i]!;
      expect(seen.has(c), `indices ${seen.get(c)} and ${i} are both #${c.toString(16)}`).toBe(false);
      seen.set(c, i);
    }
    expect(seen.size).toBe(256);
  });
});

describe('rebuilding the index plane from colour', () => {
  // The real content, not a fixture: these are the pixels the player sees, and the only
  // ones whose recovery has to hold.
  for (const name of ASSETS) {
    it(`recovers ${name}.BMP exactly`, () => {
      const bmp = bmpOf(name);
      const back = rgbaToIndexed(bmpToRgba(bmp), bmp.w, bmp.h, palette());
      expect(back.w).toBe(bmp.w);
      expect(back.h).toBe(bmp.h);
      // Compared as bytes: `toEqual` on two million-element arrays is slow enough to be
      // worth avoiding, and a Buffer comparison says the same thing.
      expect(Buffer.from(back.pixels).equals(Buffer.from(bmp.pixels))).toBe(true);
    });
  }

  it('throws on a colour the palette does not contain, rather than guessing', () => {
    // The whole safety argument for handing the decode to the browser: an unexpected
    // colour must be a loud failure, never a quietly mis-indexed pixel.
    const rgba = new Uint8ClampedArray([1, 2, 3, 255]);
    expect(() => rgbaToIndexed(rgba, 1, 1, palette())).toThrow(/not in the palette/);
  });

  it('throws on a palette that is not injective, rather than picking one', () => {
    const pal = palette();
    pal[5] = { ...pal[4]! };
    expect(() => rgbaToIndexed(new Uint8ClampedArray(4), 1, 1, pal)).toThrow(/not injective/);
  });
});

describe('what the site actually fetches', () => {
  for (const name of ASSETS) {
    it(`${name} ships as WebP, and far smaller than the bitmap`, () => {
      const webp = join(MENU, `${name}.webp`);
      const bmp = join(MENU, `${name}.BMP`);
      expect(existsSync(webp), `${webp} is missing — run tools/build-credits-webp.py`).toBe(true);
      // The original stays in the repo: it is what `--check` decodes back against, and
      // what this file reads its expectations from. Only the SITE stops carrying it
      // (tools/stage-pages-assets.mjs).
      expect(existsSync(bmp)).toBe(true);
      // A loose bound on purpose — it is a staleness guard, not a pin on the encoder.
      // Anything remotely near the BMP's size means the re-encode did not happen.
      expect(statSync(webp).size).toBeLessThan(statSync(bmp).size / 5);
    });
  }

  it('is not published as bitmaps', () => {
    // Reproduces the staging rule by name rather than importing it: `stage-pages-assets.mjs`
    // names these three one at a time because `Menu/` is full of BMPs the game still
    // fetches, and a pattern over the directory would take the world map down with them.
    const staging = readFileSync(join('tools', 'stage-pages-assets.mjs'), 'utf8');
    for (const name of ASSETS) expect(staging).toContain(`${name}.BMP`);
    expect(staging).toContain('isCreditsOriginal');
  });
});
