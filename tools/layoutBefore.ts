/**
 * The layout as it was BEFORE the rework, in the lab's common shape — the "before" panel.
 * DEV ONLY.
 *
 * It brings **no scaling maths of its own**: `computeStageLayout` and `contentScale` come
 * from `tools/before/layout.ts`, which is `src/app/layout.ts` vendored verbatim from
 * `origin/main`, and are called exactly as that revision's `relayout()` called them. So the
 * left-hand "before" is the old behaviour itself, not a description of it.
 *
 * What this file adds is only the PLACEMENT, which lived in `index.html`'s stylesheet and
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
 * the actual game, so "the lab shows the shipped layout" is a measured claim and not a
 * reading of the CSS.
 */
import { computeStageLayout, contentScale } from './before/layout.js';
import type { FitMode } from './before/layout.js';
import { TOUCHBAR_H, TOUCHBAR_W } from '../src/app/touchBarEdge.js';
import type { LayoutRequest, LayoutResult, StripEdge } from './layoutCandidate.js';

/**
 * #126's centring clamp, as the three flex rules resolve to it: centre on the whole
 * viewport, but never closer to the near edge than the bar itself.
 */
function nearEdge(viewport: number, size: number, bar: number): number {
  return Math.max(bar, (viewport - size) / 2);
}

/**
 * Lay one room out with the shipped model.
 *
 * `stripPx` overrides the bar's real 72/66 so the lab's sliders can price a different bar
 * against the old layout too. **`marginPx` is IGNORED, and that is the point**: this model's
 * reserve is `STAGE_EDGE`, a constant in NATIVE px buried inside the box calculation, so it
 * cannot be moved from the outside at all. The margin slider therefore moves the other
 * panel and not this one — which is the clearest possible demonstration of the defect.
 */
export function layoutRoomBefore(req: LayoutRequest): LayoutResult {
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

  const l = computeStageLayout(availW, availH, req.mode, panel);
  const s = contentScale(req.roomW, req.roomH, l.scale, l.mode, dpr, l.boxW, l.boxH);

  const drawnW = s * req.roomW;
  const drawnH = s * req.roomH;
  const rowW = drawnW + l.gap + l.panelW;

  const roomX = panel
    ? Math.max(0, (req.viewportW - rowW) / 2)
    : nearEdge(req.viewportW, drawnW, stripW);
  const roomY = panel
    ? Math.max(0, (req.viewportH - drawnH) / 2)
    : nearEdge(req.viewportH, drawnH, stripH);

  // Clipped by `.stage`/`#stagebox`, both `overflow: hidden`, so the area the room can
  // actually occupy is what the bar left — never the box, which may be LARGER than it
  // (that `max(STAGE_W/H, …)` floor is the 669x280 defect).
  const cutW = Math.max(0, (drawnW - availW) / (s || 1));
  const cutH = Math.max(0, (drawnH - availH) / (s || 1));

  return {
    mode: l.mode,
    stageScale: l.scale,
    contentScale: s,
    // The scale that WOULD have shown the whole room — not a term the shipped model has,
    // reported so the lab can show how far past it the shipped one goes.
    fitScale:
      req.roomW > 0 && req.roomH > 0
        ? Math.min((availW - l.gap - l.panelW) / req.roomW, availH / req.roomH)
        : 0,
    availW,
    availH,
    roomAvailW: Math.max(0, availW - l.gap - l.panelW),
    roomAvailH: availH,
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
    visible: Math.min(drawnW, availW) * Math.min(drawnH, availH),
  };
}

/** The edge rule (#128) as it behaved on the old model — where a cut room was possible. */
export function preferredStripEdgeBefore(req: Omit<LayoutRequest, 'stripEdge'>): StripEdge {
  const top = layoutRoomBefore({ ...req, stripEdge: 'top' });
  const left = layoutRoomBefore({ ...req, stripEdge: 'left' });
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left';
}

