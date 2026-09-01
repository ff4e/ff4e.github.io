/**
 * The vocabulary the layout lab speaks: one request, one result, and the per-target
 * defaults. DEV ONLY, and deliberately free of any maths.
 *
 * It is a file of its own because the shapes outlived the model that introduced them. They
 * began in a candidate implementation written to be compared against the shipped one; that
 * comparison is over — the model landed in `src/app/layout.ts` and the lab shows one layout
 * now — but the shapes are still what `tools/layoutPlaced.ts` and `tools/layout-lab.ts`
 * agree on, and what any future experiment would want to speak.
 */
import { MAX_CELL_PX } from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';

export type LayoutTarget = 'pc' | 'touch' | 'tv';
/** Which edge the touch/TV strip sits on. `none` is the PC target, which has no strip. */
export type StripEdge = 'left' | 'top' | 'none';

/**
 * Per-target defaults. Every one of these is a proposal the lab can move, not a constant of
 * the model — which is the point of them being here rather than inline.
 *
 * `left` and `top` are separate because the two edges are not interchangeable: measured
 * over the 72 rooms, a LEFT strip is nearly free at any size (a phone pays 0.49% of room
 * scale at 72px and 0.66% at 96px) while a TOP strip costs about 0.29% per pixel. In
 * landscape height is the scarce axis, so the left strip comes out of the one with slack.
 * Size the left one for thumbs; make the top one as thin as its icons allow.
 *
 * `marginX`/`marginY` are the reserve per viewport edge in CSS px, mirroring
 * `VIEWPORT_MARGIN`, and they are **0 on every target** — including TV.
 *
 * ── Why TV is 0, having briefly been 48x27 ───────────────────────────────────
 * The title-safe / overscan inset is real, but it belongs to a delivery path this game does
 * not use. The distinction is between:
 *
 *   - **an HDMI input** — a console or PC feeding a panel. True overscan happens here, and
 *     it is where the 5% conventions come from (Android TV 48x27dp at 1080p, Xbox
 *     title-safe). The set crops the signal and the source cannot see that it did.
 *   - **a smart TV's own browser** — webOS, Tizen. The platform composites its apps into
 *     the panel's real pixels, so there is no legacy overscan to compensate for, and
 *     **webOS's browser already reserves about 20px per side itself**. Reserving again on
 *     top is double-counting.
 *
 * Fish Fillets is a web page, so the second path is ours. Reserving 2.5% of each axis for a
 * crop that will not happen cost a measured **4.62% of room scale vertically** — the rooms
 * are 1.07-3.47 aspect against a 1.78 screen, so 67 of 72 sit against the top and bottom
 * edges where the reserve bites, and only 5 reach the sides. Paying that for nothing is
 * exactly the "weird" Martin called it (2026-09-01).
 *
 * The parameter stays because the moment a real TV target exists on an HDMI path — the
 * Xbox port is a live task — it is the knob that answers it, and because a real device
 * showing a clipped edge is the only evidence that should turn it on.
 *
 * **Whatever it is set to, the STRIP goes inside it.** See `STRIP_INSIDE_MARGIN` below.
 */
export const TARGET_DEFAULTS: Record<
  LayoutTarget,
  { left: number; top: number; marginX: number; marginY: number; maxCellPx: number }
> = {
  pc: { left: 0, top: 0, marginX: 0, marginY: 0, maxCellPx: MAX_CELL_PX },
  touch: { left: 72, top: 66, marginX: 0, marginY: 0, maxCellPx: MAX_CELL_PX },
  // A TV is ~5x further away than a desktop, so it needs more CSS px for the same apparent
  // size: at the desktop's 28 a 1080p TV drops to 22-27 arc-minutes, well under the 31-35'
  // the original had. 45 puts it back. Not in `src/` — there is no TV target yet.
  // 68/68 is Martin's, set in the lab 2026-09-01. A TV strip holds a LEGEND of the
  // controller's buttons rather than tappable targets, so it could be thinner than touch's
  // 72 — but it is also five times further away, and 68 css px on a 1080p panel is ~42mm,
  // about 58 arc-minutes at 2.5m, which is legible. It costs ~0.3% of room scale on the left
  // edge, so the size is very nearly free and should be chosen for legibility alone.
  tv: { left: 68, top: 68, marginX: 0, marginY: 0, maxCellPx: 45 },
};

/**
 * The strip sits INSIDE the reserve, not against the panel's edge.
 *
 * This was the wrong way round and it mattered: the room was inset and the strip — the only
 * thing on screen a player has to *aim at* — was pinned to x=0, exactly where a cropping set
 * eats it. Every platform's guidance says the same thing, that a background may run
 * edge-to-edge while interactive elements may not, and the strip is the interactive element.
 *
 * It is free. The room already starts at `margin + strip`, so moving the strip from `[0,
 * strip]` to `[margin, margin + strip]` changes no size at all — only where the strip is
 * drawn. Recorded as a named constant rather than a comment because the eventual CSS has to
 * do the same thing (`left: marginX` rather than `left: 0`), and that is easy to miss.
 */
export const STRIP_INSIDE_MARGIN = true;

export interface LayoutRequest {
  /** The whole viewport, CSS px. */
  viewportW: number;
  viewportH: number;
  /** The room, native px. For layout purposes this is all a room is. */
  roomW: number;
  roomH: number;
  target: LayoutTarget;
  /** The player's fit mode. Resolved per target — touch and TV force `fill`. */
  mode: FitMode;
  /**
   * Use `mode` even on a target the game would override.
   *
   * The game forces touch and TV to `fill` (`effectiveFitMode`), because neither has a fit
   * control and the stored value is whatever a mouse session last chose — a setting the
   * player cannot see deciding how big the game is. That is a reasonable default and a poor
   * ceiling: it also means a phone CANNOT be given a bounded mode even if that is what suits
   * it. Setting this lets the lab draw the other modes on those targets, so the question
   * "what would touch look like on `medium`?" can be answered by looking instead of by
   * changing the game first.
   */
  respectMode?: boolean;
  /** Strip thickness in CSS px: its WIDTH on the left edge, its HEIGHT on the top edge. */
  stripPx?: number;
  stripEdge?: StripEdge;
  /** Reserve per viewport edge, CSS px — one number, or one per axis (see ViewportMargin). */
  marginPx?: number | { x: number; y: number };
  /** Ceiling on how big one 15px game cell may be drawn, CSS px. `Infinity` lifts it. */
  maxCellPx?: number;
  /** Device pixel ratio, for the crisp-integer fit modes. */
  dpr?: number;
}

export interface LayoutResult {
  /** The fit mode actually in force (touch/TV force `fill`). */
  mode: FitMode;
  /** CSS px per native px for the 800x600 envelope — the OBJECT-SIZE reference. */
  stageScale: number;
  /** CSS px per native px the room is actually drawn at. */
  contentScale: number;
  /** The largest scale that shows the whole room in the space left for it. */
  fitScale: number;
  /** The area left after the strip and the two margins, CSS px. */
  availW: number;
  availH: number;
  /** The area left for the ROOM specifically — `avail` minus the panel column. */
  roomAvailW: number;
  roomAvailH: number;
  /** The room on screen, CSS px. */
  drawnW: number;
  drawnH: number;
  /** Where the room lands, CSS px from the viewport's top-left. */
  roomX: number;
  roomY: number;
  /** The faithful panel, CSS px. Zero on touch and TV. */
  panelW: number;
  panelH: number;
  panelX: number;
  panelY: number;
  gap: number;
  /** Free space on each side of the room, CSS px. Negative means it runs off the screen. */
  gapLeft: number;
  gapRight: number;
  gapTop: number;
  gapBottom: number;
  /** How much of the room is off screen, in the ROOM'S OWN native px. */
  cutW: number;
  cutH: number;
  /** True when at least one whole native pixel of the room is hidden. */
  cut: boolean;
  /** Visible area, CSS px2 — the drawn size clamped to the area, since the stage clips. */
  visible: number;
}

