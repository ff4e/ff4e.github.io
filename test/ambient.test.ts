/**
 * Audio-feedback fidelity: the ambient bubble (Zvuky_okoli) and the exit cheer
 * (jo-m/jo-v + the zvykacka gum easter egg), driven with a scripted RNG so the
 * exact branch is deterministic.
 */
import { describe, it, expect, vi } from 'vitest';
import { maybeBubble, exitCheer, type CheerCtx } from '../src/core/ambient.js';

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
  const quiet = { talkingLittle: false, talkingBig: false };

  it('the little fish says jo-m-N when the big fish is alive', () => {
    const r = exitCheer('little', { ...quiet, aliveOther: true, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([3]));
    expect(r).toEqual({ sound: 'jo-m-3', speaker: 'little' });
  });

  it('the big fish says jo-v-N (not jo-v-4) when its partner has not exited', () => {
    // rnd(100)=1 (<15) but venkuLittle=false -> falls through to jo-v-{rnd(4)}
    const r = exitCheer('big', { ...quiet, aliveOther: true, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([1, 2]));
    expect(r).toEqual({ sound: 'jo-v-2', speaker: 'big' });
  });

  it('the big fish says jo-v-4 (15% chance) when its partner is already out', () => {
    const r = exitCheer('big', { ...quiet, aliveOther: false, venkuOther: true, venkuLittle: true, zvykacka: false }, scripted([10]));
    expect(r).toEqual({ sound: 'jo-v-4', speaker: 'big' });
  });

  it('stays silent when the partner is dead (neither alive nor out)', () => {
    const r = exitCheer('little', { ...quiet, aliveOther: false, venkuOther: false, venkuLittle: false, zvykacka: false }, scripted([0]));
    expect(r).toBe(null);
  });

  it('the zvykacka gum easter egg pays off (ob-m-zvykacka) when the partner is out', () => {
    const r = exitCheer('little', { ...quiet, aliveOther: false, venkuOther: true, venkuLittle: false, zvykacka: true }, scripted([0]));
    expect(r).toEqual({ sound: 'ob-m-zvykacka', speaker: 'little' });
  });

  it.each(['little', 'big'] as const)('does not consume randomness when the %s speaker is talking', which => {
    const rnd = vi.fn(() => 0);
    expect(exitCheer(which, {
      aliveOther: true, venkuOther: false, venkuLittle: false, zvykacka: false,
      talkingLittle: true, talkingBig: true,
    }, rnd)).toBe(null);
    expect(rnd).not.toHaveBeenCalled();
  });

  const gum: CheerCtx = {
    ...quiet, aliveOther: false, venkuOther: true, venkuLittle: true, zvykacka: true,
  };

  it('the big fish can exit while talking, but the gum line belongs to the idle little fish', () => {
    expect(exitCheer('big', { ...gum, talkingBig: true }, () => 0))
      .toEqual({ sound: 'ob-m-zvykacka', speaker: 'little' });
  });

  it('falls back to the big farewell if the little fish cannot say the gum line', () => {
    expect(exitCheer('big', { ...gum, talkingLittle: true }, scripted([50, 2])))
      .toEqual({ sound: 'jo-v-2', speaker: 'big' });
  });

  it.each(['little', 'big'] as const)('skips the gum and ordinary farewell when both voices are talking (%s exit)', which => {
    const rnd = vi.fn(() => 0);
    expect(exitCheer(which, { ...gum, talkingLittle: true, talkingBig: true }, rnd)).toBe(null);
    expect(rnd).not.toHaveBeenCalled();
  });
});
