/**
 * The cheat codes (Uovl.pas:166-182, ZaznamenejPrikazKlavesou Uovl.pas:744-776,
 * dispatch URoom.pas:24534-24690 and its map-screen twin UMain.pas:1750-1786).
 *
 * The shipping Delphi source stores the twelve cheat words XOR-obfuscated (built
 * by `Xor/Cheaty.pas`) against the key 113 * 113^n mod 256, with the plaintext
 * surviving only in the commented-out original at `Uovl.pas:166-168`. Decoding
 * the shipped table gives the authoritative spellings — note `WEMAKETHERULEZ`
 * ends in a Z, and the Tetris code is `TETRIS`, not the `xcubes` its stale
 * dispatch comment claims.
 *
 * These are live retail features, not dev tools: `ZaznamenejPrikazKlavesou` is
 * not `develop`-gated the way the `#116..#122` dev keys at `Uovl.pas:882-910` are.
 *
 * Entry model: `X` arms the buffer, each following letter extends it, and a
 * letter repeated immediately is swallowed rather than appended (so `XSTTORM`
 * still fires STORM). The moment the buffer stops being a prefix of any cheat the
 * machine latches the `nocheat` sentinel and stays inert until the next `X` — so
 * a stray letter cannot silently keep a half-typed code alive.
 */
import type { FfrBitmap } from '../data/ffr.js';

/** The twelve cheat words, in table order — the index IS the dispatch code. */
export const CHEATS = [
  'MEGABOMB', // 1  kill both fish (URoom.pas:24534)
  'TETRIS', // 2  the Tetris minigame (URoom.pas:24564, UMain.pas:1764)
  'UNDEAD', // 3  flip the fish sprites (URoom.pas:24573)
  'MORPH', // 4  swap the fish sprite shapes (URoom.pas:24588)
  'FISHER', // 5  drop a fishing hook (URoom.pas:24597)
  'STORM', // 6  storm water (URoom.pas:24607)
  'INTERLACED', // 7  interlaced screen collapse (URoom.pas:24627)
  'SILENT', // 8  silent-film mode (URoom.pas:24641)
  'WEMAKETHERULEZ', // 9  solve the room (URoom.pas:24666)
  'IAMACHEATER', // 10 no-op — its body is commented out (URoom.pas:24680)
  'SCORE', // 11 open the SCORE bonus room (UMain.pas:1773, map screen only)
  'ULTRAVIOLENCE', // 12 auto-start the fishing hooks (UMain.pas:1779, map screen only)
] as const;

export type Cheat = (typeof CHEATS)[number];

/** `nocheat` (Uovl.pas:215): the sentinel that parks the machine until the next `X`. */
const NOCHEAT = '$$$';

/** What the host should do with the key that was just fed in. */
export interface CheatKeyResult {
  /**
   * True when the cheat machine consumed the key (`result:=true; akce:=dir_no`) —
   * the host must not also treat it as a normal game key.
   */
  swallowed: boolean;
  /** The cheat that just completed, or null. */
  cheat: Cheat | null;
}

const MISS: CheatKeyResult = { swallowed: false, cheat: null };
const EATEN: CheatKeyResult = { swallowed: true, cheat: null };

/**
 * The typed-cheat state machine. One instance per screen that accepts cheats
 * (the room keeps `cheatstring`, the map its own `dircheat` — Uovl.pas:744 /
 * UMain.pas:1726 — and the two never share a buffer).
 */
export class CheatEntry {
  /** `cheatstring` / `dircheat`: the letters typed since `X`, or the sentinel. */
  private buf = NOCHEAT;

  /** True while a code is part-typed (i.e. `X` was pressed and still matches). */
  get armed(): boolean {
    return this.buf !== NOCHEAT;
  }

  /** Park the machine (what each dispatch body does: `cheatstring:=nocheat`). */
  reset(): void {
    this.buf = NOCHEAT;
  }

  /**
   * Feed a key that cannot extend any code (an arrow, Space, Backspace, a function
   * key...). The original runs every key through the buffer, so such a key breaks
   * the prefix and parks the machine, then falls through to its normal action —
   * which is why you cannot type half a code, press Backspace, and finish it.
   */
  cancel(): CheatKeyResult {
    this.buf = NOCHEAT;
    return MISS;
  }

  /**
   * Feed one key. `key` is a single character; letters are matched
   * case-insensitively (the original sees the uppercase VK char).
   */
  press(key: string): CheatKeyResult {
    const ch = key.toUpperCase();
    if (ch.length !== 1) return MISS;
    if (ch === 'X') {
      this.buf = ''; // `ord('X'): dirCheat:=''` — arm/re-arm, and swallow the X
      return EATEN;
    }
    if (this.buf === NOCHEAT) return MISS;
    // A key held/repeated is not appended twice (`if key<>cheatstring[length]`).
    if (this.buf === '' || ch !== this.buf[this.buf.length - 1]) this.buf += ch;
    const hit = CHEATS.find((c) => c.startsWith(this.buf));
    if (hit === undefined) {
      // No cheat starts with this any more: latch the sentinel and let the key
      // through to the normal handler (the Delphi falls into its `case key of`).
      this.buf = NOCHEAT;
      return MISS;
    }
    if (hit === this.buf) {
      this.buf = NOCHEAT;
      return { swallowed: true, cheat: hit };
    }
    return EATEN;
  }
}

// ---------------------------------------------------------------------------
// Sprite transforms used by the UNDEAD and MORPH cheats.
// ---------------------------------------------------------------------------

/**
 * `pretoc` (URoom.pas:23892): flip a sprite vertically, in a fresh bitmap. The
 * UNDEAD cheat applies it to every fish head and body frame, so the fish swim
 * upside down like little zombies.
 */
export function pretoc(bm: FfrBitmap): FfrBitmap {
  const pixels = new Uint8Array(bm.pixels.length);
  for (let y = 0; y < bm.h; y++) {
    const src = (bm.h - 1 - y) * bm.w;
    pixels.set(bm.pixels.subarray(src, src + bm.w), y * bm.w);
  }
  return { w: bm.w, h: bm.h, pixels, padded: bm.padded };
}

/**
 * `morph` (URoom.pas:23832), shrink half: the little fish takes the BIG fish's
 * sprite squeezed to 3/4 width and half height — every other source row, and
 * every third source column dropped.
 */
export function morphShrink(big: FfrBitmap): FfrBitmap {
  const w = big.w - Math.floor(big.w / 4);
  const h = Math.floor(big.h / 2);
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = y * 2 * big.w;
    let d = y * w;
    for (let x = 1; x <= w; x++) {
      pixels[d++] = big.pixels[s++]!;
      if (x % 3 === 0) s++;
    }
  }
  return { w, h, pixels, padded: 0 };
}

/**
 * `morph` (URoom.pas:23832), stretch half: the big fish takes the LITTLE fish's
 * sprite blown up to 4/3 width and double height — each source row twice, and
 * every fourth destination column a repeat of the previous source pixel.
 */
export function morphStretch(little: FfrBitmap): FfrBitmap {
  const w = little.w + Math.floor(little.w / 3);
  const h = little.h * 2;
  const pixels = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = Math.floor(y / 2) * little.w;
    let d = y * w;
    for (let x = 1; x <= w; x++) {
      pixels[d++] = little.pixels[s]!;
      if (x % 4 !== 1) s++;
    }
  }
  return { w, h, pixels, padded: 0 };
}

// ---------------------------------------------------------------------------
// The same transforms over truecolor sprites.
//
// In enhanced (truecolor) mode the fish are not drawn from the FFR head/body
// frames at all — the enhanced art source blits its own RGBA sprites — so
// UNDEAD and MORPH have to reshape those too, or they do nothing in the mode the
// game ships in. Same arithmetic, four bytes per pixel instead of one.
// ---------------------------------------------------------------------------

/** A truecolor sprite (structurally `EnhancedSprite`). */
export interface RgbaSprite {
  readonly w: number;
  readonly h: number;
  readonly rgba: Uint8Array;
}

/** Copy the 4-byte pixel at source offset `s` to destination offset `d`. */
function copyPx(dst: Uint8Array, d: number, src: Uint8Array, s: number): void {
  dst[d] = src[s]!;
  dst[d + 1] = src[s + 1]!;
  dst[d + 2] = src[s + 2]!;
  dst[d + 3] = src[s + 3]!;
}

/** `pretoc` over a truecolor sprite: flip it vertically. */
export function pretocRgba(bm: RgbaSprite): RgbaSprite {
  const rgba = new Uint8Array(bm.rgba.length);
  const stride = bm.w * 4;
  for (let y = 0; y < bm.h; y++) {
    const src = (bm.h - 1 - y) * stride;
    rgba.set(bm.rgba.subarray(src, src + stride), y * stride);
  }
  return { w: bm.w, h: bm.h, rgba };
}

/** `morph` shrink half over a truecolor sprite: 3/4 width, half height. */
export function morphShrinkRgba(big: RgbaSprite): RgbaSprite {
  const w = big.w - Math.floor(big.w / 4);
  const h = Math.floor(big.h / 2);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    let s = y * 2 * big.w;
    let d = y * w;
    for (let x = 1; x <= w; x++) {
      copyPx(rgba, d++ * 4, big.rgba, s++ * 4);
      if (x % 3 === 0) s++;
    }
  }
  return { w, h, rgba };
}

/** `morph` stretch half over a truecolor sprite: 4/3 width, double height. */
export function morphStretchRgba(little: RgbaSprite): RgbaSprite {
  const w = little.w + Math.floor(little.w / 3);
  const h = little.h * 2;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    let s = Math.floor(y / 2) * little.w;
    let d = y * w;
    for (let x = 1; x <= w; x++) {
      copyPx(rgba, d++ * 4, little.rgba, s * 4);
      if (x % 4 !== 1) s++;
    }
  }
  return { w, h, rgba };
}
