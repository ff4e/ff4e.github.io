/**
 * Swipes on the Siri Remote's touch surface, from the thumb's MOTION: in a menu and on the
 * map a swipe moves the highlight or the selection (the controller spec's B2), and in a room
 * it moves the active fish, held for as long as the thumb stays on the surface (B6, which
 * reverses B5.1 after TestFlight build 3; `SwipeHold`, below).
 *
 * The host hands over where the thumb is, every frame (`__native.remoteTouch`): tvOS reports
 * the surface's ABSOLUTE position (`reportsAbsoluteDpadValues`, which the 1st-generation
 * remote's clicks need — native/host/platform_tvos.m), -1..1 across and down, and SDL passes
 * it on as the left stick's two axes (SDL_mfijoystick.m) — with no touch-down or lift of its
 * own: a lifted thumb reads (0, 0), and the host says null then. It reads them raw, because
 * SDL's own reading of the inverted y gives -1 for a lifted thumb; a position within `LIFTED`
 * of the centre is taken as lifted here too, so that reading can never pass for a thumb. A
 * position is not a deflection: a thumb resting on an edge is not a swipe, so a swipe is
 * measured from where the thumb came down, and from where the last step was taken.
 *
 * Each `STEP` of travel along the dominant axis is one step that way, so a long swipe keeps
 * stepping, as a list scrolls under it, and a fast one takes the steps it covered. Turning
 * back is measured from how far the thumb went, not from where its last step was taken: a
 * `STEP` back from its furthest along that way is a step back, so a thumb that overshot its
 * last step does not have to travel the overshoot again before it turns. Nothing
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
  private thumb = false;
  private last: { dir: SwipeDir; at: number } | null = null;
  /** This touch's last step, and how far along its way the thumb has gone since (its signed coordinate). */
  private reach: { dir: SwipeDir; far: number } | null = null;

  /** Is a thumb on the surface, as of the last `feed` (a click held included)? */
  get touching(): boolean {
    return this.thumb;
  }

  /**
   * The thumb at `pos` (x right, y down; null when lifted) at time `now`: the steps its
   * travel since the last call makes, in order.
   */
  feed(pos: readonly [number, number] | null, now: number): SwipeDir[] {
    this.thumb = !!pos && (Math.abs(pos[0]) > LIFTED || Math.abs(pos[1]) > LIFTED);
    if (!pos || !this.thumb) {
      this.anchor = null;
      this.reach = null;
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
    const r = this.reach;
    if (out.length) {
      const dir = out[out.length - 1]!;
      this.reach = { dir, far: along(dir, pos) };
    } else if (r) {
      const at = along(r.dir, pos);
      if (at > r.far) r.far = at;
      else if (r.far - at >= STEP) {
        // A step back from the furthest the thumb went: the turn starts from here.
        const dir = BACK[r.dir];
        out.push(dir);
        this.anchor = [pos[0], pos[1]];
        this.reach = { dir, far: along(dir, pos) };
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
    this.reach = null;
  }

  /** Is a click toward `dir` (null: the centre), going down at `now`, the end of a swipe? */
  endsSwipe(dir: SwipeDir | null, now: number): boolean {
    return dir !== null && this.last !== null && this.last.dir === dir && now - this.last.at <= SWIPE_CLICK_MS;
  }

  /** Forget the thumb (the remote went away, or focus was lost). */
  reset(): void {
    this.anchor = null;
    this.pressed = false;
    this.thumb = false;
    this.last = null;
    this.reach = null;
  }
}

const BACK: Readonly<Record<SwipeDir, SwipeDir>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

/** How far `pos` is along `dir`'s way (x right, y down). */
const along = (dir: SwipeDir, pos: readonly [number, number]): number =>
  dir === 'right' ? pos[0] : dir === 'left' ? -pos[0] : dir === 'down' ? pos[1] : -pos[1];

/**
 * Swipes in a room, as one held direction (B6): the first step a swipe makes presses that
 * way — through the game's held-key machine, so the fish keeps moving at the game's own
 * cadence, exactly as a held arrow does — and the hold lasts while the thumb stays on the
 * surface, resting or not; lifting it lets go. A swipe the thumb never lifts from can turn:
 * a step another way — a whole `STEP` back from the furthest the thumb went, or a `STEP`
 * across (the tracker's rules) — lets go and holds the new way, so turning needs as
 * deliberate a motion as starting did, and a thumb settling back a little does not reverse
 * the fish. More steps the
 * same way change nothing. Only steps start a hold, and only travel makes steps: a thumb that
 * lands and rests, anywhere, moves nothing.
 *
 * Each call returns what changed — the direction let go, and the one pressed — or null.
 */
export class SwipeHold {
  private dir: SwipeDir | null = null;

  /** The direction held now, or null. */
  get held(): SwipeDir | null {
    return this.dir;
  }

  /** Steps the thumb made, in order: the last one is held. */
  steps(steps: readonly SwipeDir[]): { up: SwipeDir | null; down: SwipeDir } | null {
    const want = steps[steps.length - 1];
    if (!want || want === this.dir) return null;
    const up = this.dir;
    this.dir = want;
    return { up, down: want };
  }

  /** The thumb lifted (or something else took over): the direction let go, or null. */
  release(): SwipeDir | null {
    const up = this.dir;
    this.dir = null;
    return up;
  }
}
