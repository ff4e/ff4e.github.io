#!/usr/bin/env bash
# Build the upload package for Kaggle voice training.
#
#   out/kaggle/ff4e-voice.zip
#     wavs/        614 big-fish training clips (22.05 kHz mono)
#     src/         the 4 replacement lines to convert (Piper, duration+pitch matched)
#     targets.json target duration / pitch per line
#
# Upload the zip to Kaggle as a private Dataset, then run tools/kaggle/ff4e-svc-kaggle.ipynb.
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT="$PWD"
DS="$ROOT/out/voice-dataset/big"
SRC="$ROOT/out/voice-src-matched"
STAGE="$ROOT/out/kaggle/ff4e-voice"
ZIP="$ROOT/out/kaggle/ff4e-voice.zip"

[ -d "$DS/wavs" ] || { echo "missing $DS/wavs — run tools/build-voice-dataset.mjs first" >&2; exit 1; }
[ -d "$SRC" ]     || { echo "missing $SRC — run tools/make-voice-takes.mjs + pitch-match.mjs first" >&2; exit 1; }

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE/wavs" "$STAGE/src"

cp "$DS"/wavs/*.wav "$STAGE/wavs/"
cp "$DS"/metadata.csv "$DS"/dataset.json "$STAGE/" 2>/dev/null || true
cp "$SRC"/*.wav "$STAGE/src/"

python3 - "$STAGE" <<'PY'
import json, sys, wave, glob, os, statistics
stage = sys.argv[1]

def probe(p):
    w = wave.open(p)
    return {"seconds": round(w.getnframes() / w.getframerate(), 3),
            "rate": w.getframerate(), "channels": w.getnchannels()}

src = {os.path.splitext(os.path.basename(p))[0]: probe(p)
       for p in sorted(glob.glob(os.path.join(stage, "src", "*.wav")))}
train = [wave.open(p).getnframes() / wave.open(p).getframerate()
         for p in glob.glob(os.path.join(stage, "wavs", "*.wav"))]

json.dump({
    "speaker": "big",
    "note": "Fish Fillets 4ever - big fish (Czech). Target 22.05 kHz mono 16-bit, median F0 ~134 Hz.",
    "targetRate": 22050,
    "targetF0": 134.0,
    "train": {"clips": len(train), "minutes": round(sum(train) / 60, 2)},
    "lines": src,
}, open(os.path.join(stage, "targets.json"), "w"), indent=2, ensure_ascii=False)

print(f"  train : {len(train)} clips, {sum(train)/60:.1f} min, median {statistics.median(train):.2f}s")
for k, v in src.items():
    print(f"  src   : {k:8s} {v['seconds']:.2f}s @ {v['rate']} Hz")
PY

( cd "$ROOT/out/kaggle" && zip -qr "ff4e-voice.zip" "ff4e-voice" )
echo
echo "package: $ZIP  ($(du -h "$ZIP" | awk '{print $1}'))"
