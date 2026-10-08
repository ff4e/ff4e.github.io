"""Recover held motion without assuming that the intro has one effective FPS."""
from bisect import bisect_right
from collections import OrderedDict
from fractions import Fraction

import cv2
import numpy as np

ALGORITHM = "motion-progress-v1"


class MotionProbe:
    def __init__(self, frames):
        self.frames = frames
        cv2.setNumThreads(2)
        self.engine = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.cache = OrderedDict()
        self.y, self.x = np.mgrid[:frames.shape[1], :frames.shape[2]].astype(np.float32)

    def flow(self, a, b):
        key = (a, b)
        if key not in self.cache:
            self.cache[key] = self.engine.calc(self.frames[a], self.frames[b], None)
            if len(self.cache) > 12:
                self.cache.popitem(last=False)
        return self.cache[key]

    def progress(self, a, b, c):
        full = self.flow(a, c)
        partial = self.flow(a, b)
        amplitude = np.linalg.norm(full, axis=2)
        mask = amplitude > max(0.25, float(np.percentile(amplitude, 60)))
        if np.count_nonzero(mask) < 64:
            return None
        phase = np.sum(partial * full, axis=2) / (amplitude * amplitude + 1e-5)
        measured = phase[mask]
        return {
            "phase": float(np.median(measured)),
            "held_support": float(np.mean(np.abs(measured) < 0.20)),
        }

    def is_cut(self, a, b):
        before, after = self.frames[a], self.frames[b]
        raw_difference = float(np.abs(before.astype(np.float32) - after).mean())
        if raw_difference < 20:
            return False
        field = self.flow(a, b)
        warped = cv2.remap(after, self.x + field[:, :, 0], self.y + field[:, :, 1],
                           cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
        residual = float(np.abs(before.astype(np.float32) - warped).mean())
        ha = np.histogram(before, bins=32, range=(0, 256))[0].astype(np.float32)
        hb = np.histogram(after, bins=32, range=(0, 256))[0].astype(np.float32)
        histogram_difference = float(np.abs(ha / ha.sum() - hb / hb.sum()).sum() / 2)
        if not (residual > 24 and residual / raw_difference > 0.75 and histogram_difference > 0.35):
            return False
        # A lighting change is not a cut: retain interpolation when scene features track.
        features = cv2.goodFeaturesToTrack(before, 200, 0.01, 5)
        if features is not None and len(features) >= 10:
            moved, forward_status, _ = cv2.calcOpticalFlowPyrLK(before, after, features, None)
            back, backward_status, _ = cv2.calcOpticalFlowPyrLK(after, before, moved, None)
            cycle = np.linalg.norm(back - features, axis=2).ravel()
            reliable = (forward_status.ravel() != 0) & (backward_status.ravel() != 0) & (cycle < 1)
            matches = 0
            for old_point, new_point, valid in zip(features[:, 0], moved[:, 0], reliable):
                if not valid:
                    continue
                p = cv2.getRectSubPix(before, (9, 9), tuple(old_point)).astype(np.float32)
                q = cv2.getRectSubPix(after, (9, 9), tuple(new_point)).astype(np.float32)
                p -= p.mean()
                q -= q.mean()
                denominator = float(np.linalg.norm(p) * np.linalg.norm(q))
                if denominator > 1 and float(np.sum(p * q)) / denominator > 0.65:
                    matches += 1
            if matches / len(features) > 0.20:
                return False
        return True


def held_progress(value):
    return value is not None and abs(value["phase"]) < 0.12 and value["held_support"] >= 0.70


def motion_plan(frames):
    if frames.ndim != 3 or len(frames) < 2 or frames.dtype != np.uint8:
        raise ValueError("Expected at least two grayscale uint8 frames")
    probe = MotionProbe(frames)
    cuts = {i for i in range(1, len(frames)) if probe.is_cut(i - 1, i)}
    removed = set()
    left = 0
    while left < len(frames) - 2:
        if left and float(np.percentile(np.linalg.norm(probe.flow(left - 1, left), axis=2), 90)) < 0.1:
            left += 1
            continue
        chosen = None
        # Recover short repeated-frame bursts, but do not smooth an arbitrarily long pause.
        gaps = [3, 2]
        if left + 3 < len(frames) and float(np.percentile(
                np.linalg.norm(probe.flow(left, left + 3), axis=2), 90)) < 0.1:
            gaps.extend(range(4, 9))
        for gap in gaps:
            right = left + gap
            if right >= len(frames) or any(i in cuts for i in range(left + 1, right + 1)):
                continue
            evidence = [probe.progress(left, middle, right) for middle in range(left + 1, right)]
            if all(held_progress(value) for value in evidence):
                chosen = right
                break
        if chosen is not None:
            removed.update(range(left + 1, chosen))
            left = chosen
        else:
            left += 1
    return {"anchors": [i for i in range(len(frames)) if i not in removed], "cuts": sorted(cuts)}


def timeline(plan, frames, multiplier):
    anchors, cuts = plan["anchors"], set(plan["cuts"])
    if (frames < 2 or multiplier < 1 or not anchors or anchors[0] != 0
            or anchors[-1] != frames - 1 or anchors != sorted(set(anchors))
            or any(i < 1 or i >= frames for i in cuts)):
        raise ValueError("Invalid movie timeline")
    records = []
    for i in range(frames * multiplier):
        time = Fraction(i, multiplier)
        left_index = bisect_right(anchors, time) - 1
        left = anchors[left_index]
        if time == left or left_index == len(anchors) - 1:
            records.append({"copy": left})
            continue
        right = anchors[left_index + 1]
        if any(j in cuts for j in range(left + 1, right + 1)):
            records.append({"copy": int(time)})
        else:
            records.append({"left": left, "right": right,
                            "step": int((time - left) * multiplier), "steps": (right - left) * multiplier})
    return records
