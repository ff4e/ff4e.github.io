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
