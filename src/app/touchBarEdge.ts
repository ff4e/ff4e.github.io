/**
 * Which EDGE the in-room touch bar sits on while the device is in landscape.
 *
 * ── What this is, and what it deliberately is not ────────────────────────────
 * Portrait has always put the bar along the top and landscape down the left, from a plain
 * `@media (orientation: …)` pair in `index.html`. That pair knows the VIEWPORT and nothing
 * else, so it spends the same budget on every room — and the rooms are not the same shape:
 * they run from MIKRO's 360x210 to UTES's 780x225, aspect 1.07 to 3.47.
 *
 * **This does not ask the player to rotate anything.** The forced-rotation prompt was
 * deleted on purpose (#123 removed `orientation.ts`/`rotatePrompt.ts`), and nothing here
 * revives it: the device stays in whatever orientation it is being held in, and only the
 * bar moves. What IS borrowed from `rotatePrompt.ts` is its architecture — derive the
 * answer once per frame from the render loop rather than pushing it from every site that
 * could change it — because the same three things still vary independently: the viewport,
 * which screen is up, and which room is loaded.
 *
 * ── The rule ─────────────────────────────────────────────────────────────────
 * **Lay the room out both ways and keep whichever shows more of it.** That is the whole
 * decision, and it is Martin's (2026-08-31): "calculate area with the buttons on top,
 * second calculation with buttons on side and take the button position for which the area
 * is higher."
 *
 * The comparison is over VISIBLE area — each candidate clamped to the area that bar leaves
 * — because `.stage` is `overflow: hidden` and `MIN_STAGE_SCALE` is deliberately allowed
 * to overflow the HEIGHT (see `computeStageScale`), so on a short viewport the top bar does
 * not shrink the room, it CUTS it. Measured across 172 real viewports, that clamp alone
 * caught 104 cases where comparing SCALE would have moved the bar onto a room it was
 * slicing up to 46px off.
 *
 * **But visible area is not sufficient on its own, and an early version of this shipped
 * believing it was.** A cut room can still show more than a whole one, so the whole-room
 * test has to come FIRST — see `preferredTouchBarEdge` for the 669x280 case that
 * disproved it.
 *
 * What the rule genuinely does avoid is **device classes and viewport thresholds**: the
 * comparison is already driven by the viewport, so a phone, a tablet and an open foldable
 * get different answers without this code knowing which it is looking at.
 *
 * **Ties go to the top**, which is the one aesthetic thumb on the scale and costs nothing
 * by construction (Martin prefers the bar along the top; a tie means the room does not
 * care).
 *
 * ── What it actually does, measured ──────────────────────────────────────────
 * Over the 72 rooms and every landscape touch viewport in Playwright's device registry
 * (`tools/measure-touchbar-edge.mjs`):
 *
 *  - **phones** — ~7 rooms of 72 move the bar to the top, the widest ones. UTES (780x225,
 *    aspect 3.47) does so on 47 of 48 phone viewports and gains +7% to +13%, crossing 1:1
 *    on an iPhone (0.980 -> 1.076). Most phones move the bar twice in a whole playthrough.
 *  - **open foldables** — near-square, so most rooms prefer the top: +3.3% on average.
 *  - **tablets** — ~9 rooms, +0.8%. Android tablets are 1.76-1.82 aspect, where the left
 *    bar is nearly free (it comes out of the axis with slack) and a top bar costs 8-11%.
 *
 * The asymmetry has one structural cause worth keeping in mind before "improving" this:
 * **in landscape, height is the scarce axis** — that is what landscape means — and the
 * browser's address bar has already eaten some of it. The left bar spends WIDTH, which is
 * the axis with slack. So the wider the viewport, the freer the left bar and the dearer
 * the top one, and no bar height changes that (measured at 52-66px: it moves the tablet
 * numbers by ~1pt and the phone numbers not at all). It is about which axis, not how many
 * pixels.
 *
 * Everything here is PURE and DOM-free, like `layout.ts`'s functions and for the same
 * reason — the arithmetic is the part worth unit-testing (`test/touchBarEdge.test.ts`).
 * The per-frame sync that applies the answer lives in `touchButtons.ts`, which already
 * owns the bar's DOM state and the one `relayout()` that follows a change to it.
 */
import { computeStageLayout, contentScale } from './layout.js';
import type { FitMode } from './layout.js';

/**
 * The bar's footprint, in CSS px, and the ONE thing here that is duplicated from
 * `index.html`. Both numbers are the bar's real size in the stylesheet (72px wide down the
 * left, 66px tall along the top); this module has to know them because it is pricing the
 * two layouts before either is applied, and CSS cannot be asked.
 *
 * `test/touchBarEdge.test.ts` reads the stylesheet and asserts that every px length in the
 * landscape branch is the constant for that branch's axis, which is what keeps the pair
 * honest in BOTH directions — changing the CSS alone, changing a constant alone, or
 * updating the bar's own size while forgetting #126's centring clamp are all caught.
 * (`tools/test-touchbar.mjs` pins the rendered margins too, but against string literals,
 * so on its own it would not notice a constant moving.)
 */
export const TOUCHBAR_W = 72;
export const TOUCHBAR_H = 66;

export type TouchBarEdge = 'left' | 'top';

/**
 * How much of a `roomW`x`roomH` room is actually on screen, in CSS px², if the game is
 * given an `availW`x`availH` area.
 *
 * `availW`/`availH` are what `relayout()` will measure once the bar is placed — the
 * viewport minus that bar — so this runs the real pipeline: `computeStageLayout` for the
 * stage scale and the elastic box, then `contentScale` for the room inside it. `panel` is
 * false because touch mode hides the side column, which is also what forces the fit mode
 * to `fill` (`effectiveFitMode`), so `dpr` never reaches a crisp-integer branch here.
 *
 * The `Math.min` pair is the clipping: `.stage` hides whatever runs past its edge, so a
 * room drawn larger than the area does not count for more than the area.
 */
export function visibleRoomArea(
  roomW: number,
  roomH: number,
  availW: number,
  availH: number,
  mode: FitMode,
  dpr = 1,
): number {
  return roomOn(roomW, roomH, availW, availH, mode, dpr).visible;
}

/** How a room comes out on one candidate area: how much of it shows, and whether it is cut. */
interface Placed {
  /** Visible area in CSS px2 — the drawn size clamped to the area, since `.stage` clips. */
  visible: number;
  /** True when at least one NATIVE pixel of the room is off-screen — see `roomOn`. */
  cut: boolean;
}

function roomOn(
  roomW: number,
  roomH: number,
  availW: number,
  availH: number,
  mode: FitMode,
  dpr: number,
): Placed {
  if (!(roomW > 0) || !(roomH > 0) || !(availW > 0) || !(availH > 0)) {
    return { visible: 0, cut: false };
  }
  const l = computeStageLayout(availW, availH, mode, false);
  const s = contentScale(roomW, roomH, l.scale, l.mode, dpr, l.availW, l.availH);
  const drawnW = s * roomW;
  const drawnH = s * roomH;
  // The overflow measured in the ARTWORK's own pixels, not in CSS px. Below one native
  // pixel nothing of the room is hidden at all — there is no such thing as half a pixel of
  // wall — so that is where "cut" has to start. Measuring it in CSS px instead makes the
  // threshold depend on the scale the room happens to be drawn at, which is the quantity
  // being compared: at 653x344 BATYSKAF overflows by 0.7 CSS px, two thirds of one game
  // pixel, and treating that as a cut room cost 21% of the room's area for nothing.
  const overflow = Math.max(0, drawnH - availH) + Math.max(0, drawnW - availW);
  const cut = s > 0 && overflow / s >= 1;
  return { visible: Math.min(drawnW, availW) * Math.min(drawnH, availH), cut };
}

/**
 * The edge that shows more of this room, for a landscape viewport.
 *
 * Callers are expected to have established that the bar is up and the viewport is
 * landscape — portrait keeps its own media query and is not this function's business.
 * `viewportW`/`viewportH` are the WHOLE viewport (`window.innerWidth/innerHeight`); each
 * candidate subtracts its own bar.
 *
 * **Showing the WHOLE room outranks showing more of it.** That ordering is a guard now
 * rather than a live branch, and it is worth knowing what it was for. Measured at 669x280
 * with ZRC (555x225), BEFORE `layout.ts`'s rework: the top edge left 214px of height,
 * `MIN_STAGE_SCALE`'s floor overflowed it, and the room was drawn 266px tall — 52px of the
 * level not on screen. It STILL won on visible area, 140,598 against 138,740, because what
 * survived the cut was larger than the whole room is on the other edge. So a plain area
 * comparison moved the bar onto the layout that hid part of the level, which is the wrong
 * trade in a game where the level IS the puzzle. (Found by Martin, 2026-08-31, at exactly
 * this viewport, by resizing a window.)
 *
 * The content can no longer be drawn past its area, so `cut` is false on both edges at that
 * viewport and the plain area comparison now reaches the same answer on its own
 * (`test/touchBarEdge.test.ts` asserts both halves). The branch stays because it is two
 * lines and it is the only thing standing between a reintroduced clip and a bar that moves
 * onto it.
 */
export function preferredTouchBarEdge(
  roomW: number,
  roomH: number,
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  dpr = 1,
): TouchBarEdge {
  const top = roomOn(roomW, roomH, viewportW, viewportH - TOUCHBAR_H, mode, dpr);
  const left = roomOn(roomW, roomH, viewportW - TOUCHBAR_W, viewportH, mode, dpr);
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left';
}
