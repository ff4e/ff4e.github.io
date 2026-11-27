/**
 * The smoke gate's look at a room's size cap (roomFit.ts), on the room it has just drawn:
 *
 * - the host's own `letterbox` (`presentRect`, asked for a named window) against its
 *   restatement `letterboxRect`, capped and not, at 1920×1080 and 3840×2160 — every room the
 *   gate plays, so the C and the JS copies cannot drift apart;
 * - that a room under the cap is shown exactly as it was, and one over it at the cap;
 * - MIKRO, the smallest room: 45 px a cell at 1080 lines and 90 at 2160, centred, and the
 *   present pass itself (`presentProbe`, the colour grade's pass) drawing exactly that rect.
 *
 * With `--smoke-out DIR`, what those windows show of the room is written beside the
 * composites, capped and as it was (`DIR/<room>-fit-<W>x<H>-<capped|full>.rgba`).
 */
import { ROOM_CELL_LINES, ROOM_CELL_PX, letterboxRect, roomCapH, type Rect } from './roomFit.js';
import { CELL_NATIVE } from '../../src/app/layout.js';
import type { NativeAiScreen } from './nativeAiScreen.js';

const WINDOWS: readonly (readonly [number, number])[] = [[1920, 1080], [3840, 2160]];
const MIKRO = 33;

const same = (a: readonly number[] | null, b: readonly number[]): boolean => !!a && b.every((v, i) => a[i] === v);

/** The first and last opaque pixel along row `y` (or column `x`) of a top-down RGBA buffer. */
function opaqueSpan(px: Uint8Array, w: number, h: number, along: 'row' | 'col', at: number): [number, number] {
  const n = along === 'row' ? w : h;
  let first = -1, last = -1;
  for (let i = 0; i < n; i++) {
    const p = along === 'row' ? (at * w + i) * 4 : (i * w + at) * 4;
    if (px[p + 3] === 0) continue;
    if (first < 0) first = i;
    last = i;
  }
  return [first, last];
}

/** What is wrong with the room's fit, or null. `num` the room drawn into `target`. */
export function checkRoomFit(target: NativeAiScreen, num: number, outDir?: string): string | null {
  const { width: w, height: h } = target;
  const capH = roomCapH(target.scale);
  const cell = CELL_NATIVE * target.scale;
  for (const [sw, sh] of WINDOWS) {
    for (const cap of [0, capH]) {
      const want = letterboxRect(w, h, sw, sh, cap);
      const got = __native.presentRect(w, h, cap, sw, sh);
      if (!same(got, want)) return `at ${sw}×${sh}${cap ? ', capped' : ''} the host shows the room at ${JSON.stringify(got?.slice(0, 4))}, letterboxRect says ${JSON.stringify(want)}`;
    }
    const full = letterboxRect(w, h, sw, sh), capped = letterboxRect(w, h, sw, sh, capH);
    const most = (ROOM_CELL_PX * sh) / ROOM_CELL_LINES;
    const over = (full[3] / h) * cell > most;
    if (!over && !same(capped, full)) return `at ${sw}×${sh} a room under the cap is shown differently: ${JSON.stringify(capped)}, not ${JSON.stringify(full)}`;
    if (over && Math.floor((h * sh) / capH) !== capped[3]) return `at ${sw}×${sh} a room over the cap is not shown at it: ${capped[3]} px tall`;
    if (num === MIKRO) {
      const err = checkMikro(w, h, sw, sh, capH, capped, (most * w) / cell, (most * h) / cell);
      if (err) return err;
    }
    if (outDir) {
      for (const [name, cap] of [['full', 0], ['capped', capH]] as const) {
        const px = __native.presentProbe(0, sw, sh, true, cap);
        const file = new Uint8Array(8 + px.byteLength);
        new DataView(file.buffer).setUint32(0, sw, true);
        new DataView(file.buffer).setUint32(4, sh, true);
        file.set(new Uint8Array(px), 8);
        __native.writeFile(`${outDir}/${num}-fit-${sw}x${sh}-${name}.rgba`, file.buffer);
      }
    }
  }
  return null;
}

/** MIKRO at the cap, centred, and the present pass drawing exactly that. */
function checkMikro(w: number, h: number, sw: number, sh: number, capH: number, r: Rect, wantW: number, wantH: number): string | null {
  const [ox, oy, dw, dh] = r;
  if (dw !== wantW || dh !== wantH) return `MIKRO at ${sw}×${sh}: ${dw}×${dh}, not the cap's ${wantW}×${wantH}`;
  if (ox !== Math.floor((sw - dw) / 2) || oy !== Math.floor((sh - dh) / 2)) return `MIKRO at ${sw}×${sh} is not centred: at (${ox}, ${oy})`;
  const px = new Uint8Array(__native.presentProbe(0, sw, sh, true, capH));
  const row = opaqueSpan(px, sw, sh, 'row', oy + (dh >> 1)), col = opaqueSpan(px, sw, sh, 'col', ox + (dw >> 1));
  if (!same(row, [ox, ox + dw - 1]) || !same(col, [oy, oy + dh - 1]))
    return `MIKRO at ${sw}×${sh}: the present pass draws columns ${row.join('..')} and rows ${col.join('..')}, not the rect ${JSON.stringify(r)} (composite ${w}×${h})`;
  return null;
}
