#!/usr/bin/env python3
"""
Re-encode the end-credits bitmaps as lossless WebP, and emit their shared palette.

The credits were the last uncompressed art the site fetched. `CredStat1.BMP` (640x480)
and the scroll strip (`CredMov.BMP` 640x2921, or `CredMov_port.BMP` 640x3285 when the
port card has been built) are 8-bit palette BMPs with no compression at all, so a page
of white-on-black names costs the same per pixel as a photograph: 2.41 MB for one
click on the credits corner.

They are text on a flat background with a 256-entry palette, which is close to a best
case for a lossless codec. Measured on the shipped assets:

    CredStat1     308 280 ->  20 522 B   (15.0x)
    CredMov     1 870 520 ->  99 428 B   (18.8x)
    CredMov_port2 103 478 -> 101 838 B   (20.7x)

    what a session actually fetches (stat + port): 2.41 MB -> 0.12 MB, 19.7x

LOSSLESS, and not as a matter of taste: lossy WebP is *bigger* here (q90 lands at
213 kB against lossless's 122 kB), because a photographic codec has nothing to throw
away in flat colour and spends its bits fighting the hard edges of text. So there is
no quality knob to tune and no fidelity to trade — the pixels are the 1998 pixels.

── Why the palette is emitted as source ──────────────────────────────────────────
`src/render/credits.ts` composites on palette INDICES, not colours: `transp` and
`black` are the static frame's corner pixels, the test is `s !== transp`, and the strip
is looked up in the STATIC image's palette (UMain.pas:1171,1179-1181). WebP has no
indexed mode, so the index plane cannot survive in the file — it has to be recovered
from the decoded RGB.

That recovery is exact because the palette is INJECTIVE: all three images carry a
byte-identical 256-entry palette and no two entries share an RGB triple, so colour ->
index is a bijection (asserted below, and pinned by `test/creditsAsset.test.ts`). The
palette itself is what WebP cannot carry, so it is written to
`src/data/creditsPalette.ts` and compiled into the bundle — 768 bytes of data that
would otherwise be a second network door with its own failure mode.

The BMPs are NOT deleted. `public/data/` is the ALTAR release byte for byte
(`public/restored/README.md`); `tools/stage-pages-assets.mjs` simply stops publishing
these three, which is where the bytes are actually saved, and they stay in the repo as
the thing `--check` verifies against.

Usage:
    python3 tools/build-credits-webp.py [--force]   # encode + write the palette module
    python3 tools/build-credits-webp.py --check     # verify the committed output, write nothing
"""
import os
import sys
import hashlib
import json

try:
    from PIL import Image
except ImportError:
    sys.exit('Pillow is required: python3 -m pip install --user Pillow')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MENU = os.path.join(ROOT, 'public', 'data', 'Menu')
PALETTE_TS = os.path.join(ROOT, 'src', 'data', 'creditsPalette.ts')
# Ties each shipped .webp to the .BMP it was made from, so the unit suite can catch a
# regenerated bitmap whose WebP was never rebuilt. See `stamp()`.
STAMP = os.path.join(MENU, '.credits-webp.json')

# The static frame first: it is the one whose palette the renderer uses for both images.
SOURCES = ['CredStat1', 'CredMov', 'CredMov_port']


def load_indexed(name):
    """The BMP as (PIL image, index plane top-down, 256 RGB tuples)."""
    path = os.path.join(MENU, f'{name}.BMP')
    if not os.path.exists(path):
        return None
    im = Image.open(path)
    if im.mode != 'P':
        sys.exit(f'{name}.BMP: expected an 8-bit palette bitmap, got mode {im.mode}')
    raw = im.getpalette() or []
    raw = raw + [0] * (768 - len(raw))
    return im, im.tobytes(), [tuple(raw[i * 3:i * 3 + 3]) for i in range(256)]


def encode(name, im):
    """Write `<name>.webp` beside the BMP and return its size in bytes."""
    out = os.path.join(MENU, f'{name}.webp')
    # `exact` keeps the RGB of every pixel rather than letting the encoder rewrite the
    # colour under transparent areas — there is no alpha here, but the flag also stops
    # any colour rewriting, which is the whole property this file rests on.
    im.convert('RGB').save(out, format='WEBP', lossless=True, quality=100, method=6, exact=True)
    return os.path.getsize(out)


def recovered_indices(name, palette):
    """The committed `<name>.webp`, decoded and mapped back through `palette`.

    This is the browser's job at runtime (`src/render/creditsAsset.ts`), done here with
    the same rule so a mismatch is caught at build time rather than by a player.
    """
    path = os.path.join(MENU, f'{name}.webp')
    if not os.path.exists(path):
        return None
    rgb = Image.open(path).convert('RGB')
    lookup = {c: i for i, c in enumerate(palette)}
    data = rgb.tobytes()
    out = bytearray(rgb.size[0] * rgb.size[1])
    for p in range(len(out)):
        c = (data[p * 3], data[p * 3 + 1], data[p * 3 + 2])
        i = lookup.get(c)
        if i is None:
            sys.exit(f'{name}.webp: pixel {p} decoded to {c}, which is not in the palette')
        out[p] = i
    return bytes(out)


def stamp(loaded):
    """Tie each shipped `.webp` to the `.BMP` it was encoded from.

    `--check` proves index-identity, but it needs Pillow and so cannot run in the unit
    suite (or in CI, which is node-only by design — see .github/workflows/checks.yml).
    That left the one invariant this change rests on with no guard that runs on a push,
    and a concrete way to drift: `tools/build-credits-port.py` regenerates
    `CredMov_port.BMP`, nothing regenerates `CredMov_port.webp`, and the faithful tier
    now reads only the latter — so the two tiers would quietly roll DIFFERENT credits.

    Two hashes per asset close that for milliseconds: the BMP's index plane (not the
    file, so a palette-only rewrite is still caught while padding is not mistaken for
    content) and the WebP's bytes. `test/creditsAsset.test.ts` recomputes both in Node,
    with no image decoder, and fails asking for a regenerate.
    """
    return {
        name: {
            'bmp': hashlib.sha256(idx).hexdigest(),
            'webp': hashlib.sha256(open(os.path.join(MENU, f'{name}.webp'), 'rb').read()).hexdigest(),
            'w': im.size[0],
            'h': im.size[1],
        }
        for name, (im, idx, _) in loaded.items()
    }


def palette_module(palette):
    lines = [
        '/**',
        ' * The end-credits palette — the one part of the bitmaps WebP cannot carry.',
        ' *',
        ' * GENERATED by `tools/build-credits-webp.py`. Do not edit by hand; regenerate.',
        ' *',
        ' * `src/render/credits.ts` composites on palette INDICES (UMain.pas:1171,1179-1181),',
        ' * and WebP has no indexed mode, so the shipped `.webp` carries only colour. This is',
        ' * the table that turns it back into indices, and it is exact because the palette is',
        ' * INJECTIVE — no two of the 256 entries share an RGB triple, so colour -> index is a',
        ' * bijection. `test/creditsAsset.test.ts` pins both that property and this data',
        ' * against the committed BMPs.',
        ' *',
        ' * All three credits bitmaps carry a byte-identical palette, so one table serves the',
        ' * static frame and both scroll strips — which is also what lets the renderer look the',
        ' * strip up in the STATIC image\'s palette, as the original does.',
        ' *',
        ' * 0xRRGGBB, index order.',
        ' */',
        'export const CREDITS_PALETTE: readonly number[] = [',
    ]
    for row in range(0, 256, 8):
        entries = ', '.join(
            f'0x{r:02x}{g:02x}{b:02x}' for r, g, b in palette[row:row + 8]
        )
        lines.append(f'  {entries},')
    lines.append('];')
    lines.append('')
    return '\n'.join(lines)


def main():
    args = sys.argv[1:]
    check = '--check' in args
    force = '--force' in args
    for a in args:
        if a not in ('--check', '--force'):
            sys.exit(f'unknown argument {a}\n{__doc__}')

    loaded = {}
    for name in SOURCES:
        got = load_indexed(name)
        if got is None:
            # Only the port card is optional — it is built by tools/build-credits-port.py
            # and a build without it is a legitimate build (see mapNav.ts openCredits).
            if name == 'CredMov_port':
                print(f'{name}.BMP absent — skipping (the port card has not been built)')
                continue
            sys.exit(f'{name}.BMP is missing from {MENU}')
        loaded[name] = got

    # The renderer looks the strip up in the STATIC frame's palette, so a strip whose
    # own palette differs would render in the wrong colours. Today they are identical;
    # this is the check that says so out loud rather than assuming it.
    palette = loaded['CredStat1'][2]
    for name, (_, _, pal) in loaded.items():
        if pal != palette:
            sys.exit(f'{name}.BMP: palette differs from CredStat1.BMP — the shared-palette '
                     'assumption in credits.ts no longer holds')

    seen = {}
    for i, c in enumerate(palette):
        if c in seen:
            sys.exit(f'palette is not injective: indices {seen[c]} and {i} are both {c} — '
                     'colour cannot be mapped back to an index, so the WebP path is unsound')
        seen[c] = i

    if check:
        bad = 0
        for name, (_, idx, _) in loaded.items():
            got = recovered_indices(name, palette)
            if got is None:
                print(f'FAIL {name}.webp is missing — run without --check to build it')
                bad += 1
            elif got != idx:
                n = sum(1 for a, b in zip(got, idx) if a != b)
                print(f'FAIL {name}.webp recovers {n} of {len(idx)} pixels differently from the BMP')
                bad += 1
            else:
                print(f'ok   {name}.webp -> {len(idx)} pixels, index-identical to {name}.BMP')
        want = palette_module(palette)
        have = open(PALETTE_TS).read() if os.path.exists(PALETTE_TS) else None
        if have != want:
            print(f'FAIL {os.path.relpath(PALETTE_TS, ROOT)} is stale — regenerate it')
            bad += 1
        else:
            print(f'ok   {os.path.relpath(PALETTE_TS, ROOT)} matches the bitmaps')
        if not bad:
            recorded = json.load(open(STAMP)) if os.path.exists(STAMP) else None
            if recorded != stamp(loaded):
                print(f'FAIL {os.path.relpath(STAMP, ROOT)} is stale — regenerate it')
                bad += 1
            else:
                print(f'ok   {os.path.relpath(STAMP, ROOT)} matches the shipped pairs')
        sys.exit(1 if bad else 0)

    total_bmp = total_webp = 0
    for name, (im, idx, _) in loaded.items():
        out = os.path.join(MENU, f'{name}.webp')
        if os.path.exists(out) and not force:
            print(f'{name}.webp exists — pass --force to re-encode')
        else:
            encode(name, im)
        got = recovered_indices(name, palette)
        if got != idx:
            sys.exit(f'{name}.webp does not decode back to {name}.BMP — refusing to ship it')
        src = os.path.getsize(os.path.join(MENU, f'{name}.BMP'))
        dst = os.path.getsize(out)
        total_bmp += src
        total_webp += dst
        print(f'{name:14s} {src:9d} -> {dst:8d} B  ({src / dst:5.1f}x)  index-identical')

    with open(PALETTE_TS, 'w') as f:
        f.write(palette_module(palette))
    print(f'wrote {os.path.relpath(PALETTE_TS, ROOT)}')
    with open(STAMP, 'w') as f:
        json.dump(stamp(loaded), f, indent=2, sort_keys=True)
        f.write('\n')
    print(f'wrote {os.path.relpath(STAMP, ROOT)}')
    print(f'total {total_bmp:9d} -> {total_webp:8d} B  ({total_bmp / total_webp:5.1f}x)')


if __name__ == '__main__':
    main()
