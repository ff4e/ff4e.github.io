#!/usr/bin/env python3
"""
Build the title-splash cover (public/cover.webp) from the game's own credits logo.

The source is part of the GPL-released Fish Fillets data (Altar Interactive), the
same data this port already ships, so the cover carries no third-party assets:

  * public/data/Menu/CredStat1.bmp — the credits frame whose top band is the
    original metallic "FILLETS" wordmark + fish-in-circle emblem over an
    under-water glow. This is the highest-resolution copy of the logo in the data
    (~427px wide) — far cleaner than the tiny Help/help01e.BMP strokes.

Pipeline (faithful, non-faceted, high-res):
  1. Crop the logo band from CredStat1.bmp (with margin for feathering).
  2. AI-upscale x4 with Real-ESRGAN (ncnn-vulkan, realesrgan-x4plus) — keeps the
     metallic bevel crisp at 4x with no tracing/faceting. The binary is NOT in the
     repo; point REALESRGAN_NCNN at it (see below). The committed cover.webp is the
     output, so the normal site build needs neither Python nor the upscaler.
  3. Feather the band edges to transparent and drop the thin speckly strip below
     the letter baseline, so on black the band melts away and only the logo shows.
  4. Bake in extra contrast, trim, and encode to a small webp-with-alpha.

The cover sits on a black backdrop (see #intro-cover in index.html); the feathered
transparency blends its under-water glow into that black.

Requires Pillow + numpy (`pip install Pillow numpy`) and, to re-upscale, the
Real-ESRGAN ncnn-vulkan binary:
  https://github.com/xinntao/Real-ESRGAN/releases (realesrgan-ncnn-vulkan-*-macos)
  export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan   # dir must hold ./models
Usage: `python3 tools/build-cover.py`
"""
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "data" / "Menu" / "CredStat1.bmp"
OUT = ROOT / "public" / "cover.webp"

CROP = (55, 2, 585, 132)   # logo band + margin for feathering, in CredStat1.bmp
UPSCALE = 4
OUT_WIDTH = 1800           # final width; height follows the crop aspect


def smoothstep(t: np.ndarray) -> np.ndarray:
    t = np.clip(t, 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def upscale(crop_png: Path, out_png: Path) -> None:
    """AI-upscale x4 via Real-ESRGAN ncnn-vulkan (realesrgan-x4plus)."""
    binp = os.environ.get("REALESRGAN_NCNN")
    if not binp or not Path(binp).exists():
        sys.exit(
            "Real-ESRGAN binary not found. Set REALESRGAN_NCNN to the "
            "realesrgan-ncnn-vulkan executable (its folder must contain ./models). "
            "Download: https://github.com/xinntao/Real-ESRGAN/releases"
        )
    binp = Path(binp)
    models = binp.parent / "models"
    subprocess.run(
        [str(binp), "-i", str(crop_png), "-o", str(out_png),
         "-n", "realesrgan-x4plus", "-s", str(UPSCALE), "-m", str(models)],
        check=True, cwd=str(binp.parent),
    )


def feather(img: Image.Image) -> Image.Image:
    a = np.array(img.convert("RGBA")).astype(np.float32)
    h, w = a.shape[:2]
    # horizontal + top edge feather (px falloff widths)
    xs = np.arange(w, dtype=np.float32)
    hx = np.minimum(smoothstep(xs / 175.0), smoothstep((w - 1 - xs) / 200.0))
    ys = np.arange(h, dtype=np.float32)
    top = smoothstep(ys / 60.0)
    # fade the thin strip just below the letter baseline (removes photo speckle)
    baseline = 472.0 * h / 520.0
    bottom = smoothstep((baseline - ys) / (24.0 * h / 520.0))
    vy = np.minimum(top, bottom)
    a[..., 3] *= np.minimum(hx[None, :], vy[:, None])
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def boost_contrast(img: Image.Image) -> Image.Image:
    r, g, b, alpha = img.split()
    rgb = Image.merge("RGB", (r, g, b))
    rgb = ImageEnhance.Contrast(rgb).enhance(1.42)
    rgb = ImageEnhance.Brightness(rgb).enhance(1.06)
    r, g, b = rgb.split()
    return Image.merge("RGBA", (r, g, b, alpha))


def main() -> None:
    src = Image.open(SRC).convert("RGB").crop(CROP)
    with tempfile.TemporaryDirectory() as td:
        crop_png = Path(td) / "crop.png"
        up_png = Path(td) / "up.png"
        src.save(crop_png)
        upscale(crop_png, up_png)
        img = feather(Image.open(up_png))
    img = boost_contrast(img)
    img = img.crop(img.getbbox())          # trim transparent margin
    pad = 24
    canvas = Image.new("RGBA", (img.width + 2 * pad, img.height + 2 * pad), (0, 0, 0, 0))
    canvas.alpha_composite(img, (pad, pad))
    h = round(canvas.height * OUT_WIDTH / canvas.width)
    canvas.resize((OUT_WIDTH, h), Image.LANCZOS).save(OUT, "WEBP", quality=90, method=6)
    print(f"wrote {OUT} ({OUT_WIDTH}x{h})")


if __name__ == "__main__":
    main()
