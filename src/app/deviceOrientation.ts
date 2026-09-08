/**
 * Which way the DEVICE should be held for a room — the native app's orientation lock.
 *
 * ── This deliberately reverses #123, and only for the native app ─────────────
 * #123 ("How the phone is held, and whether it plays at all, are the player's business")
 * deleted `orientation.ts`/`rotatePrompt.ts` on purpose, and Martin's words at the time
 * were that rotation is "fully up to the user". **This is the opposite of that, on
 * purpose, on one platform.** The difference is not a change of mind about the web: it is
 * that the two platforms are not capable of the same thing.
 *
 * On the web, `screen.orientation.lock()` throws `NotSupportedError` in Safari on every
 * iOS version — there is no orientation lock to have — so the only thing the website
 * could ever do is ASK, which is exactly the prompt #123 deleted for being an imposition
 * that bought nothing. **The public website's behaviour is unchanged and must stay
 * unchanged.** Nothing in this module is reachable from a browser: `orientationSync.ts`
 * gates the whole thing on `isNativeHost()`.
 *
 * In the native app an OS-level lock is a different thing entirely. It does not merely
 * narrow which orientations are ALLOWED — when the interface orientation in effect falls
 * outside the newly-locked set, iOS animates the interface round to a permitted one by
 * itself, however the player is physically holding the phone. That is a capability the
 * website has no version of, so this is a platform difference rather than an
 * inconsistency.
 *
 * ── The rule, which is `touchBarEdge.ts`'s rule one level up ─────────────────
 * **Lay the room out both ways and keep whichever shows more of it.** That is Martin's
 * own method (2026-08-31, quoted in `touchBarEdge.ts`), and this reuses that module's
 * machinery rather than a new heuristic: `visibleRoomArea()` runs the real scaling
 * pipeline (`computeStageLayout` then `contentScale`) on a candidate area and reports how
 * many CSS px2 of the room actually land on screen.
 *
 * `preferredTouchBarEdge` compares "bar on top" against "bar on the left" WITHIN one
 * physical orientation. This compares the two ORIENTATIONS, and each candidate is priced
 * with the bar the stylesheet would actually put there:
 *
 *   - **landscape** — the bar goes left OR top, whichever shows more, which is precisely
 *     the choice `preferredTouchBarEdge` will make once we are there. So landscape is
 *     worth the BETTER of the two, not one of them arbitrarily.
 *   - **portrait** — the bar goes along the top, unconditionally. That is not a choice
 *     this module makes; `index.html`'s `@media (orientation: portrait)` block hard-codes
 *     it, and `preferredTouchBarEdge` deliberately does not run in portrait for that
 *     reason.
 *
 * **The deleted `orientation.ts` did NOT do this.** Its `preferredOrientation()` was a
 * sign check on the aspect ratio (`w <= h ? 'portrait' : 'landscape'`) — no scaling
 * pipeline, no bar, no clipping. Reviving it verbatim would have been a regression
 * against machinery that already exists and is already unit-tested, so it was not
 * revived.
 *
 * ── Why the screen is given as long/short rather than width/height ───────────
 * The answer must NOT depend on how the phone is being held at the moment it is asked,
 * or the lock would chase its own tail: locking to landscape changes the viewport, which
 * would change the answer, which would change the lock. A device has two fixed screen
 * dimensions and the caller passes them as `longEdge`/`shortEdge`, which is the same pair
 * whichever way the phone is turned. `orientationSync.ts` derives them as
 * `max/min(innerWidth, innerHeight)` — honest in the native app because the web view is
 * genuinely full-screen there (`CAPBridgeViewController.loadView()` does `view = webView`,
 * and `UIStatusBarHidden` is set), so nothing is subtracted from one orientation that is
 * not subtracted from the other.
 *
 * ── One housing number, not four ─────────────────────────────────────────────
 * `housing` is the display cutout's size on whichever edge it is on, in CSS px. A single
 * number covers both orientations because the cutout is the same piece of hardware:
 * measured on an iPhone 17 Pro (the numbers in `SafeAreaBridgeViewController.swift`),
 * portrait reports `top=62` and landscape reports `62` on the housing's side. Where it is
 * SPENT differs, and that is what the three candidates below encode — in landscape the
 * housing is beside the room, so the top edge costs the bar alone; in portrait it is above
 * the room, so the top edge costs the bar plus the cutout.
 *
 * The home indicator (`--sa-bottom`, 34 portrait / 20 landscape) is ignored here, for the
 * same reason `preferredTouchBarEdge` ignores it: nothing in the stage's layout reserves
 * it, so pricing it would be pricing something that is not spent.
 *
 * Everything here is PURE and DOM-free, like `touchBarEdge.ts` and `layout.ts` before it,
 * and for the same reason — the arithmetic is the part worth unit-testing
 * (`test/deviceOrientation.test.ts`). Asking the document about the cutout, and calling
 * the plugin, are `orientationSync.ts`'s and `src/platform/orientationLock.ts`'s jobs.
 */
import { TOUCHBAR_H, TOUCHBAR_W, TOUCHBAR_LEAD, visibleRoomArea } from './touchBarEdge.js';
import type { FitMode } from './layout.js';

export type DeviceOrientation = 'portrait' | 'landscape';

/**
 * What the screens with no room behind them lock to — the map, the leg story pages, the
 * intro and ending movies, the KUFRIK demo, the Tetris minigame, the credits roll and the
 * help pages.
 *
 * Landscape, unconditionally (Martin, 2026-09-08). None of them has room dimensions to
 * compare, and the deleted `rotatePrompt.ts` had already answered the same question the
 * same way with its `NON_ROOM_CONTENT = { w: 640, h: 480 }` stand-in — a landscape shape,
 * because the 1998 game's screen is one.
 *
 * The alternative considered and rejected was re-locking only ON a room boundary and
 * leaving whatever was in force in between. It is cheaper in forced rotations (room A
 * landscape -> map -> room B landscape costs none either way, but a portrait room -> map
 * -> the same portrait room costs two here and none there) and it was rejected because it
 * makes the map's orientation a function of which room you last left, which is a thing no
 * player can predict.
 */
export const NON_ROOM_ORIENTATION: DeviceOrientation = 'landscape';

/**
 * The way to hold a `roomW`x`roomH` room on a screen whose two fixed edges are
 * `longEdge` and `shortEdge`.
 *
 * `mode`/`dpr` are the same pair `preferredTouchBarEdge` takes and mean the same thing:
 * the player's fit setting and `devicePixelRatio`. `housing` is the display cutout, in
 * CSS px, 0 on a screen without one.
 *
 * **Ties go to landscape**, which is the same kind of thumb on the scale as
 * `preferredTouchBarEdge`'s tie-to-top and costs the same nothing: a tie means the room
 * does not care, and landscape is what the rest of the game assumes when it has no reason
 * to think otherwise (`NON_ROOM_ORIENTATION` above, and the original game's own screen).
 *
 * A room that cannot be measured gets `NON_ROOM_ORIENTATION` rather than an answer
 * derived from zeroes — the tie-break must not be allowed to speak for a 0x0 room.
 */
export function preferredDeviceOrientation(
  roomW: number,
  roomH: number,
  longEdge: number,
  shortEdge: number,
  mode: FitMode,
  dpr = 1,
  housing = 0,
): DeviceOrientation {
  if (!(roomW > 0) || !(roomH > 0) || !(longEdge > 0) || !(shortEdge > 0)) return NON_ROOM_ORIENTATION;
  // Landscape, bar along the top. The cutout is on a SIDE in this orientation, so the top
  // edge costs the bar and nothing else — which is also why `preferredTouchBarEdge`'s
  // `insetTop` is 0 on a phone held sideways.
  const landscapeTop = visibleRoomArea(roomW, roomH, longEdge, shortEdge - TOUCHBAR_H, mode, dpr);
  // Landscape, bar down the left. The buttons start after `max(cutout, lead)` — a floor,
  // never a sum (see `--bar-lead` in index.html) — so a phone whose housing is on the far
  // side still holds them off the display's rounded corner.
  const landscapeLeft = visibleRoomArea(
    roomW,
    roomH,
    longEdge - TOUCHBAR_W - Math.max(housing, TOUCHBAR_LEAD),
    shortEdge,
    mode,
    dpr,
  );
  // Portrait, bar along the top, which is the only thing portrait does. Here the cutout IS
  // above the room, so the top edge costs the bar plus the cutout — `--bar-h` resolves to
  // `54px + var(--sa-top)` and this is that sum.
  const portrait = visibleRoomArea(roomW, roomH, shortEdge, longEdge - TOUCHBAR_H - housing, mode, dpr);
  return Math.max(landscapeTop, landscapeLeft) >= portrait ? 'landscape' : 'portrait';
}
