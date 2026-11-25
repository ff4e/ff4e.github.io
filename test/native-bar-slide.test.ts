/**
 * The top bar's slide (native/js/barSlide.ts): it takes BAR_SLIDE_MS each way, moves on the
 * first frame after a press either way, turns round from where it is, and does not skip
 * after a long frame.
 */
import { describe, expect, it } from 'vitest';
import { BAR_SLIDE_MS, Slide } from '../native/js/barSlide.js';

/** Step `s` toward `shown` in 60 Hz frames from `t0` for `ms`; every value drawn. */
function frames(s: Slide, shown: boolean, t0: number, ms: number): number[] {
  const out: number[] = [];
  for (let t = t0; t <= t0 + ms + 1e-9; t += 1000 / 60) out.push(s.step(shown, t));
  return out;
}

describe('Slide', () => {
  it('comes in and goes out over BAR_SLIDE_MS, moving from the first frame either way', () => {
    const s = new Slide();
    s.step(false, 0);
    const opening = frames(s, true, 1000 / 60, BAR_SLIDE_MS + 20);
    expect(opening[0]).toBeGreaterThan(0.2);
    expect(opening.filter((v) => v < 1)).toHaveLength(Math.floor(BAR_SLIDE_MS / (1000 / 60)));
    expect(opening.at(-1)).toBe(1);
    s.step(true, 1000);
    const closing = frames(s, false, 1000, BAR_SLIDE_MS + 20);
    expect(closing[0]).toBe(1); // the frame of the press itself: no time has passed
    expect(closing[1]).toBeLessThan(0.8);
    expect(closing.at(-1)).toBe(0);
  });

  it('turns round from where the bar is drawn', () => {
    const s = new Slide();
    s.snap(true);
    s.step(true, 0);
    const out = s.step(false, 60);
    expect(out).toBeGreaterThan(0);
    expect(out).toBeLessThan(1);
    expect(s.step(true, 60)).toBeCloseTo(out, 12);
    expect(s.step(true, 76)).toBeGreaterThan(out);
  });

  it('steps over at most 50 ms at once, and snaps with no length', () => {
    const s = new Slide();
    s.step(false, 0);
    expect(s.step(true, 10_000)).toBeLessThan(1);
    const off = new Slide(0);
    off.step(false, 0);
    expect(off.step(true, 0)).toBe(1);
    expect(off.step(false, 0)).toBe(0);
  });
});
