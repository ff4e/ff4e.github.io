from fractions import Fraction
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

from movie_pipeline.media import audio_hash, mux_audio, verify_output, video_info


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "FFmpeg/ffprobe required")
class MovieCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="ff-movie-test-")
        cls.root = Path(cls.temporary.name)
        cls.source = cls.root / "source.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=64x48:rate=15",
            "-f", "lavfi", "-i", "sine=sample_rate=22050", "-t", "0.4",
            "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(cls.source),
        ], check=True)
        cls.script = Path(__file__).resolve().parents[1] / "interpolate-movie.py"
        cls.model = cls.root / "rife-v4.6"
        cls.model.mkdir()
        for name in ["flownet.bin", "flownet.param"]:
            (cls.model / name).write_bytes(b"fixture")
        cls.backend = cls.root / "unavailable-backend"
        cls.backend.write_bytes(b"not an executable")

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def command(self, *extra):
        return [sys.executable, str(self.script), "--kind", "logo", "--input", str(self.source),
                "--base", str(self.source), "--output", str(self.root / "output.mp4"),
                "--report", str(self.root / "report.json"), "--rife", str(self.backend),
                "--model", str(self.model), *extra]

    def test_source_metadata_and_audio_are_checked(self):
        info = video_info(self.source)
        self.assertEqual(Fraction(info["rate"]), 15)
        self.assertEqual((info["width"], info["height"]), (64, 48))
        self.assertEqual(len(audio_hash(self.source)), 64)
        with self.assertRaisesRegex(ValueError, "Output frames"):
            verify_output(self.source, info, 4, audio_hash(self.source))

    def test_analysis_does_not_touch_outputs(self):
        result = subprocess.run(self.command("--analyze-only"), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("6 input frames -> 6 anchors -> 24 output frames", result.stdout)

    def test_in_place_input_is_rejected(self):
        before = self.source.read_bytes()
        result = subprocess.run(self.command("--output", str(self.source)), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must not overwrite", result.stderr)
        self.assertEqual(self.source.read_bytes(), before)

    def test_failed_backend_leaves_previous_movie_and_report_intact(self):
        output, report = self.root / "output.mp4", self.root / "report.json"
        output.write_bytes(b"previous movie")
        report.write_bytes(b"previous report")
        result = subprocess.run(self.command(), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(output.read_bytes(), b"previous movie")
        self.assertEqual(report.read_bytes(), b"previous report")

    def test_wrong_cadence_is_rejected(self):
        result = subprocess.run(self.command("--kind", "intro"), capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("~30 fps input", result.stderr)

    def test_logo_final_partial_aac_packet_survives_video_boundary(self):
        logo = Path(__file__).resolve().parents[2] / "public/data/Movie/logo.mp4"
        source = video_info(logo)
        rate = Fraction(source["rate"]) * 4
        video, output = self.root / "silent-logo.mp4", self.root / "muxed-logo.mp4"
        subprocess.run([
            "ffmpeg", "-v", "error", "-f", "lavfi", "-i", f"color=size=64x48:rate={rate}",
            "-frames:v", str(source["frames"] * 4), "-c:v", "libx264", "-preset", "ultrafast",
            "-enc_time_base", f"{rate.denominator}:{rate.numerator}",
            "-video_track_timescale", str(rate.numerator), str(video),
        ], check=True)
        mux_audio(video, logo, output, rate)
        actual = video_info(output)
        self.assertEqual(actual["audio_duration"], source["audio_duration"])
        self.assertEqual(audio_hash(output), audio_hash(logo))
