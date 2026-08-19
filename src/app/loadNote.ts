/**
 * "That did not load — try again."
 *
 * ── Why a note and not the fatal screen ───────────────────────────────────────
 * The game already has two ways to say an asset did not arrive, and neither fits a room
 * entry that failed after boot:
 *
 *  - `showFatal` (loadingUi.ts) is BOOT-only by design, and its only exit is reloading
 *    the whole game. Right for a broken deploy at boot; far too heavy for a momentary
 *    blip mid-play, where the player could simply click the room again.
 *  - `showArtFailure` (artFailure.ts) is a full-screen modal that HOLDS the room while
 *    its art is refetched. It covers the map — which is exactly what must not happen
 *    here, because the decision for a failed room entry is that the player stays on the
 *    world map and clicks the room again when the network is back. A modal would take
 *    that map away and replace clicking the room with clicking a button.
 *
 * So this is the third shape: a non-blocking note over the stage, in the same
 * `#notes` rail as the software-renderer note. The map underneath stays lit, stays
 * clickable, and the retry is a convenience rather than the only way out.
 *
 * ── The wording is built here, from the taxonomy ──────────────────────────────
 * Callers pass what the load was and whether it was TRANSIENT (`isTransient`, see
 * src/render/assetFetch.ts), never a finished sentence. That keeps the one distinction
 * that matters in one place: a request that got no answer is the player's connection and
 * is worth retrying, while a 404 is an answer — the file is not on the server, retrying
 * cannot help, and telling that player to check their connection sends them to debug
 * their own wifi over a broken deploy.
 *
 * ── No init(), deliberately ───────────────────────────────────────────────────
 * The elements are looked up on first use rather than in a boot-time `init*()`. Module
 * scope stays side-effect-free (nothing runs before main.ts's phone gate — see the
 * ordering note in the repo's AGENTS.md), and it needs no wiring line in `main.ts`,
 * which is at its line budget.
 */
import { ROOMS } from '../data/roomTable.js';

/**
 * What the player could not be given.
 *
 * Only the assets a room CANNOT be built without are here: the FFR and its subtitle
 * index. Assets that land after the room is already on screen — the voice package, the
 * music — fail too late to keep anyone off the map and are not this module's case.
 */
export type LoadSubject = 'room';

export interface LoadFailure {
  readonly subject: LoadSubject;
  /** The room the player asked for, for the sentence. */
  readonly room: number;
  /** Did the request fail without getting an ANSWER? (`isTransient`) */
  readonly transient: boolean;
  /**
   * Re-run exactly the load that failed, or undefined when there is nothing useful to
   * re-run (a permanent failure — see showLoadNote). Explicitly `| undefined` because
   * the project sets `exactOptionalPropertyTypes`, and the caller decides this from a
   * value rather than by omitting the key.
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

/** The room's own name (PRVNI, KOSTE…), or its number if the table does not have it. */
function roomName(num: number): string {
  return ROOMS[num - 1]?.jmeno ?? `room ${num}`;
}

/**
 * Raise the note for a load that did not arrive.
 *
 * Idempotent per subject: a second failure of the same kind rewords the note that is
 * already up rather than stacking another one.
 */
export function showLoadNote(f: LoadFailure): void {
  bind();
  subject = f.subject;
  retry = f.retry ?? null;
  if (msgEl) {
    msgEl.textContent = f.transient
      ? `${roomName(f.room)} didn't finish loading — check your connection and try again.`
      : `${roomName(f.room)} is missing from the game files, so it can't be opened. This is a problem with the game, not with your connection.`;
  }
  // A permanent failure has nothing to retry: the server answered, and it will answer
  // the same way next time. Offering the button anyway would be a lie the player pays
  // for in clicks, so it goes away and Dismiss is the only action left.
  if (retryEl) retryEl.hidden = f.retry === undefined;
  if (el) el.hidden = false;
}

/**
 * Take it down.
 *
 * `subject` scopes it, for the same reason `hideArtFailure` is scoped: an event that
 * answers one kind of failure says nothing about another. Called with no argument it
 * clears whatever is up, which is right for the events that supersede everything —
 * pressing a button, and entering a room successfully.
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
