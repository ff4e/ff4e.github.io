import unittest

import cv2
import numpy as np

from movie_pipeline.cadence import MotionProbe, held_progress, motion_plan, timeline


class CadenceTests(unittest.TestCase):
    @staticmethod
    def texture(shift):
        rng = np.random.default_rng(42)
        image = cv2.GaussianBlur(rng.integers(0, 256, (120, 160), dtype=np.uint8), (5, 5), 0)
        return cv2.warpAffine(image, np.float32([[1, 0, shift], [0, 1, 0]]),
                              (160, 120), borderMode=cv2.BORDER_REFLECT)

    def test_exact_and_noisy_holds_are_recovered(self):
        a, b, c = [self.texture(x) for x in [0, 4, 8]]
        rng = np.random.default_rng(3)
        noisy = np.clip(b.astype(np.int16) + rng.integers(-2, 3, b.shape), 0, 255).astype(np.uint8)
        plan = motion_plan(np.stack([a, a, b, noisy, c]))
        self.assertEqual(plan["anchors"], [0, 2, 4])

    def test_uniform_slow_motion_is_not_removed(self):
        self.assertEqual(motion_plan(np.stack([self.texture(i) for i in range(6)]))["anchors"], list(range(6)))

    def test_long_static_pause_is_preserved(self):
        frames = np.stack([self.texture(0)] * 10 + [self.texture(4)])
        self.assertEqual(motion_plan(frames)["anchors"], list(range(11)))

    def test_short_drop_burst_is_recovered(self):
        frames = np.stack([self.texture(0)] * 5 + [self.texture(4)])
        plan = motion_plan(frames)
        self.assertEqual(plan["anchors"], [0, 5])
        self.assertEqual(len(timeline(plan, 6, 2)), 12)

    def test_uncertain_and_real_intermediate_motion_are_not_repeats(self):
        self.assertFalse(held_progress(None))
        self.assertFalse(held_progress({"phase": 0.5, "held_support": 0.1}))
        self.assertFalse(held_progress({"phase": 0.02, "held_support": 0.4}))

    def test_lighting_change_is_not_a_cut(self):
        image = self.texture(0)
        brighter = np.clip(image.astype(np.int16) + 40, 0, 255).astype(np.uint8)
        self.assertFalse(MotionProbe(np.stack([image, brighter])).is_cut(0, 1))

    def test_discontinuous_scenes_are_cut(self):
        frames = np.stack([np.zeros((120, 160), np.uint8), np.full((120, 160), 255, np.uint8)])
        self.assertTrue(MotionProbe(frames).is_cut(0, 1))

    def test_cuts_and_terminal_frame_are_held_without_retiming(self):
        plan = {"anchors": [0, 1, 2], "cuts": [2]}
        self.assertEqual(timeline(plan, 3, 2)[3:], [{"copy": 1}, {"copy": 2}, {"copy": 2}])

    def test_logo_keeps_every_anchor_and_generates_quarter_steps(self):
        records = timeline({"anchors": [0, 1, 2], "cuts": []}, 3, 4)
        self.assertEqual(len(records), 12)
        self.assertEqual(records[0], {"copy": 0})
        self.assertEqual(records[4], {"copy": 1})
        self.assertEqual([r["step"] for r in records[1:4]], [1, 2, 3])
        self.assertEqual(records[8:], [{"copy": 2}] * 4)

    def test_skipped_input_is_not_an_inference_endpoint(self):
        records = timeline({"anchors": [0, 3, 4], "cuts": []}, 5, 2)
        self.assertEqual([r["step"] for r in records[1:6]], [1, 2, 3, 4, 5])
        self.assertEqual(records[6], {"copy": 3})
        for record in records:
            self.assertNotIn(record.get("copy"), [1, 2])
            self.assertNotIn(record.get("left"), [1, 2])
            self.assertNotIn(record.get("right"), [1, 2])

    def test_invalid_timeline_is_rejected(self):
        for anchors in [[], [1, 2], [0, 2, 1, 2], [0, 0, 2]]:
            with self.assertRaises(ValueError):
                timeline({"anchors": anchors, "cuts": []}, 3, 2)
