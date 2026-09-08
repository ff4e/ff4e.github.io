/**
 * The native app's orientation lock — the one call that removes the choice.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * The rooms run from MIKRO's 360x210 to UTES's 780x225, and a couple are taller than
 * they are wide. A phone held the wrong way for the room shows a fraction of it.
 * `deviceOrientation.ts` decides which way is right; this turns that decision into the
 * OS-level lock that makes it happen.
 *
 * Locking does more than narrow what is allowed: when the interface orientation in
 * effect is outside the new set, iOS animates the interface round to a permitted one on
 * its own, whichever way the phone is actually being held — the same mechanism that
 * makes a camera app's UI stay portrait in a sideways hand. That is what makes this
 * categorically different from the rotate PROMPT #123 deleted, which could only ask.
 *
 * **This is native-only and unreachable from a browser**, like everything else in this
 * directory. `screen.orientation.lock()` throws `NotSupportedError` in Safari on every
 * iOS version, so there is no web version of this to be inconsistent with; see
 * `deviceOrientation.ts` for why that makes it a platform difference rather than a
 * change of mind about #123.
 *
 * ── Why nothing here is imported eagerly ────────────────────────────────────
 * The same reason as `haptics.ts`, and the same shape: `src/` is shared with the
 * website, so a static `import { ScreenOrientation } from '@capacitor/screen-orientation'`
 * would pull `@capacitor/core`'s plugin registry into the web bundle to be dead weight
 * for every browser player. The import is dynamic and gated, Vite emits it as its own
 * chunk, and a browser never requests that chunk. `test/orientationLock.test.ts` asserts
 * that a browser does not even resolve the module, because tidying the dynamic import
 * into a static one breaks nothing visible — the plugin's web implementation throws and
 * we swallow it — so only a test that watches the MODULE can catch it.
 *
 * ── The plugin's one mistake, and where it is corrected ─────────────────────
 * `@capacitor/screen-orientation` cannot express "either landscape". Its
 * `fromOrientationTypeToMask` maps `'landscape'` to `UIInterfaceOrientationMask
 * .landscapeRight` — a SINGLE side — and `lock()` then assigns
 * `capViewController?.supportedOrientations = [orientation]`, so a landscape lock pins
 * the phone to one specific landscape and a player holding it the other way is flipped
 * 180 degrees and then held there. For a game that is a bug, not a nuance.
 *
 * It is corrected on the native side, in `SafeAreaBridgeViewController.swift`, which
 * widens a single-landscape mask back to `.landscape` — four lines, in the file that
 * already exists to correct UIKit about orientation. Doing it there rather than here is
 * what lets us keep the maintained plugin for the hard parts
 * (`setNeedsUpdateOfSupportedInterfaceOrientations`, `requestGeometryUpdate`, the
 * pre-iOS-16 fallback) instead of reimplementing them.
 *
 * **The custom-plugin fallback the plan held in reserve was not needed.** The worry was
 * that this project's `SceneDelegate`/`SafeAreaBridgeViewController` setup would put the
 * root controller somewhere the plugin could not reach, the way it already defeats
 * `env(safe-area-inset-*)`. It does not: the plugin finds the controller through
 * `bridge?.viewController`, not through `AppDelegate.window` (which is nil here, and
 * which the plugin's own README example would crash on), and our class is a
 * `CAPBridgeViewController` subclass so the cast lands. The README's AppDelegate override
 * is unnecessary for the same reason — UIKit intersects `Info.plist` with the root
 * controller's own `supportedInterfaceOrientations`, which Capacitor already derives from
 * `supportedOrientations`.
 *
 * ── Failure, and why it is swallowed ────────────────────────────────────────
 * Every call is fire-and-forget and every failure is swallowed, exactly as in
 * `haptics.ts`. A lock that does not apply leaves the player holding the phone the way
 * they were already holding it, which is the status quo the website lives in
 * permanently. Interrupting a game over that would be worse than the thing it reports.
 */

import { isNativeHost } from './nativeHost.js';

type ScreenOrientationModule = typeof import('@capacitor/screen-orientation');

/** The two families this app locks to. Structurally `DeviceOrientation`, deliberately
 * spelled out rather than imported: `src/app/` may reach into `src/platform/`, and a type
 * import the other way would be the first thread of the reverse. */
type Want = 'portrait' | 'landscape';

/** The plugin's own `OrientationLockType`, reached without naming the package at runtime. */
type LockType = Parameters<ScreenOrientationModule['ScreenOrientation']['lock']>[0]['orientation'];

/** Resolved plugin, or `null` once we know we will never have one. */
let mod: ScreenOrientationModule | null = null;
/** In-flight (or settled) load. Also the "only try once" latch. */
let load: Promise<void> | null = null;
/**
 * The most recent answer the game gave, whether or not it has reached the bridge.
 *
 * Separate from `locked` because the first answer of a session almost always arrives
 * before the plugin does. `initOrientationLock()` starts the chunk fetch at boot and the
 * frame loop asks within a frame or two, so an implementation that simply dropped a
 * request made too early would drop the FIRST one — the one that decides which way the
 * player holds the phone for the whole intro and map. Measured on the iPhone 17 Pro
 * simulator: the app came up portrait and stayed there, because the only landscape
 * request of the session was made while `mod` was still null.
 *
 * So the request is remembered instead of dropped, and `ensure()` applies it the moment
 * the module lands.
 */
let desired: Want | null = null;
/**
 * What the bridge has actually been told, so an unchanged answer costs no native call.
 *
 * This is the whole of the idempotency question. A player who goes room A (landscape) ->
 * map -> room B (landscape) crosses three lock decisions and all three say landscape, so
 * exactly one call is made — the first — and the map does not re-issue it. Whether a
 * repeated identical `lock()` would be visibly free is therefore never tested at runtime,
 * which is the point: the cheapest way to be sure a redundant rotation cannot happen is
 * not to ask for one.
 *
 * Cleared when a call rejects, so a lock that failed is retried rather than remembered as
 * applied. That path is narrower than it looks: the plugin's iOS side calls its
 * completion with `nil` unconditionally at the end of its main-queue block, and the
 * bridge drops the callback on the first settle, so a `requestGeometryUpdate` that fails
 * LATER arrives here as a success. What genuinely rejects is `noWindowScene`, which
 * reports before that. Either way the outcome is the fail-open one the header describes.
 */
let locked: Want | null = null;
/**
 * The earliest a REPEAT of `retryWant` may be tried again, as a `Date.now()` stamp.
 *
 * The frame loop asks every frame, so "clear `locked` on rejection and let the next
 * request retry" — correct for a transient failure — would be sixty bridge calls a second
 * for a lock that fails every time. One second between attempts keeps the retry (a lock
 * that fails once and would work now is worth re-asking) without the storm.
 *
 * It gates the repeat only. A player who leaves the map for a portrait room has asked a
 * NEW question, and making them wait out a gate set by an unrelated failure would be the
 * storm control causing the delay it exists to prevent.
 */
let retryAfter = 0;
/** Which want `retryAfter` is holding off; anything else is a new question, not a retry. */
let retryWant: Want | null = null;

/** How long a rejected lock waits before it may be asked for again. */
const RETRY_MS = 1000;

/**
 * Start loading the plugin, at most once per session.
 *
 * Deliberately not awaited by the callers below, for `haptics.ts`'s reason: a frame must
 * never stall on a module fetch. Unlike `haptics.ts`, a request made in the meantime is
 * not lost — `desired` holds it and the `.then` below applies it — because the first
 * request of a session is always made in that window and there is no second one coming.
 */
function ensure(): void {
  if (load) return;
  load = import('@capacitor/screen-orientation')
    .then((m) => {
      mod = m;
      // The answer is usually already waiting here — see `desired`.
      apply();
    })
    .catch(() => {
      mod = null;
    });
}

/**
 * Warm the plugin at boot so the first room entry is not the request that loads it.
 *
 * Safe to call on the web — it returns immediately, having done nothing.
 */
export function initOrientationLock(): void {
  if (!isNativeHost()) return;
  ensure();
}

/**
 * Which of the plugin's four orientation types to ask for.
 *
 * Portrait is just portrait: upside-down is in `Info.plist` for iPad only, and a phone
 * that flips itself upside-down to obey a room would be obeying nothing anybody asked
 * for.
 *
 * Landscape has to name a SIDE, because the plugin cannot say "either" (see the header).
 * Naming the side the phone is ALREADY held at makes the common case — a player in
 * landscape entering a landscape room — a geometry request for the orientation already in
 * effect, i.e. no rotation at all. Only a player in portrait gets turned, which is the
 * entire point of asking.
 *
 * `screen.orientation.type` is the source because it speaks the plugin's own vocabulary
 * (`'landscape-primary'`/`'landscape-secondary'`) and is a plain read with no bridge
 * round-trip. The plugin's own `orientation()` would be the obvious alternative and is
 * worse: it reports `UIDevice.current.orientation`, which is the physical device — face
 * up on a table is `.faceUp`, which it reports as portrait.
 *
 * If the API is missing, `'landscape'` is the answer, which is the plugin's own default
 * and costs at most one 180-degree turn on a device we have no orientation reading for.
 */
function typeFor(want: Want): LockType {
  if (want === 'portrait') return 'portrait';
  const type = typeof screen !== 'undefined' ? screen.orientation?.type : undefined;
  return type === 'landscape-secondary' ? 'landscape-secondary' : 'landscape';
}

/**
 * Send `desired` to the bridge, if there is a plugin to send it to and it is not already
 * in effect.
 *
 * Called from both ends — by `lockOrientation()` when the answer arrives, and by
 * `ensure()` when the plugin does — because either can be the later of the two.
 */
function apply(): void {
  if (!mod || desired === null || desired === locked) return;
  if (desired === retryWant && Date.now() < retryAfter) return;
  retryWant = null;
  const want = desired;
  locked = want;
  void mod.ScreenOrientation.lock({ orientation: typeFor(want) }).catch(() => {
    // Not applied, so not remembered — a later frame's decision tries again. Guarded so a
    // stale rejection cannot erase a lock that has since been re-issued.
    if (locked !== want) return;
    locked = null;
    retryWant = want;
    retryAfter = Date.now() + RETRY_MS;
  });
}

/**
 * Hold the device the given way, if we are the native app and are not already asking for
 * that.
 *
 * Fire-and-forget: the caller is the frame loop and gets no answer. Safe and cheap to
 * call every frame with an unchanged answer, which is exactly what `orientationSync.ts`
 * does — the caller must NOT keep its own "already asked" latch, or a request made
 * before the plugin loaded would be the only one ever made.
 */
export function lockOrientation(want: Want): void {
  if (!isNativeHost()) return;
  desired = want;
  ensure();
  apply();
}

/** Test seam: forget the loaded plugin and the standing lock. */
export function resetOrientationLockForTest(): void {
  mod = null;
  load = null;
  desired = null;
  locked = null;
  retryAfter = 0;
  retryWant = null;
}
