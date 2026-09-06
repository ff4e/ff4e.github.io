/**
 * Taptic feedback for the three moments the game already treats as significant.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The game is a grid puzzle whose whole input vocabulary is "push in a direction".
 * On a keyboard the wall tells you it is there by the fish not moving, and the eye
 * catches that instantly. Under a thumb, with the fish half-hidden by the hand,
 * it does not: a blocked push and a push that has not been registered yet feel
 * identical. A 10 ms tap distinguishes them without a pixel of UI.
 *
 * It also happens to be the clearest answer to App Store Guideline 4.2 — a wrapped
 * website that does something the website cannot. That is a side effect, not the
 * reason; a haptic added only to satisfy a reviewer would fire somewhere that did
 * not need it, and be more annoying than absent.
 *
 * ── Why nothing here is imported eagerly ────────────────────────────────────
 * `src/` is shared with the website and, before this file, imported nothing from
 * Capacitor at all — the native integration is a scheme sniff (`isNativeHost`) and
 * Swift. A static `import { Haptics } from '@capacitor/haptics'` would pull
 * `@capacitor/core`'s plugin registry into the web bundle to be dead weight for
 * every browser player.
 *
 * So the import is dynamic and gated. Vite emits it as its own chunk, the gate
 * means a browser never requests that chunk, and the module graph stays honest
 * about who needs what.
 *
 * ── Why there is no in-game toggle ──────────────────────────────────────────
 * iOS already has one. `UIImpactFeedbackGenerator` and friends are silent when
 * Settings → Sounds & Haptics → System Haptics is off, so a player who does not
 * want this has already said so somewhere that covers every app. A second switch
 * in the Options screen would only be able to disagree with the first.
 *
 * ── Failure ─────────────────────────────────────────────────────────────────
 * Every call is fire-and-forget and every failure is swallowed. Haptics are a
 * garnish: a device without a Taptic Engine, a plugin that failed to register,
 * a rejected promise — none of them are worth a single frame of the game loop,
 * and none of them should ever surface to the player.
 */

import { isNativeHost } from './nativeHost.js';

type HapticsModule = typeof import('@capacitor/haptics');

/** Resolved plugin, or `null` once we know we will never have one. */
let mod: HapticsModule | null = null;
/** In-flight (or settled) load. Also the "only try once" latch. */
let load: Promise<void> | null = null;

/**
 * Start loading the plugin, at most once per session.
 *
 * Deliberately not awaited by the callers below: the first buzz of a session is
 * the one that pays for the chunk fetch, and dropping it is better than stalling
 * a logic tick on it. From `capacitor://` that fetch is a local file read, so in
 * practice the plugin is ready long before the first wall.
 */
function ensure(): void {
  if (load) return;
  load = import('@capacitor/haptics')
    .then((m) => {
      mod = m;
    })
    .catch(() => {
      mod = null;
    });
}

/**
 * Warm the plugin at boot so the first blocked push is not the request that loads it.
 *
 * Safe to call on the web — it returns immediately, having done nothing.
 */
export function initHaptics(): void {
  if (!isNativeHost()) return;
  ensure();
}

/** A push that went nowhere: the lightest tap the API offers. */
export function hapticBlocked(): void {
  if (!isNativeHost()) return;
  ensure();
  if (!mod) return;
  void mod.Haptics.impact({ style: mod.ImpactStyle.Light }).catch(() => {});
}

/** A fish died. The error pattern is three beats — it reads as "that went wrong". */
export function hapticDeath(): void {
  if (!isNativeHost()) return;
  ensure();
  if (!mod) return;
  void mod.Haptics.notification({ type: mod.NotificationType.Error }).catch(() => {});
}

/** The room is solved. The counterpart pattern, and the only celebratory one. */
export function hapticSolved(): void {
  if (!isNativeHost()) return;
  ensure();
  if (!mod) return;
  void mod.Haptics.notification({ type: mod.NotificationType.Success }).catch(() => {});
}

/** Test seam: forget the loaded plugin so a case can observe the load path again. */
export function resetHapticsForTest(): void {
  mod = null;
  load = null;
}
