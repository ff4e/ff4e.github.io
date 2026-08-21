#!/usr/bin/env python3
"""
Build the link-preview card and the browser icons (public/og-card.jpg, favicon.ico,
apple-touch-icon.png) from assets this repo already ships.

Why these exist at all: pasted into Reddit, Discord, Mastodon, Slack, Teams or iMessage,
a URL with no Open Graph tags renders as bare text. The card is what decides whether the
link is clicked, so it is worth more than any wording in the post beside it. `index.html`
points `og:image` at the card and `<link rel=icon>` at the icons.

Sources, both already in the repo and both descending from the GPL-released ALTAR data:

  * docs/screenshots/room-pyramida.jpg — Mr. Cheops' House with the side panel, 1100x594.
    Its aspect (1.852) is within 3% of the 1.91:1 the scrapers want, so it fits the card
    by trimming 16 rows. That is the whole reason this screenshot is the background and a
    bare room render is not: a 4:3 room letterboxed into 1.91:1 looks like a mistake.
  * public/cover.webp — the title-splash wordmark (fish-in-circle emblem + "FILLETS"),
    built by tools/build-cover.py from the credits logo and already committed with alpha.
    Reusing it keeps the card and the game's own splash the same mark.

The icons are the emblem alone, lifted from that same wordmark. Two things have to happen
to it or a 16px favicon is a smudge: its backdrop is near-black underwater photography,
which has to go, and the line art is dark blue on black, which has to be lifted. Both are
done off the emblem's own blueness (blue minus the stronger of red and green) — the strokes
are saturated blue and the photo behind them is not — so the mask comes from the artwork
rather than from a hand-drawn path. It is a legibility change to a derived icon, not to
anything the game draws.

Outputs are committed, so the normal site build needs neither Python nor this script.

Requires Pillow (`pip install Pillow`). Usage: `python3 tools/build-share-assets.py`.
"""
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOT = ROOT / "docs" / "screenshots" / "room-pyramida.jpg"
COVER = ROOT / "public" / "cover.webp"
FONT_TEXT = ROOT / "public" / "fonts" / "Mulish.ttf"
FONT_CTA = ROOT / "public" / "fonts" / "Jost.ttf"

CARD = ROOT / "public" / "og-card.jpg"
ICO = ROOT / "public" / "favicon.ico"
TOUCH = ROOT / "public" / "apple-touch-icon.png"

CARD_W, CARD_H = 1200, 630
SITE_BG = (16, 16, 24)  # body background in index.html

# The emblem inside cover.webp (2200x528), measured from its own blueness mask.
EMBLEM = (203, 125, 560, 482)


def load_font(path: Path, size: int, weight: int) -> ImageFont.FreeTypeFont:
    """The bundled faces are variable fonts; pick a weight rather than the default 400."""
    font = ImageFont.truetype(str(path), size)
    try:
        font.set_variation_by_axes([weight])
    except (OSError, AttributeError):
        pass  # FreeType without variable-font support: the default instance still reads fine.
    return font


def build_card() -> None:
    shot = Image.open(SHOT).convert("RGB")
    # Cover-fit: scale so the short side reaches the card, then centre-crop the surplus.
    scale = max(CARD_W / shot.width, CARD_H / shot.height)
    shot = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    left = (shot.width - CARD_W) // 2
    top = (shot.height - CARD_H) // 2
    card = shot.crop((left, top, left + CARD_W, top + CARD_H))

    # A bottom-up black band, so the wordmark and the call to action sit on something dark
    # whatever the screenshot happens to be doing underneath them. It has to reach nearly
    # opaque, not merely dark: the wordmark is feathered into black rather than cut out, so
    # over bright art any transparency here shows up as a rectangle around it.
    band_top, band_full, band_max = 300, 392, 0.94
    shade = Image.new("L", (1, CARD_H), 0)
    for y in range(band_top, CARD_H):
        t = min(1.0, (y - band_top) / (band_full - band_top))
        shade.putpixel((0, y), round(255 * band_max * t * t))
    card = Image.composite(Image.new("RGB", card.size, (0, 0, 0)), card, shade.resize(card.size))

    # ...and pasted with a lighten, which is the same trick #intro-cover uses on its black
    # backdrop: black source pixels leave the card alone, so nothing boxes the mark in.
    cover = Image.open(COVER).convert("RGBA")
    mark_w = 500
    mark_h = round(cover.height * mark_w / cover.width)
    small = cover.resize((mark_w, mark_h), Image.LANCZOS)
    mark = Image.new("RGB", (mark_w, mark_h), (0, 0, 0))
    mark.paste(small, (0, 0), small)
    # Lifted, because the wordmark was drawn to glow out of a pure-black splash screen and
    # the band behind it here is not pure black. Without this the darkest letters sink.
    mark = mark.point(lambda v: min(255, round(v * 1.45)))
    box = (56, 396, 56 + mark_w, 396 + mark_h)
    card.paste(ImageChops.lighter(card.crop(box), mark), box)

    draw = ImageDraw.Draw(card)
    draw.text((60, 528), "A faithful web port of ALTAR's 1998 puzzle game",
              font=load_font(FONT_TEXT, 31, 500), fill=(205, 227, 236))
    draw.text((60, 570), "Play in your browser — ff4e.github.io",
              font=load_font(FONT_CTA, 32, 600), fill=(126, 214, 236))

    card.save(CARD, "JPEG", quality=88, optimize=True, progressive=True)
    print(f"wrote {CARD.relative_to(ROOT)} ({CARD_W}x{CARD_H}, {CARD.stat().st_size // 1024} kB)")


def build_icons() -> None:
    cover = Image.open(COVER).convert("RGBA")
    flat = Image.new("RGB", cover.size, (0, 0, 0))
    flat.paste(cover, (0, 0), cover)

    art = flat.crop(EMBLEM)
    r, g, b = art.split()
    # Blueness isolates the strokes: they are saturated blue, the photo behind them is not.
    blue = ImageChops.subtract(b, ImageChops.lighter(r, g)).point(lambda v: min(255, round(v * 2.4)))
    lit = art.point(lambda v: min(255, round(20 + v * 1.9)))

    pad = round(art.width * 0.09)
    side = art.width + 2 * pad
    mask = Image.new("L", (side, side), 0)
    mask.paste(blue, (pad, pad))
    metal = Image.new("RGB", (side, side), SITE_BG)
    metal.paste(lit, (pad, pad), blue)

    def render(size: int) -> Image.Image:
        icon = Image.new("RGB", (size, size), SITE_BG)
        m = mask.resize((size, size), Image.LANCZOS)
        if size > 64:
            # Big enough to hold the metallic bevel the logo actually has.
            icon.paste(metal.resize((size, size), Image.LANCZOS), (0, 0), m)
        else:
            # A tab icon is 16 px across and the emblem is line art: at that size the
            # strokes fall below a pixel and average away towards the background. Push the
            # mask back to solid — harder the smaller it gets — and fill flat, in a blue
            # lifted far enough off the dark backdrop to survive. Chasing the bevel here
            # would only produce a grey smudge.
            gain = {16: 3.4, 32: 2.2, 48: 1.7}.get(size, 2.0)
            m = m.point(lambda v: min(255, round(v * gain)))
            icon.paste(Image.new("RGB", (size, size), (96, 152, 255)), (0, 0), m)
        return icon.filter(ImageFilter.UnsharpMask(radius=1.0, percent=70, threshold=0))

    render(180).save(TOUCH, "PNG", optimize=True)
    # Pillow resizes a single source for every `sizes` entry, which would put the metallic
    # rendition into the 16px slot. Hand it each rendition instead.
    icons = [render(s) for s in (48, 32, 16)]
    icons[0].save(ICO, "ICO", sizes=[(16, 16), (32, 32), (48, 48)], append_images=icons[1:])
    print(f"wrote {TOUCH.relative_to(ROOT)} and {ICO.relative_to(ROOT)}")


if __name__ == "__main__":
    build_card()
    build_icons()
