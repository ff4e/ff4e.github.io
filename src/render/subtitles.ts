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
import { BASETITLE, BORDERTITLE, ROWTITLE, UNDERTITLE } from './subtitleGeom.js';

// Subtitle layout constants (URoom.pas:140-161). The geometry ones live in
// subtitleGeom.ts, which the renderer measures from; what stays here is timing.
const SPEEDTITLE = 2;
const TIMEPERCHARTITLE = 2;
const MINTIMETITLE = 40;
const MINYTITLE = BASETITLE - ROWTITLE * 5;
/** siltitborder (URoom.pas:26125): the intertitle card's frame inset. */
const SILTITBORDER = 15;

interface TitleLine {
  obsah: string;
  barva: string;
  xs: number;
  ys: number;
  cilys: number;
  startcount: number;
  killcount: number;
  /**
   * Which `newSubtitle` call produced this line — port bookkeeping, not the original's.
   *
   * The original had no use for it: it drew every line with the same bitmap font at the
   * same size, so "these lines are one sentence" was never a question the renderer had
   * to ask. A vector renderer does have to ask it, because it fits a too-wide line by
   * shrinking it (`fitFontPx`), and shrinking the lines of one sentence independently
   * makes them different sizes. `startcount` + `barva` nearly identifies a message, but
   * not quite — two calls can land on the same tick with the same speaker (a scripted
   * line while `talk()` fires, or the `pushSubtitle` debug hook) — so the identity is
   * recorded rather than inferred.
   */
  block: number;
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
  /** Message counter behind `TitleLine.block`; monotonic, never reset by `clear()`. */
  private blockSeq = 0;
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
    // Every line this call emits is one sentence, however many rows it wraps to. Only
    // the port needs to know that; see `TitleLine.block`.
    const block = ++this.blockSeq;
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
      else this.addLine(s, color, count, block);
      prvni = false;
      if (s.length >= obsah.length) return; // whole string fit on this line
      obsah = obsah.slice(i); // delete(obsah, 1, i) -> obsah[i+1..], dropping the break space
    }
  }

  /** NovyRadekTitulku (URoom.pas:520): add a title line, pushing existing ones up. */
  private addLine(s: string, c: string, count: number, block: number): void {
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
      block,
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

  /** The native game-pixel box the vector layout centres in (subtitleDom reads it). */
  get vectorScreen(): { w: number; h: number } {
    return { w: this.screenW, h: this.screenH };
  }

  /**
   * The lines a vector renderer draws, in engine terms: the text, the speaker colour
   * already resolved to RGB, and the row positions PosunTitulky maintains.
   *
   * Named for what it once was — a read-only view for probes — but it is now the
   * production input to `subtitleDom`, which is the only caller.
   */
  debugLines(): {
    obsah: string;
    barva: string;
    ys: number;
    cilys: number;
    startcount: number;
    block: number;
    rgb: [number, number, number];
  }[] {
    return this.titles.map((t) => ({
      obsah: t.obsah,
      barva: t.barva,
      ys: t.ys,
      cilys: t.cilys,
      startcount: t.startcount,
      block: t.block,
      rgb: this.vectorColor(t.barva),
    }));
  }

  /**
   * True while anything in the vector subtitle layer is still moving — a wave still
   * running or a line still scrolling toward its target row. The render loop uses this
   * to hold off the idle throttle for exactly as long as the subtitles need it
   * (typically ~1.5s per line).
   */
  vectorAnimating(count: number): boolean {
    for (const t of this.titles) {
      if (t.ys > t.cilys) return true; // PosunTitulky is still scrolling this line
      if ((count - t.startcount) * 5 - t.obsah.length < 50) return true; // wave still running
    }
    return false;
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
