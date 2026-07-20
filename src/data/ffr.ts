/**
 * FFR (room graphic + logic data) loader.
 *
 * This is a faithful, line-by-line port of the binary read sequence in
 * `URoom.pas` -> `TRoom.Init` (loader body at URoom.pas:1171-1310, with the
 * nested `ReadBitMap`/`ReadBitMapExtra` at URoom.pas:1035-1080). Constants
 * mirror the originals: toc=14 (URoom.pas:17), extra=10 (URoom.pas:32),
 * hl_max=10 / tl_max=23 (URoom.pas:53-54).
 *
 * The original `buf` is a 1 KB union reinterpreted as bytes / `word` (u16 LE) /
 * `integer` (i32 LE) / a Pascal shortstring / a BGR palette triple array. We
 * reproduce each `blockread` with the matching ByteReader primitive.
 *
 * Nothing here renders or simulates; it only decodes the file into plain data.
 */
import { ByteReader } from './binReader.js';

/** Type-of-compatibility tag every FFR begins with (URoom.pas:17). */
export const FFR_TOC = 14;
/** Horizontal padding added to background bitmaps for the water-wrap effect (URoom.pas:32). */
export const FFR_EXTRA = 10;
/** Head animation frame count per fish (URoom.pas:53). */
export const FFR_HL_MAX = 10;
/** Body animation frame count per fish (URoom.pas:54). */
export const FFR_TL_MAX = 23;

/** Item "kind" codes (URoom.pas:38-42). */
export const Kind = {
  static: 0,
  light: 1,
  heavy: 2,
  little: 3, // the small fish
  big: 4, // the big fish
} as const;

/** A paletted bitmap: `pixels` holds H rows of W palette indices (row-major). */
export interface FfrBitmap {
  readonly w: number;
  readonly h: number;
  /** Length === w*h; values are indices into the room palette. */
  readonly pixels: Uint8Array;
  /**
   * Horizontal edge padding replicated on each side (only background bitmaps,
   * read via ReadBitMapExtra, have padded === FFR_EXTRA; all others 0). The
   * stored width already includes 2*padded.
   */
  readonly padded: number;
}

/** One placed object/item. Item 0 is the room wall (URoom.pas const wall=0). */
export interface FfrItem {
  readonly xStart: number;
  readonly yStart: number;
  /** First bitmap index in `bitmaps` for this item (further frames follow at +1, +2, ...). */
  readonly bmp: number;
  readonly mask: number;
  readonly kind: number;
  /** The object's occupied cells, as (x,y) offsets relative to (xStart,yStart). */
  readonly fields: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

export interface FfrPaletteEntry {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface FfrRoom {
  readonly toc: number;
  /** Raw room description as stored (CZ and EN joined by "^"). */
  readonly descriptionRaw: string;
  readonly descriptionCz: string;
  readonly descriptionEn: string;
  /** Start facing per fish: true = right, false = left (URoom.pas:1227-1228). */
  readonly startFacingRight: { readonly small: boolean; readonly big: boolean };
  /** Water-wave parameters (amplitude / period / speed); per=spd=0 are clamped to 1. */
  readonly wamp: number;
  readonly wper: number;
  readonly wspd: number;
  readonly width: number;
  readonly height: number;
  readonly itemCount: number;
  /** Items[0..itemCount]; index 0 is the wall. */
  readonly items: readonly FfrItem[];
  readonly numBmp: number;
  /** Object bitmaps, 1-based to match the engine (bitmaps[0] is a placeholder). */
  readonly bitmaps: readonly (FfrBitmap | null)[];
  /** Head animation frames per fish, 1-based (index 0 placeholder). */
  readonly heads: { readonly big: readonly (FfrBitmap | null)[]; readonly small: readonly (FfrBitmap | null)[] };
  /** Body animation frames per fish, 1-based (index 0 placeholder). */
  readonly bodies: { readonly big: readonly (FfrBitmap | null)[]; readonly small: readonly (FfrBitmap | null)[] };
  /** 256-entry palette (stored BGR in the file, exposed as RGB). */
  readonly palette: readonly FfrPaletteEntry[];
  /** Bytes consumed by the parse; equals the file length on a clean read. */
  readonly bytesConsumed: number;
}

/** ReadBitMap (URoom.pas:1035-1052): 4-byte W/H header then H rows of W bytes. */
function readBitMap(r: ByteReader): FfrBitmap {
  const w = r.u16();
  const h = r.u16();
  const pixels = new Uint8Array(w * h);
  pixels.set(r.bytes(w * h));
  return { w, h, pixels, padded: 0 };
}

/**
 * ReadBitMapExtra (URoom.pas:1054-1080): like ReadBitMap but each row is widened
 * by `extra` on both sides, the padding replicating the row's first/last real
 * pixel. Used for background/wall-area bitmaps so the water displacement can
 * wrap without sampling out of bounds.
 */
function readBitMapExtra(r: ByteReader): FfrBitmap {
  const w0 = r.u16(); // stored (real) row width
  const h = r.u16();
  const w = w0 + 2 * FFR_EXTRA;
  const pixels = new Uint8Array(w * h);
  for (let row = 0; row < h; row++) {
    const base = row * w;
    const real = r.bytes(w0);
    pixels.set(real, base + FFR_EXTRA);
    const first = pixels[base + FFR_EXTRA]!;
    pixels.fill(first, base, base + FFR_EXTRA); // left edge replicate
    const last = pixels[base + FFR_EXTRA + w0 - 1]!;
    pixels.fill(last, base + FFR_EXTRA + w0, base + w); // right edge replicate
  }
  return { w, h, pixels, padded: FFR_EXTRA };
}

function readAnim(r: ByteReader, expectedCount: number, label: string): (FfrBitmap | null)[] {
  const j = r.i32();
  if (j !== expectedCount) {
    throw new Error(`${label} structure size mismatch: expected ${expectedCount}, got ${j}`);
  }
  const out: (FfrBitmap | null)[] = [null]; // index 0 placeholder (engine sets [..,0].P:=nil)
  for (let i = 1; i <= j; i++) out.push(readBitMap(r));
  return out;
}

/** Decode the room description bytes (CP1250 in the original) into a UTF-8 string. */
const cp1250 = new TextDecoder('windows-1250');

/**
 * Parse a complete FFR file. `data` must be the entire `0NN.FFR` byte buffer.
 * Throws on a structural mismatch or if the parse does not consume the whole
 * file (the byte-exact check is the strongest fidelity signal for the format).
 */
export function parseFfr(data: Uint8Array): FfrRoom {
  const r = new ByteReader(data);

  // 1) toc (URoom.pas:1198-1199)
  const toc = r.i32();
  if (toc !== FFR_TOC) throw new Error(`TypeOfCompatibility error: expected ${FFR_TOC}, got ${toc}`);

  // 2) room description as a Pascal shortstring (URoom.pas:1200-1201)
  const descLen = r.u8();
  const descriptionRaw = cp1250.decode(r.bytes(descLen));
  const caret = descriptionRaw.indexOf('^');
  const descriptionCz = caret >= 0 ? descriptionRaw.slice(0, caret) : descriptionRaw;
  const descriptionEn = caret >= 0 ? descriptionRaw.slice(caret + 1) : descriptionRaw;

  // 3) 10 i32: start dirs + wave params (URoom.pas:1226-1233)
  const d0 = r.i32();
  const d1 = r.i32();
  const wamp = r.i32();
  let wper = r.i32();
  let wspd = r.i32();
  r.skip(4 * 5); // i32[5..9] reserved
  if (wper === 0) wper = 1;
  if (wspd === 0) wspd = 1;

  // 4) dims + item count (URoom.pas:1234-1237)
  const width = r.i32();
  const height = r.i32();
  const itemCount = r.i32();

  // 5) items 0..itemCount inclusive; item 0 is the wall (URoom.pas:1240-1264)
  const items: FfrItem[] = [];
  for (let j = 0; j <= itemCount; j++) {
    const xStart = r.u8();
    const yStart = r.u8();
    const bmp = r.u16();
    const mask = r.u8();
    const kind = r.u8();
    const num = r.u16();
    const fields: { x: number; y: number }[] = [];
    if (num > 0) {
      const raw = r.bytes(num * 2);
      for (let k = 0; k < num; k++) fields.push({ x: raw[k * 2]!, y: raw[k * 2 + 1]! });
    }
    items.push({ xStart, yStart, bmp, mask, kind, fields });
  }

  // 6) bitmap count, then object bitmaps (URoom.pas:1266-1272)
  const numBmp = r.i32();
  const wallBmp = items[0]!.bmp; // Items[wall]^.BMP
  const bitmaps: (FfrBitmap | null)[] = [null]; // 1-based
  for (let i = 1; i <= wallBmp - 1; i++) bitmaps.push(readBitMapExtra(r));
  for (let i = wallBmp; i <= numBmp; i++) bitmaps.push(readBitMap(r));

  // 7) fish head/body animations (URoom.pas:1274-1300)
  const headsBig = readAnim(r, FFR_HL_MAX, 'HB'); // big-fish heads
  const headsSmall = readAnim(r, FFR_HL_MAX, 'HL'); // small-fish heads
  const bodiesBig = readAnim(r, FFR_TL_MAX, 'TB'); // big-fish bodies
  const bodiesSmall = readAnim(r, FFR_TL_MAX, 'TL'); // small-fish bodies

  // 8) palette: 256 * (b,g,r) (URoom.pas:1309)
  const palRaw = r.bytes(256 * 3);
  const palette: FfrPaletteEntry[] = [];
  for (let i = 0; i < 256; i++) {
    palette.push({ b: palRaw[i * 3]!, g: palRaw[i * 3 + 1]!, r: palRaw[i * 3 + 2]! });
  }

  if (!r.atEnd) {
    throw new Error(`FFR parse did not reach EOF: ${r.remaining} trailing byte(s) at offset ${r.offset}`);
  }

  return {
    toc,
    descriptionRaw,
    descriptionCz,
    descriptionEn,
    startFacingRight: { small: d0 !== 0, big: d1 !== 0 },
    wamp,
    wper,
    wspd,
    width,
    height,
    itemCount,
    items,
    numBmp,
    bitmaps,
    heads: { big: headsBig, small: headsSmall },
    bodies: { big: bodiesBig, small: bodiesSmall },
    palette,
    bytesConsumed: r.offset,
  };
}
