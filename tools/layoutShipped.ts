/**
 * The SHIPPED layout (`src/app/layout.ts` + the CSS that places its output), expressed in
 * the same shape as `tools/layoutCandidate.ts` so the two can be rendered side by side and
 * swept against each other. DEV ONLY.
 *
 * Since the model landed in `src/app/layout.ts` the two agree by design, and that is now
 * this file's second job: `layoutCandidate.ts` is an INDEPENDENT implementation of the same
 * stated result, so the sweep comparing them is a cross-check that the port did not quietly
 * change the model. A divergence is a bug in one of them.
 *
 * It brings **no scaling maths of its own** — that is the entire point. `computeStageLayout`
 * and `contentScale` are imported from `src/app/` and called exactly as `relayout()` calls
 * them, so a difference the lab shows is a difference the game has. What this file adds is
 * only the PLACEMENT, which in the game lives in `index.html`'s stylesheet and therefore
 * cannot be imported:
 *
 *  - the row (room + gap + panel) is centred in `.stage`, so the room's centre is
 *    `availW/2 - (gap + panelW)/2` — which is why moving the panel changes nothing;
 *  - in touch mode the bar reserves its space with a MARGIN on `.stage`, so `.stage`
 *    measures `viewport - bar`, and #126's pair of flex spacers then resolves the room's
 *    near edge to exactly `max(barSize, (viewport - roomSize) / 2)` — centred on the
 *    SCREEN, sliding back only when the room cannot clear the bar as well.
 *
 * `tools/verify-layout-lab.mjs` asserts this reproduction against a real Chromium running
 * the actual game, so "the lab shows the shipped layout" is a measured claim and not a
 * reading of the CSS.
 */
import { computeStageLayout, contentScale, VIEWPORT_MARGIN } from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';
import { TOUCHBAR_H, TOUCHBAR_W } from '../src/app/touchBarEdge.js';
import type { LayoutRequest, LayoutResult, StripEdge } from './layoutCandidate.js';

export { TOUCHBAR_W, TOUCHBAR_H };

/**
 * #126's centring clamp, as the three flex rules resolve to it: centre on the whole
 * viewport, but never closer to the near edge than the bar itself.
 *
 * `margin` is added to that floor because a reserve the layout holds back is part of what
 * the content may not encroach on. The stylesheet's `min-width: 72px` / `min-height: 66px`
 * is the bar alone, which is exactly right while `VIEWPORT_MARGIN` is 0 — if it is ever
 * raised, those two lengths have to become `bar + margin` or a squeezed room will sit in
 * the reserve. Modelled here so the lab shows that before anyone ships it.
 */
function nearEdge(viewport: number, size: number, bar: number, margin: number): number {
  return Math.max(bar + margin, (viewport - size) / 2);
}

/**
 * Lay one room out with the shipped model.
 *
 * `stripPx` overrides the bar's real 72/66 so the lab's sliders can price a different bar,
 * and `marginPx` is passed straight through to `computeStageLayout` — the reserve is a
 * parameter in CSS px now, so the lab's slider moves the real thing rather than a model of
 * it. Left at their defaults, both are exactly what ships.
 */
export function layoutRoomShipped(req: LayoutRequest): LayoutResult {
  const panel = req.target === 'pc';
  const stripEdge: StripEdge = panel ? 'none' : (req.stripEdge ?? 'left');
  const strip =
    stripEdge === 'none'
      ? 0
      : (req.stripPx ?? (stripEdge === 'left' ? TOUCHBAR_W : TOUCHBAR_H));
  const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;

  const stripW = stripEdge === 'left' ? strip : 0;
  const stripH = stripEdge === 'top' ? strip : 0;

  // `.stage` measures `clientWidth/clientHeight`, which excludes the bar's margin. There is
  // no margin term here: the shipped reserve is STAGE_EDGE, inside `stageBoxWidth/Height`.
  const availW = Math.max(0, req.viewportW - stripW);
  const availH = Math.max(0, req.viewportH - stripH);

  const l = computeStageLayout(availW, availH, req.mode, panel, req.marginPx);
  const s = contentScale(req.roomW, req.roomH, l.scale, l.mode, dpr, l.availW, l.availH);

  const drawnW = s * req.roomW;
  const drawnH = s * req.roomH;
  const rowW = drawnW + l.gap + l.panelW;

  const margin = req.marginPx ?? VIEWPORT_MARGIN;
  const roomX = panel
    ? Math.max(margin, (req.viewportW - rowW) / 2)
    : nearEdge(req.viewportW, drawnW, stripW, margin);
  const roomY = panel
    ? Math.max(margin, (req.viewportH - drawnH) / 2)
    : nearEdge(req.viewportH, drawnH, stripH, margin);

  // Clipped by `.stage`/`#stagebox`, both `overflow: hidden`, so the area the room can
  // actually occupy is what the bar left — never the box, which may be LARGER than it
  // (that `max(STAGE_W/H, …)` floor is the 669x280 defect).
  const cutW = Math.max(0, (drawnW - l.availW) / (s || 1));
  const cutH = Math.max(0, (drawnH - l.availH) / (s || 1));

  return {
    mode: l.mode,
    stageScale: l.scale,
    contentScale: s,
    // The scale that WOULD have shown the whole room — not a term the shipped model has,
    // reported so the lab can show how far past it the shipped one goes.
    fitScale:
      req.roomW > 0 && req.roomH > 0
        ? Math.min(l.availW / req.roomW, l.availH / req.roomH)
        : 0,
    availW,
    availH,
    roomAvailW: l.availW,
    roomAvailH: l.availH,
    drawnW,
    drawnH,
    roomX,
    roomY,
    panelW: l.panelW,
    panelH: l.panelH,
    panelX: roomX + drawnW + l.gap,
    panelY: req.viewportH / 2 - l.panelH / 2,
    gap: l.gap,
    gapLeft: roomX - stripW,
    gapRight: req.viewportW - (roomX + rowW),
    gapTop: roomY - stripH,
    gapBottom: req.viewportH - (roomY + drawnH),
    cutW,
    cutH,
    cut: cutW >= 1 || cutH >= 1,
    visible: Math.min(drawnW, l.availW) * Math.min(drawnH, l.availH),
  };
}

/** The shipped edge rule (#128), so the lab can show both rules on both models. */
export function preferredStripEdgeShipped(req: Omit<LayoutRequest, 'stripEdge'>): StripEdge {
  const top = layoutRoomShipped({ ...req, stripEdge: 'top' });
  const left = layoutRoomShipped({ ...req, stripEdge: 'left' });
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left';
}

/** Re-exported so the lab has one import site for both models. */
export type { FitMode, LayoutRequest, LayoutResult };
