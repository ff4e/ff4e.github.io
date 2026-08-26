/**
 * Is the game being played by touch, and the override that lets a desktop pretend it is.
 *
 * ── What decides it ─────────────────────────────────────────────────────────
 * The device, via `deviceClass` — anything touch-capable gets the touch UI, phone and
 * tablet alike. The tablet is included deliberately (Martin's decision, 2026-08-26):
 * the device gate admits tablets on the grounds that the faithful control panel FITS
 * there, but fitting is not the same as being pleasant to hit with a thumb, and shipping
 * two different products for one device class would be worse than either.
 *
 * A desktop is never in touch mode by the rule. That is the guarantee the whole touch
 * series rests on — the mouse-and-keyboard game cannot change under anyone — so it is one
 * predicate, in one place, and every touch feature asks it rather than re-deriving
 * something similar.
 *
 * ── Why there is an override, and why it is not a player setting ─────────────
 * The touch UI is otherwise unreachable from a development machine: a desktop browser has
 * no coarse pointer, so short of device emulation there is no way to look at the thing
 * being built. The override is dev chrome for exactly that, and it sits alongside the
 * `renderer` / `graphics` / `fitmode` overrides that already exist for the same reason.
 *
 * It is NOT offered to players. "Which controls do you want" is a question a player should
 * never have to answer, and the honest answer is already known from the device.
 */
import { deviceClass, type GateWindow, type OverrideWindow } from './deviceGate.js';

/** `'auto'` is the device's own answer; the other two force it either way. */
export type TouchOverride = 'auto' | 'on' | 'off';

/** Where the dev override is persisted, beside the game's other `ff.*` dev keys. */
export const TOUCH_KEY = 'ff.touch';

/** URL form, `?touch=on|off|auto` — the version a probe can boot straight into. */
export const TOUCH_PARAM = 'touch';

/** Everything the rule reads: the device signals plus the two override carriers. */
export type TouchWindow = GateWindow & OverrideWindow;

function isOverride(v: string | null | undefined): v is TouchOverride {
  return v === 'auto' || v === 'on' || v === 'off';
}

/**
 * A choice made during THIS session, which outranks both carriers. Only the dev-bar
 * control sets it (via `writeTouchOverride`); it is deliberately not persisted on its
 * own, because a reload should go back to reading the URL and storage.
 */
let session: TouchOverride | null = null;

/** Forget this session's choice. Test-only: module state outlives a single unit test. */
export function resetTouchSession(): void {
  session = null;
}

/**
 * The override in force, defaulting to `'auto'`.
 *
 * Precedence is: this session's explicit choice, then the URL, then storage, then the
 * device. The session slot is first because of a bug the reviewers caught: with the
 * URL ahead of everything, a page loaded with `?touch=on` could never be switched off
 * from the dev bar — the control wrote storage, the URL kept winning, and the control
 * looked dead. An action taken NOW must beat a parameter typed earlier. It also gives
 * the control something to fall back on when storage refuses the write.
 *
 * URL then storage for the rest, exactly like the phone gate's override, and for the
 * same reason: the URL is the carrier that works when storage does not, and it is what
 * a probe can set without a click.
 */
export function readTouchOverride(win: TouchWindow): TouchOverride {
  if (session !== null) return session;
  try {
    const q = new URLSearchParams(win.location?.search ?? '').get(TOUCH_PARAM);
    if (isOverride(q)) return q;
  } catch {
    // A malformed query string decides nothing; fall through.
  }
  try {
    const v = win.localStorage?.getItem(TOUCH_KEY);
    if (isOverride(v)) return v;
  } catch {
    // Storage disabled: the device's own answer is the right fallback.
  }
  return 'auto';
}

/**
 * Persist the dev override AND make it this session's answer.
 *
 * The second half is what makes the dev-bar control honest: the write is best-effort
 * like every other `ff.*` write in the app, but the choice takes effect either way, and
 * it outranks a `?touch=` that was on the URL when the page loaded.
 */
export function writeTouchOverride(win: TouchWindow, v: TouchOverride): void {
  session = v;
  try {
    win.localStorage?.setItem(TOUCH_KEY, v);
  } catch {
    // Storage disabled. The session slot above still carries the choice.
  }
}

/** Should the game show its touch controls? */
export function touchModeActive(win: TouchWindow): boolean {
  const o = readTouchOverride(win);
  if (o === 'on') return true;
  if (o === 'off') return false;
  return deviceClass(win) !== 'desktop';
}
