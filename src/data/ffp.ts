/**
 * FFP parser — the control-panel overlay graphic (panel.ffp), loaded by
 * TOvl.FormCreate (Uovl.pas:522-596).
 *
 * Layout: 16 full panel images (155x395, 8-bit), each stored row-major as
 * `[u8 len][len bytes]` with the rest of the 155-wide row left transparent
 * (index 254, the FillChar value); then a 17x17 `Cudl` button-cursor sprite in
 * the same row form; then a 256-entry BGR palette. The 16 images are colour
 * variants of the same panel (grey / orange / yellow / lit / options / scroll)
 * that TOvl composites per element state (see render/hud.ts).
 */
import { ByteReader } from './binReader.js';

export const PANEL_W = 155;
export const PANEL_H = 395;
export const PANEL_IMAGES = 16;
export const CUDL_SIZE = 17;
/** The transparent palette index (FillChar 254 pad, Uovl.pas:564). */
export const PANEL_TRANSPARENT = 254;

export interface FfpPanel {
  /** 16 colour-variant panel images, each PANEL_W*PANEL_H indexed pixels. */
  readonly images: readonly Uint8Array[];
  /** The 17x17 button-cursor sprite (Cudl). */
  readonly cudl: Uint8Array;
  /** 256-entry RGB palette (3 bytes each). */
  readonly palette: Uint8Array;
}

function readRows(r: ByteReader, width: number, height: number, fill: number): Uint8Array {
  const px = new Uint8Array(width * height).fill(fill);
  for (let row = 0; row < height; row++) {
    const len = r.u8();
    const data = r.bytes(len);
    px.set(data.subarray(0, Math.min(len, width)), row * width);
  }
  return px;
}

export function parseFfp(bytes: Uint8Array): FfpPanel {
  const r = new ByteReader(bytes);
  const images: Uint8Array[] = [];
  for (let i = 0; i < PANEL_IMAGES; i++) {
    images.push(readRows(r, PANEL_W, PANEL_H, PANEL_TRANSPARENT));
  }
  const cudl = readRows(r, CUDL_SIZE, CUDL_SIZE, 0);
  // Palette: 256 entries stored B,G,R (Uovl.pas:527,578,584-588).
  const palette = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const b = r.u8();
    const g = r.u8();
    const rr = r.u8();
    palette[i * 3] = rr;
    palette[i * 3 + 1] = g;
    palette[i * 3 + 2] = b;
  }
  return { images, cudl, palette };
}
