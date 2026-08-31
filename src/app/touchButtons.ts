/**
 * The in-room touch controls: six buttons, along whichever edge leaves more of the room
 * visible — the top in portrait, and in landscape the left or the top depending on the
 * room's shape (`touchBarEdge.ts` decides, per frame).
 *
 * ── What they are, and what they deliberately are not ────────────────────────
 * Map, Save, Load, Undo, Options, Restart — the panel's whole-room verbs, and nothing
 * else. The panel's direction buttons (regions 1-4 and 6-9) have no counterpart here on
 * purpose: touch drives the fish by swipe, which is a separate layer.
 *
 * **Undo (region 24) is the one button with no `Uovl.pas` region behind it**, because
 * the 1998 game has no undo to be faithful to — see `keyTables.ts` for why 24, and
 * `undo.ts` for the verb. On desktop it is the `-` key; the faithful canvas panel has no
 * room for it and is a separate question.
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
import { preferredTouchBarEdge } from './touchBarEdge.js';
import type { TouchBarEdge } from './touchBarEdge.js';
import { room } from './gameState.js';
import { settings } from './playerSettings.js';
import { roomScreenSize } from '../render/renderRoom.js';
import { TOUCH_REGIONS } from './keyTables.js';
import { touchModeActive } from './touchMode.js';
import { ui } from './screenState.js';
import { roomLoading } from './framePacing.js';

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
 * Last edge written to the DOM, so a steady room is not rewritten every frame.
 *
 * `'left'` because that is what the stylesheet does with the attribute absent, which makes
 * the desktop and portrait cases free: `want` never moves off it and nothing is written.
 */
let edge: TouchBarEdge = 'left';

/**
 * Put the bar on the edge that shows more of the current room, and say whether that
 * changed.
 *
 * Derived per frame rather than pushed, for the reason `rotatePrompt.ts` was (see
 * `touchBarEdge.ts`): the viewport, the screen and the room all change from places that
 * should not have to know a button bar exists, and one missed push would leave the room
 * scaled for an edge the bar is no longer on. A room that has not changed costs two
 * `computeStageLayout` calls and no DOM access.
 *
 * Portrait is left alone: it has its own media query, and the attribute is only read
 * inside the landscape one, so a value written here would be inert there anyway.
 */
function syncEdge(): boolean {
  // While a room is loading, `gameState.room` is still the PREVIOUS one but `ui.screen` is
  // already 'room' — measured: entering KOSTE (540x495) reports 780x225 for one or two
  // frames first, which is a different room's shape and answers 'top' where KOSTE answers
  // 'left'. The bar would jump to the top edge and back within ~30ms on every room change.
  // The room that is not on screen yet has no say in where the buttons go.
  if (roomLoading) return false;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let want: TouchBarEdge = 'left';
  // Portrait has its own media query and the attribute is only read inside the landscape
  // one, so there is nothing to decide there.
  if (room && vw > vh) {
    const { w, h } = roomScreenSize(room);
    // A room that cannot be measured has no opinion, and must not be allowed to express
    // one through the tie-break: `preferredTouchBarEdge` resolves a tie to 'top', which is
    // right for a room that genuinely does not care and wrong for a 0x0 one.
    if (w > 0 && h > 0) {
      want = preferredTouchBarEdge(w, h, vw, vh, settings.fitMode, window.devicePixelRatio || 1);
    } else {
      return false;
    }
  }
  if (want === edge) return false;
  edge = want;
  // An attribute, to read the same way as `data-touchbar` beside it, and SET to 'left'
  // rather than removed so a probe can tell "decided left" from "never ran".
  document.documentElement.setAttribute('data-touchbar-edge', want);
  return true;
}

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
  let changed = false;
  if (want !== up) {
    up = want;
    const bar = document.getElementById('touchbar');
    if (bar) bar.hidden = !want;
    // The attribute the stylesheet hangs the stage's margin off — the bar reserves space
    // rather than covering the room, so this changes how much room there is to draw in.
    document.documentElement.toggleAttribute('data-touchbar', want);
    changed = true;
  }
  // Which EDGE it reserves that space on depends on the ROOM as well as the viewport, and
  // a room change never reaches `relayout()` (see the comment there) — so it is derived
  // here, per frame, beside the visibility. Only while the bar is up: off-screen the
  // attribute is inert, and recomputing it on the map would move the bar under the player
  // on the way back in.
  if (want && syncEdge()) changed = true;
  // One relayout for both: the room is scaled into what the bar leaves, so either change
  // invalidates it, and doing it twice in a frame would just repeat the work.
  if (changed) relayout();
}
