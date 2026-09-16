import { describe, expect, it } from 'vitest';
import {
  cameraAxis, PhoneCamera, PHONE_RECENTER_DELAY_MS, roomBenefitsFromZoom, rubberBandZoom, type CameraFrame,
} from '../src/app/phoneZoom.js';

function setup(overrides: Partial<CameraFrame> = {}) {
  const camera = new PhoneCamera();
  let f: CameraFrame = {
    owner: {}, width: 780, height: 300, viewportW: 852, viewportH: 393,
    scale: 1, fishX: 400, fishY: 150, now: 0, ...overrides,
  };
  camera.update(f);
  const tick = (changes: Partial<CameraFrame> = {}, dt = 16) => {
    f = { ...f, now: f.now + dt, ...changes };
    camera.update(f);
  };
  const settle = () => { for (let i = 0; i < 120; i++) tick(); };
  const begin = (x = 0, y = 0) => expect(camera.beginGesture({ ratio: 1, x, y })).toBe(true);
  const zoom = (ratio: number) => {
    begin();
    camera.moveGesture({ ratio, x: 0, y: 0 });
    camera.endGesture();
    settle();
  };
  return { camera, tick, settle, begin, zoom, frame: () => f };
}

describe('phone zoom eligibility', () => {
  it('uses standard cell size, with the confirmed strict 20px threshold', () => {
    expect(roomBenefitsFromZoom(19.99 / 15)).toBe(true);
    expect(roomBenefitsFromZoom(20 / 15)).toBe(false);
    for (const scale of [0, -1, NaN, Infinity]) expect(roomBenefitsFromZoom(scale)).toBe(false);
  });

  it('does not admit gestures in an already-readable room', () => {
    const { camera } = setup({ scale: 2 });
    expect(camera.beginGesture({ ratio: 1, x: 0, y: 0 })).toBe(false);
    camera.moveGesture({ ratio: 3, x: 100, y: 100 });
    expect(camera.inspecting).toBe(false);
    expect(camera.zoom).toBe(1);
  });
});

describe('camera bounds', () => {
  it('resists overshoot at both limits without changing any in-range zoom', () => {
    for (const zoom of [1, 1.375, 2.2, 3]) expect(rubberBandZoom(zoom)).toBe(zoom);
    for (const zoom of [0.001, 0.1, 0.5, 0.99]) {
      expect(rubberBandZoom(zoom)).toBeGreaterThan(0.92);
      expect(rubberBandZoom(zoom)).toBeLessThan(1);
    }
    for (const zoom of [3.01, 3.5, 6, 1000]) {
      expect(rubberBandZoom(zoom)).toBeGreaterThan(3);
      expect(rubberBandZoom(zoom)).toBeLessThan(3.24);
    }
    for (const zoom of [0, -1, NaN, Infinity]) expect(() => rubberBandZoom(zoom)).toThrow('Invalid phone zoom');
  });

  it('centres an interior fish and clamps at either edge', () => {
    expect(cameraAxis(800, 600, 400, 1.5)).toBe(0);
    expect(cameraAxis(800, 600, 300, 1.5)).toBe(150);
    expect(cameraAxis(800, 600, 0, 1.5)).toBe(300);
    expect(cameraAxis(800, 600, 800, 1.5)).toBe(-300);
    expect(cameraAxis(200, 600, 0, 1.5)).toBe(0);
  });

  it('never pans a visible edge past the room, at arbitrary zooms and for exiting fish', () => {
    for (const size of [210, 285, 360, 585, 795]) {
      for (const view of [320, 393, 430, 600, 852, 932]) {
        for (const zoom of [1, 1.137, 1.5, 2.2, 3]) {
          for (const fish of [-100, 0, size / 3, size / 2, size, size + 100]) {
            const shift = cameraAxis(size, view, fish, zoom);
            const left = (view - size * zoom) / 2 + shift;
            if (size * zoom <= view) expect(shift).toBe(0);
            else {
              expect(left).toBeLessThanOrEqual(1e-9);
              expect(left + size * zoom).toBeGreaterThanOrEqual(view - 1e-9);
            }
          }
        }
      }
    }
  });
});

describe('per-room continuous camera', () => {
  it.each([1.375, 2.2, 3])('preserves %sx zoom and framing across repeated Undo rebuilds', (zoom) => {
    const s = setup();
    s.zoom(zoom);
    const position = [s.camera.x, s.camera.y];
    const budget = s.camera.renderZoom;
    const restored = {}, fallback = {};
    s.camera.continueRoom(s.frame().owner, restored);
    s.camera.continueRoom(restored, fallback);
    expect([s.camera.zoom, s.camera.x, s.camera.y]).toEqual([zoom, ...position]);
    s.tick({ owner: fallback, fishX: 450 });
    expect(s.camera.zoom).toBe(zoom);
    expect(s.camera.renderZoom).toBe(budget);
    expect(s.camera.x).toBeLessThan(position[0]!);
    expect(s.camera.x).toBeGreaterThan(cameraAxis(780, 852, 450, zoom));
    s.tick({ owner: {} });
    expect(s.camera.zoom).toBe(1);
  });

  it.each(['gesture', 'return', 'hold'])('preserves Undo zoom and cancels %s inspection state', (state) => {
    const s = setup();
    s.zoom(2.2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 80, y: 0 });
    s.settle();
    const held = s.camera.x;
    if (state !== 'gesture') s.camera.endGesture();
    if (state === 'hold') s.camera.hold();
    const restored = {};
    s.camera.continueRoom(s.frame().owner, restored);
    s.tick({ owner: restored });
    expect(s.camera.zoom).toBe(2.2);
    expect(s.camera.inspecting).toBe(false);
    expect(s.camera.x).toBeLessThan(held);
  });

  it('does not transfer another room or attempt into the current camera', () => {
    const s = setup();
    s.zoom(2.2);
    const restored = {};
    s.camera.continueRoom({}, restored);
    s.tick({ owner: restored });
    expect(s.camera.zoom).toBe(1);
  });

  it('starts every room at 1x, including re-entry and a change during a live gesture', () => {
    const s = setup();
    s.zoom(2.2);
    expect(s.camera.zoom).toBeCloseTo(2.2, 9);
    s.begin();
    s.camera.moveGesture({ ratio: 1.2, x: 80, y: 0 });
    s.tick({ owner: {} });
    expect([s.camera.zoom, s.camera.renderZoom, s.camera.x, s.camera.y]).toEqual([1, 1, 0, 0]);
    expect(s.camera.inspecting).toBe(false);
    s.settle();
    expect(s.camera.zoom).toBe(1);
    s.tick({ owner: {}, scale: 2 });
    s.tick({ owner: {}, scale: 1 });
    s.settle();
    expect(s.camera.zoom).toBe(1);
  });

  it('keeps arbitrary zoom after release and completes even a pinch between frames', () => {
    const s = setup();
    s.zoom(1.375);
    expect(s.camera.zoom).toBeCloseTo(1.375, 9);
    expect(s.camera.renderZoom).toBe(1.5);
    s.zoom(1.6);
    expect(s.camera.zoom).toBeCloseTo(2.2, 9);
    expect(s.camera.renderZoom).toBe(2.5);
    expect(s.camera.inspecting).toBe(false);
    expect(s.camera.moving).toBe(false);
  });

  it('anchors the room under the centroid while pinching and dragging together', () => {
    const s = setup();
    s.zoom(2);
    s.begin(40, 20);
    const roomX = (40 - s.camera.x) / s.camera.zoom;
    const roomY = (20 - s.camera.y) / s.camera.zoom;
    s.camera.moveGesture({ ratio: 1.1, x: 100, y: 35 });
    s.settle();
    expect(s.camera.zoom).toBeCloseTo(2.2, 9);
    expect((100 - s.camera.x) / s.camera.zoom).toBeCloseTo(roomX, 9);
    expect((35 - s.camera.y) / s.camera.zoom).toBeCloseTo(roomY, 9);
  });

  it('holds inspection for 350ms after release, then eases to the current active fish', () => {
    const s = setup();
    s.zoom(2);
    s.begin();
    const before = s.camera.x;
    s.camera.moveGesture({ ratio: 1, x: 80, y: 40 });
    s.settle();
    expect(s.camera.x).toBeCloseTo(before + 80, 9);
    const held = [s.camera.x, s.camera.y];
    s.tick({ fishX: 700, fishY: 260 });
    s.settle();
    expect([s.camera.x, s.camera.y]).toEqual(held);
    s.camera.endGesture();
    expect([s.camera.x, s.camera.y]).toEqual(held);
    s.tick({}, PHONE_RECENTER_DELAY_MS - 1);
    expect([s.camera.x, s.camera.y]).toEqual(held);
    expect(s.camera.moving).toBe(true);
    s.tick({}, 1);
    const f = s.frame();
    const targetX = cameraAxis(f.width, f.viewportW, f.fishX, 2);
    expect(s.camera.x).toBeLessThan(held[0]!);
    expect(s.camera.x).toBeGreaterThan(targetX);
    expect(s.camera.moving).toBe(true);
    s.settle();
    expect(s.camera.x).toBe(targetX);
    expect(s.camera.y).toBe(cameraAxis(f.height, f.viewportH, f.fishY, 2));
    expect(s.camera.zoom).toBe(2);
    expect(s.camera.moving).toBe(false);
  });

  it('stretches at either limit, responds to reversal and settles inside 1x-3x on release', () => {
    const s = setup();
    s.begin();
    s.camera.moveGesture({ ratio: 5, x: 0, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeGreaterThan(3);
    expect(s.camera.zoom).toBeLessThan(3.24);
    expect(s.camera.renderZoom).toBe(3);
    const upper = s.camera.zoom;
    s.camera.moveGesture({ ratio: 4.5, x: 0, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeLessThan(upper);
    s.camera.moveGesture({ ratio: 0.1, x: 0, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeGreaterThan(0.92);
    expect(s.camera.zoom).toBeLessThan(1);
    const lower = s.camera.zoom;
    s.camera.moveGesture({ ratio: 0.11, x: 0, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeGreaterThan(lower);
    s.camera.endGesture();
    s.settle();
    expect(s.camera.zoom).toBe(1);
    s.begin();
    s.camera.moveGesture({ ratio: 6, x: 0, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeGreaterThan(3);
    s.camera.endGesture();
    s.settle();
    expect(s.camera.zoom).toBe(3);
  });

  it('times the pause from the actual release and lets a new gesture cancel the pending return', () => {
    const s = setup();
    s.zoom(2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 80, y: 0 });
    s.settle();
    const held = s.camera.x;
    s.camera.endGesture(s.frame().now + 100);
    s.tick({}, PHONE_RECENTER_DELAY_MS);
    expect(s.camera.x).toBe(held);
    s.begin();
    s.settle();
    expect(s.camera.x).toBe(held);
    s.camera.endGesture();
    expect(s.camera.cancelGesture()).toBe(true);
    s.tick();
    expect(s.camera.x).toBeLessThan(held);
  });

  it('does not carry a delayed return across a room or orientation change', () => {
    const s = setup();
    s.zoom(2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 80, y: 0 });
    s.settle();
    s.camera.endGesture();
    s.tick({ owner: {} });
    s.settle();
    expect([s.camera.zoom, s.camera.x, s.camera.y]).toEqual([1, 0, 0]);
    s.zoom(2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 80, y: 0 });
    s.settle();
    s.camera.endGesture();
    s.tick({ viewportW: 393, viewportH: 852 });
    s.settle();
    expect(s.camera.x).toBe(cameraAxis(780, 393, 400, 2));
    expect(s.camera.zoom).toBe(2);
  });

  it.each([0.25, 6])('can re-grab an elastic view (%sx raw) without a jump or oversized buffer', (ratio) => {
    const s = setup();
    s.begin();
    s.camera.moveGesture({ ratio, x: 10, y: 0 });
    s.settle();
    s.camera.endGesture();
    const before = s.camera.zoom;
    const position = [s.camera.x, s.camera.y];
    s.begin();
    s.tick();
    expect(s.camera.zoom).toBeCloseTo(before, 9);
    expect([s.camera.x, s.camera.y]).toEqual(position);
    s.camera.moveGesture({ ratio: 1.2, x: 20, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBeLessThanOrEqual(3.24);
    expect(s.camera.zoom).toBeGreaterThan(0.92);
    expect(s.camera.renderZoom).toBeLessThanOrEqual(3);
  });

  it('ignores fish movement during the release pause even while elastic zoom is settling', () => {
    const a = setup(), b = setup();
    for (const s of [a, b]) {
      s.zoom(2);
      s.begin(80, 30);
      s.camera.moveGesture({ ratio: 3, x: 120, y: 40 });
      s.settle();
      s.camera.endGesture();
    }
    for (let elapsed = 16; elapsed < PHONE_RECENTER_DELAY_MS; elapsed += 16) {
      a.tick();
      b.tick({ fishX: 50, fishY: 25 });
      expect([a.camera.zoom, a.camera.x, a.camera.y]).toEqual([b.camera.zoom, b.camera.x, b.camera.y]);
    }
    a.tick();
    b.tick();
    expect(a.camera.x).not.toBe(b.camera.x);
  });

  it('cancels the pending return during an asset hold without discarding the selected zoom', () => {
    const s = setup();
    s.zoom(2.2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 80, y: 0 });
    s.settle();
    const held = s.camera.x;
    s.camera.endGesture();
    s.camera.hold();
    expect(s.camera.moving).toBe(false);
    s.tick();
    expect(s.camera.x).toBeLessThan(held);
    expect(s.camera.zoom).toBe(2.2);
  });

  it('batches separate finger events so a pan at maximum zoom does not zoom out', () => {
    const s = setup();
    s.zoom(3);
    s.begin();
    const before = s.camera.x;
    s.camera.moveGesture({ ratio: 1.2, x: 20, y: 0 });
    s.camera.moveGesture({ ratio: 1, x: 40, y: 0 });
    s.settle();
    expect(s.camera.zoom).toBe(3);
    expect(s.camera.x).toBeCloseTo(before + 40, 9);
  });

  it('rebases a clamped pan so a small reversal is not swallowed by overshoot', () => {
    const s = setup();
    s.zoom(2);
    s.begin();
    s.camera.moveGesture({ ratio: 1, x: 10000, y: 0 });
    s.settle();
    const edge = s.camera.x;
    s.camera.moveGesture({ ratio: 1, x: 9990, y: 0 });
    s.settle();
    expect(s.camera.x).toBeCloseTo(edge - 10, 9);
  });

  it('uses bounded backing-store buckets rather than reallocating for every zoom sample', () => {
    const s = setup();
    s.begin();
    const buckets = new Set<number>([s.camera.renderZoom]);
    for (let ratio = 1.01; ratio < 3; ratio += 0.01) {
      s.camera.moveGesture({ ratio, x: 0, y: 0 });
      s.tick();
      buckets.add(s.camera.renderZoom);
    }
    expect([...buckets]).toEqual([1, 1.5, 2, 2.5, 3]);
    s.camera.moveGesture({ ratio: 1.2, x: 0, y: 0 });
    s.settle();
    expect(s.camera.renderZoom).toBe(3);
    s.camera.endGesture();
    s.settle();
    expect(s.camera.renderZoom).toBe(1.5);
  });

  it('clamps every intermediate frame while pinching, panning, rotating and returning', () => {
    const s = setup();
    s.begin();
    for (let i = 0; i < 180; i++) {
      if (i < 100) s.camera.moveGesture({ ratio: 1 + i / 40, x: 1200 * Math.sin(i / 10), y: 700 * Math.cos(i / 10) });
      if (i === 100) s.camera.endGesture();
      s.tick(i === 80 ? { viewportW: 393, viewportH: 852 } : {});
      const f = s.frame();
      expect(Math.abs(s.camera.x)).toBeLessThanOrEqual(Math.max(0, (f.width * s.camera.zoom - f.viewportW) / 2) + 1e-9);
      expect(Math.abs(s.camera.y)).toBeLessThanOrEqual(Math.max(0, (f.height * s.camera.zoom - f.viewportH) / 2) + 1e-9);
    }
  });

  it('keeps same-room zoom through asset holds/help, but never restores it in a different room', () => {
    const s = setup();
    s.zoom(2.2);
    s.begin();
    s.camera.hold();
    expect(s.camera.inspecting).toBe(false);
    expect(s.camera.beginGesture({ ratio: 1, x: 0, y: 0 })).toBe(false);
    expect(s.camera.zoom).toBeCloseTo(2.2, 9);
    s.tick();
    s.camera.suspend();
    expect(s.camera.zoom).toBe(1);
    s.tick();
    expect(s.camera.zoom).toBeCloseTo(2.2, 9);
    s.camera.suspend();
    s.tick({ owner: {} });
    expect(s.camera.zoom).toBe(1);
  });

  it('returns to full view if rotation makes zoom ineligible, without later auto-zoom', () => {
    const s = setup();
    s.zoom(2.2);
    s.tick({ scale: 2 });
    s.settle();
    expect(s.camera.zoom).toBe(1);
    s.tick({ scale: 1 });
    s.settle();
    expect(s.camera.zoom).toBe(1);
  });

  it('still animates both directions after a stalled frame instead of jumping to the target', () => {
    const s = setup();
    for (const ratio of [2, 0.25]) {
      const before = s.camera.zoom;
      s.begin();
      s.camera.moveGesture({ ratio, x: 0, y: 0 });
      s.camera.endGesture();
      s.tick({}, 1000);
      expect(s.camera.zoom).toBeGreaterThan(1);
      expect(s.camera.zoom).toBeLessThan(2);
      expect(s.camera.zoom).not.toBe(before);
      expect(s.camera.moving).toBe(true);
      s.settle();
    }
    expect(s.camera.zoom).toBe(1);
  });

  it('rejects invalid gesture geometry rather than poisoning the transform', () => {
    const s = setup();
    for (const sample of [{ ratio: 0, x: 0, y: 0 }, { ratio: Infinity, x: 0, y: 0 }, { ratio: 1, x: NaN, y: 0 }]) {
      expect(() => s.camera.beginGesture(sample)).toThrow('Invalid phone camera gesture');
    }
  });
});
