#!/usr/bin/env python3
"""
Build the title-splash cover (public/cover.webp) from the original game's own art.

Both source bitmaps are part of the GPL-released Fish Fillets data (Altar
Interactive), the same data this port already ships — so the cover carries no
third-party assets:

  * public/data/Menu/mapa-0.BMP  — the unlit under-water world-map scene (backdrop)
  * public/data/Help/help01e.BMP — the "FILLETS" logo (fish emblem + wordmark +
                                    "...more than the FISH MEAT" tagline)

The logo is drawn as near-black strokes on a flat teal help page; we key the teal
out to a smooth alpha and recolour the strokes to cream, then composite it over a
dimmed, blue-cooled, vignetted copy of the map. Re-run after changing either
source; the output is committed so the site build needs no Python.

Requires Pillow (`pip install Pillow`). Usage: `python3 tools/build-cover.py`.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "public" / "data"
OUT = ROOT / "public" / "cover.webp"

TEAL = (140, 206, 198)   # help-page background
CREAM = (245, 237, 208)  # recoloured logo strokes
LOGO_BOX = (250, 18, 388, 72)  # emblem + wordmark + tagline in help01e.BMP
LOGO_SCALE = 2.6
LOGO_CY_FRAC = 0.30      # logo centre, fraction of height from the top


def extract_logo() -> Image.Image:
    src = Image.open(DATA / "Help" / "help01e.BMP").convert("RGB")
    crop = src.crop(LOGO_BOX)
    w, h = crop.size
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    sp, op = crop.load(), out.load()
    for y in range(h):
        for x in range(w):
            p = sp[x, y]
            d = max(abs(p[0] - TEAL[0]), abs(p[1] - TEAL[1]), abs(p[2] - TEAL[2]))
            a = max(0, min(255, int((d - 18) / (150 - 18) * 255)))  # teal->0, ink->~full
            op[x, y] = (CREAM[0], CREAM[1], CREAM[2], a)
    return out.resize((int(w * LOGO_SCALE), int(h * LOGO_SCALE)), Image.LANCZOS)


def dim_map() -> Image.Image:
    base = Image.open(DATA / "Menu" / "mapa-0.BMP").convert("RGB")
    bw, bh = base.size
    out = Image.new("RGB", (bw, bh))
    bp, op = base.load(), out.load()
    for y in range(bh):
        for x in range(bw):
            r, g, b = bp[x, y]
            nr, ng, nb = int(r * 0.46 * 0.85), int(g * 0.46 * 0.92), int(b * 0.46 * 1.05 + 18)
            dx, dy = (x - bw / 2) / (bw / 2), (y - bh / 2) / (bh / 2)
            vig = max(0.0, 1 - 0.55 * (dx * dx + dy * dy))  # radial vignette
            op[x, y] = (min(255, int(nr * vig)), min(255, int(ng * vig)), min(255, int(nb * vig)))
    return out


def main() -> None:
    logo = extract_logo()
    cov = dim_map().convert("RGBA")
    bw, bh = cov.size
    lw, lh = logo.size
    cov.alpha_composite(logo, ((bw - lw) // 2, int(bh * LOGO_CY_FRAC) - lh // 2))
    cov.convert("RGB").save(OUT, "WEBP", quality=85, method=6)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size} bytes, {bw}x{bh})")


if __name__ == "__main__":
    main()
