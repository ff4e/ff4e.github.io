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
import {
  BASETITLE,
  BORDERTITLE,
  ROWTITLE,
  SUB_FONT_PX,
  UNDERTITLE,
  bevelBottomRgb,
  bevelSpan,
  fitFontPx,
  lineAnchor,
  strokeWidth,
  wavePhase,
  waveDy,
} from './subtitleGeom.js';

// Subtitle layout constants (URoom.pas:140-161). The geometry ones live in
// subtitleGeom.ts, which both renderers measure from; what stays here is timing.
const SPEEDTITLE = 2;
const TIMEPERCHARTITLE = 2;
const MINTIMETITLE = 40;
const MINYTITLE = BASETITLE - ROWTITLE * 5;
/** siltitborder (URoom.pas:26125): the intertitle card's frame inset. */
const SILTITBORDER = 15;

/**
 * Sub-tick animation steps for the enhanced overlay. The wave-in and the line scroll
 * are functions of the 12.5/s logic tick, which on its own looks stepped; the port
 * already interpolates fish motion between ticks, and this does the same for the
 * vector subtitles (enhanced only — the classic bitmap path stays at the faithful
 * tick rate). 5 steps per 80ms tick = 62.5 animation updates/s, smooth to the eye
 * while keeping the repaint cost bounded no matter how fast the display refreshes.
 * Every whole tick still renders exactly the state it rendered before.
 */
export const SUB_SUBSTEPS = 5;

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
/** Quantise a 0..1 sub-tick fraction to the overlay's animation step grid. */
function subStep(alpha: number): number {
  if (!(alpha > 0)) return 0; // also catches NaN
  return Math.min(Math.floor(alpha * SUB_SUBSTEPS), SUB_SUBSTEPS - 1) / SUB_SUBSTEPS;
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
    let prvni = true; // the outer call; the original recurses with prvni=false
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
      if (this.silentFilm) this.addSilentLine(s, color, prvni);
      else this.addLine(s, color, count);
      prvni = false;
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
    this.silent.length = 0;
    this.silentTime = 0;
  }

  // ---- silent-film intertitles (the xsilent cheat) -------------------------

  /**
   * silentfilm (URoom.pas:604): while set, a spoken line becomes an intertitle
   * card instead of a scrolling subtitle — the room is replaced by the card for
   * `silentTime` frames, as in a silent movie.
   */
  silentFilm = false;
  /** silenttit[] — the lines on the current card. */
  private readonly silent: { s: string; c: string }[] = [];
  /** cassilenttit — frames the card still has to run. */
  silentTime = 0;

  /** True while a card is showing (the room is not drawn underneath it). */
  get silentActive(): boolean {
    return this.silentTime > 0;
  }

  /** URoom.pas:604-615: a new card starts at 10 frames, each line adding len/2. */
  private addSilentLine(s: string, c: string, prvni: boolean): void {
    if (prvni) {
      this.silent.length = 0;
      this.silentTime = 10;
    }
    this.silentTime += Math.floor(s.length / 2);
    this.silent.push({ s, c });
  }

  /** Palette index for a font colour code + shade (fontcol), for the film effects. */
  fontcolIndex(code: string, shade: number): number {
    return this.fontcol.get(code)?.[shade] ?? 0;
  }

  /**
   * KresliSilentTit (URoom.pas:26126): the intertitle card — a two-pixel frame
   * inset 15px, with the wrapped lines centred as a block. The original's vertical
   * edges land two pixels past the horizontal rules on the right; kept as it is.
   */
  drawSilentTitle(screen: PixelTarget): void {
    const b = SILTITBORDER;
    const col = this.fontcolIndex('M', 0);
    const w = screen.width;
    const h = screen.height;
    for (const y of [b, b + 1, h - 1 - b, h - 1 - b - 1]) {
      for (let x = b; x < b + (w - 2 * b); x++) screen.setIndex(x, y, col);
    }
    for (let y = b; y <= h - 1 - b; y++) {
      screen.setIndex(b, y, col);
      screen.setIndex(b + 1, y, col);
      screen.setIndex(w - b, y, col);
      screen.setIndex(w - b + 1, y, col);
    }
    if (this.silent.length === 0) return;
    const y0 = Math.floor((h - this.silent.length * 20) / 2);
    for (let i = 0; i < this.silent.length; i++) {
      const line = this.silent[i]!;
      const x = Math.floor((w - this.font.textWidth(line.s)) / 2);
      // PisString, not PisStringF: a card does not wave in, so pass a `cas` big
      // enough that every glyph is already settled.
      this.drawText(screen, x, y0 + i * 20, 0, line.s, line.c, 1000);
    }
  }

  /** The card's lines (debug/probes). */
  get silentLines(): readonly { s: string; c: string }[] {
    return this.silent;
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
   * The state a vector renderer needs: enough for an independent
   * reference implementation of PisStringF's wave to reproduce the overlay exactly.
   */
  debugLines(): {
    obsah: string;
    barva: string;
    ys: number;
    cilys: number;
    startcount: number;
    rgb: [number, number, number];
  }[] {
    return this.titles.map((t) => ({
      obsah: t.obsah,
      barva: t.barva,
      ys: t.ys,
      cilys: t.cilys,
      startcount: t.startcount,
      rgb: this.vectorColor(t.barva),
    }));
  }

  /**
   * True while anything on the overlay is still moving — a wave still running or a
   * line still scrolling toward its target row. The render loop uses this to hold
   * off the idle throttle for exactly as long as the subtitles need it (typically
   * ~1.5s per line), and to know that repainting the overlay is worthwhile at all.
   */
  vectorAnimating(count: number): boolean {
    for (const t of this.titles) {
      if (t.ys > t.cilys) return true; // PosunTitulky is still scrolling this line
      if ((count - t.startcount) * 5 - t.obsah.length < 50) return true; // wave still running
    }
    return false;
  }

  /**
   * The line's y at a fraction `frac` into the current tick. PosunTitulky moves it
   * SPEEDTITLE px per tick toward cilys, so the in-between position is exact rather
   * than a guess — no need to keep a previous value, and no added latency.
   */
  private renderYs(t: TitleLine, frac: number): number {
    if (frac === 0 || t.ys <= t.cilys) return t.ys;
    const next = Math.max(t.cilys, t.ys - SPEEDTITLE);
    return t.ys + (next - t.ys) * frac;
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
