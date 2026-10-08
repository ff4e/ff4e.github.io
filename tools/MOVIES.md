# Intro and logo movies: source-to-delivery build

The startup sequence and the map's "watch intro" corner use the original game's
movies through an HTML5 `<video>` overlay. Runtime selection lives in
`src/app/introOverlay.ts`: classic/enhanced use `logo.mp4` and `intro_clean.mp4`;
the AI tier uses `logo_ai.mp4` and `intro_ai.mp4` when present. No video processing
happens at runtime or during a normal site build.

## Sources

| File | What it is |
|------|------------|
| Original `Movie/intro.avi` | Cinepak AVI, 640x480, `1000000/33333` fps (~30), 2,201 frames, ~73.366 s, PCM stereo audio. |
| Original `Movie/logo.avi` | Cinepak AVI, 640x480, `1000000/66667` fps (~15), 457 frames, ~30.467 s. |
| Fish Fillets NG `intro.mpg` | The community FFNG port's MPEG-1 version of the same footage, used only for the burst patch below. Default path: `/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images/menu/intro.mpg`; override with `FFNG_MOVIE=/path/to/intro.mpg`. |

Keep original AVIs outside `public/`; they are build sources, not shipped assets.
The movie footage descends from ALTAR's GPL-released game data (see
`CONTRIBUTING.md`). Neural models are offline tool dependencies, not replacement
movie footage.

## Pipeline and shipped files

1. **Base conversion:** `tools/build-movies.mjs` converts the original movies to
   H.264 (`libx264`, CRF 17, yuv420p) and AAC. For the intro, FFNG footage patches
   the original Cinepak burst described below. The AI tier inherits that patch.
2. **Spatial upscale:** `tools/build-movies-ai.mjs` extracts every base frame
   without resampling, applies Real-ESRGAN `realesr-animevideov3-x4`, then downsamples
   2560x1920 to 1920x1440 with Lanczos. It creates a temporary spatial-only MP4 at
   the source rate, CRF 23, with copied audio.
3. **Temporal reconstruction:** `tools/interpolate-movie.py` and
   `tools/movie_pipeline/` run RIFE v4.6 over those spatial images. The intro uses
   motion-aware cadence recovery; the logo uses uniform 4x interpolation.
4. **Delivery:** H.264, yuv420p, CRF 23, slow preset, faststart MP4, 1920x1440.
   Audio is copied in a separate mux step so the logo's final partial AAC packet
   is not cut off by the video frame limit. Frame count, exact rational rate,
   duration, retained RGB images and audio packets are checked before replacement.

| Shipped file under `public/data/Movie/` | Role | Video frames / rate |
| --- | --- | --- |
| `logo.mp4` | Faithful base; classic/enhanced | 457 at ~15 fps |
| `intro_clean.mp4` | Cleaned base; classic/enhanced | 2,201 at ~30 fps |
| `logo_ai.mp4` | Spatial upscale + uniform RIFE | 1,828 at `4000000/66667` fps (~60) |
| `intro_ai.mp4` | Spatial upscale + motion-aware RIFE | 4,402 at `2000000/33333` fps (~60) |

The rational rates are deliberate: multiplying the original rate preserves the
movie's duration rather than slightly speeding it up or slowing it down. The
two AI MP4s **replace the previous spatial-only files at the same URLs**. There
is no second unsmoothed AI variant to ship. Faithful/classic assets are unchanged.

### Why the intro and logo use different temporal methods

The logo already has a useful ~15 fps motion cadence. Keep every source image
and insert three RIFE images between each pair.

The intro's ~30 fps encoding does **not** mean 30 distinct motion updates each
second. The original AVI itself contains exact and near-held images, unevenly
distributed; some sections also have genuinely more frequent motion. Merely
doubling FPS, dropping every second image, or using one pixel-difference threshold
leaves stretches of visibly uneven motion.

`motion-progress-v1` estimates optical flow at 320x240 with OpenCV DIS. It compares
the motion to an intermediate image against the motion to a later endpoint.
Little progress supported by most moving pixels identifies a held-image candidate,
even when compression has changed its pixel values. Short repeated-image bursts
can span up to eight source frames (~0.27 s); longer stationary pauses remain.
Surviving images keep their original timestamps.

The same rule applies throughout the intro: no manually selected time windows,
no blanket 15 fps conversion, and no source-rate fallback during dissolves.
Cut detection additionally checks image correspondence so a lighting flash is not
mistaken for a hard cut. RIFE fills the recovered timeline at ~60 fps.

This remains an estimate, not a guarantee of perfect motion or preservation of
every short intended pause. Review the **whole movie**, including fast motion,
dissolves, lighting changes and retained pauses. Scoring only repaired intervals
does not establish that the rest of the film is smooth.

## Rebuilding from the original movies

Prerequisites: Node 22; FFmpeg/ffprobe with libx264; native Python (3.9 tested);
Real-ESRGAN ncnn-vulkan plus its models; RIFE ncnn-vulkan plus `rife-v4.6`.
The binaries/models are not committed. Upstream packages:
https://github.com/xinntao/Real-ESRGAN/releases and
https://github.com/nihui/rife-ncnn-vulkan/releases (RIFE package `20221029`).

From the repository root, using a POSIX shell:

```sh
python3 -m venv .venv-movies
.venv-movies/bin/python -m pip install -r tools/movie_pipeline/requirements.txt

# Rebuild the faithful/clean bases from the original, external AVI directory.
MOVIE_SOURCE_DIR=/path/to/original/Movie \
FFNG_MOVIE=/path/to/fillets-ng/intro.mpg \
node tools/build-movies.mjs

export AI_PYTHON="$PWD/.venv-movies/bin/python"
export REALESRGAN_NCNN=/path/to/realesrgan-ncnn-vulkan
export RIFE_NCNN=/path/to/rife-ncnn-vulkan
npm run build-movies-ai             # both movies
# npm run build-movies-ai -- intro  # or just one
```

Real-ESRGAN's directory must contain `models/`; RIFE's directory must contain
`rife-v4.6/flownet.bin` and `flownet.param`. The Python dependencies are pinned in
`tools/movie_pipeline/requirements.txt`. `AI_MODEL`, `AI_SCALE`, `AI_OUT_WIDTH`
and `AI_CRF` retain their spatial-builder overrides; `AI_CRF` also controls final
delivery. Shipped settings are model `realesr-animevideov3-x4`, scale 4, width 1920
and CRF 23. `RIFE_GPU` defaults to 0 (`-1` selects CPU).

On Apple Silicon, run the **whole command chain natively**, especially from a
Rosetta-hosted terminal: create/install the venv with `arch -arm64 python3`, and
use `arch -arm64 node tools/build-movies-ai.mjs` instead of the npm command.
An arm64 Node executable alone may still inherit an x86 preference for a universal
Python binary. Do not mix x86 Python with arm64 NumPy/OpenCV.

The FFNG input is necessary to reproduce the cleaned intro. Without it, the base
builder explicitly warns and makes `intro_clean.mp4` a faithful copy instead;
that is a different input. `intro.mp4` and `logo_clean.mp4` are redundant base-stage
comparison outputs, not committed runtime assets. `stage-pages-assets.mjs` ships
only the four runtime movie filenames, excluding these outputs, AVIs and spatial caches.

### Reusing an existing spatial stage

The first smoothed delivery reused the existing spatial encodes introduced in
commit `e5aaadd`, retaining their appearance rather than rerunning Real-ESRGAN.
Their input hashes are recorded in `tools/movie-builds/{intro,logo}.json`.
To reproduce just the temporal stage, put those **spatial-only** files outside
`public/`, named `intro_spatial.mp4` and `logo_spatial.mp4`, then run:

```sh
AI_PYTHON=/path/to/venv/bin/python \
RIFE_NCNN=/path/to/rife-ncnn-vulkan \
node tools/build-movies-ai.mjs --spatial-dir /path/to/spatial-cache
```

This skips Real-ESRGAN, not validation. The tool rejects already-interpolated
inputs and inputs whose frame count, cadence or audio differ from the base.
Never rename the new ~60 fps outputs into this cache and smooth them again.
The old spatial files are rebuildable intermediates, not an additional shipped
graphics tier. Fresh full rebuilds create and remove their intermediates automatically.

The JSON reports record input/base/output hashes, retained-frame counts, the
cadence-plan hash, RIFE executable/model hashes, software versions and encoding
settings. GPU upscaling/interpolation and codec versions can affect exact bytes;
the recipe is reproducible, but cross-platform bit-identical output is not promised.

## Validation

```sh
.venv-movies/bin/python -m unittest discover -s tools -p 'test_*.py'
npm run typecheck
npm test
npm run test:ui -- intro
```

The Python suite covers hold recovery, genuine slow motion, lighting vs cuts,
terminal timing, the logo's partial AAC packet, and failure leaving old outputs
intact. Ordinary unit tests verify the committed movie reports and file hashes
without requiring GPU tools. The UI probe covers playback routing/skip behavior;
also play both complete final movies at 1x to check decode performance and visual
quality. A high container FPS or a passing short excerpt is not sufficient.

## The burst fix (why `intro_clean` exists)

**The problem.** At a couple of points the intro globe suddenly posterizes into
coarse blocks for ~½–2 s — a **"burst"**. There are two: the big one from
**~12.03 s** to the dissolve at ~14 s, and a shorter, milder one from **~23.03 s**
(the globe with the descending UFO), recovering by ~23.6 s. Both begin right after
a Cinepak keyframe. This is **not** a corrupt keyframe or a decoder bug — the
keyframes are perfectly regular (every 30 frames) and decode fine. It's a genuine
**encoding** limitation: as the globe brightens/rotates into a big smooth
gradient, Cinepak's tiny per-strip codebook can't represent it, so it quantizes
those frames coarsely. The lost sub-block detail is **destroyed in the source and
exists in no copy** — verified: blurring our frame *converges* toward FFNG (so
FFNG has no extra detail; it's a smoothed copy), and FFNG has *less* high-frequency
energy than ours. So the detail can't be "restored" by any filter — only smoothed
(looks blurry) or **replaced**.

> **What's actually fixed:** only the **big 12 s burst** is spliced (it's the most
> obvious). The shorter 23 s burst is milder and was judged acceptable, so it's
> **intentionally left as-is** (faithful). Re-add its window to `SPLICES` to fix it too.

**The fix — splice FFNG's clean frames over each burst window.** The FFNG movie is
a clean rendering of the *same footage*, so for each burst window we overlay FFNG's
frames onto our faithful base:

- **Time-align:** FFNG drifts **non-linearly** vs ours — it's ~0.11 s ahead at 12 s
  but ~0.0 s at 23 s — so each window carries its own measured offset
  (`offset = our_time − matching_FFNG_time`, found by PSNR-matching frames) applied
  as a per-window `-itsoffset`.
- **Colour-match:** none needed — FFNG and ours already match to <1 on mean Y/U/V
  in these windows, so the seams don't pop.
- **Crossfade the seams:** FFNG's alpha fades **in** just before the burst onset and
  **out** as it recovers; outside the fades our video shows through untouched
  (`overlay=eof_action=pass`). Moving objects (e.g. the UFO) track across the seam
  because the offset holds the alignment.
- **Audio:** our original audio is kept (`-map 0:a`).

The source content outside these windows remains the original footage. The
historical comparison reported **PSNR = ∞ / identical at t=6/18/30/48/60 s**.
That checks sampled decoded frames, not whole-file identity or every later codec
build; H.264 is a lossy delivery encoding.
The windows are declared in the `SPLICES` array at the top of
`tools/build-movies.mjs` — add a `{ offset, fadeIn, fadeOut, d }` entry (each with
its own measured FFNG offset) to fix another burst. Each window uses its own FFNG
input instance.

### Approaches that were tried and rejected

- **Global deblock/denoise** (`hqdn3d`, `smartblur`, `pp7`, `spp`, `bilateral`):
  either too weak (blocks remain) or they blur the *whole* video. Rejected.
- **Temporal denoise** (`hqdn3d` heavy temporal): the blocks are *static* after
  the keyframe (they don't flicker), so temporal averaging can't touch them — it
  only added blur. Rejected.
- **Window-gated deblock** (strong `uspp`+`smartblur` only in 10.5–14 s): removed
  the blocks but still just *blurred* those 2 s. Better than global, but still
  blur. Rejected in favour of the FFNG splice, which uses real clean frames.

## Comparison tool

A separate 4-up comparison player (kept outside this repo) shows
Delphi original · ours-faithful · ours-cleaned · FFNG side by side
— with synced play, frame-stepping, per-clip audio and alignment nudge. Serve it
with the bundled range-capable server:

    cd path/to/compare && python3 serve.py 8777
    # open http://127.0.0.1:8777/compare.html

Useful for eyeballing the burst fix and the crossfade seams (step through
11.8 → 14.2 s).
