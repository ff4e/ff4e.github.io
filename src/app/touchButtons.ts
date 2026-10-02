/**
 * The in-room touch controls: six buttons, along whichever edge leaves more of the room
 * visible — the top in portrait, and in landscape the left or the top depending on the
 * room's shape (`touchBarEdge.ts` decides, per frame). Undo is the exception: it is still
 * one of the bar's buttons, but pinned to the bottom-right corner as on a phone
 * (`styles/tabletUndo.css`).
 * This remains the tablet bar. Phones use phoneControls.ts's corner overlays instead;
 * neither the space reservation nor the edge selector runs on that path.
 *
 * ── What they are, and what they deliberately are not ────────────────────────
 * Map, Save, Load, Restart, Options, Undo — the panel's whole-room verbs, and nothing
 * else. The panel's direction buttons (regions 1-4 and 6-9) have no counterpart here on
 * purpose: touch drives the fish by swipe, which is a separate layer.
 *
 * **Undo (region 24) is the one button with no `Uovl.pas` region behind it**, because
 * the 1998 game has no undo to be faithful to — see `keyTables.ts` for why 24, and
 * `undo.ts` for the verb. On desktop it is the `-` key; the faithful canvas panel has no
 * room for it and is a separate question.
 *
 * **Swap (region 11) is not among these six buttons.** The gesture layer makes a tap on the
 * play area swap the fish (`touchSwipe.ts`), which is both quicker than reaching for the
 * bar and where a player's hand already is, so the button was redundant rather than
 * missing (Martin's call, 2026-08-28). The verb is untouched — `panelAction(11)` and the
 * Space key still do it. The corner fish indicator now offers the same tap action.
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
 * from half a dozen places and none of them should have to know about a button bar.
 *
 * The buttons FLOAT over the room (Martin, 2026-09-29). They used to sit on a bar that
 * reserved real space — `.stage` got a margin while it was up, so the room was scaled into
 * what was left — and that reserve shrank up to a third of the rooms by as much as ~7% on
 * an iPad in landscape. The bar is now an invisible positioning box (`index.html`), so
 * neither its visibility nor its edge changes the room's size or position: the room stays
 * centred, and the buttons change EDGE rather than the room moving (Martin, 2026-09-29).
 * The `relayout()` below is kept anyway: it is one call per change, not per frame, and it
 * also wakes the renderer.
 */
import { relayout } from './loadingUi.js';
import { touchBarPlacement, TOUCHBAR_LEAD } from './touchBarEdge.js';
import type { TouchBarEdge } from './touchBarEdge.js';
import { cutscene, room } from './gameState.js';
import { settings } from './playerSettings.js';
import { roomScreenSize } from '../render/renderRoom.js';
import { TOUCH_REGIONS } from './keyTables.js';
import { phoneModeActive, touchModeActive } from './touchMode.js';
import { initPhoneControls, phoneMenuOpen, syncPhoneControls } from './phoneControls.js';
import { initActiveFishIndicator, syncActiveFishIndicator } from './activeFishIndicator.js';
import { touchOptionsOpen } from './touchOptions.js';
import { O_NORMAL, O_SC_DOWN, ui } from './screenState.js';
import { closeMapOverlay } from './mapNav.js';
import { roomLoading } from './framePacing.js';
import { safeAreaInset } from './safeArea.js';
import { isNativeHost } from '../platform/nativeHost.js';
import { setNativeMenuEnabled, syncNativeMenu } from './nativeMenu.js';

export { TOUCH_REGIONS };

/** The one name this module needs from `main.ts`. */
export interface TouchButtonsHost {
  /** The panel's dispatch table (Uovl regions). See the file comment. */
  readonly panelAction: (region: number, panelX?: number) => void;
}

let host!: TouchButtonsHost;
let active = false;
let phone = false;
let initialized = false;
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
 * `null` until the first decision: with the attribute absent the stylesheet falls back to
 * its orientation default — the left in landscape, the top in portrait — so nothing has
 * to be written for a room that never gets an opinion.
 */
let edge: TouchBarEdge | null = null;

/** Last `--bar-inset` written, in CSS px; 0 is also what the stylesheet assumes unset. */
let barInset = 0;

/**
 * Put the buttons on the edge where they cover the least of the current room, and say
 * whether that changed.
 *
 * Derived per frame rather than pushed, for the reason `rotatePrompt.ts` was (see
 * `touchBarEdge.ts`): the viewport, the screen and the room all change from places that
 * should not have to know a button bar exists, and one missed push would leave the buttons
 * over the part of the room it can least spare. A room that has not changed costs a few
 * `computeStageLayout` calls and no DOM access beyond the insets.
 *
 * Both orientations: portrait used to be the stylesheet's alone (always the top), but a
 * room the top buttons would cover and the left ones would not — VRAK on an iPad — now
 * moves them to the left there too (`touchBarPlacement`).
 *
 * The INSET beside it moves the buttons in from the screen edge to the room's edge when
 * they cannot fit beside the room, so they sit wholly on it rather than half on it. It is
 * a custom property on the bar, not layout: the room does not move for it.
 */
function syncEdge(): boolean {
  // While a room is loading, `gameState.room` is still the PREVIOUS one but `ui.screen` is
  // already 'room' — measured: entering KOSTE (540x495) reports 780x225 for one or two
  // frames first, which is a different room's shape and answers 'top' where KOSTE answers
  // 'left'. The bar would jump to the top edge and back within ~30ms on every room change.
  // The room that is not on screen yet has no say in where the buttons go.
  if (roomLoading || !room) return false;
  const { w, h } = roomScreenSize(room);
  // A room that cannot be measured has no opinion, and must not be allowed to express
  // one through the tie-break: `preferredTouchBarEdge` resolves a tie to 'top', which is
  // right for a room that genuinely does not care and wrong for a 0x0 one.
  if (!(w > 0 && h > 0)) return false;
  const { edge: want, inset } = touchBarPlacement(
    w,
    h,
    window.innerWidth,
    window.innerHeight,
    settings.fitMode,
    window.devicePixelRatio || 1,
    safeAreaInset('--sa-top'),
    // What the LEFT edge has to clear, which is not the housing alone: the buttons
    // start after `max(housing, lead)` (see `--bar-lead` in index.html), so pricing the
    // housing on its own would under-price the left edge on any phone whose housing is
    // on the far side — every one of them, in one of the two landscapes.
    Math.max(safeAreaInset('--sa-left'), TOUCHBAR_LEAD),
  );
  if (inset !== barInset) {
    barInset = inset;
    document.getElementById('touchbar')?.style.setProperty('--bar-inset', `${inset}px`);
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
  initPhoneControls(h);
  window.matchMedia('(any-pointer: coarse)').addEventListener('change', refreshTouchMode);
  window.addEventListener('resize', refreshTouchMode);
  for (const el of document.querySelectorAll<HTMLElement>('#touchbar [data-region]')) {
    const region = Number(el.dataset.region);
    if (!Number.isFinite(region)) continue;
    // `click`, not `pointerdown`: a tap that starts on a button and slides off should not
    // fire, and `click` is the event that already encodes that. The panel's own mouse
    // path uses mousedown because it also drives the volume sliders by drag, which none
    // of these do.
    el.addEventListener('click', (e) => {
      // A pointer click must not leave Save focused when game keys are used next.
      // Keyboard/assistive clicks have detail=0 and retain their focus indicator.
      if (e.detail > 0) el.blur();
      host.panelAction(region);
    });
  }
  // The canvas and swipe layer cancel default pointer handling, including the
  // normal focus hand-off. Release only OUR button, before those handlers run.
  window.addEventListener('pointerdown', (e) => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.matches('#touchbar button') &&
      e.target instanceof Node && !focused.contains(e.target)) focused.blur();
  }, true);
  initialized = true;
}

/** Re-read touch mode at boot, on device-emulation changes and for the dev override. */
export function refreshTouchMode(): void {
  const nextActive = typeof window !== 'undefined' && touchModeActive(window);
  const nextPhone = nextActive && phoneModeActive(window);
  const changed = nextActive !== active || nextPhone !== phone;
  active = nextActive;
  phone = nextPhone;
  document.documentElement.toggleAttribute('data-touch', active);
  document.documentElement.toggleAttribute('data-phone', phone);
  setNativeMenuEnabled(active || isNativeHost());
  if (!initialized || !changed) return;
  // Put the FAITHFUL Options face back to a known state on the way through. Turning
  // touch on while it is open would strand it: the hand-over in `togglePanelOptions`
  // returns before the branch that scrolls it back down, so nothing could close it
  // until the next room load. Device changes and the dev override share this cleanup.
  if (ui.mapOverlay === 'options') closeMapOverlay();
  else if (ui.ostav !== O_NORMAL) ui.ostav = O_SC_DOWN;
  // Phone/desktop changes leave the tablet bar hidden, so its sync cannot relayout
  // for us. relayout also wakes the renderer to apply panel sizing and visibility.
  relayout();
}

/** Is the touch UI on? Read by the rest of the touch series and by the dev bar. */
export function touchUi(): boolean {
  return active;
}

export function phoneUi(): boolean {
  return phone;
}

/**
 * Put the bar up in a room and take it down everywhere else.
 *
 * Called from the frame loop beside `syncLoadingUi`. A desktop leaves on the first line.
 */
export function syncTouchButtons(): void {
  syncPhoneControls();
  syncNativeMenu();
  const showFish = active && ui.screen === 'room' && !ui.helpOpen &&
    !touchOptionsOpen() && !(phone && phoneMenuOpen());
  if (showFish) initActiveFishIndicator(phone ? 'phone-controls' : 'touchbar');
  syncActiveFishIndicator(showFish);
  // Not over the help pages: they fill the stage the room was centred in, and the buttons
  // float, so they would sit across the page's edge (the room-based placement cannot see
  // it). The phone controls and the fish indicator already step aside for help the same way.
  // Nor over the briefcase demo, where nothing on the bar applies and its ✕ is the one
  // control (cutsceneClose.ts); the phone controls stand aside for it too.
  const want = active && !phone && ui.screen === 'room' && !ui.helpOpen && !cutscene;
  let changed = false;
  if (want !== up) {
    up = want;
    const bar = document.getElementById('touchbar');
    if (bar) bar.hidden = !want;
    // Read by probes and by the stylesheet's edge rules; it no longer changes the room's
    // size, because the buttons float over the room instead of reserving space.
    document.documentElement.toggleAttribute('data-touchbar', want);
    changed = true;
  }
  // Which EDGE the buttons sit on depends on the ROOM as well as the viewport, and a room
  // change never reaches `relayout()` (see the comment there) — so it is derived here,
  // per frame, beside the visibility. Only while the bar is up: off-screen the attribute
  // is inert, and recomputing it on the map would move the bar under the player on the
  // way back in.
  if (want && syncEdge()) changed = true;
  // One relayout for both, and doing it twice in a frame would just repeat the work.
  if (changed) relayout();
}
