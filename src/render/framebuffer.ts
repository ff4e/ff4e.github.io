/**
 * Software-paletted 8-bit framebuffer, matching the original engine's indexed
 * `BMScreen` (a 256-colour DirectDraw surface). All compositing happens in
 * palette-index space exactly as the Delphi blitters do; the RGBA conversion
 * via the room palette is applied once at the end. This keeps the port on the
 * "software-paletted first, exact pixels" path.
 *
 * The blit primitives are faithful ports of the URoom.pas assembler routines:
 *   blit      <- Kresli      (URoom.pas:25005) — masked copy, left-to-right
 *   blitRev   <- KresliRev   (URoom.pas:25041) — masked copy, mirrored in [x, x+w-1]
 *   blit2     <- Kresli2      (URoom.pas:25123) — wall over water-wobbled background
 *   blitFishBody <- KresliR   (URoom.pas:25262) with a nil head (Split=0): the
 *                              fish base pose; non-rev = leftward-anchored copy,
 *                              rev = drawn right-to-left starting at x (leftward).
 */
import type { FfrBitmap, FfrPaletteEntry } from '../data/ffr.js';
import { FFR_EXTRA } from '../data/ffr.js';

/**
 * randpole (URoom.pas:441, filled at :27032 with random(256)): a 256-byte
 * threshold table used by KresliK's dithered dissolve. The original indexes it
 * as randpole[((i*W) and 255) + j], reading past the 256-byte array for wide
 * sprites (a latent overread); we index with wraparound, preserving the random
 * dithering the effect relies on. Seeded for determinism.
 */
export const RANDPOLE = ((): Uint8Array => {
  const t = new Uint8Array(256);
  let s = 0x9e3779b9 >>> 0; // fixed seed
  for (let i = 0; i < 256; i++) {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    t[i] = ((x ^ (x >>> 14)) >>> 0) & 255;
  }
  return t;
})();

/** Delphi's Round: round to nearest, ties to even (banker's rounding). */
export function delphiRound(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/**
 * The minimal write surface the subtitle renderer needs: a framebuffer it can
 * poke individual palette-index pixels into. Both `IndexedScreen` and the
 * RGBA compositor implement it, so baked (classic) subtitles work on either.
 */
export interface PixelTarget {
  readonly width: number;
  readonly height: number;
  /** Set the pixel at (x,y) to palette index `idx` (bounds are the caller's job). */
  setIndex(x: number, y: number, idx: number): void;
}

/**
 * The full compositor write surface — every faithful blit primitive plus the
 * per-pixel helpers the in-place effects (mirror, ropes, hooks) use. The room
 * compositor (`renderInto`) is written once against this interface so it can
 * target either the palette-indexed `IndexedScreen` or the RGBA framebuffer,
 * with the pluggable art source deciding the colours. The blit primitives are
 * concrete on each implementation (no per-pixel virtual dispatch in hot loops);
 * only the small-region effects use `getIndex`/`setIndex`.
 */
export interface CompositeTarget extends PixelTarget {
  /** Read the palette index at (x,y). */
  getIndex(x: number, y: number): number;
  /** Copy the pixel at (sx,sy) to (dx,dy) — index and, for RGBA targets, colour. */
  copyPixel(dx: number, dy: number, sx: number, sy: number): void;
  /** Fill the whole frame with a single palette index (e.g. gspec=2 darkness). */
  fillIndex(idx: number): void;
  blit(x: number, y: number, bm: FfrBitmap, mask: number): void;
  blitRev(x: number, y: number, bm: FfrBitmap, mask: number): void;
  blitFishBody(x: number, y: number, bm: FfrBitmap, mask: number, rev: boolean): void;
  blit2(
    x: number, y: number, wall: FfrBitmap, bg: FfrBitmap, mask: number,
    count: number, wamp: number, wper: number, wspd: number,
  ): void;
  blitDisintegrate(x: number, y: number, bm: FfrBitmap, mask: number, rozpad: number, rev: boolean): void;
  blitFishComposite(
    x: number, y: number, body: FfrBitmap, head: FfrBitmap | null, mask: number, split: number, rev: boolean,
  ): void;
  blitZX(
    x: number, y: number, wall: FfrBitmap, bg: FfrBitmap, mask: number,
    count: number, wamp: number, wper: number, wspd: number,
    colors: readonly number[], st: { pruh: number; count: number; cur: number },
  ): void;
  /** KresliZrcadlo (spec=1) mirror reflection over the glass rect (x,y,dx,dy). */
  mirror(x: number, y: number, dx: number, dy: number): void;
  /** KresliDvojlano: the elevator's double rope from (x1,y1) to (x2,y2). */
  drawRope(x1: number, y1: number, x2: number, y2: number, col: number): void;
}

/**
 * A `CompositeTarget` that can also composite the FFNG truecolor (enhanced) art:
 * a truecolor background (`blit2Rgba`) and alpha-blended sprite quads
 * (`blitSpriteRgba`). Both the CPU `RgbaScreen` and the WebGL `GlScreen` provide
 * these, so the enhanced art source narrows to this capability instead of a
 * concrete class — the backend stays a free choice. The pure-palette
 * `IndexedScreen` (the classic byte-exact oracle) does NOT implement it and is
 * never used for enhanced.
 */
export interface TruecolorTarget extends CompositeTarget {
  /** Enhanced background: classic wall mask decides structure, FFNG texels the colour. */
  blit2Rgba(
    classicWall: FfrBitmap,
    classicBg: FfrBitmap,
    ffngWall: Uint8Array,
    ffngBg: Uint8Array,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
  ): void;
  /** Alpha-blend a straight-RGBA truecolor sprite (display-only; index plane untouched). */
  blitSpriteRgba(rgba: Uint8Array, sw: number, sh: number, x0: number, y0: number, mirror: boolean): void;
}

/** Narrowing guard: does this target support the FFNG truecolor (enhanced) blitters? */
export function isTruecolorTarget(t: CompositeTarget): t is TruecolorTarget {
  return typeof (t as TruecolorTarget).blit2Rgba === 'function';
}

/**
 * KresliZrcadlo (URoom.pas:25822): the mirror reflection, written once against
 * `CompositeTarget` so every CPU target shares it (the GPU target overrides it
 * with a shader pass). The pixel at the mirror's centre is the reflective
 * "glass" colour; then, per row, each glass pixel at column X+k is overwritten
 * with the pixel at column X+3-k — a horizontal flip about X+1.5 mirroring the
 * scene to the glass's left. Runs in-place, left-to-right, exactly like the
 * original asm (the near-axis self-reference reads glass→glass, a no-op, so the
 * result is a pure reflection of the pre-mirror buffer).
 */
export function cpuMirror(screen: CompositeTarget, X: number, Y: number, dx: number, dy: number): void {
  if (dx <= 0 || dy <= 0) return;
  const cx = X + (dx >> 1);
  const cy = Y + (dy >> 1);
  if (cx < 0 || cx >= screen.width || cy < 0 || cy >= screen.height) return;
  const mask = screen.getIndex(cx, cy);
  for (let i = 0; i < dy; i++) {
    const y = Y + i;
    if (y < 0 || y >= screen.height) continue;
    for (let k = 0; k < dx; k++) {
      const dCol = X + k;
      const sCol = X + 3 - k;
      if (dCol < 0 || dCol >= screen.width) continue;
      if (sCol < 0 || sCol >= screen.width) continue;
      if (screen.getIndex(dCol, y) === mask) screen.copyPixel(dCol, y, sCol, y);
    }
  }
}

/**
 * KresliDvojlano (URoom.pas:25863): two parallel "ropes" 4px apart from (x1,y1)
 * down to (x2,y2), the x stepped by the accumulated slope so the pair leans with
 * the endpoints. Only draws downward (y2 >= y1), as the lift always hangs below
 * the gear. Shared by all CPU targets; the GPU target drives it through setIndex.
 */
export function cpuDrawRope(
  screen: CompositeTarget,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  col: number,
): void {
  if (y2 <= y1) return; // guards div-by-zero and the empty for-loop
  const d = (x2 - x1) / (y2 - y1);
  let r = 0.5;
  let x = x1;
  for (let y = y1; y <= y2; y++) {
    while (r > 1) {
      x++;
      r -= 1;
    }
    while (r < 0) {
      x--;
      r += 1;
    }
    r += d;
    if (y < 0 || y >= screen.height) continue;
    if (x >= 0 && x < screen.width) screen.setIndex(x, y, col);
    if (x + 4 >= 0 && x + 4 < screen.width) screen.setIndex(x + 4, y, col);
  }
}

export class IndexedScreen implements CompositeTarget {
  readonly px: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    fill = 0,
  ) {
    this.px = new Uint8Array(width * height).fill(fill);
  }

  getIndex(x: number, y: number): number {
    return this.px[y * this.width + x]!;
  }

  setIndex(x: number, y: number, idx: number): void {
    this.px[y * this.width + x] = idx;
  }

  copyPixel(dx: number, dy: number, sx: number, sy: number): void {
    this.px[dy * this.width + dx] = this.px[sy * this.width + sx]!;
  }

  fillIndex(idx: number): void {
    this.px.fill(idx);
  }

  /** Kresli: copy `bm` at (x,y), skipping pixels equal to `mask`. */
  blit(x: number, y: number, bm: FfrBitmap, mask: number): void {
    const { w, h, pixels } = bm;
    for (let i = 0; i < h; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const srow = i * w;
      const drow = sy * this.width;
      for (let j = 0; j < w; j++) {
        const a = pixels[srow + j]!;
        if (a === mask) continue;
        const dx = x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /** KresliRev: like blit but mirrored, occupying columns [x, x+w-1]. */
  blitRev(x: number, y: number, bm: FfrBitmap, mask: number): void {
    const { w, h, pixels } = bm;
    for (let i = 0; i < h; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const srow = i * w;
      const drow = sy * this.width;
      for (let j = 0; j < w; j++) {
        const a = pixels[srow + j]!;
        if (a === mask) continue;
        const dx = x + w - 1 - j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /**
   * KresliR base-pose (Split=0). non-rev is identical to blit. rev draws the
   * source left-to-right but writing columns x, x-1, x-2, ... (leftward from x),
   * matching the fish-facing-right call `KresliR(X*fsize+dxryby-1, ..., true)`.
   */
  blitFishBody(x: number, y: number, bm: FfrBitmap, mask: number, rev: boolean): void {
    if (!rev) {
      this.blit(x, y, bm, mask);
      return;
    }
    const { w, h, pixels } = bm;
    for (let i = 0; i < h; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const srow = i * w;
      const drow = sy * this.width;
      for (let j = 0; j < w; j++) {
        const a = pixels[srow + j]!;
        if (a === mask) continue;
        const dx = x - j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /**
   * Kresli2: draw the wall bitmap `wall` at (x,y); where a wall pixel equals
   * `mask`, show the `bg` background instead, sampled with the per-row water
   * displacement `k = round(wamp/2 * sin(i/wper + count/wspd))`. `bg` is an
   * ReadBitMapExtra bitmap padded by FFR_EXTRA on each side, so the sample
   * origin is (extra + k).
   */
  blit2(
    x: number,
    y: number,
    wall: FfrBitmap,
    bg: FfrBitmap,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
  ): void {
    const iw = wall.w;
    const ih = wall.h;
    for (let i = 0; i < ih; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const k = delphiRound((wamp / 2) * Math.sin(i / wper + count / wspd));
      const wRow = i * iw;
      const bgRow = i * bg.w + (k + FFR_EXTRA);
      const drow = sy * this.width;
      for (let j = 0; j < iw; j++) {
        let a = wall.pixels[wRow + j]!;
        if (a === mask) a = bg.pixels[bgRow + j]!;
        const dx = x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /**
   * KresliK (URoom.pas:25448): dithered dissolve blit for a dying fish's
   * skeleton. A source pixel is drawn only where randpole[idx] < rozpad, so as
   * rozpad counts down from ~255 to 0 the sprite erodes away. `rev` matches
   * blitFishBody (rev draws leftward from x).
   */
  blitDisintegrate(x: number, y: number, bm: FfrBitmap, mask: number, rozpad: number, rev: boolean): void {
    const { w, h, pixels } = bm;
    for (let i = 0; i < h; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const srow = i * w;
      const drow = sy * this.width;
      const pBase = (i * w) & 255;
      for (let j = 0; j < w; j++) {
        const a = pixels[srow + j]!;
        if (a === mask) continue;
        if (RANDPOLE[(pBase + j) & 255]! >= rozpad) continue; // erode
        const dx = rev ? x - j : x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /**
   * KresliR (URoom.pas:25262): composite a fish, drawing the head sprite over
   * the front `split` (dxhlavy) columns and the body sprite behind it. A null
   * head (split 0) degenerates to a plain body blit. `rev` mirrors the sprite,
   * anchored at x (the head-front), extending left — matching blitFishBody.
   */
  blitFishComposite(
    x: number,
    y: number,
    body: FfrBitmap,
    head: FfrBitmap | null,
    mask: number,
    split: number,
    rev: boolean,
  ): void {
    if (!head) split = 0;
    const iw = body.w;
    const ih = body.h;
    for (let i = 0; i < ih; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const drow = sy * this.width;
      for (let j = 0; j < iw; j++) {
        // Front `split` columns come from the head sprite, the rest from the body.
        let a: number;
        if (j < split && head) {
          if (j >= head.w) continue;
          a = head.pixels[i * head.w + j]!;
        } else {
          a = body.pixels[i * iw + j]!;
        }
        if (a === mask) continue;
        const dx = rev ? x - j : x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a;
      }
    }
  }

  /**
   * KresliZX (URoom.pas:25177): the gspec=42 "ZX-Spectrum emulator" wall render. Like
   * blit2 (water-wobbled background shows through the wall's mask pixels), but every
   * OPAQUE wall pixel is replaced by a flat band colour that cycles down the screen in
   * horizontal stripes of height ~`st.pruh` scanlines (the loading-screen attribute
   * effect). `colors` = [ZX1,ZX2,ZX3,ZX4] (the wall's four corner colours); `st.cur`
   * indexes it and alternates within its pair (0<->1 tall bands, 2<->3 thin stripes);
   * `st.count` accumulates fractional scanlines across frames.
   */
  blitZX(
    x: number,
    y: number,
    wall: FfrBitmap,
    bg: FfrBitmap,
    mask: number,
    count: number,
    wamp: number,
    wper: number,
    wspd: number,
    colors: readonly number[],
    st: { pruh: number; count: number; cur: number },
  ): void {
    const iw = wall.w;
    const ih = wall.h;
    for (let i = 0; i < ih; i++) {
      const sy = y + i;
      if (sy < 0 || sy >= this.height) continue;
      const k = delphiRound((wamp / 2) * Math.sin(i / wper + count / wspd));
      const wRow = i * iw;
      const bgRow = i * bg.w + (k + FFR_EXTRA);
      const drow = sy * this.width;
      st.count += 1;
      if (st.count > st.pruh) {
        st.count -= st.pruh;
        // ZX1<->ZX2 (indices 0,1) or ZX3<->ZX4 (indices 2,3).
        st.cur = st.cur === 0 ? 1 : st.cur === 1 ? 0 : st.cur === 2 ? 3 : 2;
      }
      const band = colors[st.cur] ?? 0;
      for (let j = 0; j < iw; j++) {
        const a = wall.pixels[wRow + j]!;
        const dx = x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.px[drow + dx] = a === mask ? bg.pixels[bgRow + j]! : band;
      }
    }
  }

  /** KresliZrcadlo mirror (shared CPU implementation). */
  mirror(x: number, y: number, dx: number, dy: number): void {
    cpuMirror(this, x, y, dx, dy);
  }

  /** KresliDvojlano double rope (shared CPU implementation). */
  drawRope(x1: number, y1: number, x2: number, y2: number, col: number): void {
    cpuDrawRope(this, x1, y1, x2, y2, col);
  }

  /** Convert the indexed screen to an RGBA buffer using the room palette. */
  toRgba(palette: readonly FfrPaletteEntry[]): Uint8Array {
    const out = new Uint8Array(this.width * this.height * 4);
    for (let i = 0; i < this.px.length; i++) {
      const c = palette[this.px[i]!]!;
      const o = i * 4;
      out[o] = c.r;
      out[o + 1] = c.g;
      out[o + 2] = c.b;
      out[o + 3] = 255;
    }
    return out;
  }
}
