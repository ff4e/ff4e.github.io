/**
 * Subtitle system: colour mapping, glyph rendering, and the scrolling line
 * manager, ported from URoom.pas.
 *
 *   SearchColors     (URoom.pas:1082-1141) -> per-room fontcol / fontcol2
 *   PisStringF       (URoom.pas:25572-25625) -> drawText (with the wave-in)
 *   NovyTitulek/NovyRadekTitulku/PosunTitulky/KresliTitulky (URoom.pas:505-623,
 *                     25638) -> newSubtitle / tick / draw
 */
import type { FfrPaletteEntry } from '../data/ffr.js';
import type { FontData } from './font.js';
import type { PixelTarget } from './framebuffer.js';

// Subtitle layout constants (URoom.pas:140-161).
const ROWTITLE = 26;
const BASETITLE = 0;
const UNDERTITLE = 15;
const SPEEDTITLE = 2;
const TIMEPERCHARTITLE = 2;
const MINTIMETITLE = 40;
const MINYTITLE = BASETITLE - ROWTITLE * 5;
const BORDERTITLE = 20;

// Enhanced (vector) subtitle rendering.
const SUB_FONT_PX = 23; // native-pixel font size for the FreeSans-Bold overlay
const SUB_BASELINE_OFF = -6; // nudges the vector baseline to sit like the bitmap line

interface TitleLine {
  obsah: string;
  barva: string;
  xs: number;
  ys: number;
  cilys: number;
  startcount: number;
  killcount: number;
}

/**
 * Everything about a vector subtitle line that is invariant for its whole life:
 * the fitted font size, the font string, the width the centring uses and each
 * glyph's x offset from the line's left edge. Only the per-glyph wave offset
 * changes between frames, so this is measured once per (text, font) instead of
 * on every one of the ~120 overlay repaints a second.
 */
interface VectorLine {
  chars: string[];
  xs: number[];
  fs: number;
  font: string;
  total: number;
}

/** najdi_barvu (URoom.pas:1087): nearest palette index by weighted RGB distance. */
function nearestColor(pal: readonly FfrPaletteEntry[], r: number, g: number, b: number): number {
  let best = 0;
  let bestErr = Infinity;
  for (let i = 0; i < 256; i++) {
    const p = pal[i]!;
    const err = (r - p.r) ** 2 * 0.35 + (g - p.g) ** 2 * 0.5 + (b - p.b) ** 2 * 0.15;
    if (err < bestErr) {
      bestErr = err;
      best = i;
    }
  }
  return best;
}

export class SubtitleSystem {
  private readonly titles: TitleLine[] = [];
  /** Letter colour codes -> 6 palette-index shades (fontcol). */
  private readonly fontcol = new Map<string, number[]>();
  /** Digit colour codes -> two ramps of 6 shades (fontcol2). */
  private readonly fontcol2 = new Map<string, [number[], number[]]>();
  /** Measured vector layouts, keyed by weight|family|text (see VectorLine). */
  private readonly vecCache = new Map<string, VectorLine>();

  constructor(
    private readonly font: FontData,
    palette: readonly FfrPaletteEntry[],
    private readonly roomWidth: number, // cells
    private readonly screenW: number, // px
    private readonly screenH: number, // px
  ) {
    this.searchColors(palette);
  }

  /** SearchColors: map each colour code's RGB to nearest palette shades. */
  private searchColors(pal: readonly FfrPaletteEntry[]): void {
    for (const [c, col] of this.font.coltab) {
      const ramp: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = (4 - i) / 4;
        ramp.push(nearestColor(pal, Math.round(s * col.r), Math.round(s * col.g), Math.round(s * col.b)));
      }
      ramp.push(ramp[4]!); // fontcol[c,5]:=fontcol[c,4]
      this.fontcol.set(c, ramp);
    }
    // '@' fixed indices (URoom.pas:1119-1124).
    this.fontcol.set('@', [0, 10, 7, 2, 1, 1]);

    for (const [c, cols] of this.font.coltab2) {
      const ramps: [number[], number[]] = [[], []];
      for (let n = 0; n < 2; n++) {
        const col = cols[n]!;
        const ramp = ramps[n]!;
        for (let i = 0; i < 5; i++) {
          const s = (4 - i) / 4;
          ramp.push(nearestColor(pal, Math.round(s * col.r), Math.round(s * col.g), Math.round(s * col.b)));
        }
        ramp.push(ramp[4]!);
      }
      this.fontcol2.set(c, ramps);
    }
  }

  /** NovyTitulek (URoom.pas:592): word-wrap `text` to the room width, add lines.
   *  Faithful to the original: shrink the current line word-by-word (re-checking the
   *  width each time) until it fits, add it, then recurse on the remainder. */
  newSubtitle(text: string, color: string, count: number): void {
    const maxW = this.screenW - BORDERTITLE * 2;
    let obsah = text;
    for (;;) {
      let s = obsah;
      let i = s.length;
      while (this.font.textWidth(s) > maxW) {
        i = s.length;
        // Walk back to a break point (Pascal 1-based s[i]/s[i-2] -> 0-based s[i-1]/s[i-3]).
        while ((i > 0 && s[i - 1] !== ' ') || (i - 2 > 0 && s[i - 3] === ' ')) i--;
        if (i === 0) i = s.length; // a single word wider than the line: keep it whole
        s = s.slice(0, i - 1); // delete(s, i, ..) -> s[1..i-1]
      }
      this.addLine(s, color, count);
      if (s.length >= obsah.length) return; // whole string fit on this line
      obsah = obsah.slice(i); // delete(obsah, 1, i) -> obsah[i+1..], dropping the break space
    }
  }

  /** NovyRadekTitulku (URoom.pas:520): add a title line, pushing existing ones up. */
  private addLine(s: string, c: string, count: number): void {
    let lasty: number;
    if (this.titles.length === 0) {
      lasty = -1000;
    } else {
      for (const t of this.titles) t.cilys -= ROWTITLE;
      lasty = this.titles[this.titles.length - 1]!.ys;
    }
    let ys = lasty + 26;
    if (ys < BASETITLE) ys = BASETITLE;
    const len = s.length;
    let killcount = count + (len * TIMEPERCHARTITLE < MINTIMETITLE ? MINTIMETITLE : len * TIMEPERCHARTITLE);
    if (ys > 0) killcount += Math.floor(ys / SPEEDTITLE);
    this.titles.push({
      obsah: s,
      barva: c,
      xs: Math.floor((this.screenW - this.font.textWidth(s)) / 2),
      ys,
      cilys: BASETITLE - ROWTITLE,
      startcount: count,
      killcount,
    });
  }

  /** PosunTitulky (URoom.pas:563): scroll lines toward their target, expire the oldest. */
  tick(count: number): void {
    for (const t of this.titles) {
      if (t.ys > t.cilys) {
        t.ys -= SPEEDTITLE;
        if (t.ys < t.cilys) t.ys = t.cilys;
      }
    }
    const oldest = this.titles[0];
    if (oldest && (oldest.killcount < count || oldest.ys < MINYTITLE)) this.titles.shift();
  }

  clear(): void {
    this.titles.length = 0;
  }

  get active(): boolean {
    return this.titles.length > 0;
  }

  /** Total characters currently on screen (perf probes). */
  get lineChars(): number {
    let n = 0;
    for (const t of this.titles) n += t.obsah.length;
    return n;
  }

  /** Number of subtitle lines currently on screen (perf probes). */
  get lineCount(): number {
    return this.titles.length;
  }

  /** The native game-pixel box the vector layout centres in (parity probe). */
  get vectorScreen(): { w: number; h: number } {
    return { w: this.screenW, h: this.screenH };
  }

  /**
   * The state `drawVector` renders, for the parity probe: enough for an independent
   * reference implementation of PisStringF's wave to reproduce the overlay exactly.
   */
  debugLines(): { obsah: string; barva: string; ys: number; startcount: number; rgb: [number, number, number] }[] {
    return this.titles.map((t) => ({
      obsah: t.obsah,
      barva: t.barva,
      ys: t.ys,
      startcount: t.startcount,
      rgb: this.vectorColor(t.barva),
    }));
  }

  /**
   * Enhanced-graphics subtitle renderer: draw the same lines (layout, scroll and
   * per-character wave from KresliTitulky/PisStringF) as crisp vector text with a
   * dark outline and a top->bottom bevel gradient in the speaker's colour, onto a
   * high-resolution 2D overlay. The caller sets the context transform so that one
   * unit == one native game pixel (i.e. drawing happens in screenW x screenH
   * space); crispness comes from the overlay's larger backing store.
   *
   * Per frame this only issues the two text draws per glyph. The text shaping
   * (`measureText` for the fit and for every glyph advance) is memoised per line
   * in `vectorLayout`, and the bevel gradient is shared by every glyph sitting at
   * the same wave offset — which, once the wave-in has finished, is all of them.
   */
  drawVector(ctx: CanvasRenderingContext2D, count: number, fontFamily: string, weight: string | number = 700): void {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = 'rgb(5,5,12)';
    for (const t of this.titles) {
      const [r, g, b] = this.vectorColor(t.barva);
      const line = this.vectorLayout(ctx, t.obsah, fontFamily, weight);
      ctx.font = line.font;
      ctx.lineWidth = line.fs * 0.16;
      const top = `rgb(${r},${g},${b})`;
      const bottom = `rgb(${Math.round(r * 0.42)},${Math.round(g * 0.42)},${Math.round(b * 0.42)})`;
      // y here mirrors PisStringF: the line's on-screen top is ys (+screenH the
      // caller already folds into the transform origin at 0). y0 is the wave's
      // rest line; (y0 - y) == UNDERTITLE - ys drives the wave amplitude.
      const baseline = t.ys + this.screenH + SUB_BASELINE_OFF;
      const amp = UNDERTITLE - t.ys;
      const cas = count - t.startcount;
      const x0 = (this.screenW - line.total) / 2;
      // The gradient is anchored to the glyph's own baseline, so glyphs that share
      // a wave offset share one gradient object (all of them on a settled line).
      const grads = new Map<number, CanvasGradient>();
      for (let i = 0; i < line.chars.length; i++) {
        const ch = line.chars[i]!;
        const p = cas * 5 - (i + 1);
        if (p < 0 || ch === ' ') continue;
        let dy = 0;
        if (p < 50) dy = ((amp * (50 - p)) / 50) * Math.cos((3.5 * Math.PI * p) / 50);
        const gy = baseline + dy;
        let grad = grads.get(gy);
        if (grad === undefined) {
          grad = ctx.createLinearGradient(0, gy - line.fs * 0.72, 0, gy + line.fs * 0.1);
          grad.addColorStop(0, top);
          grad.addColorStop(1, bottom);
          grads.set(gy, grad);
        }
        const x = x0 + line.xs[i]!;
        ctx.strokeText(ch, x, gy);
        ctx.fillStyle = grad;
        ctx.fillText(ch, x, gy);
      }
    }
  }

  /**
   * Measure (once) the invariant layout of a vector subtitle line: fit the line to
   * the room width by shrinking the font if needed — matching the classic word-wrap
   * intent, which used bitmap metrics — then record each glyph's x offset.
   *
   * The cache is keyed by weight|family|text, so the F-key font cycling and the
   * per-line text both invalidate it; all subtitle faces are loaded before the
   * overlay is ever used (subFontReady), so measurements can't be taken against a
   * fallback face and then go stale.
   */
  private vectorLayout(
    ctx: CanvasRenderingContext2D,
    obsah: string,
    fontFamily: string,
    weight: string | number,
  ): VectorLine {
    const key = `${weight}|${fontFamily}|${obsah}`;
    const hit = this.vecCache.get(key);
    if (hit) return hit;
    const maxW = this.screenW - BORDERTITLE * 2;
    let fs = SUB_FONT_PX;
    let font = `${weight} ${fs}px ${fontFamily}`;
    ctx.font = font;
    let total = ctx.measureText(obsah).width;
    if (total > maxW) {
      fs = Math.max(8, (fs * maxW) / total);
      font = `${weight} ${fs}px ${fontFamily}`;
      ctx.font = font;
      total = ctx.measureText(obsah).width;
    }
    const chars = [...obsah];
    const xs: number[] = [];
    let x = 0;
    for (const ch of chars) {
      xs.push(x);
      x += ctx.measureText(ch).width;
    }
    const line: VectorLine = { chars, xs, fs, font, total };
    if (this.vecCache.size >= 128) this.vecCache.clear(); // bounded; a room is nowhere near this
    this.vecCache.set(key, line);
    return line;
  }

  /**
   * A key that changes exactly when `drawVector`'s output would change, so the
   * caller can skip the overlay clear+repaint on every frame that would redraw the
   * identical image. The wave offset is a function of the logic tick (12.5/s), not
   * of the frame, so at 60fps most repaints are pure waste; and once the last glyph
   * has passed p >= 50 the wave is over, so a settled, fully scrolled line stops
   * changing altogether and needs no repaints at all.
   */
  vectorSignature(count: number): string {
    let s = '';
    for (let i = 0; i < this.titles.length; i++) {
      const t = this.titles[i]!;
      const cas = count - t.startcount;
      // p of the LAST glyph: >= 50 means every glyph has settled at dy = 0. UTF-16
      // length over-counts astral characters, which only ever delays `settled` — it
      // can never claim a still-waving line is static.
      const settled = cas * 5 - t.obsah.length >= 50;
      s += `${i}:${t.barva}${t.obsah}|${t.ys}|${settled ? 'x' : cas};`;
    }
    return s;
  }

  /** Speaker colour (true RGB) for a subtitle colour code: letters -> coltab,
   *  digits -> the top tone of coltab2; anything unknown -> white. */
  private vectorColor(code: string): [number, number, number] {
    if (code >= '@') {
      const c = this.font.coltab.get(code);
      if (c) return [c.r, c.g, c.b];
    } else {
      const c = this.font.coltab2.get(code);
      if (c) return [c[0].r, c[0].g, c[0].b];
    }
    return [255, 255, 255];
  }

  /** KresliTitulky (URoom.pas:25638): draw all lines with the PisStringF wave-in. */
  draw(screen: PixelTarget, count: number): void {
    for (const t of this.titles) {
      this.drawText(screen, t.xs, t.ys + this.screenH, UNDERTITLE + this.screenH, t.obsah, t.barva, count - t.startcount);
    }
  }

  /** PisStringF (URoom.pas:25572): render text at (x,y), each glyph waving in from y0. */
  private drawText(screen: PixelTarget, x: number, y: number, y0: number, obsah: string, barva: string, cas: number): void {
    const fd = this.font.fontdat;
    let index = 0;
    for (const ch of obsah) {
      index++;
      const g = this.font.glyphs.get(ch);
      if (!g) {
        if (ch === ' ') x += 8;
        continue;
      }
      const a = g.addr;
      const px = x;
      const yoff = fd[a + 1]!;
      const hj = 25 - yoff;
      let py = y - 30 + yoff;
      const p = cas * 5 - index;
      if (p < 50) py += Math.round(((y0 - y) * (50 - p)) / 50 * Math.cos((3.5 * Math.PI * p) / 50));
      const ddx = fd[a + 2]!;
      const ddy = fd[a + 3]!;
      let pf = a + 4;
      if (p >= 0) {
        for (let j = 0; j < ddy; j++) {
          const sy = j + py;
          if (sy >= 0 && sy < screen.height) {
            const n = j < hj ? 0 : 1;
            for (let i = 0; i < ddx; i++) {
              const val = fd[pf]!;
              if (val !== 4) {
                const color =
                  barva >= '@'
                    ? this.fontcol.get(barva)?.[val]
                    : this.fontcol2.get(barva)?.[n]?.[val];
                const dx = px + i;
                if (color !== undefined && dx >= 0 && dx < screen.width) screen.setIndex(dx, sy, color);
              }
              pf++;
            }
          } else {
            pf += ddx;
          }
        }
      }
      x += ddx;
    }
    void this.roomWidth;
  }
}
