/**
 * The Siri Remote's swipes (`native/js/remoteSwipe.ts`), from the thumb's position on the
 * touch surface as tvOS reports it with absolute d-pad values: a swipe is travel, never
 * where the thumb happens to rest, and a click at the end of a swipe toward its edge is that
 * swipe's end. Synthetic sequences, one sample a frame (~16 ms), x right and y down in -1..1.
 */
import { describe, expect, it } from 'vitest';
import { LIFTED, STEP, SWIPE_CLICK_MS, SwipeHold, SwipeTracker, TAP_SLOP, type SwipeDir } from '../native/js/remoteSwipe.js';

type Sample = readonly [number, number] | null;

/** Feed `samples` a frame apart from `t0`; every step made, and the time after the last. */
function play(tr: SwipeTracker, samples: readonly Sample[], t0 = 0): { steps: SwipeDir[]; t: number } {
  const steps: SwipeDir[] = [];
  let t = t0;
  for (const s of samples) {
    steps.push(...tr.feed(s, t));
    t += 16;
  }
  return { steps, t };
}

/** `n` samples from `a` to `b`, evenly. */
const line = (a: readonly [number, number], b: readonly [number, number], n: number): Sample[] =>
  Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / (n - 1), a[1] + ((b[1] - a[1]) * i) / (n - 1)] as const);

/** A thumb resting at `p` with a little jitter, `n` frames. */
const rest = (p: readonly [number, number], n: number): Sample[] =>
  Array.from({ length: n }, (_, i) => [p[0] + (i % 2 ? 0.02 : -0.02), p[1] + (i % 3 ? 0.015 : -0.015)] as const);

describe('remote swipes', () => {
  it('a tap in the centre is no swipe, and its click is a click', () => {
    const tr = new SwipeTracker();
    const { steps, t } = play(tr, [...rest([0.04, -0.03], 12), null]);
    expect(steps).toEqual([]);
    expect(tr.endsSwipe(null, t)).toBe(false);
  });

  it('a thumb landing and resting on an edge is no swipe, and its edge click is a click', () => {
    const tr = new SwipeTracker();
    const { steps, t } = play(tr, rest([0.92, 0.05], 20));
    expect(steps).toEqual([]);
    expect(tr.endsSwipe('right', t)).toBe(false);
  });

  it('a slow swipe past one step is one step', () => {
    const tr = new SwipeTracker();
    expect(play(tr, [...line([-0.3, 0.1], [0.45, 0.16], 40), null]).steps).toEqual(['right']);
  });

  it('a fast swipe takes the steps it covered, even in one frame', () => {
    const tr = new SwipeTracker();
    expect(play(tr, [[-0.85, 0], [0.1, 0.05], [0.9, 0.08], null]).steps).toEqual(['right', 'right', 'right']);
  });

  it('a long swipe keeps stepping as it goes, like a list scrolling under it', () => {
    const tr = new SwipeTracker();
    const out: SwipeDir[][] = [];
    let t = 0;
    for (const s of line([0, -0.9], [0, 0.9], 30)) {
      out.push(tr.feed(s, t));
      t += 16;
    }
    expect(out.flat()).toEqual(['down', 'down', 'down']);
    // ...one at a time, spread along the travel rather than all at the end.
    expect(out.findIndex((s) => s.length > 0)).toBeLessThan(out.length / 2);
  });

  it('steps go by the dominant axis; a slant below a step in either is nothing', () => {
    const tr = new SwipeTracker();
    expect(play(tr, line([0, 0], [STEP * 0.9, STEP * 0.8], 10)).steps).toEqual([]);
    const tr2 = new SwipeTracker();
    expect(play(tr2, line([0.2, 0.3], [-0.5, -0.1], 10)).steps).toEqual(['left']);
  });

  it('a swipe that ends near an edge does not also click there', () => {
    const tr = new SwipeTracker();
    const { steps, t } = play(tr, line([0, 0.3], [0.02, 0.92], 12));
    expect(steps).toEqual(['down']);
    // The thumb, at the edge, presses the ring: the end of that swipe, not one more step...
    expect(tr.endsSwipe('down', t)).toBe(true);
    // ...but the centre, another edge, or the same edge a moment later is a click.
    expect(tr.endsSwipe(null, t)).toBe(false);
    expect(tr.endsSwipe('left', t)).toBe(false);
    expect(tr.endsSwipe('down', t + SWIPE_CLICK_MS + 1)).toBe(false);
  });

  it('travel while a click is held counts for nothing, and starts again from the release', () => {
    const tr = new SwipeTracker();
    play(tr, rest([0, 0.1], 3));
    tr.press(true);
    expect(play(tr, line([0, 0.1], [0.9, 0.1], 6), 100).steps).toEqual([]);
    tr.press(false);
    expect(play(tr, rest([0.9, 0.1], 5), 300).steps).toEqual([]);
    expect(play(tr, line([0.9, 0.1], [0.2, 0.1], 6), 400).steps).toEqual(['left']);
  });

  it('turning back counts from the furthest the thumb went, not from its last step', () => {
    const tr = new SwipeTracker();
    // A step right at -0.1, the thumb on to 0.35 (no second step), then back to -0.2: a
    // STEP back from 0.35, though only 0.1 back from the step.
    expect(play(tr, [...line([-0.6, 0], [0.35, 0], 10), ...line([0.35, 0], [-0.2, 0], 8)]).steps).toEqual(['right', 'left']);
    // Back less than a STEP from the furthest is nothing.
    expect(play(new SwipeTracker(), [...line([-0.6, 0], [0.35, 0], 10), ...line([0.35, 0], [-0.1, 0], 8)]).steps).toEqual(['right']);
  });

  it('a lift starts the next swipe afresh', () => {
    const tr = new SwipeTracker();
    expect(play(tr, [...line([-0.4, 0], [0.05, 0], 5), null, ...line([-0.3, 0], [0.15, 0], 5)]).steps).toEqual([]);
  });

  describe('with a lift read through SDL_GetGamepadAxis: (0, -1/32767), not (0, 0)', () => {
    // SDL maps the remote's y inverted and rescales it in float: a raw 0 reads -1. The host
    // reads the raw axes (menuSmoke checks that through a virtual remote); this is the
    // tracker's own guard, should such a reading ever reach it.
    const LIFT: Sample = [0, -1 / 32767];

    it('a lift starts the next touch afresh: a touch-down off the centre is no step', () => {
      const tr = new SwipeTracker();
      expect(play(tr, [LIFT, LIFT, ...rest([0.8, 0.05], 6), LIFT, ...rest([-0.75, 0.6], 6), LIFT]).steps).toEqual([]);
    });

    it('a swipe does not undo itself on the lift', () => {
      const tr = new SwipeTracker();
      expect(play(tr, [LIFT, ...line([0.1, 0], [0.7, 0], 8), LIFT, LIFT]).steps).toEqual(['right']);
      expect(play(new SwipeTracker(), [LIFT, ...line([0, -0.1], [0, -0.7], 8), LIFT, LIFT]).steps).toEqual(['up']);
    });

    it('a resting thumb then an edge click is one step, not two', () => {
      const tr = new SwipeTracker();
      const { steps, t } = play(tr, [LIFT, ...rest([0, 0.85], 30)]);
      expect(steps).toEqual([]);
      expect(tr.endsSwipe('down', t)).toBe(false);
    });

    it('only readings that close to the centre count as lifted', () => {
      const tr = new SwipeTracker();
      expect(play(tr, [[LIFTED * 2, 0], [0.6, 0]]).steps).toEqual(['right']);
    });
  });

  it('relative values (zero at the touch-down) swipe the same', () => {
    // Without absolute values the first sample reads (0, 0), which is a lifted thumb: the
    // travel counts from the next one.
    const tr = new SwipeTracker();
    expect(play(tr, [null, ...line([0.05, 0], [-0.7, 0.04], 8), null]).steps).toEqual(['left']);
  });

  describe("the iPhone's Apple TV Remote: its select is a tap, which can end a swipe", () => {
    // TestFlight tvOS builds 4-6: on the phone's touchpad a swipe moved the fish the wrong
    // way or switched it. The host now hands over its touch as GameController reads it (absolute,
    // y down) and its tap as a centre click (native/host/main.c, the touchpad kind); a centre
    // click after the thumb travelled is the swipe's end (uiInput.ts asks `travelled`).

    it('a swipe landing high and going down steps down only, wherever it landed', () => {
      const tr = new SwipeTracker();
      expect(play(tr, [...line([0.1, -0.85], [0.12, 0.2], 10), null]).steps).toEqual(['down', 'down']);
    });

    it('a swipe whose tap comes as it lifts, or just after, travelled: no click', () => {
      const tr = new SwipeTracker();
      const { steps, t } = play(tr, line([-0.7, 0.3], [0.4, 0.32], 8));
      expect(steps).toEqual(['right', 'right']);
      expect(tr.travelled(t)).toBe(true); // the tap with the thumb still down
      const after = play(tr, [null], t).t;
      expect(tr.travelled(after + 20)).toBe(true); // ...or a moment after the lift
      expect(tr.travelled(after + SWIPE_CLICK_MS + 20)).toBe(false); // a tap later is a tap
    });

    it('a short swipe, too short for a step, is still no tap', () => {
      const tr = new SwipeTracker();
      const { steps, t } = play(tr, line([0, 0.5], [0, 0.5 - STEP * 0.8], 6));
      expect(steps).toEqual([]);
      expect(tr.travelled(t)).toBe(true);
    });

    it('a tap — the thumb landing and lifting where it landed — did not travel', () => {
      const tr = new SwipeTracker();
      const { t } = play(tr, rest([0.3, -0.6], 6));
      expect(tr.travelled(t)).toBe(false);
      expect(tr.travelled(play(tr, [null], t).t)).toBe(false);
    });

    it('a resting thumb drifting under the slop did not travel', () => {
      const tr = new SwipeTracker();
      const { t } = play(tr, line([0.2, 0.2], [0.2 + TAP_SLOP * 0.8, 0.2], 20));
      expect(tr.travelled(t)).toBe(false);
    });

    it('the click that ends a swipe is judged before it starts the travel over; its release does', () => {
      const tr = new SwipeTracker();
      const { t } = play(tr, line([0, -0.6], [0, 0.2], 6));
      tr.press(true);
      expect(tr.travelled(t)).toBe(true);
      tr.press(false);
      const later = play(tr, rest([0, 0.2], 30), t).t;
      expect(tr.travelled(later)).toBe(false); // the thumb stayed, still: the next click is a click
    });

    it("--remote-keys' Shift+arrow swipe is travel too, for a moment", () => {
      const tr = new SwipeTracker();
      tr.swiped('left', 1000);
      expect(tr.travelled(1000 + SWIPE_CLICK_MS)).toBe(true);
      expect(tr.travelled(1001 + SWIPE_CLICK_MS)).toBe(false);
    });
  });

  describe('in a room, a swipe held while the thumb stays (B6)', () => {
    const LIFT: Sample = [0, -1 / 32767];

    /** Feed `samples` as uiInput does: steps to the hold, a lift letting go. What was held, frame by frame. */
    function hold(samples: readonly Sample[]): (SwipeDir | null)[] {
      const tr = new SwipeTracker();
      const h = new SwipeHold();
      return samples.map((s, i) => {
        h.steps(tr.feed(s, i * 16));
        if (!tr.touching) h.release();
        return h.held;
      });
    }

    it('a thumb landing and resting, anywhere, holds nothing', () => {
      for (const p of [[0.9, 0], [-0.85, 0.1], [0, 0.9], [0.03, -0.02]] as const) {
        expect(hold([LIFT, ...rest(p, 40), LIFT]).every((d) => d === null)).toBe(true);
      }
    });

    it('a swipe holds its way while the thumb rests where it stopped, and the lift lets go', () => {
      const held = hold([LIFT, ...line([-0.3, 0], [0.4, 0.05], 8), ...rest([0.4, 0.05], 60), LIFT, LIFT]);
      const first = held.indexOf('right');
      expect(first).toBeGreaterThan(0);
      expect(held.slice(first, -2).every((d) => d === 'right')).toBe(true);
      expect(held.slice(-2)).toEqual([null, null]);
    });

    it('the lifted reading (0, -1/32767) and a missing remote (null) both let go', () => {
      expect(hold([...line([0, -0.1], [0, -0.8], 8), LIFT]).slice(-1)).toEqual([null]);
      expect(hold([...line([0, -0.1], [0, -0.8], 8), null]).slice(-1)).toEqual([null]);
    });

    it('settling back less than a step keeps the way; a whole step back turns it', () => {
      const go = line([-0.6, 0], [0.2, 0], 8);
      const settle = line([0.2, 0], [-0.1, 0], 5); // 0.3 back from the furthest: less than a STEP
      expect(hold([...go, ...settle]).slice(-1)).toEqual(['right']);
      const turn = line([0.2, 0], [-0.4, 0], 8); // 0.6 back from the furthest (the last step was at -0.1)
      expect(hold([...go, ...turn]).slice(-1)).toEqual(['left']);
      const across = line([0.2, 0], [0.2, 0.7], 8); // a step down, the thumb still on
      expect(hold([...go, ...across]).slice(-1)).toEqual(['down']);
    });

    it('more steps the same way change nothing: one press, held', () => {
      const h = new SwipeHold();
      expect(h.steps(['up'])).toEqual({ up: null, down: 'up' });
      expect(h.steps(['up', 'up'])).toBeNull();
      expect(h.steps(['left', 'down'])).toEqual({ up: 'up', down: 'down' });
      expect(h.release()).toBe('down');
      expect(h.release()).toBeNull();
    });
  });
});
