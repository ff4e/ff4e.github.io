/**
 * The native map's menu repeat (native/js/dirRepeat.ts): the controller spec's cadence —
 * a step on the press, a repeat after 340 ms, then every 140 ms — and a fresh press always
 * steps at once.
 */
import { describe, expect, it } from 'vitest';
import { DirRepeat } from '../native/js/dirRepeat.js';

describe('DirRepeat', () => {
  it('steps on the press, after 340 ms, then every 140 ms', () => {
    const r = new DirRepeat();
    const steps = [0, 100, 339, 340, 400, 479, 480, 620].map((t) => r.step('left', t));
    expect(steps).toEqual(['left', null, null, 'left', null, null, 'left', 'left']);
  });

  it('steps at once on a new direction, and on a re-press after a release', () => {
    const r = new DirRepeat();
    expect(r.step('left', 0)).toBe('left');
    expect(r.step('up', 10)).toBe('up');
    expect(r.step(null, 20)).toBeNull();
    expect(r.step('up', 30)).toBe('up');
    expect(r.step('up', 200)).toBeNull();
  });
});
