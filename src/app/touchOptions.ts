/**
 * The touch Options: the original panel's Options face, in a dialog over the room or map.
 *
 * ── Why it borrows the panel rather than drawing one ─────────────────────────
 * The faithful Options is a FACE of the 155x395 control panel: the corner button scrolls
 * the indexed-palette bitmap over ten frames to a second picture with three volume
 * sliders, three subtitle buttons, Help and the exit corner. This overlay borrows the
 * SAME panel canvas as the desktop, rather than maintaining a second renderer or dispatch
 * table, and opens it already on that face. Closing it returns the panel column to the
 * stage, hidden during touch gameplay. The canvas Options face is untouched and stays
 * exactly as it was for mouse players. Only one presentation is reachable:
 * `togglePanelOptions` and `openMapOptions` — the two doors into Options — hand over to
 * this module while touch mode is on.
 *
 * Phones used to get plain HTML sliders and radios here instead, because at the scale a
 * phone draws the side panel the face's sliders are 9px tall and its subtitle buttons
 * ~20px square. What changed is not the artwork but its size: a phone now scales the
 * face to fill the dialog, and in landscape — where 395 rows will not fit — shows it cut
 * in two and laid side by side (`optionsLayout.ts`, which also explains the cut).
 *
 * ── Everything goes through `panelAction` ────────────────────────────────────
 * The face's taps and slider drags reach the panel canvas's own pointer handlers in
 * `main.ts`, so there is no second dispatch path: `panelAction` opens with `hracNespi()` —
 * the original's unconditional "the player is not asleep" on every panel press
 * (Uovl.pas:946) — and it is what `tools/test-options.mjs` drives, so this UI is covered
 * by the oracle that already exists for volumes, subtitles and their persistence.
 *
 * ── What it does not do ──────────────────────────────────────────────────────
 * It does not pause the game, for the same reason the faithful panel does not: the panel
 * sits BESIDE a live room and the player can open it mid-puzzle. Nothing here is a mode.
 * (Help is, and Help already handles that itself — `openHelp` sets the modal pause.)
 */
import { panelCol } from './dom.js';
import { touchUi } from './touchButtons.js';
import { O_NORMAL, O_OPTIONS, SCMAX, SCMIN, ui } from './screenState.js';
import '../styles/touchOptions.css';

let open = false;
let panelHome: HTMLElement | null = null;

/** Is the touch Options overlay up? Read by the panel/map hand-over and by the probe. */
export function touchOptionsOpen(): boolean {
  return open;
}

/**
 * Show or hide the overlay. Private: everything outside comes in through the two
 * verbs below, so "is touch mode on" is asked in exactly one place.
 */
function setOpen(want: boolean): void {
  if (want === open) return;
  open = want;
  const el = document.getElementById('touchopts');
  if (want && el) {
    panelHome = panelCol.parentElement;
    el.prepend(panelCol);
    ui.ostav = O_OPTIONS;
    ui.scroll = SCMAX;
    ui.scrollAcc = 0;
  } else if (!want && panelHome) {
    panelCol.style.display = 'none';
    panelHome.append(panelCol);
    panelHome = null;
    ui.ostav = O_NORMAL;
    ui.scroll = SCMIN;
    ui.scrollAcc = 0;
    ui.panelPressed = 0;
    ui.panelDragBus = null;
  }
  if (el) el.hidden = !want;
  // Mirrors `data-touch`/`data-touchbar`: an attribute a probe can see even if the
  // markup is missing, so a test cannot pass by finding nothing.
  document.documentElement.toggleAttribute('data-touchopts', want);
}

/** Open the touch Options (the touch stand-in for the panel's Options face). */
export function openTouchOptions(): void {
  setOpen(true);
}

/** Close it, back to whatever screen is underneath. */
export function closeTouchOptions(): void {
  setOpen(false);
}

/** The corner button's behaviour: open if closed, close if open (Uovl.pas:636-639). */
export function toggleTouchOptions(): void {
  setOpen(!open);
}

/**
 * Take the overlay down when it no longer has a screen to sit on.
 *
 * Called from the frame loop beside `syncTouchButtons`. Nothing PUTS it up from here —
 * it is opened by a deliberate act, not derived — but the things that can pull the
 * ground out from under it (the dev override turning touch off, a room script starting
 * a cutscene, help opening some other way) are spread over half the app, and none of
 * them should have to know this overlay exists. A closed overlay costs one comparison.
 * A phone turning into a tablet (or back) needs nothing here: the face's size and shape
 * are re-read every frame (`optionsLayout.ts`).
 */
export function syncTouchOptions(): void {
  if (!open) return;
  const grounded = touchUi() && !ui.helpOpen && (ui.screen === 'room' || ui.screen === 'map');
  if (!grounded) closeTouchOptions();
}
