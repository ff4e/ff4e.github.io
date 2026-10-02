/**
 * The decisions behind the GPU-loss recovery (src/app/gpuLoss.ts): what counts as a wiped
 * sentinel, when a second recovery is refused, and that a hand-over survives the trip
 * through sessionStorage — and nothing that is not one is mistaken for it.
 *
 * The reload and the resume themselves need a browser, and `tools/test-gpu-loss.mjs`
 * covers them.
 */
import { describe, it, expect } from 'vitest';
import {
  RECOVERY_COOLDOWN_MS,
  decodeResume,
  encodeResume,
  mayRecover,
  sentinelWiped,
  type GpuLossResume,
} from '../src/app/gpuLoss.js';

describe('sentinelWiped', () => {
  it('fires on the transparent black a lost GPU process leaves', () => {
    expect(sentinelWiped([0, 0, 0, 0])).toBe(true);
  });
  it('does not fire on the opaque pixel it was painted with', () => {
    expect(sentinelWiped([18, 52, 86, 255])).toBe(false);
  });
  it('does not fire on a read nudged by anti-fingerprinting noise', () => {
    expect(sentinelWiped([19, 51, 86, 255])).toBe(false);
    expect(sentinelWiped([18, 52, 86, 254])).toBe(false);
  });
});

describe('mayRecover', () => {
  const t = 1_000_000;
  it('allows the first recovery', () => {
    expect(mayRecover(t, null)).toBe(true);
  });
  it('refuses a second one inside the cooldown, so a recurring loss cannot loop', () => {
    expect(mayRecover(t, t)).toBe(false);
    expect(mayRecover(t + RECOVERY_COOLDOWN_MS - 1, t)).toBe(false);
  });
  it('allows one again after the cooldown', () => {
    expect(mayRecover(t + RECOVERY_COOLDOWN_MS, t)).toBe(true);
  });
  it('does not let a clock that went backwards block recovery', () => {
    expect(mayRecover(t - 5, t)).toBe(true);
  });
});

describe('the hand-over', () => {
  const r: GpuLossResume = {
    room: 12,
    rec: 'lRuD',
    vars: { bank: [1, 2, 3] },
    undo: { v: 1, points: [] },
    active: 'big',
  };

  it('round-trips', () => {
    expect(decodeResume(encodeResume(r))).toEqual(r);
  });

  it('defaults what an older or partial hand-over leaves out', () => {
    expect(decodeResume(JSON.stringify({ room: 3, rec: '' }))).toEqual({
      room: 3,
      rec: '',
      vars: null,
      undo: null,
      active: null,
    });
    expect(decodeResume(JSON.stringify({ ...r, active: 'shark' }))?.active).toBeNull();
  });

  it('rejects anything that does not name a room and a record', () => {
    expect(decodeResume(null)).toBeNull();
    expect(decodeResume('')).toBeNull();
    expect(decodeResume('not json')).toBeNull();
    expect(decodeResume('null')).toBeNull();
    expect(decodeResume('[]')).toBeNull();
    expect(decodeResume(JSON.stringify({ rec: 'l' }))).toBeNull();
    expect(decodeResume(JSON.stringify({ room: 0, rec: 'l' }))).toBeNull();
    expect(decodeResume(JSON.stringify({ room: 2.5, rec: 'l' }))).toBeNull();
    expect(decodeResume(JSON.stringify({ room: 2, rec: 7 }))).toBeNull();
  });
});
