import { describe, it, expect } from 'vitest';
import { hitTest, sliderIndex, OBLMYSI, OBLROH, NOBLMYSI } from '../src/render/hud.js';

describe('control-panel hit-testing (oblmysi, Uovl.pas)', () => {
  it('resolves the normal-panel regions 1..16', () => {
    // Centres of a few known regions (from OBLMYSI geometry).
    expect(hitTest(75, 197)).toBe(1); // little up (circle)
    expect(hitTest(75, 25)).toBe(6); // big up
    expect(hitTest(76, 158)).toBe(11); // swap (rect)
    expect(hitTest(30, 326)).toBe(12); // save
    expect(hitTest(30, 382)).toBe(15); // restart
    expect(hitTest(130, 360)).toBe(16); // options corner (roh)
  });

  it('does not expose options regions on the normal panel', () => {
    // A point inside the sound-slider rect is region 17 only in the options state
    // (on the normal panel this spot maps to nothing).
    expect(hitTest(140, 90)).toBe(0);
    expect(hitTest(140, 90, false)).toBe(0);
    expect(hitTest(140, 90, true)).toBe(17);
  });

  it('resolves the options regions 16..23 in the options state', () => {
    expect(hitTest(76, 85, true)).toBe(17); // sound slider
    expect(hitTest(76, 134, true)).toBe(18); // voices slider
    expect(hitTest(76, 183, true)).toBe(19); // music slider
    expect(hitTest(28, 266, true)).toBe(20); // subtitles czech
    expect(hitTest(75, 266, true)).toBe(21); // subtitles english
    expect(hitTest(124, 266, true)).toBe(22); // subtitles off
    expect(hitTest(56, 338, true)).toBe(23); // help
    expect(hitTest(130, 360, true)).toBe(16); // corner still works in options
  });

  it('exposes the corner as the shared boundary of both ranges', () => {
    expect(OBLROH).toBe(16);
    expect(NOBLMYSI).toBe(23);
    expect(OBLMYSI.length).toBe(24); // 0 (unused) + 1..23
  });

  it('maps a slider click x to the 0..12 index (PomObl = (x-12) div 10)', () => {
    expect(sliderIndex(12)).toBe(0);
    expect(sliderIndex(11)).toBe(0); // clamps below the track
    expect(sliderIndex(22)).toBe(1);
    expect(sliderIndex(141)).toBe(12);
    expect(sliderIndex(999)).toBe(12); // clamps above
  });
});
