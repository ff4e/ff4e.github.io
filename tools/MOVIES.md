# Intro movies — how they're built

The startup **intro** (ALTAR logo → intro movie) and the map's top-left "watch
intro" corner play the original game's two movies as HTML5 `<video>` overlays.
`tools/build-movies.mjs` transcodes them from the original assets into
`public/data/Movie/` (gitignored, like all game data). Run it once:

    node tools/build-movies.mjs      # needs ffmpeg on PATH

Without the MP4s the game just skips the intro and boots straight to the map.

## Sources

| File | What it is |
|------|------------|
| `public/data/Movie/intro.avi` | The intro movie — **Cinepak** AVI, 640×480, 30 fps, ~73 s, PCM stereo 22 kHz. The 1998 original. |
| `public/data/Movie/logo.avi` | The ALTAR logo — Cinepak AVI, 640×480, ~30 s. |
| Fish Fillets NG `intro.mpg` | The community FFNG port's intro — MPEG-1, a **clean re-render of the same footage**. Used only to patch one broken window (below). Default path: `/Applications/Fillets.app/Contents/Resources/fillets/share/games/fillets-ng/images/menu/intro.mpg`; override with `FFNG_MOVIE=/path/to/intro.mpg`. |

Browsers can't play Cinepak AVI or MPEG-1 in `<video>`, so everything is
transcoded to **H.264/MP4** — the one codec that plays in *every* browser and
device (Safari included). It's the correct choice here: the video is bundled
locally (not streamed) and is low-detail 1998 CGI, so H.264's universal
compatibility matters far more than the marginal file-size win of VP9/AV1 (which
also lack reliable Safari support). See the README "Original data" note.

## Outputs (two variants per movie)

| File | Description |
|------|-------------|
| `intro.mp4`, `logo.mp4` | **Faithful** — a straight H.264 transcode (`libx264 -crf 17`, near-lossless). Preserves the original's Cinepak vector-quantization "block" artifacts — i.e. looks exactly like the real 1998 game. |
| `intro_clean.mp4` | **Cleaned** — the faithful transcode, with one ~2 s window patched (see "The burst fix"). Everything outside that window is byte-for-byte the faithful video. |
| `logo_clean.mp4` | A plain copy of `logo.mp4` (the logo has no burst to fix). |

The port currently plays the **faithful** intro. `intro_clean.mp4` exists as the
higher-quality option; wiring the port to prefer it (globally, or only in
Enhanced-graphics mode) is a one-line change in `src/app/main.ts` (the
`INTRO_MOVIE` constant).

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

Result: each burst window is clean FFNG globe (real content, no blocks, **no
blur**); the seams are invisible; and everything outside the windows is our
faithful transcode, byte-for-byte (verified PSNR = ∞ / identical at t=6/18/30/48/60 s).
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
