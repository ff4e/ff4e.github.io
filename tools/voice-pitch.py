"""
Median voiced pitch of a set of clips, for matching a replacement voice to the original.

    python3 tools/voice-pitch.py <glob> [label] ...
    python3 tools/voice-pitch.py 'out/voice-dataset/big/wavs/*.wav' original \
                                 'out/voice-src/*.wav' source

Voice conversion has to be told how far to move the pitch, and the person driving it
cannot always judge the result by ear alone. This gives a number to aim at: the shipped
big fish sits at ~135 Hz, so a converted take that lands near that is in the right
register, and the semitone gap printed between two sets is the transpose to apply.

Autocorrelation on voiced frames only — crude next to a real F0 tracker, but the point
is comparing two speakers, not measuring either precisely.
"""
import glob
import sys
import wave

import numpy as np


def f0_median(path, fmin=60, fmax=400):
    with wave.open(path) as w:
        sr = w.getframerate()
        x = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float64)
    if len(x) < sr // 4:
        return None
    win, hop = int(0.04 * sr), int(0.02 * sr)
    lo, hi = int(sr / fmax), int(sr / fmin)
    out = []
    for i in range(0, len(x) - win, hop):
        fr = x[i : i + win]
        if np.sqrt((fr ** 2).mean()) < 300:      # silence
            continue
        fr = fr - fr.mean()
        ac = np.correlate(fr, fr, "full")[win - 1 :]
        if ac[0] <= 0:
            continue
        seg = ac[lo:hi]
        if not len(seg):
            continue
        p = int(np.argmax(seg)) + lo
        if ac[p] / ac[0] < 0.3:                  # weakly periodic => unvoiced
            continue
        out.append(sr / p)
    return float(np.median(out)) if len(out) > 5 else None


def measure(pattern, limit=200):
    vals = [v for v in (f0_median(f) for f in sorted(glob.glob(pattern))[:limit]) if v]
    return (float(np.median(vals)), len(vals)) if vals else (None, 0)


args = sys.argv[1:]
if not args:
    print(__doc__)
    raise SystemExit(2)

results = []
for i in range(0, len(args), 2):
    pattern = args[i]
    label = args[i + 1] if i + 1 < len(args) else pattern
    med, n = measure(pattern)
    if med is None:
        print(f"  {label:24s} no voiced audio found ({pattern})")
        continue
    print(f"  {label:24s} median F0 {med:6.1f} Hz   (n={n})")
    results.append((label, med))

if len(results) == 2:
    (la, a), (lb, b) = results
    semitones = 12 * np.log2(b / a)
    print(f"\n  {lb} is {semitones:+.1f} semitones from {la}"
          f"  -> transpose {-semitones:+.0f} to match")
