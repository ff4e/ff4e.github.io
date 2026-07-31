#!/usr/bin/env python3
"""
Append a web-port credit to the end of the scrolling end-credits.

The credits scroll a tall strip (`CredMov.BMP`, 640x2921) upward behind a static
frame. Two facts about that strip drive this script:

  * It is stored UPSIDE DOWN. The renderer shows strip row `delka-1-yobs` at screen
    row y (render/credits.ts), i.e. it displays the strip vertically flipped, so the
    artwork is authored mirrored. New rows must be mirrored too.
  * Its TOP rows are shown LAST (large `posun` reads low row indices — the existing
    top rows are the "(c) 1998 Altar R&D" closing card). So a credit that should come
    after everything else is PREPENDED, not appended.

Output is a NEW file (`CredMov_port.BMP`) — the original game asset is left untouched;
the game and the Studio staging prefer the port variant when it exists. Because the
strip's height defines `delka`, the roll's settle point and auto-close extend to cover
the new rows automatically, with no code change.

The block is written in the strip's own 8-bit palette (it has a full grey ramp and a
cyan ramp, so antialiased text quantises cleanly), so the result is a drop-in
replacement that every graphics tier can read.

Usage: python3 tools/build-credits-port.py [--force]
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'public/data/Menu/CredMov.BMP')
DST = os.path.join(ROOT, 'public/data/Menu/CredMov_port.BMP')

SERIF = '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
SERIF_BOLD = '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'

# Rendered at the strip's native 640 width, matching the existing cards' proportions:
# a cyan section header, then the name in large white serif, then a smaller line.
LINES = [
    ('Web port & graphics upscaling', 21, 'cyan', 34),
    ('Martin Obrátil', 34, 'white', 16),
    ('with a team of AI agents', 19, 'white', 0),
]
PAD_TOP = 150       # empty run before the card scrolls in
PAD_BOTTOM = 90     # and after, so it is not flush against the 1998 closing card


def nearest(pal, rgb, candidates):
    """Index of the palette entry closest to `rgb`, restricted to `candidates`."""
    best, bd = candidates[0], None
    for i in candidates:
        pr, pg, pb = pal[i * 3:i * 3 + 3]
        d = (pr - rgb[0]) ** 2 + (pg - rgb[1]) ** 2 + (pb - rgb[2]) ** 2
        if bd is None or d < bd:
            best, bd = i, d
    return best


def main():
    if not os.path.exists(SRC):
        sys.exit(f'missing {SRC}')
    if os.path.exists(DST) and '--force' not in sys.argv:
        print(f'{os.path.relpath(DST, ROOT)} exists (use --force to regenerate)')
        return

    strip = Image.open(SRC)
    if strip.mode != 'P':
        sys.exit(f'expected a palette BMP, got mode {strip.mode}')
    pal = strip.getpalette()
    w = strip.width

    # Candidate indices: the greys (for white text and its antialiasing) and the cyans.
    greys = [i for i in range(256)
             if abs(pal[i * 3] - pal[i * 3 + 1]) < 6 and abs(pal[i * 3 + 1] - pal[i * 3 + 2]) < 6]
    cyans = [i for i in range(256)
             if pal[i * 3 + 2] > 120 and pal[i * 3 + 1] > 120 and pal[i * 3] < pal[i * 3 + 1] - 40]
    black = nearest(pal, (0, 0, 0), greys)

    # --- render the card in RGB, then quantise per colour family -----------------
    height = PAD_TOP + sum(size + gap for _, size, _, gap in LINES) + PAD_BOTTOM
    card = Image.new('RGB', (w, height), (0, 0, 0))
    d = ImageDraw.Draw(card)
    y = PAD_TOP
    placed = []
    for text, size, colour, gap in LINES:
        font = ImageFont.truetype(SERIF_BOLD if colour == 'cyan' else SERIF, size)
        bbox = d.textbbox((0, 0), text, font=font)
        d.text(((w - (bbox[2] - bbox[0])) / 2 - bbox[0], y - bbox[1]), text,
               font=font, fill=(120, 235, 215) if colour == 'cyan' else (255, 255, 255))
        placed.append((text, y, size, colour))
        y += size + gap

    # Quantise: cyan pixels to the cyan ramp, everything else to the grey ramp, so the
    # antialiased edges land on real palette entries instead of dithering.
    src = card.load()
    out = Image.new('P', (w, height), black)
    out.putpalette(pal)
    op = out.load()
    for yy in range(height):
        for xx in range(w):
            r, g, b = src[xx, yy]
            if r == 0 and g == 0 and b == 0:
                continue
            fam = cyans if (b > r + 30 and g > r + 30) else greys
            op[xx, yy] = nearest(pal, (r, g, b), fam)

    # Mirror to match the strip's stored orientation, then PREPEND (top = shown last).
    out = out.transpose(Image.FLIP_TOP_BOTTOM)
    merged = Image.new('P', (w, height + strip.height), black)
    merged.putpalette(pal)
    merged.paste(out, (0, 0))
    merged.paste(strip, (0, height))
    merged.save(DST)

    print(f'wrote {os.path.relpath(DST, ROOT)}  {w}x{merged.height}  (+{height} rows)')
    for text, yy, size, colour in placed:
        print(f'   {colour:5s} {size:2d}px  "{text}"')


if __name__ == '__main__':
    main()
