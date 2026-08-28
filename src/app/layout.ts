/**
 * Display layout for the public release (Phase 1 scaling refactor).
 *
 * The original ran a fixed window with each room's playfield centered inside it;
 * objects were therefore a constant on-screen size in every room. The port had
 * drifted to a fixed 2x per-room scale, so the canvas physically resized between
 * rooms (measured: 72 rooms span 285-795 x 210-585 px, 63 distinct sizes).
 *
 * We restore the faithful model and make it fill the viewport:
 *
 *  - A fixed **stage box** (STAGE_W x STAGE_H) contains every room (max 795x585)
 *    and the world map (640x480). The stage box + side panel are scaled together
 *    (`stageScale`) to be as large as the available viewport allows, so the panel
 *    is a constant size across all rooms (it no longer tracks the room height).
 *    The box's WIDTH is elastic (see `stageBoxWidth`): STAGE_W is its minimum, and
 *    on a window wider than the 967x600 footprint's 1.61:1 it grows into the width
 *    the height-bound scale has already declined to use. It is still the same box
 *    for every room — that invariant is the point of this file — but it now tracks
 *    the window, so one room is no longer the same size on differently-shaped
 *    windows. That is a deliberate extension of the deviation below, taken because
 *    the leftover width was otherwise simply empty and it is the ONLY thing that
 *    enlarges a room whose fit is width-bound (measured: the wide, short rooms gain
 *    up to +27% on a 2048x1017 window; 44 of the 72 rooms are unaffected, and the
 *    object-size spread across all 72 tightens slightly, 1.342x -> 1.316x). The
 *    panel's position was NOT the constraint and moving it changes nothing: the
 *    room is centred in the box, and the panel sits beside that box.
 *  - The box's HEIGHT is elastic on the same terms (`stageBoxHeight`), and that is the
 *    MIRROR of the width rule rather than a further deviation: the two fire on
 *    complementary viewports and can never both move. A height-bound viewport has
 *    `scale = availH / STAGE_H`, so `availH / scale` is exactly STAGE_H and the height
 *    cannot grow; a width-bound one has no spare width and the WIDTH cannot grow. The
 *    absence of this half was a real defect and portrait paid for it: at 638x1310 with
 *    no panel the scale is width-bound at 638/800, the box is 638x479 inside a 638x1310
 *    area, and ~64% of the height was simply unused. Measured over the 72 rooms it moves
 *    0 of them on every landscape/desktop viewport tried (1600x1017, 2048x1017, 1280x800,
 *    852x327) and up to +135% in portrait, and the object-size spread within a mode does
 *    not change at all (1.342x in 'medium', the same as on the desktop) because it is
 *    FIT_FACTORS, not the box, that bounds it. Only the 34 rooms taller than the box's
 *    own 4:3 can gain anything: the other 38 are already at the largest scale the
 *    viewport allows, because their own WIDTH is what binds.
 *  - **In touch mode there is no side panel**, and every function that reserves its
 *    footprint takes a `panel` flag to say so (default `true` — a mouse is the case
 *    nothing may change for). The touch build replaces the panel's verbs with a bar of
 *    its own (`app/touchButtons.ts`) and drives the fish by swipe, so the column is
 *    hidden outright by `drawPanel` and the 167 native px it was claiming
 *    (`PANEL_FOOTPRINT_W`) go back to the room.
 *  - **Touch mode is also always `fill`** (`effectiveFitMode`). The fit mode is a
 *    desktop control — the touch Options offers no way to change it — so the stored
 *    value is whatever a mouse session on the same browser last chose, and letting it
 *    bound a phone is letting a setting the player cannot see decide how big the game is.
 *    A phone has no pixels to spare, so it takes all of them; the price is that object
 *    size varies between rooms there (spread 2.79x rather than 'medium's 1.342x), which
 *    is the trade 'fill' has always made and is Martin's decision for this device class
 *    (2026-08-28). The desktop is untouched: `panel` true keeps the player's own mode.
 *  - That box is the SCALING envelope, and it is room-independent. The DOM element
 *    that holds the content (`#stagebox`) is sized to the CONTENT instead, so the
 *    panel sits beside the room rather than beside the box's empty slack — a room
 *    narrower than the box was otherwise pushed away from its own controls by a
 *    median 230px, up to 593px. That is a second deliberate deviation: the original's
 *    panel was a FIXED side column, so a narrow room genuinely did sit far from it,
 *    whereas here the panel's x tracks the room. The room itself does not move — its
 *    centre is `availW/2 - (gap + panelW)/2`, which the box width cancels out of.
 *  - Note for anything reading a room's scale: `contentScale` is now a function of the
 *    elastic box, so the ROOM's scale moves with the viewport width even though
 *    `stageScale` does not. Subtitle sizing reads both (`subtitleScale` takes the min of
 *    the two, `fitScreenW` takes the room's), so it is NOT invariant here: in the
 *    graded modes the min still returns `stageScale`, but in the crisp-integer modes a
 *    wider box raises the room's scale and the subtitle grows with it, toward — never
 *    past — the constant stage size. See render/subtitleGeom.ts.
 *  - Each piece of content (room / map / cutscene) is drawn at `contentScale`
 *    and centered inside the stage box:
 *      * mode 'fixed'  (Approach D, the faithful one): contentScale === stageScale, so
 *        objects are an identical on-screen size in every room; small rooms are
 *        letterboxed.
 *      * the graded "fill" modes (C): small content is enlarged up to a per-mode
 *        bound (FIT_FACTORS) to fill more of the stage box, keeping object-size
 *        variance bounded. 'small'→'large' pick how aggressive that is; 'fill'
 *        grows content until it exactly fills the stage box (no bound).
 *        **'medium' is the shipped default** (core/settings.ts), not 'fixed' — so out
 *        of the box a room IS zoomed to fit, by 1.006x to 1.35x across the 71 rooms.
 *        That spread is why subtitles are sized from the stage and not from the room
 *        (app/framePainter.ts, updateRoomSubtitles).
 *      * mode 'native': the largest INTEGER display scale that still fits the stage
 *        box (1×/2×/3×…). With `image-rendering: pixelated` this gives uniform,
 *        crisp nearest-neighbour pixels — the closest thing to the original's 1:1
 *        pixels — at the cost of object size varying between rooms (like 'fill',
 *        but snapped to a whole number so there is no fractional upscaling shimmer).
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
 * Native-pixel margin kept between the stage box + panel group and each viewport edge.
 *
 * The elastic box (`stageBoxWidth`) would otherwise spend every spare pixel and leave the
 * group touching both edges — which `#stagebox`'s `overflow: hidden` then clips, because
 * the row is centred and any rounding lands on one side. Reserving a margin is what makes
 * "use the spare width" mean "use the spare width, not all of it".
 */
export const STAGE_EDGE = 12;
/** The widest content the stage box ever has to hold (DRAKAR/PUCLIK are 795 native px wide). */
export const MAX_CONTENT_W = 795;
/** The tallest content the stage box ever has to hold (PUCLIK is 585 native px tall). */
export const MAX_CONTENT_H = 585;
/** Control-panel native size (mirrors PANEL_W/PANEL_H in data/ffp.ts). */
export const PANEL_NATIVE_W = 155;
export const PANEL_NATIVE_H = 395;
/** Legacy alias for the 'medium' fit factor (was the sole 'capped' bound). */
export const CAPPED_MAX = FIT_FACTORS.medium;
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
  /** Display px per native px for the stage box + panel (constant across rooms). */
  scale: number;
  /**
   * The fit mode this layout was sized by — `effectiveFitMode(mode, panel)`, NOT the raw
   * setting, because touch overrides it. Carried for the same reason as `boxW`: the box
   * and the content must be scaled by the same one, and only this function knows it.
   */
  mode: FitMode;
  /** Gap between stage box and panel, in display px. */
  gap: number;
  /**
   * Stage box WIDTH IN NATIVE px — `STAGE_W` or wider, per `stageBoxWidth()`.
   *
   * Carried on the layout rather than read from the `STAGE_W` constant, because it is now
   * a property of the viewport and every consumer must use the SAME one. `contentScale`
   * takes it as an argument for exactly that reason.
   */
  boxW: number;
  /** Stage box HEIGHT IN NATIVE px — `STAGE_H` or taller, per `stageBoxHeight()`. */
  boxH: number;
  /** Stage box size in display px. */
  stageW: number;
  stageH: number;
  /** Panel size in display px (fixed — does not track the room). */
  panelW: number;
  panelH: number;
}

/**
 * The scale that fits the stage box + gap + panel into the available area, as
 * large as possible. Clamped to a floor so it never collapses on tiny viewports.
 *
 * Computed from the MINIMUM box (`STAGE_W`), never the elastic one: the box only ever
 * grows into width the scale has already declined to use, so letting it feed back into
 * the scale would be circular — and would trade a bigger scale for a wider box, which is
 * the opposite of the point.
 *
 * `panel` false drops the panel's footprint from that fit — see `sideFootprint`.
 *
 * **The floor yields to the width.** `MIN_STAGE_SCALE` exists so a very small window
 * still shows a usable game rather than collapsing, and it is allowed to overflow the
 * HEIGHT to do it — a short window letterboxes the box and the player scrolls nothing,
 * which is the intended trade. Overflowing the WIDTH is a different thing: `.stage` is
 * `overflow: hidden`, so a row wider than the viewport does not make the room bigger, it
 * makes a strip of it invisible. That is what a 393 px phone in portrait hit — 393/800 =
 * 0.491 is below the floor, so the scale was 0.5, the logical box was 400 display px in a
 * 393 px viewport, and a room wide enough to fill it was clipped by 7 px. Capping the
 * floor at `availW / footprintW` removes exactly that case and nothing else: on any
 * viewport where the floor was not already the binding term the expression is unchanged,
 * and a short-and-wide window still floors at 0.5.
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
 * How wide the stage box may grow before a wider one buys nothing, in native px.
 *
 * A GRADED mode enlarges a room by at most its own bound, so once the box can hold the
 * widest content at that bound, extra width buys nothing. Measured across the 72 rooms,
 * the mean gain saturates exactly there: `medium` stops moving at 795x1.35 = 1073,
 * `large` at 795x1.6 = 1272. `fixed`'s bound is 1, which lands below `STAGE_W`, so it
 * never widens the box — right, and it falls out rather than being special-cased, since
 * `contentScale === stageScale` in `fixed`.
 *
 * `fill` and the crisp-integer family are bounded by the VIEWPORT instead — see the note
 * in the body for why a native-px ceiling is the wrong instrument for the integer modes.
 */
export function stageBoxCeiling(mode: FitMode): number {
  // The crisp-integer family is bounded by its own `k = min(target, kMax)` and by the
  // viewport, not by a width in native px. Its target is PHYSICAL pixels per game pixel,
  // so the box width it needs depends on `stageScale` and `dpr` — neither of which a
  // room-independent ceiling can know. Multiplying MAX_CONTENT_W by it mixes the two
  // units and silently denies the mode a scale it could have had: measured at 1600x500,
  // dpr 1, 'x1' on UTES 780x225, a 936 box was available and would have given the exact
  // 1.0 the mode asks for, but a 795 ceiling clamped the box to STAGE_W and the room was
  // drawn at 0.855. Leaving them viewport-bounded costs nothing now that the DOM box
  // hugs its content, so a box wider than the content cannot push the panel away.
  if (NATIVE_TARGET[mode] !== undefined) return Infinity;
  return MAX_CONTENT_W * (FIT_FACTORS[mode] ?? 1);
}

/**
 * The stage box width for a viewport, in native px — `STAGE_W` or wider.
 *
 * The layout is height-bound on any window wider than the 967x600 footprint's 1.61:1, and
 * the leftover width was simply empty: the room is centred in a FIXED box, so the panel
 * was never what limited it. This spends that leftover on the box, which is the only
 * thing that enlarges a room whose fit is width-bound — the wide, short ones.
 *
 * Never below `STAGE_W`, so nothing is ever smaller than it was; never above
 * `stageBoxCeiling(mode)`, past which no room can grow. A width-bound viewport (narrower
 * than 1.61:1 — a 16:10 laptop panel at true fullscreen is one) has no leftover and gets
 * exactly today's box.
 *
 * The box stays the same for every room, which is the invariant this file exists to keep
 * (see the header). What is new is that it tracks the WINDOW, so one room is no longer
 * the same size on differently-shaped windows — a deliberate extension of the deviation
 * documented in the header, not a new one.
 */
export function stageBoxWidth(
  availW: number,
  availH: number,
  scale: number,
  mode: FitMode,
  panel = true,
): number {
  if (!Number.isFinite(scale) || scale <= 0) return STAGE_W;
  const usable = availW / scale - sideFootprint(panel) - 2 * STAGE_EDGE;
  if (!Number.isFinite(usable)) return STAGE_W;
  return Math.max(STAGE_W, Math.min(stageBoxCeiling(mode), usable));
}

/**
 * The same ceiling for the box's HEIGHT, in native px.
 *
 * `MAX_CONTENT_H` rather than `MAX_CONTENT_W` is the only difference — once the box can
 * hold the TALLEST content at the mode's bound, extra height buys nothing, exactly as
 * extra width does not. The crisp-integer family is viewport-bounded for the reason given
 * in `stageBoxCeiling`.
 */
export function stageBoxHeightCeiling(mode: FitMode): number {
  if (NATIVE_TARGET[mode] !== undefined) return Infinity;
  return MAX_CONTENT_H * (FIT_FACTORS[mode] ?? 1);
}

/**
 * The fit mode actually in force, given the input device.
 *
 * Touch is always `fill`. There is no fit control in the touch Options (`touchOptions.ts`
 * deliberately offers a short list), so on a phone the stored mode is whatever a mouse
 * session on the same browser last picked — a setting the player cannot see, deciding how
 * big the game is on the device with the fewest pixels. `fill` takes every pixel the
 * viewport allows; measured over the 72 rooms at 638x1310 that puts ALL of them at the
 * viewport maximum, against 38 before.
 *
 * `panel` is the same flag the rest of this file takes, and it is false in exactly one
 * case — touch mode. Resolved here rather than at each call site so that the box and the
 * content are sized by the SAME mode: `computeStageLayout` reports it back on
 * `StageLayout.mode`, and every consumer reads that instead of the raw setting.
 */
export function effectiveFitMode(mode: FitMode, panel = true): FitMode {
  return panel ? mode : 'fill';
}

/**
 * The stage box height for a viewport, in native px — `STAGE_H` or taller.
 *
 * The mirror of `stageBoxWidth`, and it fires on the complementary viewport: a
 * height-bound one has `scale = availH / STAGE_H`, so `availH / scale` is STAGE_H exactly
 * and this returns the floor. Only a WIDTH-bound viewport — a phone in portrait, a tall
 * narrow window — has leftover height, and there the box's fixed 600 native px were
 * throwing it away (measured: 638x479 of a 638x1310 area, ~64% of the height unused).
 *
 * It does not take `panel`: the panel is a side column and costs width, not height. It
 * does keep the same `STAGE_EDGE` margin, for the same reason — `#stagebox` clips, and
 * spending the last pixel means the rounding lands on the content.
 */
export function stageBoxHeight(availH: number, scale: number, mode: FitMode): number {
  if (!Number.isFinite(scale) || scale <= 0) return STAGE_H;
  const usable = availH / scale - 2 * STAGE_EDGE;
  if (!Number.isFinite(usable)) return STAGE_H;
  return Math.max(STAGE_H, Math.min(stageBoxHeightCeiling(mode), usable));
}

/** Full stage layout (stage box + panel display sizes) for an available area. */
export function computeStageLayout(
  availW: number,
  availH: number,
  mode: FitMode,
  panel = true,
): StageLayout {
  const fit = effectiveFitMode(mode, panel);
  const scale = computeStageScale(availW, availH, panel);
  const boxW = stageBoxWidth(availW, availH, scale, fit, panel);
  const boxH = stageBoxHeight(availH, scale, fit);
  return {
    scale,
    mode: fit,
    // Zero when the panel is gone, and both for the same reason: the row has one item
    // left, so there is no gap between anything, and the panel canvas is not drawn at
    // all (drawPanel returns before it reads these). A layout that still reported them
    // would be describing a column that is `display: none`.
    gap: panel ? STAGE_GAP * scale : 0,
    boxW,
    boxH,
    stageW: boxW * scale,
    stageH: boxH * scale,
    panelW: panel ? PANEL_NATIVE_W * scale : 0,
    panelH: panel ? PANEL_NATIVE_H * scale : 0,
  };
}

/**
 * Display scale for content (room / map / cutscene) of native size `w`x`h`.
 *  - 'fixed'      → stageScale (constant object size; content centered + letterboxed).
 *  - crisp integer ('native', 'x1'…'x4') → a scale that maps each game pixel to a
 *    WHOLE number of *physical* pixels (crisp, uniform nearest-neighbour). 'native'
 *    auto-picks the largest such multiple that fits the stage box; 'xN' requests
 *    exactly N physical px per game px, capped down so it never overflows the box
 *    (so e.g. 'x4' behaves like 'native' when only 3× fits). `dpr` makes this
 *    device-pixel-perfect: the returned CSS scale may be fractional (e.g. 2/1.5 at
 *    dpr 1.5), but scale×dpr is always an integer, so pixels stay square at any
 *    browser zoom / display scaling. Falls back to the exact fitting scale only
 *    when even 1 physical pixel per game pixel would overflow (a tiny viewport).
 *  - graded fits  → stageScale enlarged by up to FIT_FACTORS[mode] so small content
 *    fills more of the stage box ('fill' = grow until it fills the box exactly);
 *    content that already fills the box is left as-is.
 * Never enlarges past the point where content would overflow the stage box.
 *
 * `boxW` is the stage box's NATIVE width — `stage.boxW`, which is elastic (see
 * `stageBoxWidth`). It is a parameter and not a read of `STAGE_W` so that every consumer
 * is forced to use the same box the layout actually sized; defaulting to `STAGE_W` keeps
 * the pre-elastic behaviour for callers that genuinely have no layout to hand. `boxH` is
 * the same for the height (`stage.boxH`, `stageBoxHeight`), and defaults to `STAGE_H`.
 */
export function contentScale(
  w: number,
  h: number,
  stageScale: number,
  mode: FitMode,
  dpr = 1,
  boxW: number = STAGE_W,
  boxH: number = STAGE_H,
): number {
  const fill = Math.min(boxW / w, boxH / h); // grow-to-fill-the-box factor (≥1)
  const target = NATIVE_TARGET[mode];
  if (target !== undefined) {
    const maxFit = stageScale * fill; // largest CSS scale that still fits the box
    const d = dpr > 0 ? dpr : 1;
    // Whole physical pixels per game pixel: k = scale×dpr. kMax is the largest that
    // fits; 'native' takes kMax, 'xN' takes N but never more than fits.
    const kMax = Math.floor(maxFit * d);
    const k = Math.min(target, kMax);
    return k >= 1 ? k / d : maxFit; // device-integer scale, or fitting scale if <1 physical px
  }
  const cap = FIT_FACTORS[mode] ?? 1;
  if (cap <= 1) return stageScale;
  const factor = Math.max(1, Math.min(cap, fill));
  return stageScale * factor;
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
