import { describe, expect, it } from 'vitest';
import { compositeClip, glPlacement, phoneCropFor } from '../src/app/phoneGlCrop.js';
import { cameraAxis } from '../src/app/phoneZoom.js';

const bucketOf = (zoom: number) => Math.min(3, Math.ceil(zoom * 2) / 2);

describe('phone GL crop', () => {
  it('presents the whole room when not magnified, or below the held bucket', () => {
    expect(phoneCropFor(780, 300, 852, 393, 1, 1, 0, 0)).toBeNull();
    // A zoom-out settling under a 3x high-water bucket.
    expect(phoneCropFor(780, 300, 852, 393, 2.2, 3, 0, 0)).toBeNull();
    expect(phoneCropFor(780, 300, 852, 393, NaN, 3, 0, 0)).toBeNull();
    // A room that already fits the viewport at this bucket's lowest zoom.
    expect(phoneCropFor(300, 150, 852, 393, 1.4, 1.5, 0, 0)).toBeNull();
  });

  it('always covers what the camera shows, and keeps one size per bucket', () => {
    for (const [w, h] of [[780, 300], [585, 435], [795, 210], [360, 285]] as const) {
      for (const [vw, vh] of [[852, 393], [393, 852], [932, 430]] as const) {
        const sizes = new Map<number, string>();
        for (let zoom = 1.01; zoom <= 3.2; zoom += 0.07) {
          const rz = bucketOf(zoom);
          for (const fx of [0, w / 4, w / 2, w, w + 50]) {
            for (const fy of [0, h / 3, h]) {
              const cx = cameraAxis(w, vw, fx, zoom);
              const cy = cameraAxis(h, vh, fy, zoom);
              const c = phoneCropFor(w, h, vw, vh, zoom, rz, cx, cy);
              if (!c) {
                expect(Math.min(w, vw / (rz - 0.5)) >= w && Math.min(h, vh / (rz - 0.5)) >= h).toBe(true);
                continue;
              }
              const key = `${c.w}x${c.h}`;
              expect(sizes.get(rz) ?? key).toBe(key);
              sizes.set(rz, key);
              expect(c.x).toBeGreaterThanOrEqual(0);
              expect(c.y).toBeGreaterThanOrEqual(0);
              expect(c.x + c.w).toBeLessThanOrEqual(w + 1e-9);
              expect(c.y + c.h).toBeLessThanOrEqual(h + 1e-9);
              // The room span under the viewport, clipped to the room.
              const left = Math.max(0, w / 2 + (-vw / 2 - cx) / zoom);
              const right = Math.min(w, w / 2 + (vw / 2 - cx) / zoom);
              const top = Math.max(0, h / 2 + (-vh / 2 - cy) / zoom);
              const bottom = Math.min(h, h / 2 + (vh / 2 - cy) / zoom);
              expect(c.x).toBeLessThanOrEqual(left + 1e-9);
              expect(c.x + c.w).toBeGreaterThanOrEqual(right - 1e-9);
              expect(c.y).toBeLessThanOrEqual(top + 1e-9);
              expect(c.y + c.h).toBeGreaterThanOrEqual(bottom - 1e-9);
            }
          }
        }
      }
    }
  });

  it('is far smaller than the full present at high zoom', () => {
    // The measured case: room 7 at 3x on an 852x393 @3x viewport presented 17.0 MP.
    const c = phoneCropFor(852, 245.67, 852, 393, 3, 3, 0, 0)!;
    const full = glPlacement(852, 245.67, 9, null);
    const p = glPlacement(852, 245.67, 9, c);
    expect(full.w * full.h / 1e6).toBeCloseTo(17.0, 0);
    expect(p.w * p.h).toBeLessThan(full.w * full.h / 2.5);
  });

  it('places the crop on whole pixels of the full present, or the full canvas without one', () => {
    expect(glPlacement(780, 300, 3, null)).toEqual({ fullW: 2340, fullH: 900, x: 0, y: 0, w: 2340, h: 900 });
    expect(glPlacement(780.4, 300.2, 4.5, null)).toEqual({
      fullW: Math.round(780.4 * 4.5), fullH: Math.round(300.2 * 4.5), x: 0, y: 0,
      w: Math.round(780.4 * 4.5), h: Math.round(300.2 * 4.5),
    });
    for (const s of [3, 4.5, 6, 7.5, 9]) {
      for (const crop of [
        { x: 0, y: 0, w: 340.8, h: 157.2 }, { x: 439.2, y: 142.8, w: 340.8, h: 157.2 },
        { x: 123.456, y: 17.891, w: 340.8, h: 157.2 }, { x: 0, y: 0, w: 780, h: 300 },
      ]) {
        const p = glPlacement(780, 300, s, crop);
        for (const v of [p.x, p.y, p.w, p.h]) expect(Number.isInteger(v)).toBe(true);
        expect(p.x + p.w).toBeLessThanOrEqual(p.fullW);
        expect(p.y + p.h).toBeLessThanOrEqual(p.fullH);
        expect(p.w).toBeGreaterThanOrEqual(Math.min(p.fullW, crop.w * s));
        expect(Math.abs(p.x - crop.x * s)).toBeLessThanOrEqual(1);
      }
    }
  });

  // The texel columns PRESENT_FS (glRoomAi.ts) can read for destination column `i` of a
  // `full`-px present of a `buf`-px buffer: its box taps, each a LINEAR (2-texel) fetch.
  const readSpan = (i: number, buf: number, full: number, taps: number): [number, number] => {
    const r = buf / full;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < taps; k++) {
      const t = (i + 0.5) * r + ((k + 0.5) / taps - 0.5) * r;
      lo = Math.min(lo, Math.max(0, Math.floor(t - 0.5)));
      hi = Math.max(hi, Math.min(buf - 1, Math.floor(t - 0.5) + 1));
    }
    return [lo, hi];
  };

  it('composites every buffer pixel a cropped present can read, and leaves most of it out', () => {
    // Rooms 7 and 5 at x4, and a room drawn smaller than its art.
    for (const [cssW, cssH, bufW, bufH] of [[852, 245.77, 3120, 900], [524, 393, 2400, 1800], [360, 285, 1440, 1140]] as const) {
      for (const dpr of [2, 3]) {
        for (const zoom of [1.6, 2.2, 2.5, 3]) {
          const rz = bucketOf(zoom);
          const s = dpr * rz;
          for (const [cx, cy] of [[0, 0], [-1e4, -1e4], [1e4, 1e4], [137.3, -41.9]]) {
            const crop = phoneCropFor(cssW, cssH, 852, 393, zoom, rz, cx, cy);
            if (!crop) continue;
            const p = glPlacement(cssW, cssH, s, crop);
            const clip = compositeClip(p, bufW, bufH)!;
            expect(clip.x).toBeGreaterThanOrEqual(0);
            expect(clip.y).toBeGreaterThanOrEqual(0);
            expect(clip.x + clip.w).toBeLessThanOrEqual(bufW);
            expect(clip.y + clip.h).toBeLessThanOrEqual(bufH);
            const taps = Math.min(4, Math.max(1, Math.ceil(Math.max(bufW / p.fullW, bufH / p.fullH))));
            const [l] = readSpan(p.x, bufW, p.fullW, taps);
            const [, r] = readSpan(p.x + p.w - 1, bufW, p.fullW, taps);
            const [t] = readSpan(p.y, bufH, p.fullH, taps);
            const [, b] = readSpan(p.y + p.h - 1, bufH, p.fullH, taps);
            expect(clip.x).toBeLessThanOrEqual(l);
            expect(clip.x + clip.w - 1).toBeGreaterThanOrEqual(r);
            expect(clip.y).toBeLessThanOrEqual(t);
            expect(clip.y + clip.h - 1).toBeGreaterThanOrEqual(b);
          }
        }
      }
    }
  });

  it('leaves most of the composite out in the measured rooms', () => {
    // Rooms 7 and 5 at x4 on an 852x393 @3x phone. The crop is sized for the bucket's
    // lowest zoom, so it keeps ~41% of the room at 2.2x and ~26% at 3x.
    for (const [cssW, cssH, bufW, bufH] of [[852, 245.77, 3120, 900], [524, 393, 2400, 1800]] as const) {
      for (const [zoom, most] of [[2.2, 0.45], [3, 0.3]] as const) {
        const rz = bucketOf(zoom);
        const p = glPlacement(cssW, cssH, 3 * rz, phoneCropFor(cssW, cssH, 852, 393, zoom, rz, 0, 0));
        const clip = compositeClip(p, bufW, bufH)!;
        expect(clip.w * clip.h / (bufW * bufH)).toBeLessThan(most);
      }
    }
  });

  it('composites the whole buffer for an uncropped present', () => {
    expect(compositeClip(glPlacement(852, 245.77, 7.5, null), 3120, 900)).toBeNull();
  });
});
