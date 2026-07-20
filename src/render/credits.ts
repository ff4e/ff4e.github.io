/**
 * The scrolling end-credits (UMain.pas InitCredits/KresliCredits, 761-798,1171).
 *
 * Two assets share one palette: `CredStat1.bmp` is a full-screen static frame
 * (640x480) with a transparent "window"; `CredMov.bmp` is a tall strip
 * (640 x delkaCredits) of credit text that scrolls up through that window. For
 * a scroll offset `posun`, each screen row shows the static pixel unless it is
 * the transparent colour, in which case it shows the corresponding scroll-strip
 * row (or the background colour before/after the strip passes).
 *
 * `transp`/`black` mirror the original: transp = the static image's bottom-right
 * pixel, black = its top-left pixel (UMain.pas:1179-1181).
 */
import type { Bmp } from '../data/bmp.js';

export const CREDIT_SPEED = 4; // posun step per timer tick (UMain.pas:29)
export const CREDIT_TICK_MS = 100; // Timer1.Interval (UMain.dfm)
const PRESAH = 150; // trailing scroll past the strip before it settles (presahCredits)
const CLOSE_EXTRA = 600; // extra hold after settling before auto-close (UMain.pas:868)

export class Credits {
  readonly w: number;
  readonly h: number;
  readonly delka: number; // scroll-strip height (delkaCredits)
  private readonly stat: Uint8Array; // static frame, top-down
  private readonly mov: Uint8Array; // scroll strip, top-down
  private readonly pal: readonly { r: number; g: number; b: number }[];
  private readonly transp: number;
  private readonly black: number;

  constructor(stat: Bmp, mov: Bmp) {
    this.w = stat.w;
    this.h = stat.h;
    this.delka = mov.h;
    this.stat = stat.pixels;
    this.mov = mov.pixels;
    this.pal = stat.palette; // the scroll strip is drawn through the static palette
    this.black = this.stat[0]!;
    this.transp = this.stat[this.w * this.h - 1]!;
  }

  /** The scroll offset at which the roll has settled (stops advancing visually). */
  get maxScroll(): number {
    return this.delka + PRESAH;
  }

  /** The offset past which the credits auto-close. */
  get closeAt(): number {
    return this.delka + PRESAH + CLOSE_EXTRA;
  }

  /**
   * Render the credits at scroll offset `posun` to an RGBA buffer. The static
   * frame's transparent window reveals the scroll strip; `parseBmp` gives both
   * buffers top-down, so the original's bottom-up scroll index maps to
   * `delka-1-yobs`.
   */
  render(posun: number): Uint8ClampedArray {
    const clamped = Math.min(posun, this.maxScroll);
    const { w, h, delka, stat, mov, transp, black, pal } = this;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      const yobs = y + clamped - h;
      for (let x = 0; x < w; x++) {
        const s = stat[y * w + x]!;
        let idx: number;
        if (s !== transp) idx = s;
        else if (yobs >= 0 && yobs < delka) idx = mov[(delka - 1 - yobs) * w + x]!;
        else idx = black;
        const c = pal[idx]!;
        const d = (y * w + x) * 4;
        rgba[d] = c.r;
        rgba[d + 1] = c.g;
        rgba[d + 2] = c.b;
        rgba[d + 3] = 255;
      }
    }
    return rgba;
  }
}
