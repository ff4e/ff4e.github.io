/**
 * Which presses tick under the thumb (`hapticTap`, `src/platform/haptics.ts`).
 *
 * ── Every HTML button, from one listener ────────────────────────────────────
 * The buttons are spread over a dozen modules (the phone corners, the tablet bar, the
 * touch Options, the briefcase ✕, the fish indicator, the help close, the load and
 * feedback notes, the intro start). Wiring each one would mean every new button has to
 * remember to buzz, and the one that forgets is the one a player notices. So this is a
 * single delegated listener, and a button added tomorrow ticks without being told to.
 *
 * `click`, not `pointerdown`, for the reason `touchButtons.ts` gives for its own
 * handlers: a press that slides off a button does not activate it, and the haptic
 * should say "that did something", not "your finger touched glass". It is registered
 * CAPTURING on `document` so a handler that stops propagation at the button cannot
 * swallow the tick.
 *
 * Radio buttons count (the touch Options' subtitle choice looks and acts like a row of
 * buttons), and a click on their `<label>` reaches here once, as the synthetic click on
 * the input. Sliders do not: dragging is not pressing. A disabled control never
 * activates, so it never ticks.
 *
 * ── Canvas buttons are not here ─────────────────────────────────────────────
 * The world map's corner buttons and record-panel icons are pixels, not elements, and
 * only the hit-test in `main.ts` knows a press landed on one. Those call `hapticTap()`
 * where the hit is resolved, which also keeps an inert press (the unwired Exit corner,
 * Replay with no stored record) silent.
 */
import { hapticTap } from '../platform/haptics.js';

const PRESSABLE = 'button, a.fb-btn, input[type="radio"], input[type="checkbox"]';

/** Does a click on `target` press a control? Exported for the unit test. */
export function pressesControl(target: EventTarget | null): boolean {
  const el = (target as Element | null)?.closest?.(PRESSABLE);
  return !!el && !(el as HTMLButtonElement | HTMLInputElement).disabled;
}

/** Arm the delegated listener. Called once from `boot.ts`, beside `initHaptics()`. */
export function initButtonHaptics(): void {
  document.addEventListener('click', (e) => {
    if (pressesControl(e.target)) hapticTap();
  }, true);
}
