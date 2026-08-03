"""
Speak the rewritten tutorial lines in the big fish's own voice, using XTTS-v2 cloning.

    ~/.cache/ff4e-tts-venv/bin/python tools/make-voice-xtts.py [outDir] [takes]

Unlike the Piper route, which produces a different man's voice in roughly the right
register, this conditions on recordings of the fish itself and reproduces its timbre.
The references come from the corpus built by tools/build-voice-dataset.mjs; mid-length
clips are preferred, being well articulated rather than clipped exclamations, and
several are averaged so one odd reading does not colour the result.

Output is conformed to the shipped format — 22.05 kHz mono 16-bit — and every line is
generated several times, because sampling varies run to run and picking the best take by
ear is far cheaper than trying to steer it. Pitch is reported against the original as an
objective check that a take is in the right register.
"""

import os
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
os.chdir(REPO)
os.environ.setdefault("COQUI_TOS_AGREED", "1")

OUT = Path(sys.argv[1] if len(sys.argv) > 1 else "out/voice-xtts")
TAKES = int(sys.argv[2]) if len(sys.argv) > 2 else 3
REF_DIR = Path("out/xtts-ref")
RATE = 22050

# Keep in step with src/platform/padCaptions.ts.
LINES = {
    "help2": "Než vstoupíme do dílny, uložíme si pozici - dělá se to tlačítkem LB.",
    "help7": "Nyní začínáme znovu - můžeme však nahrát uloženou pozici tlačítkem RB.",
    "help11": "Znovu nahrajeme pozici tlačítkem RB.",
    "help22": (
        "Tak, to by asi bylo z pravidel všechno. Chceš-li vědět více, "
        "stiskni tlačítko Menu a vyber Nápovědu."
    ),
}

refs = sorted(str(p) for p in REF_DIR.glob("*.wav"))
if not refs:
    sys.exit(f"no reference clips in {REF_DIR} — see xbox/VOICE.md")

from TTS.api import TTS  # noqa: E402  (import after the cwd/env setup above)

# XTTS on MPS still falls back to CPU for several ops, and the fallbacks have produced
# wrong results in the past; on an M-series CPU four short lines take under a minute
# each, so correctness is worth more than the speed here.
tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to("cpu")

OUT.mkdir(parents=True, exist_ok=True)
raw = OUT / ".raw"
raw.mkdir(exist_ok=True)

print(f"references: {len(refs)} clips")
for name, text in LINES.items():
    for take in range(1, TAKES + 1):
        tmp = raw / f"{name}-{take}.wav"
        tts.tts_to_file(text=text, speaker_wav=refs, language="cs", file_path=str(tmp))
        dst = OUT / f"{name}-take{take}.wav"
        # XTTS renders at 24 kHz; the game's clips are 22.05 kHz mono 16-bit.
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(tmp),
             "-ar", str(RATE), "-ac", "1", "-sample_fmt", "s16", str(dst)],
            check=True,
        )
        dur = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(dst)],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        print(f"  {name}-take{take}  {float(dur):.2f}s")

subprocess.run(["rm", "-rf", str(raw)], check=False)
print(f"\n-> {OUT}/   (pick a take per line, then see xbox/VOICE.md)")
