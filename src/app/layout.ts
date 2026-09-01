/**
 * Display layout: how big the game is drawn, and where it lands.
 *
 * ── The result this file exists to produce ───────────────────────────────────
 * Everything below is derived from one sentence, and if a change cannot be justified
 * against it, it does not belong here:
 *
 *   **Place the content as large as the viewport allows, WHOLLY on screen, centred on the
 *   screen, with the input device's furniture reserved — and never smaller than it would
 *   be on any smaller viewport.**
 *
 * That sentence was written down after two defects shipped: a room drawn 266px tall into
 * 214px of space at 669x280 (52px of the level simply off screen) and a room held 21px off
 * both viewport edges at 1491x1114 which reaches them once the window is 1557 wide. Both
 * passed 2223 unit tests, 94 UI probes and a code review, and both were found in minutes by
 * dragging a window edge. The cause in each case was the same thing: the file stated what
 * every MECHANISM was for and never what the RESULT should be, so a mechanism could be
 * locally reasonable and jointly wrong. `tools/layout-lab.html` is where a change to any of
 * this is now shown before it is made, and `tools/sweep-layout.mjs` is what proves a
 * property over millions of (room, viewport) pairs rather than at one hand-picked size.
 *
 * ── The faithful part, which does not change ─────────────────────────────────
 * The original ran a fixed window with each room's playfield centred inside it, so an
 * object was a constant on-screen size in every room. The **stage box** (STAGE_W x STAGE_H)
 * is that window: it contains every room (max 795x585) and the world map (640x480), and
 * `stageScale` is how big it is drawn. The panel is scaled by the same number, so it too is
 * a constant size across rooms. **`stageScale` is the OBJECT-SIZE REFERENCE and nothing
 * else** — that is the one job it kept.
 *
 * ── The scaling, in one line ─────────────────────────────────────────────────
 *
 *     contentScale = min(stageScale x FIT_FACTORS[mode], fitScale)
 *
 * where `fitScale` is the largest scale that shows the whole content in the space left for
 * it. `fixed` (factor 1) is `min(stageScale, fitScale)`; `fill` (Infinity) is exactly
 * `fitScale`; the graded modes sit between; the crisp-integer family floors `fitScale` to a
 * whole number of physical pixels. `fitScale` is a ceiling in every mode, and that is the
 * "wholly on screen" half of the sentence.
 *
 * This replaced an elastic stage box with two per-mode ceilings and a `max(STAGE_W/H, …)`
 * floor in the middle of it. The box was computing exactly this expression, in native px —
 * except that its floor made it BIGGER than the space it was in on a small viewport, which
 * is how a room came to be drawn off the screen. Removing it is not a loss of the
 * "one box for every room" invariant: `stageScale` still carries it, and `fitScale` depends
 * only on the room and the area, never on the box.
 *
 * ── The reserve, and why it is CSS px ────────────────────────────────────────
 * `VIEWPORT_MARGIN` replaces the old `STAGE_EDGE`, which was 12 NATIVE px applied inside the
 * box calculation. That cost `12 x stageScale` on screen, so widening the window made the
 * reserve grow faster than the space it was taking from and the room got SMALLER as the
 * window got BIGGER (measured: widening 301 -> 456 at height 300 cost VRAK 1.59%). It also
 * vanished entirely whenever the box hit its floor, which on a height-bound viewport is
 * always. A margin between the game and the edge of the SCREEN is a property of the screen,
 * so it is now in the screen's unit and subtracted from the viewport once, up front — which
 * makes every quantity below a monotone function of the viewport by construction.
 *
 * It is 0 (Martin, 2026-08-31): its old job was to stop the elastic box spending the last
 * pixel into `#stagebox`'s `overflow: hidden`, and `fitScale` now bounds the content to the
 * area by construction, so at 0 nothing can overflow — confirmed over 1,255,527 combinations.
 * It is kept as a real parameter because it is the knob a TV target needs: a title-safe
 * overscan inset is exactly "a reserve per viewport edge" (conventionally 2.5-5% of the
 * height), and because what is left of it is a purely aesthetic choice that costs a
 * measurable ~2 x margin / viewportH of content size.
 *
 * ── The one property that does NOT hold, and cannot ──────────────────────────
 * On the DESKTOP target only, making a window TALLER can make a width-bound room slightly
 * smaller: the panel is reserved in NATIVE px, so a taller window raises `stageScale`, which
 * widens the panel, which takes width from a room that was already width-bound. Worst
 * measured: -4.39% in the shipped `medium` default, -10.62% in `fill`. It never happens in
 * `fixed` (there the room scales with the stage too) and never in touch mode (no panel).
 *
 * It is not a bug to be fixed but an impossibility to be known: **the panel cannot be
 * (a) a constant size in every room and scaled with the stage, (b) guaranteed to fit the
 * viewport, and (c) harmless to a width-bound room when the window grows taller.** Making
 * it (c) means sizing it from the width alone — a panel 345px wide and 879px tall on a
 * 2000x552 window. Accepted deliberately (Martin, 2026-08-31); the previous model had the
 * same defect and slightly worse (-4.83%).
 *
 * ── The deliberate deviations from the original ──────────────────────────────
 *  - **The room is not letterboxed into a fixed 800x600 unless `fixed` asks for it.** The
 *    graded modes enlarge small content toward the space available, which the original
 *    never did; `medium` is the shipped default (core/settings.ts), so out of the box a
 *    room IS zoomed to fit, by 1.006x to 1.35x across the 71 rooms. That spread is why
 *    subtitles are sized from the stage and not from the room (app/framePainter.ts).
 *  - **The panel's x tracks the room**, because `#stagebox` hugs its content: the original's
 *    panel was a fixed side column, so a narrow room genuinely did sit far from it, and here
 *    it would have been pushed away by a median 230px of the box's empty slack. The room
 *    itself does not move — its centre is `availW/2 - (gap + panelW)/2`, which is why moving
 *    the panel to the other side changes nothing about the room's size.
 *  - **In touch mode there is no side panel**, and every function that reserves its
 *    footprint takes a `panel` flag to say so (default `true` — a mouse is the case nothing
 *    may change for). The touch build replaces the panel's verbs with a bar of its own
 *    (`app/touchButtons.ts`) and drives the fish by swipe, so the column is hidden outright
 *    by `drawPanel` and the 167 native px it was claiming (`PANEL_FOOTPRINT_W`) go back to
 *    the room.
 *  - **Touch mode is also always `fill`** (`effectiveFitMode`). The fit mode is a desktop
 *    control — the touch Options offers no way to change it — so the stored value is
 *    whatever a mouse session on the same browser last chose, and letting it bound a phone
 *    is letting a setting the player cannot see decide how big the game is. The price is
 *    that object size varies between rooms there, which is the trade 'fill' has always made
 *    and is Martin's decision for this device class (2026-08-28).
 *  - Note for anything reading a room's scale: `contentScale` is a function of the AREA, so
 *    the room's scale moves with the viewport even where `stageScale` does not. Subtitle
 *    sizing reads both (`subtitleScale` takes the min of the two, `fitScreenW` takes the
 *    room's), so it is NOT invariant here. See render/subtitleGeom.ts.
 *
 * These functions are pure (no DOM) so the scaling maths is unit-tested; the DOM
 * wiring lives in main.ts.
 */

/**
 * Fit mode. 'fixed' keeps a constant on-screen object size in every room (Approach
 * D, faithful to the original). The graded 'small'→'fill' modes enlarge small rooms
 * so they fill more of the stage box, by an increasing amount (Approach C) — see
 * FIT_FACTORS. The crisp-integer family maps each game pixel to a whole number of
 * *physical* pixels (nearest-neighbour, no blur): 'native' auto-picks the largest
 * multiple that fits, while 'x1'…'x4' request an exact multiple (capped to fit).
 * The legacy value 'capped' is migrated to 'medium' on load.
 */
export type FitMode =
  | 'fixed'
  | 'native'
  | 'x1'
  | 'x2'
  | 'x3'
  | 'x4'
  | 'small'
  | 'medium'
  | 'large'
  | 'fill';

/** Every fit mode, in dropdown order (single source of truth for UI + validation). */
export const FIT_MODES: readonly FitMode[] = [
  'fixed',
  'native',
  'x1',
  'x2',
  'x3',
  'x4',
  'small',
  'medium',
  'large',
  'fill',
];

/** Type guard: is `v` one of the current fit modes? (Used for settings validation.) */
export function isFitMode(v: unknown): v is FitMode {
  return typeof v === 'string' && (FIT_MODES as readonly string[]).includes(v);
}

/**
 * The crisp-integer family and the *physical* pixel multiple each requests:
 * 'native' = Infinity (auto-pick the largest that fits); 'xN' = exactly N. All are
 * handled specially in contentScale() (device-pixel-perfect, capped to the box).
 */
const NATIVE_TARGET: Partial<Record<FitMode, number>> = {
  native: Infinity,
  x1: 1,
  x2: 2,
  x3: 3,
  x4: 4,
};

/**
 * Per-mode cap on how much small content may be enlarged over its fixed size.
 * 1 = no enlargement (faithful); Infinity = grow until the content fills the
 * stage box exactly. The bounded steps keep object-size variance between rooms
 * predictable, so the player can trade faithfulness for a bigger picture.
 * 'native' is listed for completeness (its upper bound is the fill scale) but is
 * handled specially in contentScale() — it floors that scale to a whole number.
 * The same is true of the 'x1'…'x4' fixed-integer modes.
 */
export const FIT_FACTORS: Record<FitMode, number> = {
  fixed: 1,
  native: Infinity,
  x1: Infinity,
  x2: Infinity,
  x3: Infinity,
  x4: Infinity,
  small: 1.15,
  medium: 1.35,
  large: 1.6,
  fill: Infinity,
};

/** Stage box that contains every room (max 795x585) and the world map (640x480), with headroom. */
export const STAGE_W = 800;
export const STAGE_H = 600;
/** Native-pixel gap between the stage box and the side panel. */
export const STAGE_GAP = 12;
/**
 * Reserve kept between the game and each viewport edge, in **CSS px**.
 *
 * The unit is the point. Its predecessor `STAGE_EDGE` was 12 NATIVE px applied inside the
 * stage box's own arithmetic, so on screen it cost `12 x stageScale`: widening the window
 * raised the scale, the reserve grew faster than the space it was taking from, and the room
 * shrank as the window grew. It also disappeared whenever the box hit its `max(STAGE_H, …)`
 * floor — which on a height-bound viewport is always, so the vertical reserve was mostly
 * fiction. Subtracting a CSS-px constant from the viewport once, before anything else, has
 * neither problem and makes everything downstream monotone in the viewport.
 *
 * **0 today** (Martin, 2026-08-31). Its old job was to stop the elastic box spending the
 * last pixel into `#stagebox`'s `overflow: hidden`; `contentScale`'s `fitScale` ceiling now
 * bounds the content to the area by construction, so at 0 nothing can overflow. What is
 * left is air around the picture, which costs about `2 x margin / viewportH` of content
 * size — ~2.2% at 1080p for 12px a side.
 *
 * Kept as a named parameter rather than deleted because it is exactly the knob a TV target
 * needs: a title-safe overscan inset is "a reserve per viewport edge". `computeStageLayout`
 * therefore takes it PER AXIS as well as as a single number — see `ViewportMargin`.
 */
export const VIEWPORT_MARGIN = 0;

/**
 * A reserve per viewport edge, in CSS px — one number for both axes, or one per axis.
 *
 * Per-axis because the TV convention is asymmetric and the asymmetry is not cosmetic.
 * Android TV / Google TV ask for 48dp left and right but 27dp top and bottom at 1920x1080
 * (2.5% of each axis), and measured over the 72 rooms on a 1080p TV the two cost wildly
 * different amounts: the vertical reserve costs 4.62% of room scale, the horizontal one
 * 0.56%. The rooms are 1.07-3.47 aspect against a 1.78 screen, so most of them are already
 * letterboxed sideways — 67 of 72 have their top and bottom rows against the screen edge
 * where overscan would eat them, and only 5 reach the sides at all. A single number cannot
 * say that, and rounding the pair to one would either overpay horizontally or underprotect
 * vertically.
 */
export type ViewportMargin = number | { x: number; y: number };

/**
 * Native px per game cell. The rooms are laid out on a grid and every room's size is a whole
 * number of these (72 rooms, 285x210 to 795x585, all multiples of 15), so it is the unit a
 * player actually perceives — a crate, a step, a fish's head.
 */
export const CELL_NATIVE = 15;

/**
 * The largest a single game cell may be drawn, in CSS px — a ceiling on ENLARGEMENT.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 * The graded modes and `fill` enlarge small content toward the space available, and the
 * space available on a modern screen is enormous. Measured on `fill`, one cell of MIKRO
 * (360x210, the smallest room) comes out at **21mm on a 27" monitor** — and within that one
 * screen the smallest and largest rooms differ by **2.6x**. It looks wrong because it IS
 * wrong: the same room is a different size on every machine, and on a big one it is absurd.
 *
 * ── Why 28, and why CSS px ───────────────────────────────────────────────────
 * There is a faithful number to aim at. The original ran a fixed 800x600 window, so one
 * cell subtended roughly **31-35 arc-minutes** on a period CRT (a 15" 4:3 tube at ~575mm:
 * 5.3mm, 31'). Reproducing that today needs about 27px on a laptop and 30px on a 27"
 * monitor, so **28 lands both within a couple of arc-minutes of the 1998 original** —
 * measured, the 27" goes from 40'-104' to a flat 32' and the MacBook to 28'-35'.
 *
 * The unit has to be CSS px because it is the only physical-ish quantity a browser will
 * give you: real ppi is not exposed (fingerprinting) and CSS `mm` is a fixed 1in = 96px
 * ratio, so a "millimetre" cap would be a CSS-px cap wearing a costume. CSS px is at least
 * *defined* as an angular reference, which is what the eye cares about.
 *
 * ── Why it needs no device detection ─────────────────────────────────────────
 * **A phone never reaches it.** Its biggest cell on `fill` is 24.5px, under this ceiling, so
 * a phone keeps every pixel it has — which matters, because phones are the case that looks
 * too SMALL (their big rooms are fit-bound at ~17', and no fit mode can help that; only more
 * viewport can). "Generous on phones, bounded on big screens" therefore falls out of the
 * arithmetic rather than being a rule with a device class and a threshold to argue about —
 * the same property #128 was careful to keep for the touch bar's edge.
 *
 * A TV wants a larger number (~45px): it is five times further away, so it needs more CSS px
 * for the same apparent size. That belongs with the TV target, which does not exist yet.
 */
export const MAX_CELL_PX = 28;

/** The reserve resolved to a pair, so the callers below can stop caring which form it took. */
function marginAxes(m: ViewportMargin): { x: number; y: number } {
  return typeof m === 'number' ? { x: m, y: m } : m;
}
/** Control-panel native size (mirrors PANEL_W/PANEL_H in data/ffp.ts). */
export const PANEL_NATIVE_W = 155;
export const PANEL_NATIVE_H = 395;
/**
 * Never shrink the stage below this scale, even on tiny viewports — up to the point
 * where the floor would put the box OUTSIDE the viewport (see `computeStageScale`).
 */
export const MIN_STAGE_SCALE = 0.5;

/**
 * Native px the side panel takes out of the row: the panel itself plus the gap it is
 * separated from the stage box by.
 *
 * A single term because the two always travel together — a hidden panel takes its gap
 * with it (`display: none` removes the flex item AND the row's gap; see drawPanel), so
 * reserving one without the other would describe a layout that cannot happen.
 */
export const PANEL_FOOTPRINT_W = STAGE_GAP + PANEL_NATIVE_W;

/**
 * How much of the row the panel is claiming, in native px.
 *
 * `panel` is false in exactly one case: touch mode, where the faithful control panel is
 * retired in favour of the touch bar and the room is given its 167 px back. It is an
 * ARGUMENT rather than something this file works out, because these functions are pure —
 * the caller (`relayout`) is the one that knows, and it asks `touchUi()`.
 */
function sideFootprint(panel: boolean): number {
  return panel ? PANEL_FOOTPRINT_W : 0;
}

export interface StageLayout {
  /**
   * Display px per native px for the stage box + panel — the OBJECT-SIZE REFERENCE.
   *
   * Constant across rooms, which is what makes a crate the same size on screen everywhere
   * and is the faithful core of this file. It is NOT a bound on the content: that is
   * `contentScale`'s `fitScale`, computed from `availW`/`availH`.
   */
  scale: number;
  /**
   * The fit mode this layout was sized by — `effectiveFitMode(mode, panel)`, NOT the raw
   * setting, because touch overrides it. Carried so the layout and the content are scaled
   * by the SAME one; every consumer reads this rather than `settings.fitMode`.
   */
  mode: FitMode;
  /** Gap between stage box and panel, in display px. */
  gap: number;
  /**
   * The area left for the CONTENT, in **display px**: the viewport, minus the input
   * device's furniture, minus the two margins, minus the panel column.
   *
   * This is what replaced the elastic stage box's `boxW`/`boxH`, and the change of UNIT is
   * deliberate rather than incidental. The box was in native px and floored at STAGE_W/H,
   * so on a small viewport it described an area LARGER than the one the content was going
   * into and the content ran off the screen. This is the real area, measured in the unit
   * the screen is measured in, and `contentScale` may never exceed it.
   */
  availW: number;
  availH: number;
  /**
   * The stage box's display size — what `relayout()` gives `#stagebox`.
   *
   * Identical to `availW`/`availH`: the box IS the area now. Kept as separate names
   * because they are two different ideas (one is a DOM element's size, the other is a
   * budget) and because it is the DOM box that has `overflow: hidden`.
   */
  stageW: number;
  stageH: number;
  /** Panel size in display px (fixed — does not track the room). */
  panelW: number;
  panelH: number;
}

/**
 * The scale that fits the stage box + gap + panel into the available area, as large as
 * possible — the object-size reference, and nothing else.
 *
 * `availW`/`availH` are the area the game has AFTER the furniture and the margins are off;
 * `relayout()` measures `.stage`, whose margin already reserves the touch bar.
 *
 * `panel` false drops the panel's footprint from that fit — see `sideFootprint`.
 *
 * **The floor yields to the width.** `MIN_STAGE_SCALE` exists so a very small window still
 * shows usable objects and a usable panel rather than collapsing. It is allowed to overflow
 * the HEIGHT to do it, which letterboxes; overflowing the WIDTH is a different thing,
 * because `.stage` is `overflow: hidden` and a row wider than the viewport puts the panel
 * off the side of the screen. Capping the floor at `availW / footprintW` removes exactly
 * that case: on any viewport where the floor was not already binding the expression is
 * unchanged, and a short-and-wide window still floors at 0.5.
 *
 * **What the floor can no longer do is cut the content.** It used to feed a stage box that
 * was `max(STAGE_W/H, …)`, so a floored scale produced a box bigger than the viewport and a
 * room drawn off the screen — the 669x280 defect. The content is now bounded by
 * `availW`/`availH` independently, so the floor affects only the panel and the object-size
 * reference.
 */
export function computeStageScale(availW: number, availH: number, panel = true): number {
  const footprintW = STAGE_W + sideFootprint(panel);
  const footprintH = STAGE_H;
  const s = Math.min(availW / footprintW, availH / footprintH);
  if (!Number.isFinite(s) || s <= 0) return MIN_STAGE_SCALE;
  const floor = Math.min(MIN_STAGE_SCALE, availW / footprintW);
  return Math.max(floor, s);
}

/**
 * The fit mode actually in force, given the input device.
 *
 * Touch is always `fill`. There is no fit control in the touch Options (`touchOptions.ts`
 * deliberately offers a short list), so on a phone the stored mode is whatever a mouse
 * session on the same browser last picked — a setting the player cannot see, deciding how
 * big the game is on the device with the fewest pixels. `fill` takes every pixel the
 * viewport allows.
 *
 * `panel` is the same flag the rest of this file takes, and it is false in exactly one
 * case — touch mode. Resolved here rather than at each call site so that the layout and the
 * content are sized by the SAME mode: `computeStageLayout` reports it back on
 * `StageLayout.mode`, and every consumer reads that instead of the raw setting.
 */
export function effectiveFitMode(mode: FitMode, panel = true): FitMode {
  return panel ? mode : 'fill';
}

/**
 * Full stage layout for an available area.
 *
 * In order, and the order is the model: take the margins off the viewport; size the
 * 800x600 envelope into what is left; take the panel column off for the content
 * specifically. `contentScale` then does the one line.
 *
 * `margin` is `VIEWPORT_MARGIN` by default and is a parameter so a TV target can pass a
 * title-safe inset without a second code path — per axis if it needs to, which the TV
 * convention does (see `ViewportMargin`).
 */
export function computeStageLayout(
  viewportW: number,
  viewportH: number,
  mode: FitMode,
  panel = true,
  margin: ViewportMargin = VIEWPORT_MARGIN,
): StageLayout {
  const fit = effectiveFitMode(mode, panel);
  const m = marginAxes(margin);
  const availW = Math.max(0, viewportW - 2 * m.x);
  const availH = Math.max(0, viewportH - 2 * m.y);
  const scale = computeStageScale(availW, availH, panel);
  // Zero when the panel is gone, and both for the same reason: the row has one item left,
  // so there is no gap between anything, and the panel canvas is not drawn at all
  // (drawPanel returns before it reads these). A layout that still reported them would be
  // describing a column that is `display: none`.
  const gap = panel ? STAGE_GAP * scale : 0;
  const panelW = panel ? PANEL_NATIVE_W * scale : 0;
  const panelH = panel ? PANEL_NATIVE_H * scale : 0;
  // The panel is part of the artwork, so it is reserved in NATIVE px and scales with the
  // game — which is also the one place a taller window can cost a width-bound room a little
  // size. See the header; it is an accepted impossibility, not an oversight.
  const contentW = Math.max(0, availW - gap - panelW);
  return {
    scale,
    mode: fit,
    gap,
    availW: contentW,
    availH,
    stageW: contentW,
    stageH: availH,
    panelW,
    panelH,
  };
}

/**
 * Display scale for content (room / map / cutscene) of native size `w`x`h`.
 *
 * **The whole of it is `min(stageScale x FIT_FACTORS[mode], fitScale)`**, where `fitScale`
 * is the largest scale that shows the content whole in `availW`x`availH`:
 *
 *  - 'fixed'      → `min(stageScale, fitScale)`. Constant object size in every room, which
 *                   is the faithful mode; the `fitScale` term only ever binds on a viewport
 *                   too small to letterbox into, where the alternative is cutting the room.
 *  - graded fits  → `stageScale` enlarged by up to `FIT_FACTORS[mode]` so small content
 *                   fills more of the screen; 'fill' (Infinity) is exactly `fitScale`.
 *                   **Bounded by `maxCellPx`** — see `MAX_CELL_PX`.
 *  - crisp integer ('native', 'x1'…'x4') → a scale that maps each game pixel to a WHOLE
 *                   number of *physical* pixels (crisp, uniform nearest-neighbour). 'native'
 *                   auto-picks the largest such multiple that fits; 'xN' requests exactly N,
 *                   capped down so it never overflows (so 'x4' behaves like 'native' when
 *                   only 3x fits). `dpr` makes this device-pixel-perfect: the returned CSS
 *                   scale may be fractional (e.g. 2/1.5 at dpr 1.5), but scale x dpr is
 *                   always an integer, so pixels stay square at any browser zoom.
 *
 * `availW`/`availH` are **display px** — `stage.availW`/`availH`, the area the content
 * actually has. They are parameters rather than a read of `STAGE_W`/`STAGE_H` so that every
 * consumer is forced to use the area the layout actually measured. There is no default:
 * the previous signature defaulted to the fixed 800x600 box, and a caller that took the
 * default was silently scaling against an area that did not exist.
 *
 * `maxCellPx` is the enlargement ceiling (`MAX_CELL_PX`); pass `Infinity` to lift it.
 */
export function contentScale(
  w: number,
  h: number,
  stageScale: number,
  mode: FitMode,
  dpr: number,
  availW: number,
  availH: number,
  maxCellPx: number = MAX_CELL_PX,
): number {
  // The largest scale that shows the whole thing. A ceiling in every mode — this is the
  // term the elastic stage box did not have, and its absence is why a room could be drawn
  // 266px tall into 214px of space.
  const fit = w > 0 && h > 0 ? Math.min(availW / w, availH / h) : 0;
  const target = NATIVE_TARGET[mode];
  if (target !== undefined) {
    const d = dpr > 0 ? dpr : 1;
    // Whole physical pixels per game pixel: k = scale x dpr. kMax is the largest that fits;
    // 'native' takes kMax, 'xN' takes N but never more than fits.
    const kMax = Math.floor(fit * d);
    const k = Math.min(target, kMax);
    return k >= 1 ? k / d : fit; // device-integer scale, or the fitting scale if under 1 physical px
  }
  const cap = FIT_FACTORS[mode] ?? 1;
  // What 'fixed' would give: the faithful, constant-object-size scale.
  const base = Math.min(stageScale, fit);
  if (cap <= 1) return base;
  const enlarged = Math.min(stageScale * cap, fit);
  const ceiling = maxCellPx > 0 ? maxCellPx / CELL_NATIVE : Infinity;
  // **Never below `base`**, and that floor is not a detail. The graded modes are defined as
  // "'fixed', enlarged by up to N", so the mode list reads as increasing magnification. A
  // bare ceiling breaks that on a big monitor — `stageScale` alone can exceed it there, so
  // 'medium' would come out SMALLER than 'fixed' and switching to the faithful mode would
  // make the room bigger. Bounding the ENLARGEMENT rather than the scale keeps the ordering
  // true, and costs nothing where the ceiling was the binding term anyway.
  return Math.max(base, Math.min(enlarged, ceiling));
}

/**
 * The measured geometry of one room on screen: its native size, the CSS scale it is
 * drawn at, and the backing store behind it.
 *
 * Computed by roomGeometry() in main.ts and read by the debug hooks, so it lives here
 * beside StageLayout and contentScale rather than inside either of them.
 */
export interface RoomGeometry {
  nativeW: number;
  nativeH: number;
  /** CSS px per NATIVE px (never per backing-store px). */
  scale: number;
  cssW: number;
  cssH: number;
  backingW: number;
  backingH: number;
  /** Backing-store px per native px: 1, or the AI room's upscale factor. */
  upscale: number;
}
