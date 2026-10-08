"""Explicit media validation shared by the offline movie builder."""
from fractions import Fraction
import hashlib
import json
import subprocess

import numpy as np


def run(command, capture=False):
    result = subprocess.run([str(part) for part in command], check=True,
                            stdout=subprocess.PIPE if capture else None)
    return result.stdout if capture else None


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def probe(path):
    return json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format",
                           "-of", "json", path], capture=True))


def video_info(path):
    metadata = probe(path)
    videos = [s for s in metadata["streams"] if s["codec_type"] == "video"]
    audios = [s for s in metadata["streams"] if s["codec_type"] == "audio"]
    if len(videos) != 1 or len(audios) != 1:
        raise ValueError(f"Expected one video and one audio stream: {path.name}")
    video, audio = videos[0], audios[0]
    rate = Fraction(video["avg_frame_rate"])
    frames = int(video["nb_frames"])
    if rate <= 0 or rate != Fraction(video["r_frame_rate"]) or frames < 2:
        raise ValueError(f"Expected a positive constant-rate frame sequence: {path.name}")
    if abs(float(video["duration"]) - frames / float(rate)) > 0.000002:
        raise ValueError(f"Video duration does not match its frame count/rate: {path.name}")
    return {
        "frames": frames, "rate": str(rate), "duration": float(video["duration"]),
        "width": int(video["width"]), "height": int(video["height"]),
        "audio_duration": float(audio["duration"]),
        "video_codec": video["codec_name"], "pixel_format": video["pix_fmt"],
        "audio_codec": audio["codec_name"],
    }


def audio_hash(path):
    return run(["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-c", "copy",
                "-f", "hash", "-hash", "sha256", "-"], capture=True).decode().strip().removeprefix("SHA256=")


def decode_analysis(path, frames):
    raw = run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=320:240,format=gray",
               "-fps_mode", "passthrough", "-f", "rawvideo", "-"], capture=True)
    if len(raw) != frames * 320 * 240:
        raise ValueError("Decoded analysis frame count differs from source metadata")
    return np.frombuffer(raw, dtype=np.uint8).reshape(frames, 240, 320).copy()


def frame_hashes(folder):
    text = run(["ffmpeg", "-v", "error", "-i", folder / "%08d.png", "-pix_fmt", "rgb24",
                "-f", "framemd5", "-"], capture=True).decode()
    return [line.rsplit(",", 1)[1].strip() for line in text.splitlines() if not line.startswith("#")]


def mux_audio(video, source, output, rate):
    # A video frame limit on the encode can drop the source's final partial AAC packet.
    # Mux after the video is complete, with no frame limit or -shortest.
    run(["ffmpeg", "-v", "error", "-i", video, "-i", source,
         "-map", "0:v:0", "-map", "1:a:0", "-c", "copy",
         "-video_track_timescale", str(Fraction(rate).numerator),
         "-movflags", "+faststart", output])


def verify_output(path, source, multiplier, source_audio_hash):
    output = video_info(path)
    expected_rate = Fraction(source["rate"]) * multiplier
    expected = {
        "frames": source["frames"] * multiplier, "rate": str(expected_rate),
        "width": source["width"], "height": source["height"],
        "video_codec": "h264", "pixel_format": "yuv420p", "audio_codec": source["audio_codec"],
    }
    for key, value in expected.items():
        if output[key] != value:
            raise ValueError(f"Output {key}: expected {value}, got {output[key]}")
    if abs(output["duration"] - source["duration"]) > 0.000002:
        raise ValueError("Output duration changed")
    if abs(output["audio_duration"] - source["audio_duration"]) > 0.000002:
        raise ValueError("Output audio duration changed")
    if audio_hash(path) != source_audio_hash:
        raise ValueError("Output audio packets changed")
    run(["ffmpeg", "-v", "error", "-xerror", "-i", path, "-f", "null", "-"])
    return output
