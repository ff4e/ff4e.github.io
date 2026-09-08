/**
 * How big the display cutout is, read back from the CSS custom properties.
 *
 * `index.html` resolves `env(safe-area-inset-*)` into `--sa-top`/`--sa-right`/
 * `--sa-bottom`/`--sa-left` once, and a custom property is substituted at computed-value
 * time, so this reads back a real length (`'59px'`) rather than the unresolved `env(...)`
 * text. Reading the property instead of measuring an element keeps it free of layout and
 * needs no probe node.
 *
 * **In the native app those `env()` values are all 0 and the numbers are supplied
 * instead.** `SafeAreaBridgeViewController.swift` writes the real `view.safeAreaInsets`
 * onto `:root` after every page load and every rotation, because every
 * `env(safe-area-inset-*)` resolves to `0px` inside Capacitor's WKWebView — see that
 * file's header for the whole story. This module does not care which of the two wrote
 * them; it asks the document, and the document has an answer either way.
 *
 * ── Why this is its own module ───────────────────────────────────────────────
 * It began as a private helper in `touchButtons.ts`, which was the right place while the
 * bar was the only thing pricing the cutout. `deviceOrientation.ts` prices it too, one
 * level up, and both have to agree with `index.html` about the property NAMES — so a
 * second private copy would be two places to get that wrong. The pure arithmetic stays
 * where it was (`touchBarEdge.ts`, `deviceOrientation.ts`, both DOM-free and unit-tested);
 * asking the document is this file's job.
 */

/** One inset, in CSS px. 0 on anything without a cutout on that edge, and on the web. */
export function safeAreaInset(name: '--sa-top' | '--sa-right' | '--sa-bottom' | '--sa-left'): number {
  if (typeof document === 'undefined') return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const px = Number.parseFloat(raw);
  return Number.isFinite(px) ? px : 0;
}

/**
 * The cutout's size on whichever edge it is on, in CSS px — one number for the device
 * rather than one per edge.
 *
 * `deviceOrientation.ts` needs the cutout for BOTH orientations at once, and only one of
 * them is the one being reported: held sideways the insets say `left`/`right`, held
 * upright they say `top`. It is the same piece of hardware and it measures the same
 * (62pt either way on an iPhone 17 Pro — the numbers in
 * `SafeAreaBridgeViewController.swift`), so the largest of the three IS the device's
 * cutout, whichever way it happens to be turned right now.
 *
 * `--sa-bottom` is left out on purpose: the home indicator is present in both
 * orientations and is not a cutout, and including it would report ~34 on a phone with no
 * housing at all.
 *
 * The `left`/`right` pair is safe to take a maximum over because the native side has
 * already un-mirrored it — UIKit reports the landscape inset on BOTH sides and
 * `SafeAreaBridgeViewController` zeroes the one the housing is not on, so at most one of
 * the two is non-zero here. Without that, this would still be correct (the mirrored pair
 * are equal, so the max is the same number), which is the reassuring half of it.
 */
export function housingInset(): number {
  return Math.max(safeAreaInset('--sa-top'), safeAreaInset('--sa-left'), safeAreaInset('--sa-right'));
}
