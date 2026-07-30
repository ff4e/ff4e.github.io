/**
 * Pure image helpers in the (legacy/dormant) upscale studio tool
 * tools/studio/lib/upscale.mjs. The contour-thinning feature these back was
 * abandoned, but the functions are self-contained transforms over plain
 * Uint8Array RGBA buffers, so they are trivially unit-testable. Covered briefly,
 * per the task brief (items 1-7 in roomAi.test.ts are the priority).
 *
 * Conventions: buffers are w*h*4 bytes, straight (non-premultiplied) RGBA.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore -- untyped .mjs tool module (not in tsconfig `include`; run by vitest/esbuild).
import {
  downscaleRgba,
  stretchToBBox,
  thinOutline,
  smoothEdges,
  seamFill,
  compositeOver,
  resampleAreaTo,
} from '../tools/studio/lib/upscale.mjs';

/** Allocate a transparent w*h RGBA buffer. */
function rgba(w: number, h: number): Uint8Array {
  return new Uint8Array(w * h * 4);
}

function setPx(buf: Uint8Array, w: number, x: number, y: number, r: number, g: number, b: number, a: number): void {
  const o = (y * w + x) * 4;
  buf[o] = r; buf[o + 1] = g; buf[o + 2] = b; buf[o + 3] = a;
}

function getPx(buf: Uint8Array, w: number, x: number, y: number): [number, number, number, number] {
  const o = (y * w + x) * 4;
  return [buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!];
}

/** Fill an opaque solid colour over the whole buffer. */
function fillSolid(buf: Uint8Array, r: number, g: number, b: number, a = 255): void {
  for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a; }
}

describe('downscaleRgba (area-average box downscale, premultiplied)', () => {
  it('is a no-op for factor <= 1', () => {
    const buf = rgba(4, 4);
    const out = downscaleRgba(buf, 4, 4, 1);
    expect(out.rgba).toBe(buf); // returns the same object
    expect(out.w).toBe(4);
    expect(out.h).toBe(4);
  });

  it('halves the dimensions for factor 2', () => {
    expect(downscaleRgba(rgba(4, 4), 4, 4, 2)).toMatchObject({ w: 2, h: 2 });
    expect(downscaleRgba(rgba(6, 6), 6, 6, 2)).toMatchObject({ w: 3, h: 3 });
  });

  it('preserves a uniform opaque colour', () => {
    const buf = rgba(4, 4);
    fillSolid(buf, 10, 20, 30, 255);
    const { rgba: out, w } = downscaleRgba(buf, 4, 4, 2);
    expect(getPx(out, w, 0, 0)).toEqual([10, 20, 30, 255]);
    expect(getPx(out, w, 1, 1)).toEqual([10, 20, 30, 255]);
  });

  it('uses premultiplied alpha so a transparent neighbour does not bleed black in', () => {
    // 2x1: opaque white + fully-transparent. factor 2 -> 1x1. Colour must stay white
    // (premultiplied average ignores the transparent pixel's RGB); alpha is the
    // coverage-weighted mean 255/2 = 128.
    const buf = rgba(2, 1);
    setPx(buf, 2, 0, 0, 255, 255, 255, 255);
    setPx(buf, 2, 1, 0, 0, 0, 0, 0);
    const { rgba: out, w, h } = downscaleRgba(buf, 2, 1, 2);
    expect([w, h]).toEqual([1, 1]);
    const [r, g, b, a] = getPx(out, 1, 0, 0);
    expect([r, g, b]).toEqual([255, 255, 255]);
    expect(a).toBe(128);
  });

  it('yields fully-transparent output for fully-transparent input', () => {
    const { rgba: out } = downscaleRgba(rgba(4, 4), 4, 4, 2);
    expect(Array.from(out)).toEqual(new Array(2 * 2 * 4).fill(0));
  });
});

describe('stretchToBBox (box->box non-uniform stretch)', () => {
  it('returns src unchanged when either buffer is fully transparent', () => {
    const src = rgba(4, 4);
    setPx(src, 4, 1, 1, 9, 9, 9, 255);
    const emptyRef = rgba(4, 4);
    expect(stretchToBBox(src, emptyRef, 4, 4)).toBe(src); // ref has no opaque bbox
    const emptySrc = rgba(4, 4);
    expect(stretchToBBox(emptySrc, src, 4, 4)).toBe(emptySrc); // src has no opaque bbox
  });

  it('returns src unchanged when the bounding boxes already coincide', () => {
    const src = rgba(4, 4);
    const ref = rgba(4, 4);
    setPx(src, 4, 1, 1, 5, 6, 7, 255);
    setPx(ref, 4, 1, 1, 1, 2, 3, 255); // same single-pixel bbox at (1,1)
    expect(stretchToBBox(src, ref, 4, 4)).toBe(src);
  });

  it('stretches a single opaque source pixel to fill the reference bbox', () => {
    const src = rgba(4, 4);
    const ref = rgba(4, 4);
    setPx(src, 4, 1, 1, 200, 100, 50, 255); // src bbox is the single pixel (1,1)
    setPx(ref, 4, 0, 0, 1, 1, 1, 255);      // ref bbox spans (0,0)..(3,3)
    setPx(ref, 4, 3, 3, 1, 1, 1, 255);
    const out = stretchToBBox(src, ref, 4, 4);
    // every pixel across the ref bbox samples src(1,1) -> opaque source colour.
    for (const [x, y] of [[0, 0], [3, 3], [2, 1]] as const) {
      const [r, g, b, a] = getPx(out, 4, x, y);
      expect(a).toBe(255);
      expect([r, g, b]).toEqual([200, 100, 50]);
    }
  });
});

describe('thinOutline (contour erosion)', () => {
  it('is a no-op for s <= 0 (returns the input array itself)', () => {
    const buf = rgba(5, 5);
    expect(thinOutline(buf, 5, 5, 0)).toBe(buf);
    expect(thinOutline(buf, 5, 5, -1)).toBe(buf);
  });

  it('leaves an all-bright-fill sprite untouched (no ink pixels to thin)', () => {
    const buf = rgba(6, 6);
    fillSolid(buf, 240, 240, 240, 255); // luma 240 >= 60 ⇒ all "fill", zero ink
    const out = thinOutline(buf, 6, 6, 0.5);
    expect(Array.from(out)).toEqual(Array.from(buf));
  });

  it('erodes some dark outline alpha when there IS an outline to thin', () => {
    // 9x9: transparent outer ring, a 1px dark outline (ink, luma<60), bright fill
    // core. s=1 removes the full outer contour, so some outline pixels lose alpha.
    const w = 9, h = 9;
    const buf = rgba(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ring = Math.min(x, y, w - 1 - x, h - 1 - y); // 0 = outermost
      if (ring === 0) continue;                  // transparent margin (a=0)
      if (ring === 1) setPx(buf, w, x, y, 10, 10, 10, 255);    // dark outline
      else setPx(buf, w, x, y, 230, 230, 230, 255);            // bright fill core
    }
    const out = thinOutline(buf, w, h, 1);
    let cleared = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const wasInk = Math.min(x, y, w - 1 - x, h - 1 - y) === 1;
      if (wasInk && getPx(out, w, x, y)[3] === 0) cleared++;
    }
    expect(cleared).toBeGreaterThan(0);
  });
});

describe('smoothEdges (silhouette smoothing)', () => {
  it('is a no-op for sigma <= 0 (returns the input array itself)', () => {
    const buf = rgba(5, 5);
    expect(smoothEdges(buf, 5, 5, 0)).toBe(buf);
  });

  it('leaves a fully-opaque block untouched (no silhouette transitions in-band)', () => {
    const buf = rgba(9, 9);
    fillSolid(buf, 100, 120, 140, 255); // no alpha transition anywhere ⇒ empty edge band
    const out = smoothEdges(buf, 9, 9, 1.0, 0.5);
    expect(Array.from(out)).toEqual(Array.from(buf));
  });

  it('collapses a semi-transparent edge toward binary alpha (crisp sharpen)', () => {
    // A 1-D ramp of alpha across x; a mid pixel sits near 0.5 alpha. With crisp>0 the
    // sharpen pushes near-0.5 alphas toward 0 or 255, so the output is more binary.
    const w = 6, h = 1;
    const buf = rgba(w, h);
    for (let x = 0; x < w; x++) setPx(buf, w, x, 0, 255, 255, 255, Math.round((x / (w - 1)) * 255));
    const out = smoothEdges(buf, w, h, 1.0, 1.0);
    const midAlpha = getPx(out, w, 3, 0)[3];
    expect(midAlpha === 0 || midAlpha === 255 || midAlpha < 60 || midAlpha > 195).toBe(true);
  });
});

describe('seamFill (composite-level gap restore)', () => {
  it('is a no-op when R <= 0 or fewer than two layers', () => {
    const base = rgba(4, 4);
    fillSolid(base, 1, 2, 3, 255);
    const before = Array.from(base);
    seamFill(base, 4, 4, [], 5);                       // no layers
    seamFill(base, 4, 4, [{ orig: rgba(4, 4), rgba: rgba(4, 4), w: 4, h: 4, dx: 0, dy: 0 }], 5); // 1 layer
    seamFill(base, 4, 4, [                              // R = 0
      { orig: rgba(4, 4), rgba: rgba(4, 4), w: 4, h: 4, dx: 0, dy: 0 },
      { orig: rgba(4, 4), rgba: rgba(4, 4), w: 4, h: 4, dx: 0, dy: 0 },
    ], 0);
    expect(Array.from(base)).toEqual(before);
  });

  it('restores original art in the sliver between two near-touching participants', () => {
    // Two originally-abutting blocks whose contact edges were thinned away: A owns
    // x∈{1,2} (thinned rgba keeps only x=1, so x=2 receded), B owns x∈{3,4} (keeps
    // only x=4, so x=3 receded). The receded gap {2,3} is within R of both originals
    // ⇒ a seam ⇒ each side's ORIGINAL art is restored there.
    const W = 6, H = 1;
    const base = rgba(W, H);
    fillSolid(base, 0, 0, 0, 255); // black background
    const layerA = { orig: rgba(W, H), rgba: rgba(W, H), w: W, h: H, dx: 0, dy: 0 };
    const layerB = { orig: rgba(W, H), rgba: rgba(W, H), w: W, h: H, dx: 0, dy: 0 };
    setPx(layerA.orig, W, 1, 0, 200, 0, 0, 255);
    setPx(layerA.orig, W, 2, 0, 200, 0, 0, 255);
    setPx(layerA.rgba, W, 1, 0, 200, 0, 0, 255); // x=2 receded (thinned away)
    setPx(layerB.orig, W, 3, 0, 0, 200, 0, 255);
    setPx(layerB.orig, W, 4, 0, 0, 200, 0, 255);
    setPx(layerB.rgba, W, 4, 0, 0, 200, 0, 255); // x=3 receded
    seamFill(base, W, H, [layerA, layerB], 2);
    // x=2 is a seam pixel where A's original art is restored (no longer black).
    expect(getPx(base, W, 2, 0)).not.toEqual([0, 0, 0, 255]);
  });

  it('does NOT fill where only ONE participant is near (needs the SECOND-nearest)', () => {
    // The seam rule is `min2 <= R`: a gap counts only when it is close to TWO different
    // participants. Relaxing it to `min1 <= R` would fill the open space around every
    // lone sprite, painting a halo of un-thinned art back over the composite. A single
    // isolated layer therefore has min2 = Infinity everywhere and must fill nothing.
    const W = 6, H = 1;
    const base = rgba(W, H);
    fillSolid(base, 0, 0, 0, 255);
    const lone = { orig: rgba(W, H), rgba: rgba(W, H), w: W, h: H, dx: 0, dy: 0 };
    setPx(lone.orig, W, 1, 0, 200, 0, 0, 255);
    setPx(lone.orig, W, 2, 0, 200, 0, 0, 255);
    setPx(lone.rgba, W, 1, 0, 200, 0, 0, 255); // x=2 receded, and nothing else is nearby
    // A second participant exists but is far away (x=5), beyond R from the x=2 gap.
    const far = { orig: rgba(W, H), rgba: rgba(W, H), w: W, h: H, dx: 0, dy: 0 };
    setPx(far.orig, W, 5, 0, 0, 200, 0, 255);
    setPx(far.rgba, W, 5, 0, 0, 200, 0, 255);
    seamFill(base, W, H, [lone, far], 1);
    // Nothing is within R of two participants, so the background stays untouched.
    for (let x = 0; x < W; x++) expect(getPx(base, W, x, 0)).toEqual([0, 0, 0, 255]);
  });
});

describe('compositeOver (alpha-over blit)', () => {
  it('replaces the base under a fully-opaque sprite and blends under a half-opaque one', () => {
    const W = 3, H = 1;
    const base = rgba(W, H);
    fillSolid(base, 0, 0, 0, 255);
    const spr = rgba(2, 1);
    setPx(spr, 2, 0, 0, 255, 255, 255, 255); // opaque white
    setPx(spr, 2, 1, 0, 255, 255, 255, 128); // ~half white
    compositeOver(base, W, H, { rgba: spr, w: 2, h: 1, dx: 0, dy: 0 });
    expect(getPx(base, W, 0, 0)).toEqual([255, 255, 255, 255]); // fully covered
    const [r, , , a] = getPx(base, W, 1, 0);
    expect(a).toBe(255);
    expect(r).toBeGreaterThan(120);
    expect(r).toBeLessThan(135); // ~128 over black
    expect(getPx(base, W, 2, 0)).toEqual([0, 0, 0, 255]); // outside the sprite: untouched
  });

  it('clips sprite pixels that fall outside the base', () => {
    const W = 2, H = 1;
    const base = rgba(W, H);
    fillSolid(base, 0, 0, 0, 255);
    const spr = rgba(2, 1);
    fillSolid(spr, 255, 0, 0, 255);
    compositeOver(base, W, H, { rgba: spr, w: 2, h: 1, dx: 1, dy: 0 }); // shifted right by 1
    expect(getPx(base, W, 0, 0)).toEqual([0, 0, 0, 255]); // untouched
    expect(getPx(base, W, 1, 0)).toEqual([255, 0, 0, 255]); // only the in-bounds column
  });

  it('carries the BASE colour through a partial alpha (exact blend on a non-black base)', () => {
    // Every other case here composites onto black, where the base term contributes 0 and
    // a wrong (or missing) `base * (1 - fa)` is invisible. Room backgrounds are not black,
    // so pin the exact arithmetic against a saturated non-black base.
    const W = 1, H = 1;
    const base = rgba(W, H);
    fillSolid(base, 40, 80, 200, 255);
    const spr = rgba(1, 1);
    setPx(spr, 1, 0, 0, 255, 0, 0, 64); // red at 25.1% alpha
    compositeOver(base, W, H, { rgba: spr, w: 1, h: 1, dx: 0, dy: 0 });
    const fa = 64 / 255;
    expect(getPx(base, W, 0, 0)).toEqual([
      Math.round(255 * fa + 40 * (1 - fa)),
      Math.round(0 * fa + 80 * (1 - fa)),
      Math.round(0 * fa + 200 * (1 - fa)),
      255,
    ]);
  });
});

describe('resampleAreaTo (area-average downscale)', () => {
  it('weights colour by ALPHA, so a transparent pixel cannot bleed its RGB into the result', () => {
    // Averaging straight RGB pulls in the colour stored UNDER transparent pixels. That
    // colour is arbitrary — encoders routinely leave non-zero RGB beneath alpha=0 — so a
    // sprite edge resampled without premultiplication picks up a fringe of whatever
    // happens to be in the invisible pixels, with nothing reporting an error.
    //
    // A transparent BLACK neighbour cannot detect this (its RGB is 0, so weighting by
    // alpha changes nothing), which is exactly why the obvious version of this test
    // passes against the broken implementation. Use a transparent BLUE neighbour.
    const src = rgba(2, 1);
    setPx(src, 2, 0, 0, 255, 0, 0, 255); // opaque red — the only visible pixel
    setPx(src, 2, 1, 0, 0, 0, 255, 0);   // fully transparent, but blue underneath
    const out = resampleAreaTo(src, 2, 1, 1, 1) as { rgba: Uint8Array; w: number; h: number };
    const [r, g, b, a] = getPx(out.rgba, 1, 0, 0);
    // Pure red: the invisible blue contributes nothing. Without premultiplication this
    // comes out magenta (b = 255).
    expect([r, g, b]).toEqual([255, 0, 0]);
    // Coverage still halves, which is what carries the softness at the edge.
    expect(a).toBe(128);
  });
});
