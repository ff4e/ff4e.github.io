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
 * ── What the answer means now that the buttons float ─────────────────────────
 * Since 2026-09-29 the bar reserves nothing: the room is laid out on the whole viewport
 * and the buttons are drawn over it (Martin: "keep the current logic of positioning the
 * buttons (top vs side) but lets not use the bar anymore and let the buttons to overlap
 * the room"). The rule below is unchanged, and it still PRICES each edge as if the bar
 * took its footprint off the viewport — which is now a proxy for "which edge does the
 * room spare". An edge whose reserve would cost the room nothing is one where the room
 * leaves letterbox slack at least a bar deep, so the buttons land in that slack instead of
 * on the level; when both edges would cost something, the cheaper one is the one where
 * the buttons cover the thinner strip of it.
 *
 * ── The second half this rule used to need, and no longer does ───────────────
 * It once had a whole-room test ranked ABOVE the area comparison. That existed because
 * `MIN_STAGE_SCALE`'s floor fed a stage box that could be bigger than the viewport, so on a
 * short viewport the top bar did not shrink the room, it CUT it — and a cut room can still
 * show more than a whole one, so plain area moved the bar onto the layout that hid part of
 * the puzzle. Measured at 669x280 with ZRC 555x225: 140,598 visible against the left edge's
 * 138,740, with 52px of the level off screen. Across Playwright's device registry, 44 of 48
 * phone viewports had a top bar clip at least one room.
 *
 * **`layout.ts`'s rework removed the class outright.** `contentScale` is bounded by the
 * area the content actually has, so nothing can be drawn past it: re-measured after the
 * port, **0 of 48 phone viewports clip anything**, and the comparison is plain area again.
 * `test/touchBarEdge.test.ts` keeps the 669x280 case, asserting the opposite of what it
 * used to — that neither edge cuts, and that area alone now reaches the right answer.
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
 * `index.html`. This module has to know it because it is pricing the two layouts before
 * either is applied, and CSS cannot be asked.
 *
 * Each is the bar's own content — its buttons plus 6px of breathing room before the room —
 * WITHOUT the clearance it needs on that edge, which the caller supplies. So 54 = 48 + 6
 * along the top and 58 = 52 + 6 down the left, matching `--bar-h`/`--bar-w`.
 *
 * `test/touchBarEdge.test.ts` reads the stylesheet and asserts that every px length in the
 * landscape branch is the constant for that branch's axis, which is what keeps the pair
 * honest in BOTH directions — changing the CSS alone or changing a constant alone is
 * caught. (`tools/test-touchbar.mjs` pins the rendered bar width too, but against the
 * stylesheet's own formula, so on its own it would not notice a constant moving.)
 */
export const TOUCHBAR_W = 58;
export const TOUCHBAR_H = 54;

/**
 * How far in the buttons start down the LEFT edge when no housing pushes them — the bar's
 * lead, and `--bar-lead` in the stylesheet.
 *
 * It exists for the display's rounded corner, which no safe-area inset describes (see
 * `index.html`). It is a FLOOR under the housing inset, never added to it, so the left
 * edge costs `TOUCHBAR_W + max(inset, TOUCHBAR_LEAD)`.
 *
 * 3px since 2026-09-29, down from 14: only tablets use this bar now, and their column is
 * centred along the edge, far from a corner. 3 is the distance the top row keeps from its
 * own edge, so both edges hold the buttons equally close.
 *
 * The top edge has no equivalent: its buttons are centred along an edge whose corners are
 * far away, so nothing there needs holding off.
 */
export const TOUCHBAR_LEAD = 3;

/**
 * The left edge's WHOLE footprint — what `.stage` gives up, and what `--bar-w` resolves
 * to — for a housing inset of `inset`.
 *
 * It exists because `TOUCHBAR_W` stopped being that number. Until the bar was sized from
 * its buttons, 72 was both the constant and the footprint, so anything that wanted the
 * footprint could just read the constant. Now the constant is the bar's own content and
 * the clearance is added by whoever knows the inset, which left every caller that read
 * `TOUCHBAR_W` as "the bar" quietly 14px short — and the ones OUTSIDE `src/` were not in
 * any gate to say so (`tools/run-ui-tests.mjs` only discovers `test-*.mjs`), so
 * `tools/test-touchbar-edge.mjs` had been failing both of its left-edge cases,
 * unwatched, since the split.
 *
 * So the footprint gets a name of its own. A caller that wants the number CSS renders
 * asks for it here; `TOUCHBAR_W` is left meaning the one thing it now means.
 *
 * `inset` defaults to 0 — no housing on this side, which is the case every offline model
 * and every browser is describing, and the one where this returns the old flat 72.
 */
export function touchBarLeftW(inset = 0): number {
  return TOUCHBAR_W + Math.max(inset, TOUCHBAR_LEAD);
}

export type TouchBarEdge = 'left' | 'top';

/**
 * How much of a `roomW`x`roomH` room is actually on screen, in CSS px², if the game is
 * given an `availW`x`availH` area.
 *
 * `availW`/`availH` are the viewport minus a candidate bar reserve (see the header for why
 * a reserve is still what is priced), so this runs the real pipeline: `computeStageLayout` for the
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
  return roomOn(roomW, roomH, availW, availH, mode, dpr);
}

/**
 * How much of a room shows on one candidate area, in CSS px2.
 *
 * The `Math.min` pair used to do two jobs: clamp the drawn size to the area because
 * `.stage` clips, and report whether anything had been clipped OFF, which the caller then
 * ranked above area. The second job has no work left (see the header), so what is returned
 * is just the area. The clamp stays because it is what makes this an honest number, not
 * because anything can still trip it.
 */
function roomOn(
  roomW: number,
  roomH: number,
  availW: number,
  availH: number,
  mode: FitMode,
  dpr: number,
): number {
  if (!(roomW > 0) || !(roomH > 0) || !(availW > 0) || !(availH > 0)) return 0;
  const l = computeStageLayout(availW, availH, mode, false);
  const s = contentScale(roomW, roomH, l.scale, l.mode, dpr, l.availW, l.availH, l.maxCellPx);
  const drawnW = s * roomW;
  const drawnH = s * roomH;
  return Math.min(drawnW, availW) * Math.min(drawnH, availH);
}

/**
 * The edge that shows more of this room, for a landscape viewport.
 *
 * Callers are expected to have established that the bar is up and the viewport is
 * landscape — portrait keeps its own media query and is not this function's business.
 * `viewportW`/`viewportH` are the WHOLE viewport (`window.innerWidth/innerHeight`); each
 * candidate subtracts its own bar.
 *
 * It is a plain area comparison, which it could not be before `layout.ts`'s rework — see
 * the header for the whole-room test that used to sit in front of it, and the 669x280 case
 * that made it necessary. Nothing can be drawn past its area now, so the two agree.
 */
export function preferredTouchBarEdge(
  roomW: number,
  roomH: number,
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  dpr = 1,
  // What each candidate edge has to CLEAR, on top of the bar's own content. The caller
  // reads them — they are a DOM question and this module is deliberately pure.
  //
  // On the top edge that is just the cutout, so it defaults to 0: a screen without one
  // costs `TOUCHBAR_H` and nothing more. On the LEFT it is `max(cutout, TOUCHBAR_LEAD)`,
  // because the buttons start after whichever is bigger, so it defaults to the lead rather
  // than to 0 — a phone with no housing on that side still holds them off the display's
  // rounded corner. That default is also what keeps every caller-less test pricing the
  // left edge at exactly what it always did (58 + 14 = the old flat 72).
  //
  // Getting this edge right is the whole point of taking them at all: on an iPhone in
  // landscape the housing is worth 47-68px depending on the model, which is more than the
  // bar's own width again, and pricing `left` without it would put the bar on the edge
  // that shows LESS of the room.
  insetTop = 0,
  clearLeft = TOUCHBAR_LEAD,
): TouchBarEdge {
  const top = roomOn(roomW, roomH, viewportW, viewportH - TOUCHBAR_H - insetTop, mode, dpr);
  const left = roomOn(roomW, roomH, viewportW - TOUCHBAR_W - clearLeft, viewportH, mode, dpr);
  return top >= left ? 'top' : 'left';
}

/**
 * The breathing room inside each footprint (54 = 48 + 6, 58 = 52 + 6 — see `TOUCHBAR_H`):
 * the part of it with no button in it. A gap that is short of the footprint by no more than
 * the room-side share of this still keeps every button off the room, so it counts as
 * fitting — otherwise POCITAC on a 13" iPad (53px of gap, buttons ending at 51) would have
 * them moved 53px onto a room they never touched. The top row is centred in its footprint,
 * so half of it is on the room's side; the left column is left-aligned, so all of it is.
 */
const BUTTON_BREATHING = 6;

/**
 * How much of the room the buttons on each edge cover, in CSS px deep.
 *
 * The room is drawn for the WHOLE viewport — the buttons reserve nothing — and centred on
 * it, never moved off them (Martin, 2026-09-29), so its size and position do not depend on
 * the edge. The buttons are never left half on the room and half on the letterbox either
 * ("better have buttons fully covered than covered partially"): if the gap between the room
 * and an edge holds their whole footprint they sit in it and cover nothing; if it does not,
 * they move in to the room's edge (`touchBarPlacement`) and cover their whole footprint.
 * So each edge covers either 0 or its footprint, and `gap` is where the room starts.
 */
export function buttonOverlap(
  roomW: number,
  roomH: number,
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  dpr = 1,
  insetTop = 0,
  clearLeft = TOUCHBAR_LEAD,
): { top: number; left: number; gapTop: number; gapLeft: number } {
  if (!(roomW > 0) || !(roomH > 0) || !(viewportW > 0) || !(viewportH > 0)) {
    return { top: 0, left: 0, gapTop: 0, gapLeft: 0 };
  }
  const l = computeStageLayout(viewportW, viewportH, mode, false);
  const s = contentScale(roomW, roomH, l.scale, l.mode, dpr, l.availW, l.availH, l.maxCellPx);
  const gapLeft = Math.max(0, (viewportW - s * roomW) / 2);
  const gapTop = Math.max(0, (viewportH - s * roomH) / 2);
  const footTop = TOUCHBAR_H + insetTop;
  const footLeft = TOUCHBAR_W + clearLeft;
  return {
    top: gapTop >= footTop - BUTTON_BREATHING / 2 ? 0 : footTop,
    left: gapLeft >= footLeft - BUTTON_BREATHING ? 0 : footLeft,
    gapTop,
    gapLeft,
  };
}

/**
 * Where the buttons go, in EITHER orientation: the edge, and how far in from it.
 *
 * The edge: start from the one the stylesheet has always used — `preferredTouchBarEdge` in
 * landscape, the top in portrait — and move to the other only when it covers LESS of the
 * room (Martin, 2026-09-29: "if the overlap is just partial then move the buttons to the
 * top or vice versa"). An edge that covers nothing always beats one that covers something,
 * and when both cover, the shallower footprint wins — the top's 54px over the left's 61.
 *
 * `inset`: 0 when the buttons fit beside the room. When they do not, it is the gap between
 * the screen edge and the room, rounded up, so the buttons start ON the room rather than
 * straddling its edge — TRUHLA on a 13" iPad left ~40px each side, and the left buttons sat
 * half on it. A gap under a pixel is no gap.
 *
 * Measured on iPads, room centred: portrait covers nothing (VRAK's buttons go left); in
 * landscape 32-40 of the 72 rooms have no edge the buttons fit beside, and those now get the
 * top strip, fully over the room.
 */
export function touchBarPlacement(
  roomW: number,
  roomH: number,
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  dpr = 1,
  insetTop = 0,
  clearLeft = TOUCHBAR_LEAD,
): { edge: TouchBarEdge; inset: number } {
  const usual: TouchBarEdge =
    viewportW > viewportH
      ? preferredTouchBarEdge(roomW, roomH, viewportW, viewportH, mode, dpr, insetTop, clearLeft)
      : 'top';
  const other: TouchBarEdge = usual === 'top' ? 'left' : 'top';
  const o = buttonOverlap(roomW, roomH, viewportW, viewportH, mode, dpr, insetTop, clearLeft);
  const edge = o[other] < o[usual] ? other : usual;
  const gap = edge === 'top' ? o.gapTop : o.gapLeft;
  return { edge, inset: o[edge] > 0 && gap >= 1 ? Math.ceil(gap) : 0 };
}

/** Just the edge of `touchBarPlacement` — what the probes and unit tests compare. */
export function touchBarEdgeFor(
  roomW: number,
  roomH: number,
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  dpr = 1,
  insetTop = 0,
  clearLeft = TOUCHBAR_LEAD,
): TouchBarEdge {
  return touchBarPlacement(roomW, roomH, viewportW, viewportH, mode, dpr, insetTop, clearLeft).edge;
}
