/**
 * The level "name plaque" data (Desky, UMain.pas:341 NactiDesky / 1386 KresliDesku).
 *
 * Two files per language (`popdesk<lang>.dat` + `desky<lang>.dat`, lang '1'=cz '2'=en):
 *   - `popdesk` is 72 packed 12-byte records (`x1,y1,dx,dy:word; data:longint`,
 *     little-endian), one per room, iterated branch-major over the ten Vetev
 *     branches (matching {@link BRANCHES}). `x1,y1` are the plaque's top-left map
 *     position (drawn at `x1+160, y1+434`), `dx×dy` its size, `data` a byte offset
 *     into the atlas.
 *   - `desky` is the raw 8-bit palette-indexed pixel atlas; each plaque is `dy` rows
 *     of `dx` contiguous bytes starting at `data`. Indices are into the shared menu
 *     palette (`mapa-0.bmp`). KresliDesku blits the rectangle opaquely (a plain
 *     `move`, no transparency).
 */
import { BRANCHES } from './world.js';

/** Offset added to a plaque's stored `(x1,y1)` to place it on the 640×480 map. */
export const DESKA_X_OFFSET = 160;
export const DESKA_Y_OFFSET = 434;

export interface Deska {
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  data: number; // byte offset into the atlas
}

export interface DeskyData {
  /** Per-room plaque records, indexed by 1-based room number. */
  byRoom: Map<number, Deska>;
  /** The raw palette-indexed pixel atlas (`desky<lang>.dat`). */
  atlas: Uint8Array;
}

const RECORD_SIZE = 12;

/**
 * Parse the `popdesk`/`desky` pair into per-room plaque records. The 72 popdesk
 * records are read branch-major over {@link BRANCHES} (the same order NactiDesky
 * writes them), giving each its 1-based room number.
 */
export function parseDesky(popdesk: Uint8Array, atlas: Uint8Array): DeskyData {
  const dv = new DataView(popdesk.buffer, popdesk.byteOffset, popdesk.byteLength);
  const byRoom = new Map<number, Deska>();
  let seq = 0;
  for (const branch of BRANCHES) {
    for (let j = 0; j < branch.length; j++) {
      const o = seq * RECORD_SIZE;
      seq++;
      if (o + RECORD_SIZE > popdesk.byteLength) continue;
      byRoom.set(branch.start + j, {
        x1: dv.getUint16(o, true),
        y1: dv.getUint16(o + 2, true),
        dx: dv.getUint16(o + 4, true),
        dy: dv.getUint16(o + 6, true),
        data: dv.getInt32(o + 8, true),
      });
    }
  }
  return { byRoom, atlas };
}

/**
 * Composite a room's name plaque onto an RGBA map buffer (KresliDesku): copy the
 * `dx×dy` rectangle from the atlas at byte offset `data`, one contiguous row at a
 * time, mapping each index through the menu `palette`, to `(x1+160, y1+434)`.
 * Out-of-file / out-of-bounds pixels are skipped defensively.
 */
export function blitDeska(
  rgba: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  deska: Deska,
  atlas: Uint8Array,
  palette: readonly { r: number; g: number; b: number }[],
): void {
  const { x1, y1, dx, dy, data } = deska;
  for (let row = 0; row < dy; row++) {
    const destY = y1 + DESKA_Y_OFFSET + row;
    if (destY < 0 || destY >= mapH) continue;
    const srcRow = data + row * dx;
    for (let col = 0; col < dx; col++) {
      const idx = atlas[srcRow + col];
      if (idx === undefined) continue;
      const destX = x1 + DESKA_X_OFFSET + col;
      if (destX < 0 || destX >= mapW) continue;
      const c = palette[idx];
      if (!c) continue;
      const d = (destY * mapW + destX) * 4;
      rgba[d] = c.r;
      rgba[d + 1] = c.g;
      rgba[d + 2] = c.b;
      rgba[d + 3] = 255;
    }
  }
}
