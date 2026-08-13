/**
 * The "you are not seeing the tier you chose" note.
 *
 * A player who picks `ai` and gets the enhanced render has no way to tell: the setting
 * still reads `ai`, the room looks fine, and the only difference is sharpness they have
 * nothing to compare against. This is the one symptom that used to be entirely silent.
 *
 * ── When it appears, and when it deliberately does not ────────────────────────
 * Only for a FAILED load — a request that got no answer. A room whose AI art is
 * genuinely absent (SCORE) also draws one tier down, and always will; saying so would be
 * telling the player about something they cannot act on, every time they enter that room.
 * `art.ts` makes that distinction (see `ensureAiRoom`) and this module only displays it.
 *
 * The text names the two things that retry, because both are ordinary actions the player
 * already knows: re-enter the room, or switch the graphics setting away and back.
 *
 * ── Why its own module ────────────────────────────────────────────────────────
 * It belongs beside `maybeShowWebglNote` in `loadingUi.ts`, and cannot live there:
 * `loadingUi` imports `art.ts`, and `art.ts` is what raises this. It takes the tier as an
 * argument rather than importing `renderSettings` for the same reason — that module
 * imports `art.ts` too. A three-line parameter beats a three-module cycle.
 */
export type TierNoteState = 'ok' | 'failed';

let state: TierNoteState = 'ok';
/** Dismissed for THIS failure only — a later, separate failure is worth saying again. */
let dismissed = false;

/** Bind the Dismiss button. Called once, from main.ts, after the device gate. */
export function initTierNote(): void {
  document.getElementById('tier-note-x')?.addEventListener('click', () => {
    dismissed = true;
    const note = document.getElementById('tier-note');
    if (note) note.hidden = true;
  });
}

/** Record the outcome of an `ai` tier art load, and refresh the note. */
export function setTierNote(next: TierNoteState, graphics: string): void {
  if (next === 'failed' && state !== 'failed') dismissed = false; // a fresh failure, a fresh note
  state = next;
  syncTierNote(graphics);
}

/**
 * Show or hide the note for the tier now selected.
 *
 * Called on a tier switch as well as on a load, because switching away from `ai` makes
 * the note untrue immediately — the player is now getting exactly what they asked for.
 */
export function syncTierNote(graphics: string): void {
  const note = document.getElementById('tier-note');
  if (!note) return;
  note.hidden = !(state === 'failed' && graphics === 'ai' && !dismissed);
}

/** The current state, for `window.__ff`. */
export function tierNoteState(): TierNoteState {
  return state;
}
