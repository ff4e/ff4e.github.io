import { describe, expect, it } from 'vitest';
import { CanvasSurface2D } from '../src/render/canvasSurface2d.js';
import { createSurface, setSurfaceFactory, type Surface2D } from '../src/render/surface2d.js';
import { setScratchCanvasFactory } from '../src/render/scratchCanvas.js';

/** A 2D context that records what it was asked, with the state the surface writes. */
function recorder(w = 8, h = 4) {
  const calls: unknown[][] = [];
  const ctx = new Proxy(
    { fillStyle: '' as string } as Record<string, unknown>,
    {
      get: (t, k: string) =>
        k in t ? t[k] : (...args: unknown[]) => calls.push([k, ...args]),
      set: (t, k: string, v) => ((t[k] = v), calls.push([`=${k}`, v]), true),
    },
  ) as unknown as CanvasRenderingContext2D;
  const canvas = { width: w, height: h } as HTMLCanvasElement;
  return { s: new CanvasSurface2D(canvas, ctx), canvas, calls };
}

describe('CanvasSurface2D', () => {
  it('draws a surface as its canvas, and any other image as itself', () => {
    const a = recorder();
    const b = recorder();
    const bitmap = { width: 2, height: 2 };
    a.s.drawImage(b.s, 1, 2);
    a.s.drawImage(bitmap, 1, 2, 3, 4);
    expect(a.calls).toEqual([
      ['drawImage', b.canvas, 1, 2],
      ['drawImage', bitmap, 1, 2, 3, 4],
    ]);
  });

  it('writes the fill colour as six hex digits, leading zeros kept', () => {
    const r = recorder();
    r.s.fillRect(0, 0, 1, 1, 0x000000);
    r.s.fillRect(0, 0, 1, 1, 0x0a0b0c);
    expect(r.calls.filter((c) => c[0] === '=fillStyle')).toEqual([
      ['=fillStyle', '#000000'],
      ['=fillStyle', '#0a0b0c'],
    ]);
  });

  it('fills a mask with a colour through a scratch canvas, then draws that onto the surface', () => {
    const r = recorder(8, 4);
    const tint = recorder(1, 1);
    const tintCanvas = { width: 0, height: 0, getContext: () => tint.s.ctx } as unknown as HTMLCanvasElement;
    setScratchCanvasFactory(() => tintCanvas);
    try {
      const mask = { width: 16, height: 16 };
      r.s.fillMask(mask, 2, 3, 4, 5, 10, 20, 8, 10, 0x05050c);
      expect([tintCanvas.width, tintCanvas.height]).toEqual([4, 5]);
      expect(tint.calls).toEqual([
        ['drawImage', mask, 2, 3, 4, 5, 0, 0, 4, 5],
        ['=globalCompositeOperation', 'source-in'],
        ['=fillStyle', '#05050c'],
        ['fillRect', 0, 0, 4, 5],
      ]);
      expect(r.calls).toEqual([['drawImage', tintCanvas, 0, 0, 4, 5, 10, 20, 8, 10]]);
    } finally {
      setScratchCanvasFactory(null);
    }
  });

  it('clears the whole surface whatever the transform', () => {
    const r = recorder(8, 4);
    r.s.clear();
    expect(r.calls).toEqual([['save'], ['setTransform', 1, 0, 0, 1, 0, 0], ['clearRect', 0, 0, 8, 4], ['restore']]);
  });
});

describe('createSurface', () => {
  it('builds off-screen surfaces with an injected factory', () => {
    const made: [number, number][] = [];
    setSurfaceFactory((w, h) => (made.push([w, h]), { width: w, height: h } as Surface2D));
    try {
      expect(createSurface(640, 480).width).toBe(640);
      expect(made).toEqual([[640, 480]]);
    } finally {
      setSurfaceFactory(null);
    }
  });
});
