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
 *  - Each piece of content (room / map / cutscene) is drawn at `contentScale`
 *    and centered inside the stage box:
 *      * mode 'fixed'  (D, default): contentScale === stageScale, so objects are
 *        an identical on-screen size in every room; small rooms are letterboxed.
 *      * the graded "fill" modes (C): small content is enlarged up to a per-mode
 *        bound (FIT_FACTORS) to fill more of the stage box, keeping object-size
 *        variance bounded. 'small'→'large' pick how aggressive that is; 'fill'
 *        grows content until it exactly fills the stage box (no bound).
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
/** Control-panel native size (mirrors PANEL_W/PANEL_H in data/ffp.ts). */
export const PANEL_NATIVE_W = 155;
export const PANEL_NATIVE_H = 395;
/** Legacy alias for the 'medium' fit factor (was the sole 'capped' bound). */
export const CAPPED_MAX = FIT_FACTORS.medium;
/** Never shrink the stage below this scale, even on tiny viewports. */
export const MIN_STAGE_SCALE = 0.5;

export interface StageLayout {
  /** Display px per native px for the stage box + panel (constant across rooms). */
  scale: number;
  /** Gap between stage box and panel, in display px. */
  gap: number;
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
 */
export function computeStageScale(availW: number, availH: number): number {
  const footprintW = STAGE_W + STAGE_GAP + PANEL_NATIVE_W;
  const footprintH = STAGE_H;
  const s = Math.min(availW / footprintW, availH / footprintH);
  if (!Number.isFinite(s) || s <= 0) return MIN_STAGE_SCALE;
  return Math.max(MIN_STAGE_SCALE, s);
}

/** Full stage layout (stage box + panel display sizes) for an available area. */
export function computeStageLayout(availW: number, availH: number): StageLayout {
  const scale = computeStageScale(availW, availH);
  return {
    scale,
    gap: STAGE_GAP * scale,
    stageW: STAGE_W * scale,
    stageH: STAGE_H * scale,
    panelW: PANEL_NATIVE_W * scale,
    panelH: PANEL_NATIVE_H * scale,
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
 */
export function contentScale(
  w: number,
  h: number,
  stageScale: number,
  mode: FitMode,
  dpr = 1,
): number {
  const fill = Math.min(STAGE_W / w, STAGE_H / h); // grow-to-fill-the-box factor (≥1)
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
