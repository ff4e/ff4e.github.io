/**
 * The top bar's slide: down from above the screen's top edge as it opens, back up as it
 * closes (TestFlight build 4 asked for it). Only the picture moves. The bar's state is the
 * menu stack's (`menus.ts`), which changes on the press itself, so a press acts at once
 * whatever the bar looks like — a click mid-slide in presses the focused tab, a move made
 * while it slides out moves the fish — and the slide only follows.
 *
 * How far it has come is a fraction moving at a constant rate toward shown or hidden, eased
 * out both ways — fast at once, then settling — so the bar answers Back on the frame it is
 * pressed, going as well as coming (an ease-in on the way out left it all but still for the
 * first third of the slide, which reads as a late press). Each way has its own curve, so on
 * a reversal halfway — Back pressed twice quickly — the fraction is put where the new
 * curve draws the bar where it is: it turns round from there rather than jump.
 *
 * Moving it costs no rasterising: `uiLayer.ts` draws the bar's cached masks and glyphs at a
 * whole-pixel offset (`paintBar`'s `lift`), which the GPU applies to the quads.
 */

/** How long the whole slide takes, ms: quick, as a TV's tab bar is. */
export const BAR_SLIDE_MS = 180;

/** The longest frame the slide steps over at once, ms: a hitch, or no frames while a room loaded, does not skip it. */
const MAX_STEP_MS = 50;

/** How much of the bar shows `p` of the way through a slide in (`shown`) or out: ease-out cubic either way. */
export const slideEase = (p: number, shown: boolean): number => (shown ? 1 - (1 - p) ** 3 : p ** 3);

export class Slide {
  /** How far through the slide toward `toward`: 0 hidden … 1 shown, linear in time. */
  private p = 0;
  private toward = false;
  private at: number | null = null;

  constructor(public ms = BAR_SLIDE_MS) {}

  /** Move toward `shown` by the time since the last call; returns how much of the bar shows (eased, 0..1). */
  step(shown: boolean, now: number): number {
    if (shown !== this.toward) {
      // Turn round from where the bar is drawn: the new curve's fraction for the same distance.
      const d = slideEase(this.p, this.toward);
      this.toward = shown;
      this.p = shown ? 1 - Math.cbrt(1 - d) : Math.cbrt(d);
    }
    const dt = this.at === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - this.at));
    this.at = now;
    const by = this.ms > 0 ? dt / this.ms : 1;
    this.p = shown ? Math.min(1, this.p + by) : Math.max(0, this.p - by);
    return slideEase(this.p, shown);
  }

  /** Be shown or hidden at once, no slide (the bar came back from under a panel, or went with a prompt). */
  snap(shown: boolean): void {
    this.p = shown ? 1 : 0;
    this.toward = shown;
  }
}
