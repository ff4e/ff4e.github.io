# The original data, and what was done to it

ALTAR GPL-released the 1998 game's data in 2002, which is the only reason this port can exist. This
file records where each kind of asset comes from, and every transcode applied to it on the way to
the browser — what was re-encoded, to what, why that codec, and what it was measured against.

The rule throughout: the *bytes the player experiences* stay the original's. Re-encoding is for
download size and for codecs that browsers actually decode, never for taste. Where a transcode is
lossy, the measurement that justified it is quoted here.

See also [`public/restored/README.md`](public/restored/README.md) for the handful of sounds restored
from fillets-ng, and [`CREDITS.md`](CREDITS.md) for full attribution.

Moved out of `README.md` unedited.

The shipped room data (`0NN.FFR/.FFS/.FFT`, `PANEL.FFP`) is extracted from the GPL
`ffinstallation.exe` using [REWise](https://codeberg.org/CYBERDEV/REWise) — **without executing
the installer**. Expected at:

    ~/.cache/ffng-orig/extracted/MAINDIR/{Graphic,Sound,Title,Menu}/...

Override the location with `FF_DATA_DIR=/path/to/MAINDIR`.

### Music

Every byte of audio the 1998 game shipped is uncompressed 22 050 Hz mono 16-bit PCM —
352.8 kbps — and the 17 `Music/*.wav` tracks are **63.8 MB** of it. Since a room does not
appear until all of its audio has arrived, that PCM is time on the loading screen: on a
1.5 Mbps link a room's track alone was up to 36 s of the wait.

The game fetches **`Music/<name>.m4a`** instead: AAC at 64 kbps, **12.3 MB** for all 17
(5.2×), so the worst room's music goes from 6.75 MB to 1.3 MB. Stage them with

    npx tsx tools/stage-music.ts            # writes public/data/Music/*.m4a
    npx tsx tools/stage-music.ts --check    # re-encode to a temp dir and byte-compare
    npx tsx tools/stage-music.ts --verify   # decode what we ship and measure it

AAC rather than Opus for the same reason the movies are H.264 — it is the one codec that
decodes in *every* browser, and Safari's `decodeAudioData` still does not reliably handle
Ogg Opus. Opus was measured (13.0 MB at the same bitrate) and the difference did not pay
for a Safari-shaped hole in the only audio path the game has.

The `.wav` originals stay in the repo. They are what `tools/stage-music.ts` encodes from,
what `--verify` measures against, and what `test/musicStaging.test.ts` checks the music
table's numbers against — nothing downloads them.

**The loop point is the part to be careful with.** A room loops its track from
`loopSample` (`src/audio/music.ts`, `MusicCycle` in `URoom.pas:1568`) so that the intro
plays once and only the body repeats. That offset is in samples of the 22 050 Hz original,
and `loopStart` is seconds — so the rate has to come from somewhere. It used to be read out
of the WAV header at byte offset 24; an encoded file has no such header, and the table
carries `MUSIC_RATE` and each track's `frames` instead, drift-guarded against the originals
by `test/musicStaging.test.ts`. `loopEnd` comes from `frames` and **not** from
`buf.duration`, because AAC decodes 70–1 000 samples longer than the original (encoder
padding, reported per track by `--verify`) and looping on the decoded duration would splice
that silence into the track once per repeat.

`--verify` also reports what the compression can and cannot prove: all 17 tracks decode at
**lag 0** against their original, which is exact and is what the loop points depend on. The
SNR it prints alongside (~18–29 dB) is a regression tripwire, not a transparency proof —
AAC is not a waveform coder and a perceptually identical encode scores poorly by it.

### Voices

The other 183.9 MB — and the part where the obvious claim is wrong. The voices were
**never** raw PCM: `.ffs` bodies go through `Decompres` (`src/audio/ffs.ts`,
`RSound.pas:258-333`), the original's second-order delta codec, so 254.8 MB of samples
already ship as 183.9 MB. It is 1 818 sounds, 101.0 minutes, and it is speech — median
line 2.75 s, only 3 % under a second.

The game fetches **`Sound/<id>.ffs2`**: AAC at 48 kbps, **37.4 MB** for all 76 packages
(4.9×), so a room's voices go from 2.43 MB to 0.50 MB and the worst room from 8.94 MB to
1.73 MB.

    npx tsx tools/stage-voices.ts            # writes public/**/*.ffs2
    npx tsx tools/stage-voices.ts --check    # re-encode to a temp dir and byte-compare
    npx tsx tools/stage-voices.ts --verify   # decode all 1 797 segments and measure them

**`x00` is deliberately not compressed.** It is the only package of *effects* rather than
speech — short transients like the falling-steel clang, which is what lossy coding smears
worst — and it is 0.87 MB. `isRawPkg` (`src/audio/ffs2.ts`) is that rule, and both the URL
builder and the Pages staging read it.

**One file per package, not one per line.** A room speaks ~24 lines, so per-line files
would be ~24 extra requests per room entry. A `.ffs2` is a header carrying
`zvuk → (offset, length)` and then the segment bodies, each a complete independently
decodable MP4 — ~500 bytes of container per sound, against every browser being able to
decode it. The **`.fft` is not regenerated**: it is where the subtitles live, and its
`delka` is already a SAMPLE count, so it stays true for encoded audio and `duration()`,
`TALKING_MEZ_SEC` and the lip-sync need no change. Only the byte offsets moved.

**A package is decoded in full when it is installed**, not lazily on first play
(`src/audio/ffs2Decode.ts`). `decodeAudioData` is asynchronous and a voice start is
synchronous — the original's `Sound()` claims its channel and returns, and the *next* tick
reads `playing(prior)` / `talking(prior)` back. Awaiting inside a voice start would expose
every room script to the race the `reserve()` machinery already exists for. The decode
itself is cheap (3–8 ms for a 2.5 s line); it is the asynchrony that cannot be had at play
time. Each buffer is trimmed to `delka`, because AAC decodes up to 1023 samples long and
`activeUntil` is taken from `buf.duration`.

**What it costs in memory.** `decodeAudioData` returns float32 at the context's rate, where
the old path built int16-derived buffers at 22050 — so decoded speech is ~4× the samples.
A room holds its own package while it is open (12.4 MiB median, **52.4 MiB** for KUFRIK,
dropped on exit), and the global packages are held for the whole session: x03 27.9 + x02
16.6 + restored 1.0 MiB from boot, plus x01 4.1 MiB after the first leg-final room. Peak
**~102 MiB**, in KUFRIK. That is a 10× change in steady-state audio residency and it is the
price of a synchronous voice start; `src/audio/ffs2Decode.ts` carries the full accounting
and the one lever that was deliberately not pulled.

`--verify` is explicit about what it can and cannot prove. It gates on **alignment** (no
shift in ±64 samples fits better than none), on **shape** (short-time RMS envelopes match
at better than 0.97 — which is what catches a segment decoded from the wrong offset, and
works on material where a waveform measure cannot) and on **length** (nothing audible
missing from the end). The **SNR** it prints alongside is a tripwire, not a transparency
proof: the lowest in the set is 0.9 dB, and that sound is a shush — broadband noise, which
AAC rebuilds with the right character and different samples. The `.ffs` originals stay in
the repo to encode from, measure against, and listen to; nothing downloads them.

### End credits

The credits were the last uncompressed art the site fetched. `Menu/CredStat1.BMP` (a
640×480 static frame with a transparent window) and the strip that scrolls through it —
`Menu/CredMov.BMP` at 640×2921, or `Menu/CredMov_port.BMP` at 640×3285 once the web-port
card is built — are **8-bit palette BMPs with no compression at all**, so one click on the
map's credits corner cost **2.41 MB** of what is mostly black behind white and cyan text.

The game fetches **`Menu/*.webp`**: lossless WebP, **0.12 MB** for the pair a session
actually loads (19.7×).

| | BMP | WebP | |
| --- | ---: | ---: | ---: |
| `CredStat1` | 308 280 | 20 522 | 15.0× |
| `CredMov` | 1 870 520 | 99 428 | 18.8× |
| `CredMov_port` | 2 103 478 | 101 838 | 20.7× |

**Lossless, and not out of caution — it is the smaller file.** Lossy WebP measures *larger*
here (213 kB at q90 against 122 kB lossless): a photographic codec has nothing to discard
in flat colour and spends its bits fighting the hard edges of text. So unlike the audio
above there was no quality knob to pick and nothing traded away; these are the 1998 pixels.

    python3 tools/build-credits-webp.py            # writes public/data/Menu/*.webp
    python3 tools/build-credits-webp.py --check    # decode what we ship, index-compare

The renderer composites on palette INDICES — `transp` and `black` are the static frame's
corner pixels (`UMain.pas:1171,1179-1181`) — and WebP has no indexed mode, so the index
plane is rebuilt from the decoded colour in `src/render/creditsAsset.ts`. That is exact
because the palette is **injective**: all three bitmaps carry a byte-identical 256-entry
palette and no two entries share an RGB triple. A colour outside it throws rather than
being mis-indexed, so a browser that ever decoded these differently fails loudly instead
of rolling the credits in quietly wrong colours. The palette itself is the one thing WebP
cannot carry, so it is compiled in (`src/data/creditsPalette.ts`, generated).

The `.BMP` originals stay in the repo for the reason the `.wav` and `.ffs` originals do:
`--check` decodes the WebP back against them, and `test/creditsAsset.test.ts` pins both
the palette and a hash of each pair. `tools/stage-pages-assets.mjs` simply stops
publishing them.

### Intro movies

The startup **intro** (ALTAR logo → intro movie) and the map's top-left "watch intro"
corner play the original `Movie/{logo,intro}.avi` (Cinepak 640×480) as HTML5 `<video>`.
Transcode them once to browser-friendly **H.264 MP4** (into `public/data/Movie/`, which is
gitignored like all game data):

    node tools/build-movies.mjs   # needs ffmpeg on PATH

This writes two variants per movie: **faithful** (`intro.mp4`/`logo.mp4`, a straight
transcode that keeps the original Cinepak look) and **cleaned** (`intro_clean.mp4`, with
the intro globe's ~2 s Cinepak "burst" patched using FFNG's clean frames of the same
footage — no blur). H.264 is used deliberately: it's the one codec that plays in *every*
browser (Safari included), and the video is bundled locally so file size isn't a concern.
Without the MP4s the game simply skips the intro and boots to the map.

See **[tools/MOVIES.md](tools/MOVIES.md)** for the full pipeline, the burst diagnosis, and
the FFNG-splice parameters.
