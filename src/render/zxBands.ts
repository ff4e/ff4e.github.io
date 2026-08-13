/**
 * The gspec=42 "ZX-Spectrum emulator" loading stripes (URoom.pas:26214, 1417-1423).
 *
 * ZX's wall is not drawn. Every OPAQUE wall pixel is replaced by a flat band colour that
 * cycles down the screen in horizontal stripes, the way a Spectrum tape loader painted
 * its border; the wall's MASK pixels stay transparent and the water-wobbled background
 * shows through them as usual. The stripes alternate within a pair — tall bands
 * (ZX1<->ZX2) for fifty frames, then thin ones (ZX3<->ZX4) — on a 500-frame cycle.
 *
 * Extracted from `classicBackground` so the native and ×S renderers share ONE definition
 * of the sequence rather than a copy of it. That mattered immediately: the band state
 * advances as a SIDE EFFECT of drawing (once per scanline, once per frame), so two
 * implementations of it would not merely drift, they would drift differently on every
 * frame and only in one room.
 *
 * Host-level note with no 1998 counterpart: the original had one renderer at one
 * resolution, so the question of where a band edge falls when a native row becomes S
 * device rows did not arise. `bandRows` answers it in native rows for that reason — see
 * its comment.
 */
import type { FfrBitmap } from '../data/ffr.js';
import type { Room } from '../core/room.js';

/** The mutable band state a room carries between frames (`Room.zx`). */
export interface ZxBandState {
  pruh: number;
  count: number;
  cur: number;
}

/**
 * Advance the loading-stripe band HEIGHT for this frame, and sample the four band
 * colours on first use.
 *
 * `pruh` is the stripe height in scanlines. It is not set, it is relaxed towards a
 * target — a quarter of the way each frame, with 3-10% of noise — which is what gives
 * the stripes their unsteady, tape-loading wobble. The 500-frame cycle snaps it to 38.5
 * (tall bands, ZX1<->ZX2) at phase 1 and to 3.4 (thin stripes, ZX3<->ZX4) at phase 52.
 */
export function advanceZxBands(room: Room, wall: FfrBitmap, count: number): readonly number[] {
  const zx = room.zx;
  if (!zx.colors) {
    // ZX1..ZX4 = the wall bitmap's four corner pixels (TRoom.Start, URoom.pas:1417-1423).
    const w = wall.w;
    const h = wall.h;
    zx.colors = [wall.pixels[0]!, wall.pixels[(h - 1) * w]!, wall.pixels[w - 1]!, wall.pixels[h * w - 1]!];
  }
  const phase = count % 500;
  if (phase === 1) {
    zx.pruh = 38.5;
    zx.cur = 0;
  } else if (phase === 52) {
    zx.pruh = 3.4;
    zx.cur = 2;
  } else if (phase >= 2 && phase <= 51) {
    zx.pruh = (zx.pruh * (0.97 + 0.06 * Math.random()) * 3 + 38.5) / 4;
  } else {
    zx.pruh = (zx.pruh * (0.95 + 0.1 * Math.random()) * 3 + 3.4) / 4;
  }
  return zx.colors;
}

/**
 * The band colour INDEX for each of `rows` native scanlines, advancing `st` exactly as
 * the per-scanline loop in `blitZX` does — including leaving it where that loop would.
 *
 * Deliberately in NATIVE rows, and that is the whole fidelity decision for the ×S
 * renderer. A stripe is `pruh` scanlines tall in a 1998 sense; computing the cycle per
 * DEVICE row instead would make every stripe S times thinner relative to the room, which
 * is a different effect wearing the same code. So the sequence is generated natively and
 * each entry is painted S device rows tall.
 */
export function bandRows(rows: number, colors: readonly number[], st: ZxBandState): Uint8Array {
  const out = new Uint8Array(rows);
  for (let i = 0; i < rows; i++) {
    st.count += 1;
    if (st.count > st.pruh) {
      st.count -= st.pruh;
      // ZX1<->ZX2 (indices 0,1) or ZX3<->ZX4 (indices 2,3).
      st.cur = st.cur === 0 ? 1 : st.cur === 1 ? 0 : st.cur === 2 ? 3 : 2;
    }
    out[i] = colors[st.cur] ?? 0;
  }
  return out;
}
