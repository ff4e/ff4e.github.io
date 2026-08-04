# Re-recording the tutorial lines

KUFRIK's demonstration teaches saving and loading by naming PC keys — F2, F3, F1 — which
do not exist on a controller. The captions are rewritten for the console build in
`src/platform/padCaptions.ts`; this describes producing the matching **audio**, so the
tutorial does not say one thing while the subtitle reads another.

Four lines are affected — `help2`, `help7`, `help11`, `help22` — and all four are spoken
by the **big fish**, so only one voice has to be reproduced.

The recordings are **Czech only**: the game has Czech speech with English subtitles over
it, so only Czech audio is generated.

## Targets to match

Measured from the shipped clips, and worth re-checking after any change:

| | |
| --- | --- |
| Format | 22.05 kHz, mono, 16-bit |
| Big fish median pitch | **~134 Hz** |
| Durations | help2 6.55s · help7 6.34s · help11 3.65s · help22 8.50s |

Duration matters: the game derives how long a fish's mouth moves from the clip's length,
so a noticeably shorter take reads as clipped against the scene it plays over.

## Pipeline

```bash
# 1. A corpus of the big fish, for reference or for training a converter.
#    614 clips / ~36 min, silence-trimmed, level-matched, with transcripts.
npx tsx tools/build-voice-dataset.mjs V out/voice-dataset/big

# 2. Source takes, in Czech, paced to match the clips they replace.
npx tsx tools/make-voice-takes.mjs out/voice-src

# 3. Move them into the big fish's register (step 4 prints the number to use).
node tools/pitch-match.mjs out/voice-src out/voice-src-matched -3

# 4. Check the result against the original.
python3 tools/voice-pitch.py 'out/voice-dataset/big/wavs/*.wav' original \
                             'out/voice-src-matched/*.wav' replacement

# 5. Install. The console loads these in place of the bank clips; the web build
#    never asks for them.
cp out/voice-src-matched/*.wav public/data/xbox-voice/
```

Each clip is optional and independent: a line with no recording keeps its original audio
and still shows the corrected subtitle. That is deliberate — a half-finished recording
session should not leave the tutorial silent.

## Choosing a source voice

Voice conversion replaces timbre but keeps delivery, so the source take only has to be
right about words and pacing — but the closer the source starts, the less damage the
conversion does. Measured:

| Source | Pitch | Distance from the big fish |
| --- | --- | --- |
| Piper `cs_CZ-jirka-medium` (male) | 160 Hz | 3.0 semitones |
| macOS `Zuzana` (the only Czech voice macOS ships, female) | 214 Hz | 8.2 semitones |
| A person reading the lines | — | best available: real prosody, native Czech |

Hence Piper is the default. `FF_TTS_ENGINE=say` falls back to macOS if the model is
missing.

### Installing Piper

```bash
python3.13 -m venv /tmp/ffvoice && /tmp/ffvoice/bin/pip install piper-tts
mkdir -p ~/.cache/ff4e-piper && cd ~/.cache/ff4e-piper
BASE=https://huggingface.co/rhasspy/piper-voices/resolve/main/cs/cs_CZ/jirka/medium
curl -sSLO "$BASE/cs_CZ-jirka-medium.onnx?download=true"
curl -sSLO "$BASE/cs_CZ-jirka-medium.onnx.json?download=true"
```

Override with `FF_PIPER` and `FF_PIPER_MODEL` if they live elsewhere.

## What pitch-matching does and does not do

`pitch-match.mjs` resamples, so formants move with the pitch — the effect of playing tape
slower. Over a couple of semitones downward that reads as a slightly larger speaker,
which suits this character. It puts the take in the right *register*, but it is not the
same voice.

For an actual timbre match the next step is voice conversion (RVC or similar) trained on
the corpus from step 1: ~36 minutes of clean single-speaker audio is comfortably enough.
Feed it the source takes, and a human reading the lines will convert better than any TTS,
because flat synthetic prosody survives conversion intact.

## Training the conversion model on Kaggle

Local training on the M4 was abandoned — see below. Azure was ruled out entirely: every
GPU SKU is `NotAvailableForSubscription` or returns `QuotaNotAvailableForResource` on a
Visual Studio Enterprise subscription, and the legacy K80/M60 SKUs whose quota still shows
(18 vCPU) were retired by Azure and no longer exist in any region's catalog.

Kaggle gives a free T4/P100 with ~30 GPU-hours a week, no card and no quota request. It is
also Linux, which is what makes real RVC installable at all — `rvc-python` cannot build
fairseq on Apple Silicon.

```bash
./tools/kaggle/build-package.sh      # -> out/kaggle/ff4e-voice.zip (80 MB)
```

The zip carries `wavs/` (614 clips / 36 min), `src/` (the four replacement lines, already
duration- and pitch-matched) and `targets.json`.

1. kaggle.com -> **Datasets -> New Dataset**, upload the zip, keep it **Private**.
2. **Code -> New Notebook**, then **File -> Import Notebook** and pick
   `tools/kaggle/ff4e-svc-kaggle.ipynb`.
3. Settings: **Accelerator = GPU T4 x2** (or P100), **Internet = On**.
4. **Add data ->** attach the dataset from step 1.
5. Run all. ~1.5–2 h for the default 200 epochs.

Edit the notebook via `tools/kaggle/make-notebook.py` and regenerate — the `.ipynb` is
generated so the code stays diff-friendly in git.

Download `ff4e-voice-takes.zip` from the notebook's Output tab, then:

```bash
unzip -o ~/Downloads/ff4e-voice-takes.zip -d out/voice-kaggle
python3 tools/voice-pitch.py out/voice-kaggle/*.wav    # expect ~134 Hz
afplay out/voice-kaggle/help2.wav                      # audition all four
```

Only after every line is approved:

```bash
cp out/voice-kaggle/*.wav public/data/xbox-voice/
```

No code change is needed — `src/platform/padCaptions.ts` already fetches
`/data/xbox-voice/<id>.wav` and `src/audio/audio.ts` consults `loadOverride()` before the
sound banks.

`G_final.pth` + `config.json` are saved alongside the takes; keep them to re-convert new
lines later without retraining.

### Why not local

so-vits-svc preprocessing completed fine on the Mac, but training did not fit. The trap:
`ps` RSS showed 0.4 GB while `footprint -p <pid>` showed **15 GB** — Metal/MPS allocations
do not appear in RSS. `PYTORCH_MPS_HIGH_WATERMARK_RATIO` is a fraction of the *GPU budget*
(25 GB here), so 0.7 authorised 17.5 GB. Capping it to fit caused MPS OOM instead: even
batch_size 1 needs ~7.2 GB, and only ~8 GB was genuinely free. A 16 GB CUDA card trains
this at batch 12 without trouble.
