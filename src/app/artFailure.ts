/**
 * "The artwork would not load — try again."
 *
 * ── The rule this implements ──────────────────────────────────────────────────
 * A load that FAILED (no answer: a network error, a 5xx, an aborted request) no longer
 * drops the room quietly to the tier below. That fallback was invisible by construction:
 * the graphics setting went on saying `ai`, the room looked plausible, and the only
 * difference was sharpness the player had nothing to compare against. So the game stops
 * and says so, and offers the one action that can actually help.
 *
 * It is deliberately NOT shown for art that is genuinely ABSENT — SCORE has no enhanced
 * art at all, CHODBA and WIN draw a classic background by design, and 21 object sprites
 * are legitimately unstaged. Those fall back silently, exactly as they always have,
 * because there is nothing there to retry and nothing for the player to act on. The
 * absent/failed split is `src/render/assetFetch.ts`, and it is what makes this safe:
 * without it, this screen would appear permanently in rooms that are working correctly.
 *
 * ── Why it holds the room rather than covering it ─────────────────────────────
 * The art hold (`roomArtPending`) stays ON while this is up. The screen is opaque, so
 * that is invisible — but it means that when the retry succeeds, the first frame the
 * player sees is the art they asked for. Releasing the hold and painting the lower tier
 * underneath would put the downgrade on screen for a moment, which is the thing this
 * change exists to stop.
 *
 * ── The retry is a closure, not a switch ──────────────────────────────────────
 * Whoever raises the failure knows what to re-run; this module does not want to grow a
 * copy of that knowledge. `art.ts` passes a thunk that re-enters exactly the load that
 * failed. Since #66 a failed load is not remembered, so re-running it genuinely refetches
 * rather than joining a cached "no".
 */
type Retry = () => void;

let retry: Retry | null = null;
/** What the screen currently up is ABOUT, or null when nothing is up. */
let subject: 'room' | 'map' | null = null;
let el: HTMLElement | null = null;
let titleEl: HTMLElement | null = null;
let msgEl: HTMLElement | null = null;

/** Bind the Try again button. Called once, from main.ts, after the device gate. */
export function initArtFailure(): void {
  el = document.getElementById('art-fail');
  titleEl = document.getElementById('art-fail-title');
  msgEl = document.getElementById('art-fail-msg');
  document.getElementById('art-fail-retry')?.addEventListener('click', () => {
    const again = retry;
    // Cleared BEFORE running, so a second click during the refetch cannot start a
    // third load. If it fails again, the loader raises the screen again.
    hideArtFailure();
    again?.();
  });
}

/** Is the failure screen up? Read by the loading overlay, which must not fight it. */
export function artFailureShown(): boolean {
  return el?.hidden === false;
}

/**
 * Raise the screen for a failed art load.
 *
 * `what` only picks the wording. The two cases differ in what the player is being kept
 * from — a room they were entering, or the map they were going back to — and saying
 * "this room" on the map screen would be wrong enough to be confusing.
 */
export function showArtFailure(what: 'room' | 'map', again: Retry): void {
  retry = again;
  subject = what;
  if (titleEl) titleEl.textContent = what === 'map' ? "Couldn't load the world map" : "Couldn't load the graphics";
  if (msgEl) {
    msgEl.textContent =
      what === 'map'
        ? 'The game could not download the artwork for the world map. Check your connection and try again.'
        : 'The game could not download the artwork for this room. Check your connection and try again.';
  }
  if (el) el.hidden = false;
}

/**
 * Take it down.
 *
 * `what` scopes it: a successful ROOM load answers a room's screen and says nothing
 * about the map's, and vice versa. Without that scope, boot's room-7 art landing a
 * moment after the world map failed pulled the map's screen out from under the player —
 * observed as a Try again button that resolved and then went invisible mid-click.
 *
 * Called with no argument it clears whatever is up, which is right for the events that
 * invalidate both: pressing the button, entering a room (a new destination supersedes
 * everything), and switching tier.
 */
export function hideArtFailure(what?: 'room' | 'map'): void {
  if (what !== undefined && subject !== what) return;
  retry = null;
  subject = null;
  if (el) el.hidden = true;
}
