import { describe, expect, it } from 'vitest';
import { retainPhoneSubtitleRows, type SubtitleRow } from '../src/app/phoneSubtitleExpiry.js';

const row = (id: number, block: number): SubtitleRow => ({
  id, block, obsah: `row ${id}`, barva: 'M', rgb: [255, 255, 255],
  ys: 0, cilys: -26, startcount: 0,
});

describe('phone subtitle expiry layout', () => {
  it('retains the complete message in source order through partial expiry and font rebuilds', () => {
    const first = row(1, 1), second = row(2, 1), third = row(3, 1);
    const previous = [first, second, third].map(source => ({ source }));
    expect(retainPhoneSubtitleRows([second, third], previous)).toEqual([first, second, third]);
    expect(retainPhoneSubtitleRows([third], previous)).toEqual([first, second, third]);
  });

  it('removes fully expired messages without merging an identical later message', () => {
    const first = row(1, 1), second = row(2, 2);
    second.obsah = first.obsah;
    const previous = [first, second].map(source => ({ source }));
    expect(retainPhoneSubtitleRows([second], previous)).toEqual([second]);
    expect(retainPhoneSubtitleRows([], previous)).toEqual([]);
  });

  it('uses current engine data for active rows and appends newly arriving rows', () => {
    const old = row(1, 1), current = { ...old, ys: -26 }, next = row(2, 2);
    expect(retainPhoneSubtitleRows([current, next], [{ source: old }])).toEqual([current, next]);
  });
});
