/**
 * Swipes on the Siri Remote's touch surface, from the thumb's MOTION (the controller spec's
 * B2: a swipe moves a menu's highlight or the map's selection, and never a fish).
 *
 * The host hands over where the thumb is, every frame (`__native.remoteTouch`): tvOS reports
 * the surface's ABSOLUTE position (`reportsAbsoluteDpadValues`, which the 1st-generation
 * remote's clicks need — native/host/platform_tvos.m), -1..1 across and down, and SDL passes
 * it on as the left stick's two axes (SDL_mfijoystick.m) — with no touch-down or lift of its
 * own: a lifted thumb reads (0, 0), and the host says null then. It reads them raw, because
 * SDL's own reading of the inverted y gives -1 for a lifted thumb; a position within `LIFTED`
 * of the centre is taken as lifted here too, so that reading can never pass for a thumb. A
 * position is not a
 * deflection: a thumb resting on an edge is not a swipe, so a swipe is measured from where
 * the thumb came down, and from where the last step was taken.
 *
 * Each `STEP` of travel along the dominant axis is one step that way, so a long swipe keeps
 * stepping, as a list scrolls under it, and a fast one takes the steps it covered. Nothing
 * counts while a click is held (a thumb pressing moves), and the thumb's place when the click
 * lets go is where travel starts again. A click on the edge a swipe just stepped toward —
 * a swipe that ends pressing the ring, or the 1st-generation remote's click with the thumb
 * still out there — is the end of that swipe, not one more step (`endsSwipe`); a click in the
 * centre is always a click.
 */

export type SwipeDir = 'up' | 'down' | 'left' | 'right';

/** Travel per step, in the surface's units (it is 2 across): a quarter of its width. */
export const STEP = 0.5;
/** How soon after a swipe's step a click toward the same edge is that swipe's end, ms. */
export const SWIPE_CLICK_MS = 300;
/**
 * Closer to the centre than this on both axes is no thumb (3 of SDL's 32767 steps): what
 * `SDL_GetGamepadAxis` returns for a lifted thumb on the inverted y is (0, -1/32767).
 */
export const LIFTED = 3 / 32767;

export class SwipeTracker {
  /** Where travel is measured from; null while nothing touches (or a click is held). */
  private anchor: [number, number] | null = null;
  private pressed = false;
  private last: { dir: SwipeDir; at: number } | null = null;

  /**
   * The thumb at `pos` (x right, y down; null when lifted) at time `now`: the steps its
   * travel since the last call makes, in order.
   */
  feed(pos: readonly [number, number] | null, now: number): SwipeDir[] {
    if (!pos || (Math.abs(pos[0]) <= LIFTED && Math.abs(pos[1]) <= LIFTED)) {
      this.anchor = null;
      return [];
    }
    if (this.pressed) return [];
    if (!this.anchor) {
      this.anchor = [pos[0], pos[1]];
      return [];
    }
    const out: SwipeDir[] = [];
    const a = this.anchor;
    for (;;) {
      const dx = pos[0] - a[0], dy = pos[1] - a[1];
      if (Math.max(Math.abs(dx), Math.abs(dy)) < STEP) break;
      // The dominant axis; the other one starts over from here, so a slant does not add up
      // to a step sideways.
      if (Math.abs(dx) >= Math.abs(dy)) {
        a[0] += Math.sign(dx) * STEP;
        a[1] = pos[1];
        out.push(dx > 0 ? 'right' : 'left');
      } else {
        a[1] += Math.sign(dy) * STEP;
        a[0] = pos[0];
        out.push(dy > 0 ? 'down' : 'up');
      }
    }
    if (out.length) this.swiped(out[out.length - 1]!, now);
    return out;
  }

  /** A swipe stepped `dir` at `now` (from here, or a stand-in: `--remote-keys`' Shift+arrow). */
  swiped(dir: SwipeDir, now: number): void {
    this.last = { dir, at: now };
  }

  /** A click went down (`true`) or came up: no travel counts while it is held. */
  press(down: boolean): void {
    this.pressed = down;
    this.anchor = null; // the next position is where travel starts again
  }

  /** Is a click toward `dir` (null: the centre), going down at `now`, the end of a swipe? */
  endsSwipe(dir: SwipeDir | null, now: number): boolean {
    return dir !== null && this.last !== null && this.last.dir === dir && now - this.last.at <= SWIPE_CLICK_MS;
  }

  /** Forget the thumb (the remote went away, or focus was lost). */
  reset(): void {
    this.anchor = null;
    this.pressed = false;
    this.last = null;
  }
}
