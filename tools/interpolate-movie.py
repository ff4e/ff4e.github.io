#!/usr/bin/env python3
"""Build the temporal stage from a spatial-only movie, never from a previous smoothed output."""
import argparse
from fractions import Fraction
from importlib.metadata import version
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from movie_pipeline.cadence import ALGORITHM, motion_plan, timeline
from movie_pipeline.media import audio_hash, decode_analysis, run, sha256, verify_output, video_info
from movie_pipeline.render import render


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=["intro", "logo"], required=True)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--base", type=Path, required=True, help="Faithful/clean movie used for the spatial upscale")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--rife", type=Path, required=True)
    parser.add_argument("--model", type=Path, help="Defaults to rife-v4.6 beside the executable")
    parser.add_argument("--gpu", type=int, default=0)
    parser.add_argument("--crf", type=int, default=23)
    parser.add_argument("--analyze-only", action="store_true")
    args = parser.parse_args()
    if not 0 <= args.crf <= 51:
        parser.error("--crf must be in 0..51")
    source, base = args.input.resolve(), args.base.resolve()
    output, report = args.output.resolve(), args.report.resolve()
    if output.suffix.lower() != ".mp4" or report.suffix.lower() != ".json":
        parser.error("Output must be an MP4 and report must be JSON")
    if source == output or base == output or report in [source, base, output]:
        parser.error("Input, base, output and report paths must not overwrite one another")
    rife = args.rife.resolve()
    model = args.model.resolve() if args.model else rife.parent / "rife-v4.6"
    for path in [source, base, rife, model / "flownet.bin", model / "flownet.param"]:
        if not path.is_file():
            parser.error(f"Required file not found: {path}")
    source_info, base_info = video_info(source), video_info(base)
    expected_rate, multiplier = (30, 2) if args.kind == "intro" else (15, 4)
    rate = Fraction(source_info["rate"])
    if abs(float(rate) - expected_rate) > 0.001:
        parser.error(f"Expected a spatial-only ~{expected_rate} fps input, not an already interpolated movie")
    for key in ["frames", "rate", "duration", "audio_duration"]:
        if source_info[key] != base_info[key]:
            parser.error(f"Spatial input {key} differs from its faithful/clean base")
    input_audio = audio_hash(source)
    if input_audio != audio_hash(base):
        parser.error("Spatial input audio differs from its faithful/clean base")
    input_hash = sha256(source)
    if args.kind == "intro":
        plan = motion_plan(decode_analysis(source, source_info["frames"]))
    else:
        plan = {"anchors": list(range(source_info["frames"])), "cuts": []}
    records = timeline(plan, source_info["frames"], multiplier)
    print(f"{args.kind}: {source_info['frames']} input frames -> {len(plan['anchors'])} anchors -> "
          f"{len(records)} output frames at {rate * multiplier} fps", flush=True)
    plan_hash = hashlib.sha256(
        json.dumps(plan, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    print(f"  cadence plan sha256: {plan_hash}", flush=True)
    if args.analyze_only:
        return
    output.parent.mkdir(parents=True, exist_ok=True)
    report.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"ff-movie-{args.kind}-") as directory:
        pending, copied_frames = render(source, source_info, records, Path(directory),
                                         rife, model, args.gpu, args.crf)
        result = verify_output(pending, source_info, multiplier, input_audio)
        if sha256(source) != input_hash:
            raise ValueError("Spatial input changed during generation")
        result.update({"file": output.name, "bytes": pending.stat().st_size,
                       "sha256": sha256(pending), "audio_sha256": input_audio})
        data = {
            "schema": 1, "movie": args.kind,
            "base": {"file": base.name, "sha256": sha256(base), **base_info},
            "spatial_input": {"file": source.name, "sha256": input_hash, **source_info,
                              "audio_sha256": input_audio},
            "cadence": {
                "algorithm": ALGORITHM if args.kind == "intro" else "uniform-rife-v1",
                "retained_frames": len(plan["anchors"]), "cut_boundaries": plan["cuts"],
                "plan_sha256": plan_hash, "verified_rgb_copies": copied_frames,
                "multiplier": multiplier,
            },
            "rife": {"model": model.name, "binary_sha256": sha256(rife),
                     "model_sha256": {p.name: sha256(p) for p in sorted(model.iterdir())
                                     if p.suffix in [".bin", ".param"]}},
            "software": {"python": sys.version.split()[0], "numpy": version("numpy"),
                         "opencv-python-headless": version("opencv-python-headless"),
                         "ffmpeg": run(["ffmpeg", "-version"], capture=True).decode().splitlines()[0]},
            "encoding": {"codec": "libx264", "preset": "slow", "crf": args.crf,
                         "pixel_format": "yuv420p", "audio": "copy", "faststart": True},
            "output": result,
        }
        # Stage beside each destination so replacing the movie is atomic even with an external TMPDIR.
        with tempfile.NamedTemporaryFile(dir=output.parent, prefix=".movie-", suffix=".mp4", delete=False) as f:
            staged_movie = Path(f.name)
        with tempfile.NamedTemporaryFile(dir=report.parent, prefix=".movie-", suffix=".json", delete=False) as f:
            staged_report = Path(f.name)
        try:
            shutil.copyfile(pending, staged_movie)
            staged_report.write_text(json.dumps(data, indent=2) + "\n")
            staged_movie.chmod(0o644)
            staged_report.chmod(0o644)
            os.replace(staged_movie, output)
            os.replace(staged_report, report)
        finally:
            staged_movie.unlink(missing_ok=True)
            staged_report.unlink(missing_ok=True)
    print(f"Wrote {output.name}: {result['width']}x{result['height']}, "
          f"{result['frames']} frames, {result['bytes'] / 1e6:.1f} MB; audio unchanged.", flush=True)


if __name__ == "__main__":
    main()
