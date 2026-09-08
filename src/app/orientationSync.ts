/**
 * Keeping the device's orientation lock in step with what is on screen.
 *
 * ── Derived per frame, not pushed ────────────────────────────────────────────
 * The same architecture as `touchButtons.ts`'s `syncEdge()` and `loadingUi.ts`, and for
 * the same reason: the three things this depends on — which screen is up, which room is
 * loaded, and how big the display is — change from a dozen places, and none of them
 * should have to know that an orientation lock exists. One missed push would leave the
 * phone held sideways for a room that wanted portrait, with nothing to correct it until
 * the player happened to change rooms again.
 *
 * The room-load boundary was the other candidate. It is where the room CHANGES, but it is
 * not where the map, the credits, the minigame or a cutscene begin, and those have an
 * answer too (`NON_ROOM_ORIENTATION`). Hooking the boundary would have meant hooking
 * every screen transition as well, which is the push model this file exists to avoid.
 *
 * ── What a frame actually costs ──────────────────────────────────────────────
 * Nothing at all on the web: the first line leaves, and the website's behaviour is
 * unchanged by design (see `deviceOrientation.ts`). On the native host a frame in a
 * steady room costs three `computeStageLayout` calls, one `getComputedStyle`, and no
 * native call — `lockOrientation()` is a no-op once the standing lock already matches, so
 * an unchanged answer never reaches the bridge.
 *
 * ── Why the room in flight has no say ────────────────────────────────────────
 * While a room is loading, `gameState.room` is still the PREVIOUS one and `ui.screen` is
 * already `'room'` — the exact trap documented in `touchButtons.ts`, where entering KOSTE
 * reports UTES's shape for a frame or two. There it cost a button bar that jumped edges
 * within ~30 ms; here it would cost a whole 90-degree rotation of the phone, and then
 * another one back. So a load in flight holds the previous answer rather than acting on a
 * room that is not on screen yet.
 */
import { room } from './gameState.js';
import { roomLoading } from './framePacing.js';
import { roomScreenSize } from '../render/renderRoom.js';
import { settings } from './playerSettings.js';
import { ui } from './screenState.js';
import { housingInset } from './safeArea.js';
import { NON_ROOM_ORIENTATION, preferredDeviceOrientation } from './deviceOrientation.js';
import type { DeviceOrientation } from './deviceOrientation.js';
import { isNativeHost } from '../platform/nativeHost.js';
import { lockOrientation } from '../platform/orientationLock.js';

/**
 * The last answer — kept so that a room which cannot be measured for a frame holds the
 * standing answer instead of falling back to landscape and rotating the phone.
 *
 * Deliberately NOT used to skip the call below. `lockOrientation()` owns the "already
 * asked" question, because it is the only place that knows whether the request actually
 * reached the bridge; a second latch here would swallow the retry (see its `desired`).
 */
let want: DeviceOrientation | null = null;

/**
 * Which way the player should be holding the device, right now.
 *
 * Everything that is not a room — the map, the leg pages, the intro and ending movies,
 * the KUFRIK demo, the minigame, the credits, the help screens — takes
 * `NON_ROOM_ORIENTATION`, which is landscape (Martin, 2026-09-08; see the constant).
 */
function currentWant(): DeviceOrientation {
  // A room in flight is not a room yet: `gameState.room` still holds the PREVIOUS one, so
  // acting now would answer for the room being left. Hold the standing answer instead —
  // NOT `NON_ROOM_ORIENTATION`, which would turn a portrait room into landscape for the
  // length of the load and then straight back, the double rotation this guard exists to
  // prevent. (`want ?? …` only for the first room of a session, which has no standing
  // answer and is reached from the map, which is landscape anyway.)
  if (roomLoading) return want ?? NON_ROOM_ORIENTATION;
  if (ui.screen !== 'room' || !room) return NON_ROOM_ORIENTATION;
  const { w, h } = roomScreenSize(room);
  // A room that cannot be measured has no opinion, and must not be allowed to express one
  // through the tie-break — `preferredDeviceOrientation` resolves a tie to landscape,
  // which is right for a room that genuinely does not care and wrong for a 0x0 one.
  if (!(w > 0) || !(h > 0)) return want ?? NON_ROOM_ORIENTATION;
  // The device's two FIXED screen edges, which is what the decision has to be made
  // against — see `deviceOrientation.ts` on why the current viewport orientation must not
  // enter into it. `max`/`min` of the viewport is that pair on the native host, where the
  // web view is genuinely full-screen.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return preferredDeviceOrientation(
    w,
    h,
    Math.max(vw, vh),
    Math.min(vw, vh),
    settings.fitMode,
    window.devicePixelRatio || 1,
    housingInset(),
  );
}

/**
 * Ask the OS to hold the device the way the current screen wants it.
 *
 * Called from the frame loop beside `syncTouchButtons`, and once from the top of
 * `runBoot()` so the loading overlay and the first-run audio gate are already the right
 * way round rather than turning a second or two in. Everything but the native app leaves
 * on the first line.
 */
export function syncOrientationLock(): void {
  if (!isNativeHost()) return;
  want = currentWant();
  lockOrientation(want);
}

/** Test seam: forget the standing answer. */
export function resetOrientationSyncForTest(): void {
  want = null;
}
