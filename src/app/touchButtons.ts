/**
 * The in-room touch controls: five buttons, down the left in landscape and along the
 * top in portrait.
 *
 * ── What they are, and what they deliberately are not ────────────────────────
 * Map, Save, Load, Options, Restart — the panel's whole-room verbs, and nothing else. The
 * panel's direction buttons (regions 1-4 and 6-9) have no counterpart here on purpose:
 * touch drives the fish by swipe, which is a separate layer. Undo is absent because it
 * does not exist yet in any form; it is its own task and must not be half-built here.
 *
 * **Swap (region 11) was here and is not any more.** The gesture layer makes a tap on the
 * play area swap the fish (`touchSwipe.ts`), which is both quicker than reaching for the
 * bar and where a player's hand already is, so the button was redundant rather than
 * missing (Martin's call, 2026-08-28). The verb is untouched — `panelAction(11)` and the
 * Space key still do it.
 *
 * **Restart (region 15) took its place**, and only because retiring the faithful panel
 * left it with nowhere else to go: its two doors were that panel and the `Backspace` key,
 * and a phone has neither. It is the one destructive button on the bar — one tap, no
 * confirmation, and the attempt is gone — which is why it was left off for as long as the
 * panel was still there to carry it.
 *
 * ── Everything goes through `panelAction` ────────────────────────────────────
 * Not through `saveGame()` / `showMap()` / `swapActive()` directly, which would be the
 * obvious shortcut and is wrong twice over. `panelAction` is the single dispatch table
 * for what a "save" IS (`URoom.pas`'s Uovl regions), and it opens with `hracNespi()` —
 * the original's unconditional "the player is not asleep" on every panel press
 * (Uovl.pas:946) — before it has even looked at which button was hit. A parallel path
 * would silently skip that and let the screensaver come up under a player who is
 * tapping. It also carries the `atRest()` gates on save and load, so a tap during a
 * fish's move is refused by the same rule that refuses a click.
 *
 * That is also what keeps these buttons inside the existing test oracle: `test-options`
 * and friends drive `panelAction` directly, so the verbs are already covered and this
 * module only has to be right about which region each button sends.
 *
 * ── Shown only in a room, and only in touch mode ─────────────────────────────
 * Derived per frame, like `loadingUi.ts` and `touchOptions.ts` — `ui.screen` changes
 * from half a dozen places and none of them should have to know about a button bar. The
 * bar reserves real space rather than floating over the game (`.stage` gets a margin
 * while it is up, so `relayout()` measures the smaller area), which is why a change of
 * visibility has to relayout: the room is scaled into what is left.
 */
import { relayout } from './loadingUi.js';
import { TOUCH_REGIONS } from './keyTables.js';
import { touchModeActive } from './touchMode.js';
import { ui } from './screenState.js';

export { TOUCH_REGIONS };

/** The one name this module needs from `main.ts`. */
export interface TouchButtonsHost {
  /** The panel's dispatch table (Uovl regions). See the file comment. */
  readonly panelAction: (region: number, panelX?: number) => void;
}

let host!: TouchButtonsHost;
let active = false;
/**
 * Last visibility written to the DOM, so a steady bar is not rewritten every frame.
 *
 * It starts `false` because the markup starts hidden, which is what makes the desktop
 * case free: `want` is false for ever, matches, and the sync returns without a DOM read.
 */
let up = false;

/**
 * Arm the buttons. Called once, from `main.ts`, during boot.
 *
 * The listeners are attached whatever the device is: they cost nothing on a bar that is
 * never shown, and attaching them later would mean a second place that decides what touch
 * mode is.
 */
export function initTouchButtons(h: TouchButtonsHost): void {
  host = h;
  refreshTouchMode();
  for (const el of document.querySelectorAll<HTMLElement>('#touchbar [data-region]')) {
    const region = Number(el.dataset.region);
    if (!Number.isFinite(region)) continue;
    // `click`, not `pointerdown`: a tap that starts on a button and slides off should not
    // fire, and `click` is the event that already encodes that. The panel's own mouse
    // path uses mousedown because it also drives the volume sliders by drag, which none
    // of these do.
    el.addEventListener('click', () => host.panelAction(region));
  }
}

/** Re-read whether touch mode is on. Called at boot and by the dev-bar override. */
export function refreshTouchMode(): void {
  active = typeof window !== 'undefined' && touchModeActive(window);
  document.documentElement.toggleAttribute('data-touch', active);
}

/** Is the touch UI on? Read by the rest of the touch series and by the dev bar. */
export function touchUi(): boolean {
  return active;
}

/**
 * Put the bar up in a room and take it down everywhere else.
 *
 * Called from the frame loop beside `syncLoadingUi`. A desktop leaves on the first line.
 */
export function syncTouchButtons(): void {
  const want = active && ui.screen === 'room';
  if (want === up) return;
  up = want;
  const bar = document.getElementById('touchbar');
  if (bar) bar.hidden = !want;
  // The attribute the stylesheet hangs the stage's margin off — the bar reserves space
  // rather than covering the room, so this changes how much room there is to draw in.
  document.documentElement.toggleAttribute('data-touchbar', want);
  relayout();
}
