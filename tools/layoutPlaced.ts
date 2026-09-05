/**
 * The game's layout, plus where it puts things — the one model `tools/layout-lab.html`
 * draws. DEV ONLY.
 *
 * It brings **no scaling maths of its own**, and that is the entire point:
 * `computeStageLayout` and `contentScale` are imported from `src/app/layout.ts` and called
 * exactly as `relayout()` calls them, so a number the lab shows is a number the game has.
 *
 * What this file adds is only the PLACEMENT, which lives in `index.html`'s stylesheet and
 * therefore cannot be imported:
 *
 *  - the row (room + gap + panel) is centred in `.stage`, so the room's centre is
 *    `availW/2 - (gap + panelW)/2` — which is why moving the panel changes nothing;
 *  - in touch mode the bar reserves its space with a MARGIN on `.stage`, so `.stage`
 *    measures `viewport - bar`, and #126's pair of flex spacers then resolves the room's
 *    near edge to exactly `max(barSize, (viewport - roomSize) / 2)` — centred on the
 *    SCREEN, sliding back only when the room cannot clear the bar as well.
 *
 * `tools/verify-layout-lab.mjs` asserts this reproduction against a real Chromium running
 * the actual game, so "the lab shows the game's layout" is a measured claim and not a
 * reading of the CSS.
 */
import { computeStageLayout, contentScale, CELL_NATIVE } from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';
import { TOUCHBAR_H, TOUCHBAR_W, touchBarLeftW } from '../src/app/touchBarEdge.js';
import { VIEWPORT_MARGIN } from '../src/app/layout.js';
import type { LayoutRequest, LayoutResult, StripEdge } from './layoutModel.js';

export { TOUCHBAR_W, TOUCHBAR_H, CELL_NATIVE };

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
  // `bar + margin` and not `max(bar, margin)`: the strip sits INSIDE the reserve
  // (layoutModel.ts, STRIP_INSIDE_MARGIN), so the two stack rather than overlap. The room
  // therefore starts past both, which is what it already did — moving the strip inward
  // changed where the strip is drawn and nothing about the room's size.
  return Math.max(bar + margin, (viewport - size) / 2);
}

/**
 * Lay one room out with the shipped model.
 *
 * `stripPx` overrides the bar's real 72/54 so the lab's sliders can price a different bar,
 * and `marginPx` is passed straight through to `computeStageLayout`. Left at their
 * defaults, both are exactly what the game does.
 */
export function layoutRoom(req: LayoutRequest): LayoutResult {
  const panel = req.target === 'pc';
  const stripEdge: StripEdge = panel ? 'none' : (req.stripEdge ?? 'left');
  const strip =
    stripEdge === 'none'
      ? 0
      : (req.stripPx ?? (stripEdge === 'left' ? touchBarLeftW() : TOUCHBAR_H));
  const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;

  const stripW = stripEdge === 'left' ? strip : 0;
  const stripH = stripEdge === 'top' ? strip : 0;

  // `.stage` measures `clientWidth/clientHeight`, which excludes the bar's margin. There is
  // no margin term here: the shipped reserve is STAGE_EDGE, inside `stageBoxWidth/Height`.
  const availW = Math.max(0, req.viewportW - stripW);
  const availH = Math.max(0, req.viewportH - stripH);

  const l = computeStageLayout(availW, availH, req.mode, panel, req.marginPx);
  // `l.mode` is what the game would use; `req.mode` is what the lab was asked to draw. They
  // differ only on touch and TV, and only when previewing (see `LayoutRequest.respectMode`).
  // Overriding it here is sound because with no panel the area and the stage scale do not
  // depend on the mode at all — `l.availW/availH` is the viewport minus the strip and the
  // margins, and `l.scale` is `computeStageScale` — so only the last term changes.
  const fit = req.respectMode && !panel ? req.mode : l.mode;
  // `l.maxCellPx` is the game's own per-target ceiling; `req.maxCellPx` is the lab's slider
  // overriding it. Falling back to the layout's rather than to the parameter default matters:
  // the default is the DESKTOP ceiling, so a tool that omitted it would model touch and TV
  // with the wrong number and could report a spurious failure against a correct game.
  const s = contentScale(req.roomW, req.roomH, l.scale, fit, dpr, l.availW, l.availH, req.maxCellPx ?? l.maxCellPx);

  const drawnW = s * req.roomW;
  const drawnH = s * req.roomH;
  const rowW = drawnW + l.gap + l.panelW;

  // The reserve is per axis, because the TV title-safe convention is (48 x 27 at 1080p).
  const mRaw = req.marginPx ?? VIEWPORT_MARGIN;
  const m = typeof mRaw === 'number' ? { x: mRaw, y: mRaw } : mRaw;
  const roomX = panel
    ? Math.max(m.x, (req.viewportW - rowW) / 2)
    : nearEdge(req.viewportW, drawnW, stripW, m.x);
  const roomY = panel
    ? Math.max(m.y, (req.viewportH - drawnH) / 2)
    : nearEdge(req.viewportH, drawnH, stripH, m.y);

  // Clipped by `.stage`/`#stagebox`, both `overflow: hidden`, so the area the room can
  // actually occupy is what the bar left — never the box, which may be LARGER than it
  // (that `max(STAGE_W/H, …)` floor is the 669x280 defect).
  const cutW = Math.max(0, (drawnW - l.availW) / (s || 1));
  const cutH = Math.max(0, (drawnH - l.availH) / (s || 1));

  return {
    mode: fit,
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

/** The edge rule (#128): lay the room out both ways and keep whichever shows more of it. */
export function preferredStripEdge(req: Omit<LayoutRequest, 'stripEdge'>): StripEdge {
  const top = layoutRoom({ ...req, stripEdge: 'top' });
  const left = layoutRoom({ ...req, stripEdge: 'left' });
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left';
}

/** Re-exported so the lab has one import site for both models. */
export type { FitMode, LayoutRequest, LayoutResult };
