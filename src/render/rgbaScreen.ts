/**
 * RGBA compositor framebuffer — the CPU render target for the staged WebGL
 * refactor. It composites exactly like `IndexedScreen` (same
 * faithful Delphi blit geometry, same palette-index mask tests and read-back
 * effects) but maintains, alongside the palette-index plane, a live RGBA plane
 * coloured through a pluggable `ArtSource`.
 *
 * Two co-resident planes:
 *   - `idx`  (Uint8, w*h)   — the palette index at each pixel. Drives every mask
 *                            test and the in-place read-back effects (the mirror's
 *                            index-equality compare), exactly as `IndexedScreen`.
 *   - `rgba` (Uint8, w*h*4) — the displayed colour. Written on every index write
 *                            by copying four bytes from the art source's LUT.
 *
 * For the classic art source `rgba[p] === lut[idx[p]]` holds after every write,
 * so `RgbaScreen.rgba` is byte-for-byte identical to the old
 * `IndexedScreen.toRgba(palette)` conversion (the regression gate proves this
 * across every room). The RGBA plane only diverges from the index plane once the
 * enhanced (truecolor) art source lands in P2 and paints colours that have no
 * palette index — at which point this same compositor renders enhanced with no
 * second render, no pixel diff, and no suppression maps.
 *
 * Every blit primitive here mirrors its `IndexedScreen` counterpart; the only
 * change is that each index write goes through `put`, which also updates `rgba`.
 */
import { FFR_EXTRA } from '../data/ffr.js';
import { delphiRound, RANDPOLE, cpuMirror, cpuDrawRope } from './framebuffer.js';
import type { FfrBitmap } from '../data/ffr.js';
import type { CompositeTarget, TruecolorTarget } from './framebuffer.js';
import type { ArtSource } from './artSource.js';

export class RgbaScreen implements TruecolorTarget {
  /** Palette-index plane (drives mask tests + read-back effects). */
  readonly idx: Uint8Array;
  /** Displayed RGBA plane (index coloured through the art source LUT). */
  readonly rgba: Uint8Array;
  private readonly lut: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    art: ArtSource,
    fill = 0,
  ) {
    this.idx = new Uint8Array(width * height);
    this.rgba = new Uint8Array(width * height * 4);
    this.lut = art.lut;
    if (fill !== 0) this.fillIndex(fill);
    else this.paintAll(0); // colour the initially-zero index plane
  }

  /** Write palette index `a` at linear pixel offset `p`, updating both planes. */
  private put(p: number, a: number): void {
    this.idx[p] = a;
    const lut = this.lut;
    const lo = a << 2;
    const o = p << 2;
    this.rgba[o] = lut[lo]!;
    this.rgba[o + 1] = lut[lo + 1]!;
    this.rgba[o + 2] = lut[lo + 2]!;
    this.rgba[o + 3] = lut[lo + 3]!;
  }

  /** Colour the entire rgba plane from the current index plane (init helper). */
  private paintAll(a: number): void {
    const lut = this.lut;
    const lo = a << 2;
    const r = lut[lo]!;
    const g = lut[lo + 1]!;
    const b = lut[lo + 2]!;
    const al = lut[lo + 3]!;
    const rgba = this.rgba;
    for (let o = 0; o < rgba.length; o += 4) {
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      rgba[o + 3] = al;
    }
  }

  getIndex(x: number, y: number): number {
    return this.idx[y * this.width + x]!;
  }

  setIndex(x: number, y: number, a: number): void {
    this.put(y * this.width + x, a);
  }

  /**
   * Copy a whole pixel — both the index plane and the displayed rgba plane —
   * from (sx,sy) to (dx,dy). Unlike setIndex(getIndex(...)) this preserves the
   * *colour* at the source, so the spec=1 mirror reflection shows the truecolor
   * (enhanced) scene, not a palette re-lookup. For the classic art source
   * rgba[src] === lut[idx[src]], so this stays byte-identical to a re-lookup.
   */
  copyPixel(dx: number, dy: number, sx: number, sy: number): void {
    const dp = dy * this.width + dx;
    const sp = sy * this.width + sx;
    this.idx[dp] = this.idx[sp]!;
    const od = dp << 2;
    const os = sp << 2;
    this.rgba[od] = this.rgba[os]!;
    this.rgba[od + 1] = this.rgba[os + 1]!;
    this.rgba[od + 2] = this.rgba[os + 2]!;
    this.rgba[od + 3] = this.rgba[os + 3]!;
  }

  fillIndex(a: number): void {
    this.idx.fill(a);
    this.paintAll(a);
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
        this.put(drow + dx, a);
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
        this.put(drow + dx, a);
      }
    }
  }

  /** KresliR base-pose (Split=0); rev draws leftward from x. */
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
        this.put(drow + dx, a);
      }
    }
  }

  /** Kresli2: wall over the water-wobbled background (see IndexedScreen.blit2). */
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
        this.put(drow + dx, a);
      }
    }
  }

  /** KresliK: dithered dissolve blit for a dying fish's skeleton. */
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
        this.put(drow + dx, a);
      }
    }
  }

  /** KresliR: composite a fish (head over the front `split` columns, body behind). */
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
        this.put(drow + dx, a);
      }
    }
  }

  /** KresliZX: the gspec=42 ZX-Spectrum wall render (see IndexedScreen.blitZX). */
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
        st.cur = st.cur === 0 ? 1 : st.cur === 1 ? 0 : st.cur === 2 ? 3 : 2;
      }
      const band = colors[st.cur] ?? 0;
      for (let j = 0; j < iw; j++) {
        const a = wall.pixels[wRow + j]!;
        const dx = x + j;
        if (dx < 0 || dx >= this.width) continue;
        this.put(drow + dx, a === mask ? bg.pixels[bgRow + j]! : band);
      }
    }
  }

  /** KresliZrcadlo mirror — shared CPU implementation (copyPixel carries truecolor). */
  mirror(x: number, y: number, dx: number, dy: number): void {
    cpuMirror(this, x, y, dx, dy);
  }

  /** KresliDvojlano double rope — shared CPU implementation. */
  drawRope(x1: number, y1: number, x2: number, y2: number, col: number): void {
    cpuDrawRope(this, x1, y1, x2, y2, col);
  }

  /**
   * Enhanced (truecolor) background — the RGBA counterpart of `blit2` (P2). The
   * per-pixel wall-opaque-vs-background decision is taken from the CLASSIC wall
   * mask exactly as `blit2` does, so the `idx` plane ends up byte-identical to
   * the classic background (preserving structure); the `rgba` plane is filled
   * from the FFNG truecolor masters instead of the palette. `ffngWall`/`ffngBg`
   * are straight RGBA (W*H*4) with no FFR_EXTRA padding, so the wobbled
   * background column is clamped to the image (the FFNG `-p` masters have no
   * padding). Drawn full-screen at (0,0).
   */
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
  ): void {
    const iw = classicWall.w;
    const ih = classicWall.h;
    const W = this.width;
    for (let i = 0; i < ih; i++) {
      if (i >= this.height) break;
      const k = delphiRound((wamp / 2) * Math.sin(i / wper + count / wspd));
      const wRow = i * iw;
      const bgRow = i * classicBg.w + (k + FFR_EXTRA);
      const drow = i * W;
      for (let j = 0; j < iw; j++) {
        if (j >= W) break;
        const p = drow + j;
        const o = p << 2;
        const wallIdx = classicWall.pixels[wRow + j]!;
        if (wallIdx === mask) {
          // Background: classic bg index for structure; FFNG bg texel (wobbled) for colour.
          this.idx[p] = classicBg.pixels[bgRow + j]!;
          let bx = j + k;
          if (bx < 0) bx = 0;
          else if (bx >= W) bx = W - 1;
          const so = (i * W + bx) << 2;
          this.rgba[o] = ffngBg[so]!;
          this.rgba[o + 1] = ffngBg[so + 1]!;
          this.rgba[o + 2] = ffngBg[so + 2]!;
          this.rgba[o + 3] = 255;
        } else {
          // Opaque wall: classic wall index for structure; FFNG wall texel for colour.
          this.idx[p] = wallIdx;
          const so = p << 2;
          this.rgba[o] = ffngWall[so]!;
          this.rgba[o + 1] = ffngWall[so + 1]!;
          this.rgba[o + 2] = ffngWall[so + 2]!;
          this.rgba[o + 3] = 255;
        }
      }
    }
  }

  /**
   * Alpha-blend a straight-RGBA truecolor sprite into the `rgba` plane (P2
   * enhanced object/fish overlay). `mirror` flips it within [x0, x0+sw-1]
   * (KresliRev geometry). The `idx` plane is left untouched — the sprite is a
   * display-only overlay on top of the classic-structured background; enhanced
   * rooms have no index read-back effects (mirror/ZX/darkness are ineligible).
   */
  blitSpriteRgba(rgba: Uint8Array, sw: number, sh: number, x0: number, y0: number, mirror: boolean): void {
    for (let i = 0; i < sh; i++) {
      const dy = y0 + i;
      if (dy < 0 || dy >= this.height) continue;
      for (let j = 0; j < sw; j++) {
        const so = (i * sw + j) << 2;
        const av = rgba[so + 3]!;
        if (av === 0) continue;
        const dx = mirror ? x0 + sw - 1 - j : x0 + j;
        if (dx < 0 || dx >= this.width) continue;
        const o = (dy * this.width + dx) << 2;
        if (av === 255) {
          this.rgba[o] = rgba[so]!;
          this.rgba[o + 1] = rgba[so + 1]!;
          this.rgba[o + 2] = rgba[so + 2]!;
          this.rgba[o + 3] = 255;
        } else {
          const ia = 255 - av;
          this.rgba[o] = ((rgba[so]! * av + this.rgba[o]! * ia) / 255) | 0;
          this.rgba[o + 1] = ((rgba[so + 1]! * av + this.rgba[o + 1]! * ia) / 255) | 0;
          this.rgba[o + 2] = ((rgba[so + 2]! * av + this.rgba[o + 2]! * ia) / 255) | 0;
          this.rgba[o + 3] = 255;
        }
      }
    }
  }
}