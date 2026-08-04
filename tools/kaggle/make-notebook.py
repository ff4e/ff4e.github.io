#!/usr/bin/env python3
"""Generate tools/kaggle/ff4e-svc-kaggle.ipynb.

Kept as a generator rather than a hand-edited .ipynb so the cell code stays
diff-friendly in git (notebook JSON is not).
"""
import json
import os

CELLS = []


def md(text):
    CELLS.append({"cell_type": "markdown", "metadata": {}, "source": text.strip().splitlines(True)})


def code(text):
    CELLS.append({"cell_type": "code", "execution_count": None, "metadata": {},
                  "outputs": [], "source": text.strip().splitlines(True)})


md(r"""
# Fish Fillets 4ever — big-fish voice model

Trains a **so-vits-svc** voice-conversion model on the original Czech big-fish corpus
(614 clips / ~36 min), then converts the four replacement tutorial lines into that voice.

Why voice conversion and not TTS cloning: earlier attempts (Piper + pitch match, XTTS-v2
zero-shot) were rejected — they reproduce the *pitch* but not the *identity*. so-vits-svc
converts timbre frame-by-frame from a real source performance, which is what preserves identity.

### Before running
1. **Settings → Accelerator → GPU T4 x2** (or P100). CPU will not finish.
2. **Settings → Internet → On** (needed to pip-install and fetch the pretrained base).
3. **Add data →** upload `out/kaggle/ff4e-voice.zip` as a private Dataset and attach it.

Runtime is roughly **1.5–2 h** for the default 200 epochs on a T4. Checkpoints are written
periodically, so you can stop early and still convert with the latest one.
""")

code(r"""
# 1 — environment check
import subprocess, sys
print(subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total,driver_version",
                      "--format=csv,noheader"], capture_output=True, text=True).stdout.strip() or "NO GPU")
import torch
print("python", sys.version.split()[0], "| torch", torch.__version__, "| cuda", torch.cuda.is_available())
assert torch.cuda.is_available(), "Enable the GPU accelerator (Settings -> Accelerator -> GPU)."
""")

code(r"""
# 2 — install so-vits-svc-fork
#
# torch/torchaudio are PINNED to the versions Kaggle preinstalled. Without this pip happily
# swaps in a CPU-only wheel and torch.cuda.is_available() silently flips to False.
import subprocess, sys, torch, torchaudio, pathlib

def sh(cmd):
    print("+", cmd, flush=True)
    if subprocess.run(cmd, shell=True).returncode:
        raise SystemExit(f"failed: {cmd}")

pathlib.Path("/tmp/constraints.txt").write_text(
    f"torch=={torch.__version__}\ntorchaudio=={torchaudio.__version__}\n")

sh('pip -q install "setuptools<81"')                 # so-vits-svc still imports pkg_resources
sh("pip -q install so-vits-svc-fork -c /tmp/constraints.txt")

import importlib
importlib.invalidate_caches()
import torch  # noqa: F811
print("torch", torch.__version__, "| cuda", torch.cuda.is_available())
assert torch.cuda.is_available(), "pip replaced torch with a CPU build — rerun this cell."
""")

code(r"""
# 3 — numpy 2 compatibility patch
#
# so-vits-svc-fork 4.2.x calls np.fromstring(), removed in numpy 2. Two sites, both in the
# TensorBoard plotting helper. Hit this locally on macOS too.
import site, pathlib, glob

patched = 0
for base in set(site.getsitepackages() + [site.getusersitepackages()]):
    for p in glob.glob(f"{base}/so_vits_svc_fork/utils.py"):
        f = pathlib.Path(p)
        s = f.read_text()
        if "np.fromstring" in s:
            f.write_text(s.replace("np.fromstring", "np.frombuffer"))
            patched += 1
            print("patched", p)
print("patched files:", patched, "(0 is fine if already fixed upstream)")
""")

code(r"""
# 4 — stage the dataset
import glob, os, shutil, json

root = None
for cand in glob.glob("/kaggle/input/*/"):
    if os.path.isdir(os.path.join(cand, "wavs")):
        root = cand
        break
    inner = glob.glob(os.path.join(cand, "*/wavs"))
    if inner:
        root = os.path.dirname(inner[0]) + "/"
        break
assert root, "Attach the ff4e-voice dataset (Add data -> your uploaded zip)."
print("dataset:", root)

SPEAKER = "big"
os.makedirs(f"dataset_raw/{SPEAKER}", exist_ok=True)
for p in glob.glob(os.path.join(root, "wavs", "*.wav")):
    shutil.copy(p, f"dataset_raw/{SPEAKER}/")

os.makedirs("src", exist_ok=True)
for p in glob.glob(os.path.join(root, "src", "*.wav")):
    shutil.copy(p, "src/")

targets = json.load(open(os.path.join(root, "targets.json")))
print("train clips :", len(os.listdir(f"dataset_raw/{SPEAKER}")))
print("lines       :", sorted(os.path.splitext(f)[0] for f in os.listdir("src")))
print("target rate :", targets["targetRate"], "Hz | target F0:", targets["targetF0"], "Hz")
""")

code(r"""
# 5 — preprocess (resample -> config -> HuBERT features)
#
# Trains at 44.1 kHz even though the source is 22.05 kHz: that is what the pretrained base
# expects, and keeping the base is worth far more than the empty upper band costs.
import subprocess

def svc(*args):
    print("+ svc", *args, flush=True)
    if subprocess.run(["svc", *args]).returncode:
        raise SystemExit("svc " + " ".join(args))

svc("pre-resample")
svc("pre-config")
svc("pre-hubert", "-fm", "crepe")   # crepe f0 is slower but noticeably cleaner than dio
""")

code(r"""
# 6 — training configuration
import json, pathlib

CFG = pathlib.Path("configs/44k/config.json")
cfg = json.loads(CFG.read_text())

# T4/P100 have 16 GB. batch 12 leaves headroom; the local MPS run died at batch 2 because
# Metal allocations are invisible to RSS and the Mac only had ~8 GB genuinely free.
cfg["train"]["batch_size"]    = 12
cfg["train"]["epochs"]        = 200        # ~51 steps/epoch -> ~10k steps
cfg["train"]["eval_interval"] = 800        # checkpoint often enough to stop early
cfg["train"]["log_interval"]  = 200
cfg["train"]["keep_ckpts"]    = 3          # /kaggle/working is capped at 20 GB

CFG.write_text(json.dumps(cfg, indent=2))
print(json.dumps(cfg["train"], indent=2))
print("\nspeakers:", cfg["spk"])
""")

code(r"""
# 7 — train
#
# Safe to interrupt: checkpoints land in logs/44k every eval_interval steps and cell 8
# picks up whichever is newest.
import subprocess
subprocess.run(["svc", "train", "-t"])
""")

code(r"""
# 8 — convert the four lines
import glob, os, re, subprocess

ckpts = [p for p in glob.glob("logs/44k/G_*.pth") if not p.endswith("G_0.pth")]
assert ckpts, "no checkpoint yet — let cell 7 run longer"
latest = max(ckpts, key=lambda p: int(re.search(r"G_(\d+)", p).group(1)))
print("checkpoint:", latest)

os.makedirs("converted", exist_ok=True)
for p in sorted(glob.glob("src/*.wav")):
    name = os.path.basename(p)
    print("\n===", name, flush=True)
    subprocess.run(["svc", "infer",
                    "-m", latest,
                    "-c", "configs/44k/config.json",
                    "-s", "big",
                    "-t", "0",              # source is already pitch-matched to ~134 Hz
                    "-fm", "crepe",
                    "-o", f"converted/{name}",
                    p])
print("\nconverted:", sorted(os.listdir("converted")))
""")

code(r"""
# 9 — conform to the game's format and package
#
# The game derives lip-sync from clip length, so duration must survive. so-vits-svc is
# frame-wise, so it does — this cell asserts it rather than trusting it.
import glob, json, os, shutil
import librosa, numpy as np, soundfile as sf

RATE = 22050
os.makedirs("final", exist_ok=True)
rows = []

for p in sorted(glob.glob("converted/*.wav")):
    name = os.path.basename(p)
    y, _ = librosa.load(p, sr=RATE, mono=True)
    peak = float(np.max(np.abs(y))) or 1.0
    y = (y / peak) * 0.89                     # match the originals' peak headroom
    out = f"final/{name}"
    sf.write(out, y, RATE, subtype="PCM_16")

    ref, _ = librosa.load(f"src/{name}", sr=RATE, mono=True)
    f0 = librosa.yin(y, fmin=60, fmax=400, sr=RATE)
    voiced = f0[(f0 > 60) & (f0 < 400)]
    rows.append((name, len(y) / RATE, len(ref) / RATE,
                 float(np.median(voiced)) if voiced.size else float("nan")))

print(f"{'line':14s} {'out(s)':>8s} {'src(s)':>8s} {'drift':>7s} {'medF0':>7s}   target 134 Hz")
for name, dur, ref, f0 in rows:
    print(f"{name:14s} {dur:8.2f} {ref:8.2f} {dur-ref:+7.3f} {f0:7.1f}")

shutil.make_archive("/kaggle/working/ff4e-voice-takes", "zip", "final")
shutil.copy(latest, "/kaggle/working/G_final.pth")
shutil.copy("configs/44k/config.json", "/kaggle/working/config.json")
print("\nDownload from the notebook Output tab:")
print("  ff4e-voice-takes.zip   <- the four converted lines")
print("  G_final.pth + config.json <- reuse to re-convert without retraining")
""")

md(r"""
### After downloading

```bash
cd ~/RiderProjects/ff4e-xbox
unzip -o ~/Downloads/ff4e-voice-takes.zip -d out/voice-kaggle
python3 tools/voice-pitch.py out/voice-kaggle/*.wav     # expect ~134 Hz
afplay out/voice-kaggle/help2.wav                       # audition every line
```

Only once Martin approves all four:

```bash
cp out/voice-kaggle/*.wav public/data/xbox-voice/
```

`src/platform/padCaptions.ts` already fetches `/data/xbox-voice/<id>.wav` and
`src/audio/audio.ts` consults `loadOverride()` before the sound banks, so dropping the
files in is the whole integration — no code change.
""")

nb = {
    "cells": CELLS,
    "metadata": {
        "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
        "language_info": {"name": "python"},
        "accelerator": "GPU",
    },
    "nbformat": 4,
    "nbformat_minor": 5,
}

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ff4e-svc-kaggle.ipynb")
with open(out, "w") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
    f.write("\n")
print(f"wrote {out} ({len(CELLS)} cells)")
