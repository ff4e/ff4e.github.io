import { describe, expect, it } from 'vitest';
import { TouchPinch } from '../src/app/touchPinch.js';

describe('continuous phone pinch and pan', () => {
  it('leaves one finger alone, then reports continuous zoom in either direction', () => {
    const p = new TouchPinch();
    expect(p.down(1, 100, 100)).toBeNull();
    expect(p.move(1, 120, 100)).toBeNull();
    expect(p.down(2, 220, 100)).toEqual({ ratio: 1, x: 170, y: 100 });
    expect(p.move(2, 230, 100)).toEqual({ ratio: 1.1, x: 175, y: 100 });
    expect(p.move(2, 260, 100)).toEqual({ ratio: 1.4, x: 190, y: 100 });
    expect(p.move(2, 150, 100)).toEqual({ ratio: 0.3, x: 135, y: 100 });
  });

  it('reports the centroid translation of a two-finger drag without changing its final ratio', () => {
    const p = new TouchPinch();
    p.down(1, 0, 0);
    p.down(2, 100, 0);
    p.move(1, 20, 30);
    expect(p.move(2, 120, 30)).toEqual({ ratio: 1, x: 70, y: 30 });
  });

  it('freezes after either finger lifts and stays active until all fingers are released', () => {
    const p = new TouchPinch();
    p.down(1, 0, 0);
    p.down(2, 100, 0);
    expect(p.up(99)).toBe(false);
    expect(p.up(1)).toBe(true);
    expect(p.active).toBe(true);
    expect(p.move(2, 300, 0)).toBeNull();
    expect(p.down(3, 500, 0)).toBeNull();
    expect(p.move(3, 700, 0)).toBeNull();
    expect(p.up(2)).toBe(true);
    expect(p.active).toBe(true);
    expect(p.up(3)).toBe(true);
    expect(p.active).toBe(false);
  });

  it('does not reinterpret third/replacement fingers, and resets on cancellation', () => {
    const p = new TouchPinch();
    p.down(1, 0, 0);
    p.down(2, 100, 0);
    expect(p.down(3, 200, 0)).toBeNull();
    expect(p.move(2, 200, 0)).toBeNull();
    p.up(3);
    expect(p.move(2, 300, 0)).toBeNull();
    p.reset();
    expect(p.active).toBe(false);
    expect(p.down(4, 0, 0)).toBeNull();
    expect(p.up(4)).toBe(false);
  });

  it('handles coincident contacts without a zero or infinite scale', () => {
    const p = new TouchPinch();
    p.down(1, 0, 0);
    expect(p.down(2, 0, 0)).toBeNull();
    expect(p.move(2, 100, 0)).toBeNull();
    p.reset();
    p.down(1, 0, 0);
    p.down(2, 100, 0);
    expect(p.move(2, 0, 0)).toEqual({ ratio: 0.01, x: 0, y: 0 });
  });
});
