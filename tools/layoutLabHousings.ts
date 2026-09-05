/**
 * What a phone's HOUSING costs the layout — the display cutout, per model, measured — and
 * the full-bleed viewports the native app is actually given. DEV ONLY.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────
 * `preferredTouchBarEdge` has taken a pair of clearances since the iOS shell landed, and
 * `src/app/touchButtons.ts` is the ONLY caller that passes real ones. Every offline model —
 * `layoutPlaced.ts`, `sweep-layout.mjs`, `layout-lab.html`, and both touch-bar tools —
 * called it at inset 0, on `layoutLabViewports.ts`'s sizes, which are the area a mobile
 * BROWSER leaves the page. So between them they drew a device that does not exist: no
 * cutout, on a viewport a native app never sees. The lab could not show what the game looks
 * like on an iPhone, and nothing offline would have noticed the two models diverging.
 *
 * The numbers below are the missing half. They are a separate module from
 * `layoutLabViewports.ts` because they are a different KIND of fact: that file is generated
 * from `playwright`'s `devices` export and is regenerated wholesale when the dependency
 * moves, while these were read off real hardware and can only ever be replaced by reading
 * them off real hardware again.
 *
 * ── Where the numbers come from ──────────────────────────────────────────────
 * Measured by installing the iOS build on each simulator and reading back what
 * `ios/App/App/SafeAreaBridgeViewController.swift` published into `--sa-left`
 * (commit `5ce554a`, which drove the same table through `tools/test-touchbar.mjs`):
 *
 *     iPhone 17e                          390x844   47   (notch)
 *     iPhone 17 / 17 Pro / 17 Pro Max      402x874   62   (Dynamic Island)
 *     iPhone Air                           420x912   68
 *
 * Three different values across five current models, which is the whole reason none of this
 * is a constant: the housing is a different size on different phones and iOS is the only
 * thing that knows. The sizes are PORTRAIT points, as the source recorded them; the rows
 * below transpose them, because landscape is the only orientation the rule governs.
 *
 * Two honest gaps, stated rather than papered over:
 *
 *  - **The iPhone 17 Pro Max is physically larger** than the 402x874 its row was recorded
 *    under — it reported the same 62px cutout, and only the inset was the point of that
 *    measurement. Its own size is therefore NOT in the table: deriving it would be exactly
 *    the invention this module exists to avoid. Measure it if a row for it is wanted.
 *  - **Only the LANDSCAPE cutout was measured.** In portrait the housing is on the top edge
 *    and reports a different number, and nothing here knows it — so every row is landscape
 *    only (`port: null`) and `housingFor` returns nothing for portrait. That is not a claim
 *    that a portrait iPhone has no cutout; it is a refusal to guess one. It costs little
 *    today because portrait belongs to a plain media query that `touchBarEdge.ts` is never
 *    consulted for.
 *
 * ── What a cutout costs, and on which edge ───────────────────────────────────
 * Only on the edge the bar is ON, which is what the stylesheet says: `--bar-w` is
 * `58px + max(--sa-left, --bar-lead)` and `--bar-h` is `54px + --sa-top`. A room drawn
 * against the top edge of a landscape phone is not shrunk by an island on its side — the
 * canvas runs under it — so `preferredTouchBarEdge` prices `insetTop` and `clearLeft`
 * separately, and so does `tools/layoutPlaced.ts`.
 *
 * It changes real answers, which is the point of modelling it: at a 62px housing the left
 * bar costs 58 + 62 = 120px of the room's width instead of 58 + 14 = 72, and 48px is more
 * than enough to move the bar to the other edge. `test/touchBarEdge.test.ts` pins the flips.
 *
 * How OFTEN, so the effect is not read as bigger than it is: swept over all 63 distinct room
 * shapes at 874x402/62, the edge moves on 2 and the room shrinks on 2, worst 5.7%. Phones
 * are ~2.17 times wider than they are tall in landscape, so nearly every room is height-
 * bound and a cutout on the SIDE spends width they had spare. The two that move — BATYSKAF
 * 690x300 and VITEJTE1 750x345 — are the widest rooms in the game, and they are the two the
 * unit test names. See `preferredStripEdge` in `tools/layoutPlaced.ts` for the full table.
 */
import type { LabDevice } from './layoutLabViewports.js';

/**
 * A display cutout's size on each edge, CSS px — what `env(safe-area-inset-*)` resolves to,
 * and what `touchButtons.ts` reads out of `--sa-left`/`--sa-top`.
 *
 * Both edges, and not one number, because the two are priced independently (see the
 * header). In landscape `top` is 0 on every phone: the housing is on a side.
 */
export interface LabHousing {
  left: number;
  top: number;
}

/** A browser, a desktop window, a TV — anything that reports no cutout at all. */
export const NO_HOUSING: LabHousing = { left: 0, top: 0 };

/**
 * The iPhones, at the size the NATIVE app gets and with the cutout it reports.
 *
 * Deliberately the same `LabDevice` shape as Playwright's rows so the picker needs no
 * second code path — the only difference is that `land` is the whole screen rather than
 * what a browser left of it, and that `housing` is set.
 *
 * The gap between the two is worth seeing side by side. An iPhone 17's browser row is
 * 756x352 and its native row is 874x402: mobile Safari has already taken the cutout off
 * BOTH sides (874 - 2x59 = 756) plus 50px of its own furniture off the height. That is why
 * the web caller genuinely sees an inset of 0 and why modelling the phone as "the browser
 * viewport, plus a cutout" would double-count. A native row is a different viewport, not
 * the same one with a number added.
 */
export const LAB_NATIVE_DEVICES: readonly LabDevice[] = [
  {
    name: 'iPhone 17e, native',
    klass: 'native',
    port: null,
    land: { w: 844, h: 390 },
    housing: { left: 47, top: 0 },
    note: 'Notch. 47px measured on the simulator (5ce554a). Portrait 390x844 full-bleed.',
  },
  {
    name: 'iPhone 17, 17 Pro, native',
    klass: 'native',
    port: null,
    land: { w: 874, h: 402 },
    housing: { left: 62, top: 0 },
    note: 'Dynamic Island. 62px measured (5ce554a). The 17 Pro Max reported the same 62 on a larger screen that was not recorded.',
  },
  {
    name: 'iPhone Air, native',
    klass: 'native',
    port: null,
    land: { w: 912, h: 420 },
    housing: { left: 68, top: 0 },
    note: 'The largest cutout of the five current models. 68px measured (5ce554a).',
  },
];

/**
 * The cutout a device reports the given way up — `NO_HOUSING` for everything that has none.
 *
 * Portrait always returns `NO_HOUSING`, even for a phone that plainly has a cutout there:
 * see the header. The lab says so on screen rather than letting the 0 read as a fact.
 */
export function housingFor(d: LabDevice, orient: 'portrait' | 'landscape'): LabHousing {
  if (orient === 'portrait' || !d.housing) return NO_HOUSING;
  return d.housing;
}

/** True for a device whose portrait cutout is unknown rather than absent. */
export function housingUnmeasuredInPortrait(d: LabDevice): boolean {
  return !!d.housing;
}
