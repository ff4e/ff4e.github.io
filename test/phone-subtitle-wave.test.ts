import { describe, expect, it } from 'vitest';
import { syncPhoneSubtitleWaves, type PhoneSubtitleWave } from '../src/app/phoneSubtitleWave.js';

const rows = [
  { id: 1, block: 1, obsah: 'One fish' },
  { id: 2, block: 1, obsah: 'two fish' },
  { id: 3, block: 1, obsah: 'three fish' },
];

describe('phone subtitle message wave', () => {
  it('continues the phase across bitmap row breaks, including their spaces', () => {
    const waves = new Map<number, PhoneSubtitleWave>();
    syncPhoneSubtitleWaves(waves, rows, 16);
    expect([...waves.get(1)!.offsets]).toEqual([[1, 0], [2, 9], [3, 18]]);
    expect(waves.get(1)!.stepMs).toBe(16);
  });

  it('keeps the same wave after source-row expiry and discards fully expired messages', () => {
    const waves = new Map<number, PhoneSubtitleWave>();
    syncPhoneSubtitleWaves(waves, rows, 16);
    const original = waves.get(1);
    syncPhoneSubtitleWaves(waves, rows.slice(1), 16);
    expect(waves.get(1)).toBe(original);
    expect(waves.get(1)!.offsets.get(2)).toBe(9);
    syncPhoneSubtitleWaves(waves, [], 16);
    expect(waves.size).toBe(0);
  });

  it('never spends more than 800ms revealing even a very long message', () => {
    const waves = new Map<number, PhoneSubtitleWave>();
    syncPhoneSubtitleWaves(waves, [{ id: 7, block: 8, obsah: 'a'.repeat(1000) }], 16);
    expect(waves.get(8)!.stepMs * 1000).toBe(800);
  });

  it('does not merge identical messages or count a Unicode code point twice', () => {
    const waves = new Map<number, PhoneSubtitleWave>();
    syncPhoneSubtitleWaves(waves, [
      { id: 1, block: 1, obsah: '\u{1f41f}' },
      { id: 2, block: 1, obsah: 'fish' },
      { id: 3, block: 2, obsah: '\u{1f41f}' },
    ], 16);
    expect([...waves.get(1)!.offsets]).toEqual([[1, 0], [2, 2]]);
    expect([...waves.get(2)!.offsets]).toEqual([[3, 0]]);
  });

  it('handles empty source text without an infinite step or retained block', () => {
    const waves = new Map<number, PhoneSubtitleWave>();
    syncPhoneSubtitleWaves(waves, [{ id: 1, block: 1, obsah: '' }], 16);
    expect(waves.get(1)!.stepMs).toBe(16);
    syncPhoneSubtitleWaves(waves, [{ id: 2, block: 2, obsah: 'new' }], 16);
    expect([...waves.keys()]).toEqual([2]);
  });
});
