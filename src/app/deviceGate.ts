/**
 * Device class: what KIND of device is playing, and nothing more.
 *
 * WHAT THIS ANSWERS, AND WHAT IT NO LONGER DOES
 *
 * This module used to REFUSE to run on a phone, before any art was fetched, because the
 * port had only the original's two input schemes — the keyboard (`TRoom.FormKeyDown`,
 * URoom.pas:26784) and the mouse through the room and the control panel (`akce_go`,
 * URoom.pas:26863; `ZaznamenejPrikazRoom`, URoom.pas:26808) — and neither survives a
 * phone: no keyboard, no right-click, no hover, and at phone size the panel's buttons
 * are a few millimetres across.
 *
 * The touch scheme that was missing now exists (icon buttons + swipe, `touchMode.ts` and
 * everything it gates), so the premise of the refusal is gone with it, and so is the
 * refusal — a phone boots straight into the game like anything else (Martin's decision,
 * 2026-08-28). What survives is the QUESTION the refusal was built on, because the touch
 * UI asks the same one: is this a phone, a tablet, or a desktop?
 *
 * WHAT IS DETECTED, AND WHY IT IS NOT THE USER AGENT
 *
 * User-agent sniffing gets this wrong in both directions and needs constant upkeep:
 * iPadOS 13+ deliberately reports itself as "Macintosh", while a Windows laptop with a
 * touchscreen looks like a tablet to most UA regexes.
 *
 * Two signals instead, and BOTH must hold before anything is called a phone:
 *
 *  1. `(any-pointer: coarse)` — is this touch-capable at all? `any-pointer` rather than
 *     `pointer` is deliberate: it reports EVERY input the device has, not just the
 *     primary one.
 *  2. the screen's short side in CSS pixels — density-independent, so it tracks physical
 *     size. Phones sit at or below ~430 (iPhone 15 Pro Max 430, Pixel 7 Pro 412, iPhone
 *     SE 375); the smallest tablet is far above (iPad mini 744, iPad 10.9 820).
 *
 * SIZE is what does the separating, and that is why there is no `(any-pointer: fine)`
 * test here. An earlier draft opened with "any fine pointer -> desktop", which reads
 * plausibly but turns out to decide exactly ONE case that size does not already decide:
 * a phone with a mouse paired to it. Every other device — touchscreen laptop, iPad with
 * a trackpad, plain desktop — is settled by its size or by having no touch at all. A
 * mutation test proved the branch dead in every other configuration, so it is gone: one
 * signal fewer, one untested path fewer, and a phone with a mouse is still a phone.
 *
 * It FAILS OPEN in one direction and CLOSED in the other, and the asymmetry is
 * deliberate: a device that reports no pointer information is a desktop, so an
 * unreadable browser gets the keyboard-and-mouse game the port has always been; a
 * touch-capable device whose screen size cannot be read is a TABLET, which means it
 * does get the touch UI. That second lean is the one that changed meaning when the
 * refusal went: it used to mean "never refuse on a guess", and now it means "a device
 * that says it has a finger is driven by one, whatever it says about its size". Both
 * still answer the same way — believe the signal that was actually reported, guess on
 * the one that was not.
 */

/**
 * Largest short-side screen dimension, in CSS pixels, still considered a phone.
 *
 * Sits in the empty band between the two device classes rather than next to either: the
 * biggest phones are ~430 and the smallest tablet is 744, so any threshold from roughly
 * 500 to 700 behaves identically. A foldable opened out (Pixel Fold ~840) reads as a
 * tablet, which is right — unfolded it has the room for the faithful panel.
 */
export const PHONE_MAX_SHORT_SIDE = 600;

/** The parts of `window` the rule reads. Narrowed so tests can pass a plain stub. */
export type GateWindow = Pick<Window, 'matchMedia'> & {
  screen?: { width?: number; height?: number };
};

/**
 * The three device classes the game distinguishes.
 *
 * `'tablet'` means "touch-capable and big enough", which includes anything touch-capable
 * whose size cannot be read.
 */
export type DeviceClass = 'desktop' | 'phone' | 'tablet';

/**
 * The parts of `window` an override carrier is read from — the URL and storage.
 *
 * It lives here rather than in `touchMode.ts`, its only user, because it is the other
 * half of the same window narrowing `GateWindow` starts: `touchMode.ts` composes the two
 * into the one stub shape its rule needs. Nothing in this file reads it any more; the
 * phone-refusal override that did is gone.
 */
export type OverrideWindow = {
  localStorage?: Pick<Storage, 'getItem' | 'setItem'>;
  location?: {
    href?: string;
    search?: string;
    replace?: (url: string) => void;
  };
};

/**
 * What KIND of device this is — the one place the two signals are read.
 *
 * Everything the touch UI needs to know starts here, so it is one rule in one place
 * rather than a `matchMedia` call per feature. Two signals, exactly as described in the
 * file comment above; the whole classification is these three lines.
 */
export function deviceClass(win: GateWindow): DeviceClass {
  let touch: boolean;
  try {
    touch = win.matchMedia('(any-pointer: coarse)').matches;
  } catch {
    return 'desktop'; // no matchMedia at all -> fail open, see the file comment
  }
  // Not touch-capable (or the browser cannot say) -> a desktop, or fail open.
  if (!touch) return 'desktop';
  // Touch-capable. Only phone-SIZED screens are phones; a tablet has room for the
  // faithful panel, and a touchscreen laptop is nowhere near this small. A size that
  // cannot be read is NOT a phone — the same fail-open lean, spelled as a class.
  const short = Math.min(win.screen?.width ?? 0, win.screen?.height ?? 0);
  return short > 0 && short <= PHONE_MAX_SHORT_SIDE ? 'phone' : 'tablet';
}
