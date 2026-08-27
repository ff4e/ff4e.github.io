/**
 * Swipe to move: a finger drag on the room is a held arrow key.
 *
 * ── The one decision in this file ────────────────────────────────────────────
 * A swipe is delivered as a synthetic `keydown`/`keyup` pair for the matching arrow,
 * dispatched on `window` exactly where a real one would arrive. It is NOT a second entry
 * point into `movement.ts`.
 *
 * The requirement is literally "behave like a held arrow key" — one square per swipe,
 * continuous movement while the finger stays down — and `movement.ts` already implements
 * every part of that, keyed by a keyboard `code`. What a separate entry point would have
 * had to reproduce is not the movement; it is everything the keyboard router does around
 * it, and that list is long and load-bearing:
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
 * is ACTIVE at dispatch (kdo:=sys), which is what a swipe should do — the touch bar has a
 * Swap button, and the fish-specific keys (WSAD / IKJL) have no gesture.
 *
 * The cost is one line of indirection: `movement.ts` will report `heldKey === 'ArrowUp'`
 * for a swipe. That is not a lie — it is the same command — and it means the debug
 * surface, the idle-loop throttle and the probes all describe touch without being taught
 * about it.
 *
 * ── What a gesture is ────────────────────────────────────────────────────────
 * Down, then SWIPE_PX in some direction: the dominant axis of the displacement from the
 * start point picks one of four. The direction is then LOCKED until the finger lifts,
 * exactly as a held key is: to go up and then right you lift and swipe again. Steering
 * mid-drag would be a nicer gesture and a different machine — `beginHeldMove` refuses a
 * second input while one is held — so it is deliberately not attempted before the plain
 * version has been tried on real hardware.
 *
 * ── What it does not touch ───────────────────────────────────────────────────
 * Tap-to-swim. It already works on a touch device (the browser's emulated click reaches
 * the canvas's mouse handler) and this PR neither extends nor removes it; Martin's
 * decision is that tap-to-select / tap-to-swim is revisited after swipe has been tried.
 * What IS suppressed is the emulated click at the END of a swipe — a touch that moves
 * still produces one, and without this the fish would swim to wherever the finger came to
 * rest the moment it let go.
 */
import { canvas } from './dom.js';
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

/** The arrow each direction is delivered as. `Dir` is the game's, the code is the DOM's. */
const ARROW_FOR: Record<number, string> = {
  [Dir.up]: 'ArrowUp',
  [Dir.down]: 'ArrowDown',
  [Dir.left]: 'ArrowLeft',
  [Dir.right]: 'ArrowRight',
};

/** The pointer being followed, or null between gestures. One at a time: a second finger
 *  is ignored rather than fighting the first, which is also what the held machine does. */
let tracking: number | null = null;
let startX = 0;
let startY = 0;
/** The arrow this gesture became, once it passed the threshold. */
let arrow: string | null = null;
/**
 * Swallow the browser's emulated mouse events after a swipe.
 *
 * A touch that MOVES still produces the compatibility `mousedown`/`click` at the point it
 * ended, after `pointerup` — so without this, letting go of a swipe would immediately
 * click-to-swim the fish towards the finger. Set on release and consumed by the capturing
 * listener below, so a plain TAP is untouched: its mousedown falls through to the room's
 * own handler exactly as it does today.
 */
let swallowMouse = false;

/** Send the arrow the way the keyboard would, so every guard downstream sees a keypress. */
function sendKey(type: 'keydown' | 'keyup', code: string): void {
  // `key` as well as `code`: the typed-cheat buffer reads `e.key`, and a real arrow
  // carries the same string in both. Cancelable so the router's preventDefault is a no-op
  // rather than a console warning.
  window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));
}

/** Is a drag on the room a movement command right now? */
function armed(): boolean {
  return touchUi() && ui.screen === 'room';
}

/** End the gesture, releasing the arrow if one was sent. */
function endGesture(mouse: boolean): void {
  if (arrow) {
    sendKey('keyup', arrow);
    // Only a gesture that actually moved a fish suppresses the click behind it, and only
    // a finger's: a real mouse fires its `mousedown` at the START of the drag, where there
    // is nothing yet to suppress, so arming the flag for one would only eat the NEXT press.
    if (!mouse) swallowMouse = true;
  }
  tracking = null;
  arrow = null;
}

/**
 * Arm the gestures. Called once from `main.ts` at boot, whatever the device is — the
 * listeners leave on their first line off touch, and attaching them lazily would mean a
 * second place that decides what touch mode is.
 */
export function initTouchSwipe(): void {
  canvas.addEventListener('pointerdown', (e) => {
    if (!armed() || tracking !== null) return;
    // A gesture that ended in `pointercancel` never got its emulated mousedown, so the
    // flag would otherwise be waiting to eat an unrelated press. The compatibility events
    // of the PREVIOUS gesture have all arrived by now, so this is the safe place to drop it.
    swallowMouse = false;
    tracking = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    arrow = null;
    // Keep receiving moves after the finger leaves the canvas — a swipe near the edge
    // otherwise stops being reported halfway through and the fish never lets go.
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // A synthetic pointer (a probe) has nothing to capture; the events still arrive.
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== tracking || arrow) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (Math.abs(dx) < SWIPE_PX && Math.abs(dy) < SWIPE_PX) return;
    // The dominant axis wins, so a diagonal drag resolves to the way it leans rather than
    // to whichever axis happened to cross the threshold first.
    const dir =
      Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? Dir.right : Dir.left) : dy > 0 ? Dir.down : Dir.up;
    arrow = ARROW_FOR[dir]!;
    sendKey('keydown', arrow);
  });

  for (const type of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(type, (e) => {
      if (e.pointerId !== tracking) return;
      endGesture(e.pointerType === 'mouse');
    });
  }

  // Capturing, so it runs before the room's own `mousedown` handler and can take the
  // event away from it. See `swallowMouse`.
  canvas.addEventListener(
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
