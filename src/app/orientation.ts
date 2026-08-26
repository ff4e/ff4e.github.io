/**
 * Which way up a phone has to be held, and why the rule is a ratio rather than a list.
 *
 * ── The deviation ────────────────────────────────────────────────────────────
 * The original ran in one fixed window on a desktop and had no opinion about orientation
 * at all, so nothing here is faithful to anything — it is a phone concession, like the
 * touch controls it belongs to. What it must NOT do is leak onto the desktop: every rule
 * below is a pure function of numbers, and the only caller that turns them into a demand
 * (`rotatePrompt.ts`) refuses to demand anything of a device that is not a phone.
 *
 * ── Why a ratio, and why 1.00 ────────────────────────────────────────────────
 * Rooms span 285×210 to 795×585 native px across the 72 (`layout.ts`), so "does this room
 * want a portrait phone" could be hand-tagged per room or derived. It is derived, because
 * the measurement says a list would be mostly noise: fitting every room into a real phone
 * viewport both ways, portrait beats landscape for exactly FIVE of the 72, and only one
 * of those by a margin worth interrupting a player for:
 *
 *     VRAK     315×555  0.57   ×1.76   ← the case this exists for
 *     CHODBA   510×555  0.92   ×1.09
 *     ZDVIZ1   510×540  0.94   ×1.06
 *     ZDVIZ2   510×540  0.94   ×1.06
 *     BATHROOM 465×480  0.97   ×1.03
 *     NOGROUND 285×285  1.00   ×1.00   ← exactly neutral, included by the rule
 *
 * The threshold is therefore anywhere in 0.97..1.00 without changing which rooms it
 * picks, and 1.00 is chosen as the one that needs no explanation: **a room that is not
 * wider than it is tall wants a portrait phone.** Every other room wants landscape.
 *
 * NOGROUND is the honest edge: it is square, so both orientations fit it identically and
 * the rule includes it for nothing. That is the price of a threshold instead of a list,
 * and it is one room being asked to rotate for no gain rather than 72 hand-tags to
 * maintain.
 */
import type { DeviceClass } from './deviceGate.js';

export type Orientation = 'portrait' | 'landscape';

/** What the prompt should ask for, or `'ok'` when it should not be up at all. */
export type RotationDemand = Orientation | 'ok';

/**
 * Which way up this content wants the device.
 *
 * Ties go to portrait, which is the whole of the `<= 1.00` decision above. A content size
 * that is not usable (zero, negative, NaN) reports landscape — the game's normal
 * orientation — so a bad measurement can never be the thing that demands a rotation.
 */
export function preferredOrientation(w: number, h: number): Orientation {
  if (!(w > 0) || !(h > 0)) return 'landscape';
  return w <= h ? 'portrait' : 'landscape';
}

/**
 * Which way up the device is being held, from the VIEWPORT rather than `screen`.
 *
 * The viewport is what the game is actually drawn into, and it is the thing that changes
 * when the browser chrome appears or the window is split — `screen.orientation` reports
 * the device's idea of up, which on a tablet in split view is not the same question. A
 * square viewport counts as landscape, matching `preferredOrientation`'s tie going the
 * other way: neither can then be satisfied by accident, and a square room in a square
 * viewport resolves to "rotate", which is degenerate but unreachable in practice.
 */
export function viewportOrientation(w: number, h: number): Orientation {
  return h > w ? 'portrait' : 'landscape';
}

/**
 * Should the player be asked to turn the device, and which way?
 *
 * The three ways this answers `'ok'` are the point of the function:
 *
 *  - **not a phone.** Desktop has no orientation to speak of, and a tablet is explicitly
 *    free to be held either way (Martin's decision, 2026-08-26) — it is big enough that
 *    the worse fit is still comfortable.
 *  - **the device is already that way up.**
 *  - **the numbers are unusable.** A viewport of zero happens in a hidden tab and while a
 *    phone is mid-rotation; treating that as a demand would flash the prompt at moments
 *    the player is not even looking, and worse, could leave it up.
 */
export function rotationDemand(o: {
  device: DeviceClass;
  contentW: number;
  contentH: number;
  viewW: number;
  viewH: number;
}): RotationDemand {
  if (o.device !== 'phone') return 'ok';
  if (!(o.viewW > 0) || !(o.viewH > 0)) return 'ok';
  if (!(o.contentW > 0) || !(o.contentH > 0)) return 'ok';
  const want = preferredOrientation(o.contentW, o.contentH);
  return want === viewportOrientation(o.viewW, o.viewH) ? 'ok' : want;
}
