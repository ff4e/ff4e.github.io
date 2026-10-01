/**
 * Is the game being played by touch, and the override that lets a desktop pretend it is.
 *
 * ── What decides it ─────────────────────────────────────────────────────────
 * The device, via `deviceClass` — anything touch-capable gets the touch UI, phone and
 * tablet alike. The tablet is included deliberately (Martin's decision, 2026-08-26):
 * the faithful control panel FITS on a tablet, which is why the old device gate admitted
 * one, but fitting is not the same as being pleasant to hit with a thumb, and shipping
 * two different products for one device class would be worse than either.
 *
 * A desktop is never in touch mode by the rule. That is the guarantee the whole touch
 * series rests on — the mouse-and-keyboard game cannot change under anyone — so it is one
 * predicate, in one place, and every touch feature asks it rather than re-deriving
 * something similar.
 * Phone-specific presentation uses phoneModeActive alongside it; the existing
 * phone/tablet classification, not viewport orientation, decides that narrower gate.
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
 * URL then storage for the rest, exactly like the phone gate's override did, and for the
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
  // A TV is played from the sofa with a controller, but it is laid out as a TABLET: no
  // faithful panel, the room centred and filling the screen, the plain-HTML Options. See
  // `tvModeActive` below for why it rides this predicate rather than a parallel one.
  if (tvModeActive(win)) return true;
  const o = readTouchOverride(win);
  if (o === 'on') return true;
  if (o === 'off') return false;
  return deviceClass(win) !== 'desktop';
}

/** Phone-only presentation; forcing touch on a desktop still previews the tablet UI. */
export function phoneModeActive(win: TouchWindow): boolean {
  return touchModeActive(win) && !tvModeActive(win) && deviceClass(win) === 'phone';
}

/**
 * ── TV mode: the Xbox build, and a desktop pretending to be one ──────────────
 *
 * A console is played with a controller from across the room. Nothing about that is a
 * touch screen, but everything the tablet already decided still holds for it: the
 * faithful panel's buttons are no use without a mouse, the room should fill the screen,
 * and the panel's Options face is better as plain HTML controls. So TV mode is the tablet
 * UI with its input swapped — `touchModeActive` is true on a TV, and the few tablet-only
 * pieces (the floating buttons, swipe hints, the fish-switch button) ask this predicate to
 * stand aside for a legend of the controller's buttons instead.
 *
 * Decided, in order, by:
 *  1. the build — `VITE_TARGET=xbox` is the console package, which is never anything else;
 *  2. the URL — `?tv`, `?tv=on`, `?tv=off`, the dev override a probe can boot into;
 *  3. storage — `ff.tv`, the same override remembered;
 *  4. the browser engine — the Xbox WebView says so in its user agent.
 *
 * The user-agent test is the one place this codebase sniffs one, and it is safe for the
 * reason `deviceGate.ts` rejects the practice elsewhere: it is not guessing a form factor
 * from a string that lies about it, it is recognising one platform that names itself.
 */
export type TvWindow = TouchWindow & { navigator?: { userAgent?: string } };

/** Where the dev override is persisted, beside `ff.touch`. */
export const TV_KEY = 'ff.tv';

/** URL form: bare `?tv` or `?tv=on` turns it on, `?tv=off` forces it off. */
export const TV_PARAM = 'tv';

/** Is this the console build? Read once; Vite inlines the value at build time. */
function xboxBuild(): boolean {
  try {
    return import.meta.env.VITE_TARGET === 'xbox';
  } catch {
    return false; // no import.meta.env outside Vite
  }
}

/** Should the game present itself for a TV and a controller? */
export function tvModeActive(win: TvWindow): boolean {
  if (xboxBuild()) return true;
  try {
    const params = new URLSearchParams(win.location?.search ?? '');
    if (params.has(TV_PARAM)) return params.get(TV_PARAM) !== 'off';
  } catch {
    // A malformed query string decides nothing; fall through.
  }
  try {
    const v = win.localStorage?.getItem(TV_KEY);
    if (v === 'on') return true;
    if (v === 'off') return false;
  } catch {
    // Storage disabled: fall through to the engine's own answer.
  }
  const ua = win.navigator?.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '');
  return /\bXbox\b/i.test(ua);
}
