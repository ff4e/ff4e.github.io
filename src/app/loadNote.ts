/**
 * "That did not load — try again."
 *
 * ── The middle tier's surface ─────────────────────────────────────────────────
 * Three tiers of asset (see `src/render/assetFetch.ts`), three ways to say one did not
 * arrive, and this is the middle one:
 *
 *  - **must have** → `showFatal` / `failAssets` (loadingUi.ts). The game cannot run or
 *    cannot be played correctly, so the session ends and the only exit is a reload.
 *  - **should have** → this note. The game runs, but the player is getting materially
 *    less than they asked for and would not otherwise KNOW. So it is said, out loud, and
 *    a retry is offered.
 *  - **nice to have** → nothing at all. Cosmetic or incidental; interrupting anyone would
 *    cost more than the loss.
 *
 * ── Why a note and not the fatal screen ───────────────────────────────────────
 * The two heavier surfaces both take the game away, and neither fits a should-have:
 *
 *  - `showFatal` ends the session, and its only exit is reloading the whole game. Right
 *    for a broken deploy or a missing FFR; far too heavy for help pages that did not
 *    arrive, where the player can simply open the help again.
 *  - A full-screen modal would cover the map — which is exactly what must not happen,
 *    because the whole claim of this tier is that play CONTINUES. A modal would replace
 *    "carry on and try again when you like" with "deal with me first".
 *
 * So this is the third shape: a non-blocking note over the stage, in the same `#notes`
 * rail as the software-renderer note. Whatever is underneath stays lit and stays
 * clickable, and the retry is a convenience rather than the only way out.
 *
 * ── The wording is built here, from the taxonomy ──────────────────────────────
 * Callers pass what the load was and whether it was TRANSIENT (`isTransient`, see
 * src/render/assetFetch.ts), never a finished sentence. That keeps the one distinction
 * that matters in one place: a request that got no answer is the player's connection and
 * is worth retrying, while a 404 is an answer — the file is not on the server, retrying
 * cannot help, and telling that player to check their connection sends them off to debug
 * their own wifi over a broken deploy.
 *
 * The note NAMES the thing; the fatal screen deliberately does not. That asymmetry is
 * the point of the middle tier rather than an inconsistency: a note says one specific
 * thing is missing while the rest of the game carries on, so "which thing" is the entire
 * content of the message. On the fatal screen the answer is "the game", the only action
 * is Reload whichever file broke, and naming it would buy nothing — see `failAssets`.
 *
 * ── No init(), deliberately ───────────────────────────────────────────────────
 * The elements are looked up on first use rather than in a boot-time `init*()`. Module
 * scope stays side-effect-free (nothing runs ahead of main.ts's boot order — see the
 * ordering note in the repo's AGENTS.md), and it needs no wiring line in `main.ts`,
 * which is at its line budget.
 */

/**
 * What the player could not be given, as the player-facing fragment the asset was named
 * with at its call site — "the help pages", "the story page for leg 3".
 *
 * It doubles as the note's SCOPE key (see `hideLoadNote`), which is why it is the `what`
 * string and not a separate enum: a second enum would be a second thing to keep in step
 * with the names, and the names are already required to be unique enough for the fatal
 * screen to be worth reading.
 */
export type LoadSubject = string;

export interface LoadFailure {
  /** The player-facing name of the thing, e.g. "the help pages". */
  readonly subject: LoadSubject;
  /** Did the request fail without getting an ANSWER? (`isTransient`) */
  readonly transient: boolean;
  /**
   * Re-run exactly the load that failed, or undefined when there is nothing useful to
   * re-run — either a permanent failure (see below) or a caller that did not supply one.
   * Explicitly `| undefined` because the project sets `exactOptionalPropertyTypes`, and
   * the caller decides this from a value rather than by omitting the key.
   */
  readonly retry?: (() => void) | undefined;
}

let el: HTMLElement | null = null;
let msgEl: HTMLElement | null = null;
let retryEl: HTMLElement | null = null;
let bound = false;
/** What the note currently up is ABOUT, or null when nothing is up. */
let subject: LoadSubject | null = null;
let retry: (() => void) | null = null;

/** Find the elements and bind the buttons, once, on first show. */
function bind(): void {
  if (bound) return;
  bound = true;
  el = document.getElementById('load-note');
  msgEl = document.getElementById('load-note-msg');
  retryEl = document.getElementById('load-note-retry');
  retryEl?.addEventListener('click', () => {
    const again = retry;
    // Cleared BEFORE running, so a second click during the refetch cannot start a
    // third load. If it fails again, the loader raises the note again.
    hideLoadNote();
    again?.();
  });
  document.getElementById('load-note-x')?.addEventListener('click', () => hideLoadNote());
}

/**
 * Raise the note for a load that did not arrive.
 *
 * Idempotent per subject: a second failure of the same kind rewords the note that is
 * already up rather than stacking another one. A DIFFERENT subject replaces it, which is
 * the deliberately simple choice — a rail of stacked complaints is a worse thing to hand
 * a player than the most recent one, and two should-have failures at once means the
 * connection is gone, which the next one will say just as well.
 *
 * ── Why both sentences open with "Couldn't load" ──────────────────────────────
 * Because the subject is a fragment the CALL SITE wrote, and half of them are plural:
 * "the help pages", "the credits". Any sentence built as `${subject} is …` ships
 * "The help pages is missing", and the earlier version of this file did exactly that.
 * Leading with the verb puts the subject in object position, where number does not
 * matter, so one template is correct for every name anyone adds later.
 */
export function showLoadNote(f: LoadFailure): void {
  bind();
  subject = f.subject;
  retry = f.retry ?? null;
  if (msgEl) {
    msgEl.textContent = f.transient
      ? `Couldn't load ${f.subject} — check your connection and try again.`
      : `Couldn't load ${f.subject} — missing from the game files. This is a problem with the game, not with your connection.`;
  }
  // A permanent failure has nothing to retry: the server answered, and it will answer
  // the same way next time. Offering the button anyway would be a lie the player pays
  // for in clicks, so it goes away and Dismiss is the only action left.
  if (retryEl) retryEl.hidden = f.retry === undefined || !f.transient;
  if (el) el.hidden = false;
}

/**
 * Take it down.
 *
 * `subject` scopes it: an event that answers one kind of failure says nothing about
 * another, and a help load that finally succeeded must not clear a note about the story
 * pages. Called with no argument it clears whatever is up, which is right for the events
 * that supersede everything — pressing Dismiss, and the retry button re-running the load.
 */
export function hideLoadNote(what?: LoadSubject): void {
  if (what !== undefined && subject !== what) return;
  subject = null;
  retry = null;
  if (el) el.hidden = true;
}

/** Is the note up? For the `__ff` hook the UI probes read. */
export function loadNoteShown(): boolean {
  return el?.hidden === false;
}

/** What the note says. For the `__ff` hook the UI probes read. */
export function loadNoteText(): string {
  return el?.hidden === false ? (msgEl?.textContent ?? '') : '';
}
