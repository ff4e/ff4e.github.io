import { describe, expect, it } from 'vitest';
import { tabletSubtitleBox, tabletSubtitleLineY, tabletSubtitleWaveDy } from '../src/app/tabletSubtitleLayout.js';

describe('tablet subtitle placement', () => {
  const game = { left: 0, right: 768, top: 300, bottom: 624 };

  it('keeps the full game width when Undo is below a letterboxed room', () => {
    expect(tabletSubtitleBox(766, game, { left: 696, right: 752, top: 952, bottom: 1008 }))
      .toEqual({ left: 0, width: 766 });
  });

  it.each([
    undefined,
    { left: 0, right: 0, top: 0, bottom: 0 },
    { left: 400, right: 400, top: 400, bottom: 400 },
    { left: 696, right: 752, top: 244, bottom: 300 },
    { left: 696, right: 752, top: 624, bottom: 680 },
    { left: 768, right: 824, top: 568, bottom: 624 },
  ])('does not reserve width for an absent, hidden or non-overlapping control', (undo) => {
    expect(tabletSubtitleBox(766, game, undo)).toEqual({ left: 0, width: 766 });
  });

  it('centres the caption with an 8px gap before an overlapping Undo', () => {
    expect(tabletSubtitleBox(766, game, { left: 696, right: 752, top: 568, bottom: 624 }))
      .toEqual({ left: 80, width: 606 });
  });

  it('uses actual room and button positions after safe-area changes', () => {
    expect(tabletSubtitleBox(718, { ...game, left: 24, right: 744 },
      { left: 672, right: 728, top: 568, bottom: 624 })).toEqual({ left: 80, width: 558 });
  });

  it('keeps every wave sample above the resting row, including later downward swings', () => {
    for (const amplitude of [-30, 0, 18, 49.2]) {
      for (let phase = 0; phase <= 50; phase += 0.25) {
        expect(tabletSubtitleWaveDy(phase, amplitude)).toBeLessThanOrEqual(0);
      }
      expect(tabletSubtitleWaveDy(50, amplitude)).toBe(0);
    }
    expect(tabletSubtitleWaveDy(14, 18)).toBeLessThan(-10);
    expect(tabletSubtitleWaveDy(28, 18)).toBe(0);
  });

  it('keeps the settled line and its outline at the bottom for every font size', () => {
    for (const boxHeight of [20, 32, 46]) {
      for (const scale of [0.75, 1, 1.45]) {
        const y = tabletSubtitleLineY(740, -26, scale, boxHeight, 4);
        expect(y + boxHeight + 2).toBe(740);
        expect(y - tabletSubtitleLineY(740, -52, scale, boxHeight, 4)).toBeCloseTo(31.2 * scale);
        expect(tabletSubtitleLineY(740, 0, scale, boxHeight, 4) - y).toBeCloseTo(31.2 * scale);
      }
    }
  });
});
