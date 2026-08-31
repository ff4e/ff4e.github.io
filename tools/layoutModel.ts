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
 * `margin` is the reserve per viewport edge in CSS px, mirroring `VIEWPORT_MARGIN`: **0** on
 * PC and touch, because `contentScale` bounds the content to the area by construction so the
 * reserve buys air and nothing else. TV's 27 is 2.5% of a 1080p height, the low end of the
 * broadcast title-safe convention (2.5-5%), and is the reason the parameter exists at all —
 * it is also, visibly, why the TV target draws a border the other two do not.
 */
export const TARGET_DEFAULTS: Record<LayoutTarget, { left: number; top: number; margin: number }> = {
  pc: { left: 0, top: 0, margin: 0 },
  touch: { left: 72, top: 66, margin: 0 },
  tv: { left: 48, top: 40, margin: 27 },
};

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
  /** Strip thickness in CSS px: its WIDTH on the left edge, its HEIGHT on the top edge. */
  stripPx?: number;
  stripEdge?: StripEdge;
  /** Reserve per viewport edge, CSS px. */
  marginPx?: number;
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

