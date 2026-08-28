/**
 * Touch gestures on the play area: a drag moves a fish, a tap swaps them.
 *
 * ── The one decision in this file ────────────────────────────────────────────
 * A gesture is delivered as a synthetic `keydown`/`keyup` pair — the matching arrow for a
 * swipe, `Space` for a tap — dispatched on `window` exactly where a real one would arrive.
 * It is NOT a second entry point into `movement.ts`.
 *
 * The requirement is literally "behave like a held arrow key": one square per swipe,
 * continuous movement while the finger stays down. `movement.ts` already implements every
 * part of that, keyed by a keyboard `code`. What a separate entry point would have had to
 * reproduce is not the movement; it is everything the keyboard router does around it, and
 * that list is long and load-bearing:
 *
 *   - `hracNespi()` on the way in (URoom.pas:26787), which the repeat path deliberately
 *     does NOT call — see the comment on `dispatchHeldMove`. Getting that pair wrong in a
 *     second copy would be invisible until a fish stopped commenting on an idle player.
 *   - Six guards: the map, ZELVA's possession (`natvrdo`), the ZAVER finale, the KUFRIK
 *     demonstration, a running "Replay"/solution playback, and a fast-forward load.
 *   - `beginHeldMove`'s one-input-at-a-time rule, which now covers the keyboard and the
 *     finger TOGETHER rather than each separately — a swipe during a held key is ignored,
 *     like a second key, because it IS a second key.
 *   - `releaseHeldKey`'s 1->3 transition, which is what guarantees a flick that lands and
 *     lifts within one tick still moves the fish exactly once.
 *   - The `blur` / `visibilitychange` clean-up, and every future fix to any of the above.
 *
 * `sys` = true falls out of using the ARROW keys specifically: arrows move whichever fish
 * is ACTIVE at dispatch (kdo:=sys), which is what a swipe should do. The tap uses `Space`
 * for the same reason — it is already the swap key (akce_switch), including its rule that
 * a dead partner cannot be swapped to.
 *
 * The cost is one line of indirection: `movement.ts` will report `heldKey === 'ArrowUp'`
 * for a swipe. That is not a lie — it is the same command — and it means the debug
 * surface, the idle-loop throttle and the probes all describe touch without being taught
 * about it.
 *
 * ── What a gesture is ────────────────────────────────────────────────────────
 * Down, then SWIPE_PX in some direction: the dominant axis of the displacement picks one
 * of four. Move another SWIPE_PX a different way without lifting and the fish TURNS —
 * the finger steers, rather than the gesture being locked in until it lifts.
 *
 * Two details make that work, and neither is obvious:
 *
 *   - **The anchor trails the finger.** Every time the threshold is crossed the origin is
 *     moved to where the finger is now, so it is never more than SWIPE_PX behind. Measured
 *     from the point the gesture STARTED, a long drag's committed axis would dominate for
 *     ever: after 200 px right, 30 px up is still a rightward vector. Re-anchoring is what
 *     turns the reading from "where has this gesture been" into "where is it going now".
 *   - **The turn is a release and a press**, in that order, because `beginHeldMove` refuses
 *     a second input while one is held (`heldState` 1 or 2 — the original's `KeyRoom`).
 *     Sending the keyup first is exactly what a player changing arrow keys does, so the
 *     machine needs no new state and the most recent input wins, which is the rule the
 *     rest of the input layer already follows.
 *
 * Under the threshold it is a TAP, and a tap swaps the active fish. That is Martin's call
 * after playing it: on a phone the mouse's click-to-swim reads as the game wandering off
 * on its own, while the one thing a thumb wants constantly is the other fish.
 *
 * ── Why the whole play area, and how the chrome is kept out ──────────────────
 * The listeners are on `window`, not on `#screen`. A phone draws the room into a fraction
 * of the glass and the rest is black margin; requiring the gesture to start on the canvas
 * meant most of the screen did nothing, which is the first thing that felt wrong on the
 * device.
 *
 * `onSurface` is therefore an ALLOW-list, not a deny-list: a gesture counts if it starts
 * inside `.stage` (the room, the letterboxing, the subtitle overlay) or on the page
 * background itself. Everything else is excluded by construction rather than by being
 * remembered — the touch bar, the dev bar, the dialogs and every full-screen overlay are
 * fixed-position SIBLINGS of `.stage`, so they are not inside it and are not the body.
 * The one thing that is inside and must not count is the faithful panel column, which has
 * its own buttons; it is named.
 *
 * ── A finger only, never a mouse ─────────────────────────────────────────────
 * The whole layer leaves on `pointerType === 'mouse'`, and that is a correctness rule
 * rather than a preference. Touch mode is a property of the DEVICE — `touchModeActive`
 * is `deviceClass(win) !== 'desktop'`, which is `(any-pointer: coarse)` — so it is true
 * on a touchscreen laptop or a tablet with a trackpad, where the player may well be on
 * the mouse. Delivering gestures for a mouse pointer there would give one click BOTH its
 * ordinary click-to-swim AND a synthetic `Space` swap, and a mouse drag would inject
 * arrows on top of that. `touchMode.ts` promises the mouse-and-keyboard game cannot
 * change under anyone; keying the layer on the pointer that is actually in the player's
 * hand, not on what the device is capable of, is what keeps that true.
 *
 * The cost is that the dev override (`?touch=on` on a desktop) can no longer drive a
 * swipe with the mouse — device emulation, which is what a touch UI has to be looked at
 * in anyway, is the way to exercise it.
 *
 * ── Click-to-swim, off on touch ──────────────────────────────────────────────
 * The browser's compatibility `mousedown` after a touch reaches the room's mouse handler,
 * which reads it as click-to-swim. That is right for a mouse and wrong for a finger — the
 * fish walks off towards wherever you happened to tap — so it is suppressed for every
 * gesture, swipe and tap alike, and the tap does the swap instead. Suppressed twice over
 * on purpose: `preventDefault()` on `pointerdown` is what the spec says stops the
 * compatibility events, and the capture-phase listener below is the belt for browsers
 * that fire them anyway.
 *
 * The belt has to be disarmed as carefully as it is armed. In a spec-compliant browser
 * the compatibility event never comes, so the flag is never consumed — and a flag left
 * set eats the next unrelated `mousedown` instead. Measured: after one swipe, the first
 * tap on the world map never reached the game, and the first tap on the faithful panel
 * (which is driven by `mousedown`, unlike the touch bar's `click`) was likewise dead.
 * So it is cleared at the TOP of `pointerdown`, before every guard: a mouse press fires
 * `pointerdown` before its own `mousedown`, so any new interaction of any kind disarms a
 * stale flag, and the only event that can still be swallowed is one arriving between a
 * `pointerup` and the next press — which is exactly the compatibility event.
 */
import { cutscene } from './gameState.js';
import { touchUi } from './touchButtons.js';
import { ui } from './screenState.js';
import { Dir } from '../core/dir.js';

/**
 * How far a finger travels before it is a swipe rather than a tap, in CSS px.
 *
 * Wide enough to clear the ~10 px of jitter a thumb puts into a tap, small enough that a
 * deliberate flick on a 390 px-wide phone (this is ~6% of it) never feels ignored. It is
 * a screen distance, not a room distance, on purpose: what it separates is two GESTURES,
 * and that has nothing to do with how large the room happens to be drawn.
 */
const SWIPE_PX = 24;

/**
 * How decisively the new axis must beat the committed one before the fish turns.
 *
 * Without it a sustained ~45-degree drag thrashes: the dominant axis alternates on thumb
 * jitter, every SWIPE_PX flips the direction, and each flip is a release and a press into
 * the held-move machine — so the fish spends its time turning on the spot (a horizontal
 * step animates turn-first, stav_otocka) instead of going anywhere. Half again is enough
 * that a true diagonal settles on one axis and a deliberate turn still reads instantly.
 */
const TURN_BIAS = 1.5;

/** The arrow each direction is delivered as. `Dir` is the game's, the code is the DOM's. */
const ARROW_FOR: Record<number, string> = {
  [Dir.up]: 'ArrowUp',
  [Dir.down]: 'ArrowDown',
  [Dir.left]: 'ArrowLeft',
  [Dir.right]: 'ArrowRight',
};

/** Swap the active fish (akce_switch) — what a tap is delivered as. */
const TAP_KEY = 'Space';

/** The pointer being followed, or null between gestures. One at a time: a second finger
 *  is ignored rather than fighting the first, which is also what the held machine does. */
let tracking: number | null = null;
/** Where the current direction was last committed — see "the anchor trails the finger". */
let anchorX = 0;
let anchorY = 0;
/** The arrow this gesture became, once it passed the threshold. Null while it is a tap. */
let arrow: string | null = null;
/** See the note on click-to-swim above: one emulated `mousedown` to eat. */
let swallowMouse = false;

/** Send a key the way the keyboard would, so every guard downstream sees a keypress. */
function sendKey(type: 'keydown' | 'keyup', code: string): void {
  // `key` as well as `code`: the typed-cheat buffer reads `e.key`, and a real arrow
  // carries the same string in both. Cancelable so the router's preventDefault is a no-op
  // rather than a console warning.
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
}

/** Is a gesture on the play area a command right now? */
function armed(): boolean {
  // Not during the briefcase demo or the help pages: both are still `screen === 'room'`
  // and both are dismissed by a TAP today. Leaving them out here leaves that untouched,
  // rather than swallowing the tap that skips them.
  return touchUi() && ui.screen === 'room' && !ui.helpOpen && !cutscene;
}

/** Did this gesture start on the play area rather than on a control? See the file note. */
function onSurface(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('#panelcol')) return false;
  return (
    target === document.body ||
    target === document.documentElement ||
    target.closest('.stage') !== null
  );
}

/** End the gesture: release a held arrow, or deliver the tap it turned out to be. */
function endGesture(): void {
  if (arrow) sendKey('keyup', arrow);
  else {
    sendKey('keydown', TAP_KEY);
    sendKey('keyup', TAP_KEY);
  }
  swallowMouse = true;
  tracking = null;
  arrow = null;
}

/**
 * Drop a gesture without delivering anything.
 *
 * For the two ways a drag ends without a `pointerup`: the window losing focus and the tab
 * being hidden. `main.ts` already clears the MOVEMENT side on both (the fish stops), but
 * the gesture's own `tracking`/`arrow` would survive — and a live `tracking` makes the
 * layer refuse every later gesture, which is a wedge with nothing to release it.
 */
function abandonGesture(): void {
  if (arrow) sendKey('keyup', arrow);
  tracking = null;
  arrow = null;
}

/**
 * Arm the gestures. Called once from `main.ts` at boot, whatever the device is — the
 * listeners leave on their first line off touch, and attaching them lazily would mean a
 * second place that decides what touch mode is.
 */
export function initTouchSwipe(): void {
  window.addEventListener('pointerdown', (e) => {
    // FIRST, before any guard: a press of any kind, anywhere, disarms a stale swallow.
    // See the note on click-to-swim for the two taps this was measured to be eating.
    swallowMouse = false;
    if (e.pointerType === 'mouse') return; // a finger only — see the file note
    if (!armed() || tracking !== null || !onSurface(e.target)) return;
    tracking = e.pointerId;
    anchorX = e.clientX;
    anchorY = e.clientY;
    arrow = null;
    // The spec's own way to stop the compatibility mouse events, and it has to be here:
    // by `pointerup` the browser has already decided.
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (e.pointerId !== tracking) return;
    const dx = e.clientX - anchorX;
    const dy = e.clientY - anchorY;
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return;
    // The dominant axis wins, so a diagonal drag resolves to the way it leans rather than
    // to whichever axis happened to cross the threshold first. Once an axis is committed
    // it keeps the benefit of the doubt (TURN_BIAS) so a near-diagonal hold cannot thrash;
    // a reversal along the SAME axis is not an axis change and still reads instantly.
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    const onX = arrow === 'ArrowLeft' || arrow === 'ArrowRight';
    const horizontal = arrow === null ? ax >= ay : onX ? ax * TURN_BIAS >= ay : ax >= ay * TURN_BIAS;
    const dir = horizontal ? (dx > 0 ? Dir.right : Dir.left) : dy > 0 ? Dir.down : Dir.up;
    // Unconditionally, not only on a turn: this is what keeps the anchor within SWIPE_PX
    // of the finger, and so what makes the next turn readable at all.
    anchorX = e.clientX;
    anchorY = e.clientY;
    const next = ARROW_FOR[dir]!;
    if (next === arrow) return;
    // Release before pressing. `beginHeldMove` ignores a second input while one is held,
    // so a turn has to look like a player letting go of one arrow and taking the next.
    if (arrow) sendKey('keyup', arrow);
    arrow = next;
    sendKey('keydown', next);
  });

  for (const type of ['pointerup', 'pointercancel'] as const) {
    window.addEventListener(type, (e) => {
      if (e.pointerId !== tracking) return;
      endGesture();
    });
  }

  // The two ways a drag ends without a `pointerup`, mirroring what `main.ts` already does
  // for a held KEY at the same two moments.
  window.addEventListener('blur', abandonGesture);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) abandonGesture();
  });

  // Capturing, and on `window`, so it runs before the room's own `mousedown` handler and
  // can take the event away from it. See the note on click-to-swim.
  window.addEventListener(
    'mousedown',
    (e) => {
      if (!swallowMouse) return;
      swallowMouse = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
}
