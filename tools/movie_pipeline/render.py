"""Batch only the required RIFE frame pairs; verify retained RGB images before encoding."""
from collections import defaultdict
import errno
from fractions import Fraction
import os
import shutil

from .media import frame_hashes, mux_audio, run


def link(source, target):
    try:
        os.link(source, target)
    except OSError as error:
        # A temporary directory on a different filesystem cannot use hard links.
        if error.errno != errno.EXDEV:
            raise
        shutil.copyfile(source, target)


def render(source, metadata, records, work, rife, model, gpu, crf):
    inputs, output = work / "input", work / "frames"
    inputs.mkdir()
    output.mkdir()
    run(["ffmpeg", "-v", "error", "-i", source, "-map", "0:v:0",
         "-fps_mode", "passthrough", inputs / "%08d.png"])
    if len(list(inputs.glob("*.png"))) != metadata["frames"]:
        raise ValueError("Extracted frame count differs from source metadata")

    def frame(index):
        return inputs / f"{index + 1:08d}.png"

    groups = defaultdict(dict)
    for i, record in enumerate(records):
        if "copy" in record:
            link(frame(record["copy"]), output / f"{i + 1:08d}.png")
        else:
            groups[record["steps"]].setdefault((record["left"], record["right"]), []).append((i, record["step"]))
    for steps, pairs in sorted(groups.items()):
        batch, generated = work / f"batch-{steps}", work / f"generated-{steps}"
        batch.mkdir()
        generated.mkdir()
        endpoints, positions = [], {}
        for left, right in pairs:
            if not endpoints or endpoints[-1] != left:
                endpoints.append(left)
            positions[(left, right)] = len(endpoints) - 1
            endpoints.append(right)
        for i, endpoint in enumerate(endpoints):
            link(frame(endpoint), batch / f"{i + 1:08d}.png")
        print(f"  RIFE: {len(pairs)} intervals, {steps} steps per interval", flush=True)
        run([rife, "-i", batch, "-o", generated, "-m", model,
             "-n", str(len(endpoints) * steps), "-g", str(gpu), "-j", "1:1:1", "-f", "%08d.png"])
        if len(list(generated.glob("*.png"))) != len(endpoints) * steps:
            raise ValueError("RIFE output frame count is incomplete")
        # Artificial joins between disconnected pairs are never included in the timeline.
        for pair, targets in pairs.items():
            position = positions[pair]
            for i, step in targets:
                link(generated / f"{position * steps + step + 1:08d}.png", output / f"{i + 1:08d}.png")
        shutil.rmtree(batch)
        shutil.rmtree(generated)
    if len(list(output.glob("*.png"))) != len(records):
        raise ValueError("Output timeline is incomplete")
    original_hashes, output_hashes = frame_hashes(inputs), frame_hashes(output)
    if len(original_hashes) != metadata["frames"] or len(output_hashes) != len(records):
        raise ValueError("Decoded RGB verification returned an incomplete sequence")
    copies = 0
    for i, record in enumerate(records):
        if "copy" in record:
            if output_hashes[i] != original_hashes[record["copy"]]:
                raise ValueError(f"Original RGB frame changed at output frame {i}")
            copies += 1
    rate = Fraction(metadata["rate"]) * Fraction(len(records), metadata["frames"])
    video = work / "video.mp4"
    run(["ffmpeg", "-v", "error", "-framerate", str(rate), "-i", output / "%08d.png",
         "-map", "0:v:0", "-frames:v", str(len(records)),
         "-c:v", "libx264", "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p",
         "-enc_time_base", f"{rate.denominator}:{rate.numerator}",
         "-video_track_timescale", str(rate.numerator), video])
    pending = work / "movie.mp4"
    mux_audio(video, source, pending, rate)
    return pending, copies
