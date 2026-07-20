/**
 * Audio-feedback fidelity: the ambient bubble (Zvuky_okoli) and the exit cheer
 * (jo-m/jo-v + the zvykacka gum easter egg), driven with a scripted RNG so the
 * exact branch is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { maybeBubble, exitCheer } from '../src/core/ambient.js';

/** A queue-backed rnd(n): returns the pre-scripted next value (ignoring n). */
function scripted(values: number[]) {
  let i = 0;
  return (_n: number) => values[i++] ?? 0;
}

describe('Zvuky_okoli ambient bubbles', () => {
  it('stays silent while a bubble is already sounding', () => {
    expect(maybeBubble(() => 0, true)).toBe(null);
  });

  it('plays a random bubble on the 5% roll', () => {
    // rnd(100) -> 2 (<5, fires), rnd(6) -> 3 -> sp-bubles4
    expect(maybeBubble(scripted([2, 3]), false)).toBe('sp-bubles4');
  });

  it('stays silent when the 5% roll misses', () => {
    expect(maybeBubble(scripted([9]), false)).toBe(null); // rnd(100)=9 >= 5
  });
});

describe('exit cheer (jo-m / jo-v)', () => {
  it('the little fish says jo-m-N when the big fish is alive', () => {
    const r = exitCheer('little', { aliveOther: true, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([3]));
    expect(r).toEqual({ sound: 'jo-m-3', clearGum: false });
  });

  it('the big fish says jo-v-N (not jo-v-4) when its partner has not exited', () => {
    // rnd(100)=1 (<15) but venkuLittle=false -> falls through to jo-v-{rnd(4)}
    const r = exitCheer('big', { aliveOther: true, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([1, 2]));
    expect(r).toEqual({ sound: 'jo-v-2', clearGum: false });
  });

  it('the big fish says jo-v-4 (15% chance) when its partner is already out', () => {
    const r = exitCheer('big', { aliveOther: false, venkuOther: true, venkuLittle: true, zvykacka: false }, scripted([10]));
    expect(r).toEqual({ sound: 'jo-v-4', clearGum: false });
  });

  it('stays silent when the partner is dead (neither alive nor out)', () => {
    const r = exitCheer('little', { aliveOther: false, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([0]));
    expect(r).toEqual({ sound: null, clearGum: false });
  });

  it('the zvykacka gum easter egg pays off (ob-m-zvykacka) when the partner is out', () => {
    const r = exitCheer('little', { aliveOther: false, venkuOther: true, venkuLittle: false, zvykacka: true }, scripted([0]));
    expect(r).toEqual({ sound: 'ob-m-zvykacka', clearGum: true });
  });
});
