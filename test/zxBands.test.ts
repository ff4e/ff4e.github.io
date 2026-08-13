/**
 * The gspec=42 loading-stripe sequence (src/render/zxBands.ts).
 *
 * Cheap to test and worth testing: the sequence is pure arithmetic, it is shared by two
 * renderers that must agree byte-for-byte, and it advances as a SIDE EFFECT — which is
 * the property most likely to be broken by an innocent-looking edit.
 */
import { describe, it, expect } from 'vitest';
import { advanceZxBands, bandRows, type ZxBandState } from '../src/render/zxBands.js';
import type { Room } from '../src/core/room.js';
import type { FfrBitmap } from '../src/data/ffr.js';

/** A 4x3 wall whose four corners are distinct indices, so ZX1..ZX4 are identifiable. */
function wall(): FfrBitmap {
  // corners: [0]=10 (TL), [(h-1)*w]=20 (BL), [w-1]=30 (TR), [h*w-1]=40 (BR)
  const pixels = new Uint8Array([10, 0, 0, 30, 0, 0, 0, 0, 20, 0, 0, 40]);
  return { w: 4, h: 3, pixels } as unknown as FfrBitmap;
}

function room(zx?: Partial<Room['zx']>): Room {
  return { zx: { pruh: 0, count: 0, cur: 0, colors: null, ...zx } } as unknown as Room;
}

describe('zx loading stripes', () => {
  describe('advanceZxBands', () => {
    it('samples ZX1..ZX4 from the wall corners, in TL/BL/TR/BR order', () => {
      const r = room();
      expect(advanceZxBands(r, wall(), 1)).toEqual([10, 20, 30, 40]);
    });

    it('samples the corners once and then leaves them alone', () => {
      const r = room();
      advanceZxBands(r, wall(), 1);
      const other = { w: 4, h: 3, pixels: new Uint8Array(12).fill(99) } as unknown as FfrBitmap;
      expect(advanceZxBands(r, other, 2)).toEqual([10, 20, 30, 40]);
    });

    it('snaps to the tall bands at phase 1 and the thin stripes at phase 52', () => {
      const r = room({ pruh: 7, cur: 3 });
      advanceZxBands(r, wall(), 501); // 501 % 500 === 1
      expect(r.zx.pruh).toBe(38.5);
      expect(r.zx.cur).toBe(0);
      advanceZxBands(r, wall(), 52);
      expect(r.zx.pruh).toBe(3.4);
      expect(r.zx.cur).toBe(2);
    });

    it('relaxes a quarter of the way towards the phase target, so a snap is not undone at once', () => {
      const r = room();
      advanceZxBands(r, wall(), 1); // pruh = 38.5
      advanceZxBands(r, wall(), 2); // in the tall run: target stays 38.5
      // (38.5 * n * 3 + 38.5) / 4 with n in [0.97, 1.03] — i.e. still essentially 38.5.
      expect(r.zx.pruh).toBeGreaterThan(37.8);
      expect(r.zx.pruh).toBeLessThan(39.2);

      // Entering the thin run, one frame after the snap, it must be heading DOWN from
      // 3.4 rather than jumping back up: the relaxation is what makes the stripes settle.
      advanceZxBands(r, wall(), 52); // pruh = 3.4
      advanceZxBands(r, wall(), 53);
      expect(r.zx.pruh).toBeGreaterThan(3.2);
      expect(r.zx.pruh).toBeLessThan(3.6);
    });
  });

  describe('bandRows', () => {
    it('alternates within the tall pair, changing every `pruh` rows', () => {
      const st: ZxBandState = { pruh: 10, count: 0, cur: 0 };
      const rows = bandRows(30, [10, 20, 30, 40], st);
      // count exceeds pruh on row 10 and row 20 (strictly greater, so the 11th row).
      expect(Array.from(rows.slice(0, 10))).toEqual(new Array(10).fill(10));
      expect(Array.from(rows.slice(10, 20))).toEqual(new Array(10).fill(20));
      expect(Array.from(rows.slice(20, 30))).toEqual(new Array(10).fill(10));
    });

    it('alternates within the thin pair when cur starts there — never across pairs', () => {
      const st: ZxBandState = { pruh: 4, count: 0, cur: 2 };
      const rows = bandRows(12, [10, 20, 30, 40], st);
      expect(new Set(rows)).toEqual(new Set([30, 40]));
    });

    it('carries the fractional accumulator, so a non-integer pruh does not round every band', () => {
      // pruh 2.5 ⇒ bands of 3,2,3,2… not 3,3,3,3 (which is what dropping the remainder
      // would give, and it is 20% wrong at the 3.4 setting the thin stripes use).
      const st: ZxBandState = { pruh: 2.5, count: 0, cur: 0 };
      const rows = Array.from(bandRows(10, [10, 20, 30, 40], st));
      const runs: number[] = [];
      let n = 1;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i] === rows[i - 1]) n++;
        else {
          runs.push(n);
          n = 1;
        }
      }
      runs.push(n);
      expect(runs.slice(0, 3)).toEqual([2, 3, 2]);
    });

    it('resumes where the previous frame left off', () => {
      const st: ZxBandState = { pruh: 10, count: 0, cur: 0 };
      bandRows(5, [10, 20, 30, 40], st);
      expect(st.count).toBe(5);
      const next = bandRows(10, [10, 20, 30, 40], st);
      // The band boundary lands 5 rows into THIS call, not 10.
      expect(next[4]).toBe(10);
      expect(next[5]).toBe(20);
    });

    it('falls back to index 0 rather than undefined if the colours are short', () => {
      const st: ZxBandState = { pruh: 1, count: 0, cur: 0 };
      expect(Array.from(bandRows(3, [], st))).toEqual([0, 0, 0]);
    });
  });
});
