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
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  // The invariant the whole change rests on is that the shipped `.webp` decodes to the
  // SAME index plane as the `.BMP`. Proving that pixel by pixel needs a WebP decoder,
  // which Node has not got — `tools/build-credits-webp.py --check` does it with Pillow,
  // but CI is node-only by design, so on its own that guard runs nowhere automatic.
  //
  // The stamp closes it for milliseconds: the tool records a hash of each BMP's index
  // plane and of each WebP's bytes at the moment it verified them, and these recompute
  // both. Any drift on either side fails here.
  //
  // Not hypothetical. `tools/build-credits-port.py` regenerates `CredMov_port.BMP` and
  // nothing regenerates `CredMov_port.webp`; since the faithful tier now reads only the
  // latter, that would leave it rolling the STALE card while the `ai` tier — staged from
  // the BMP by `tools/studio/stage-ui.mjs` — rolls the new one. Two tiers, different
  // credits, and no rendering test would show it.
  const stamp = JSON.parse(readFileSync(join(MENU, '.credits-webp.json'), 'utf8')) as Record<
    string,
    { bmp: string; webp: string; w: number; h: number }
  >;
  const sha = (b: Buffer | Uint8Array): string => createHash('sha256').update(b).digest('hex');
  const REGEN = 'run `python3 tools/build-credits-webp.py --force`';

  it('records every asset it ships', () => {
    expect(Object.keys(stamp).sort()).toEqual([...ASSETS].sort());
  });

  for (const name of ASSETS) {
    it(`${name}.webp is the one built from today's ${name}.BMP`, () => {
      const webp = join(MENU, `${name}.webp`);
      expect(existsSync(webp), `${webp} is missing — ${REGEN}`).toBe(true);
      // The original stays in the repo: it is what `--check` decodes back against, and
      // what this file reads its expectations from. Only the SITE stops carrying it
      // (tools/stage-pages-assets.mjs).
      const bmp = bmpOf(name);
      expect(bmp.w).toBe(stamp[name]!.w);
      expect(bmp.h).toBe(stamp[name]!.h);
      // Hashed as the INDEX PLANE, not the file: that is what the WebP has to reproduce,
      // and it ignores the BMP's row padding while still catching a one-pixel edit.
      expect(sha(bmp.pixels), `${name}.BMP changed since its WebP was built — ${REGEN}`).toBe(stamp[name]!.bmp);
      expect(sha(readFileSync(webp)), `${name}.webp is not the file that was verified — ${REGEN}`).toBe(
        stamp[name]!.webp,
      );
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
