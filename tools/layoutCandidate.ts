/**
 * A candidate layout model, stated as a RESULT rather than as six interacting mechanisms.
 *
 * ── Status ───────────────────────────────────────────────────────────────────
 * **This model LANDED in `src/app/layout.ts`** (2026-08-31). The file stays for two jobs:
 * it is an INDEPENDENT implementation of the same stated result, so `tools/sweep-layout.mjs`
 * comparing it against `tools/layoutShipped.ts` is a real cross-check that the port did not
 * quietly change the model — they must agree exactly, and a divergence is a bug in one of
 * them — and it is where the NEXT proposed change to the layout is written and shown in the
 * lab before it is made. Everything below describes why the model is what it is.
 *
 * ── Why this file exists ─────────────────────────────────────────────────────
 * `src/app/layout.ts` is correct in most places and was arrived at one measured decision
 * at a time, but nowhere does it say what the finished layout is SUPPOSED to look like —
 * only what each part is for. Two defects survived 2223 unit tests, 94 UI probes and a
 * code review because of that, and both were found by Martin resizing a window by hand:
 * a room drawn 266px tall into 214px of space at 669x280, and a room held 21px off the
 * viewport edges at 1491x1114 that reaches them once the window is widened to 1557.
 *
 * So this module starts from one sentence and derives everything from it:
 *
 *   **Place the room as large as the viewport allows, WHOLLY on screen, centred on the
 *   screen, with the target's furniture and a margin reserved — and never smaller than
 *   it would be on any smaller viewport.**
 *
 * It is DEV ONLY and nothing in `src/` imports it. `tools/layout-lab.html` renders it
 * beside the shipped model so the two can be compared by eye at any viewport, and
 * `tools/sweep-layout.mjs` runs both over millions of (room, viewport) pairs.
 *
 * ── What it changes, and why each change is forced by that sentence ──────────
 *
 * **1. The margin is CSS px, subtracted from the viewport once, at the start.**
 * `STAGE_EDGE` is 12 NATIVE px applied inside the native-px box calculation, so on screen
 * it costs `12 * stageScale` CSS px. Widening the window raises `stageScale`, so the
 * reserve grows faster than the space it is taking from and the room can get SMALLER as
 * the window gets BIGGER (measured: widening 301 -> 456 at height 300 shrinks VRAK by
 * 1.59%). It is also why the reserve vanishes entirely once `stageBoxHeight`'s `max` picks
 * its `STAGE_H` floor — the margin stops being subtracted at all, which is the 1491-vs-1557
 * case. A margin between the game and the edge of the SCREEN is a property of the screen,
 * so it belongs in the screen's unit. Once it is, every downstream quantity is a
 * monotone function of the viewport by construction (see `LayoutResult.monotoneByShape`).
 *
 * **2. The room is bounded by the AVAILABLE AREA, not by a box floored at 800x600.**
 * `stageBoxWidth/Height` return `max(STAGE_W/H, avail/scale - margin)`, so on a viewport
 * smaller than the box the box is BIGGER than the space it is in, and a room that fills it
 * runs off the screen. That floor is what `MIN_STAGE_SCALE`'s "deliberately allowed to
 * overflow the HEIGHT" comment is describing, and it is how 52px of a level came to be off
 * screen at 669x280. Here the floor still protects the stage SCALE (so the panel and the
 * objects do not collapse on a tiny window) but it can no longer cut the room, because
 * `fitScale` bounds the room independently.
 *
 * **3. The 800x600 envelope survives untouched as the OBJECT-SIZE reference.**
 * That is the faithful part and the reason the file exists at all: `stageScale` is what
 * makes a crate the same size on screen in every room, which is what the original did with
 * its fixed window. It is only its second job — bounding the room — that is removed.
 *
 * The whole of the scaling then collapses to one line (see `layoutRoom`):
 *
 *     contentScale = min(stageScale * FIT_FACTORS[mode], fitScale)
 *
 * `fixed` (factor 1) is `min(stageScale, fitScale)`; `fill` (factor Infinity) is exactly
 * `fitScale`; the graded modes sit between. The elastic box, its two ceilings and the
 * `max`/`min` pair all fall out — they were computing this, in native px, with a floor in
 * the middle of it.
 *
 * ── The three targets ────────────────────────────────────────────────────────
 * One function with a target-shaped input, not three implementations. The targets differ
 * only in what furniture is reserved and how the fit mode is resolved:
 *
 *   pc     the faithful 155x395 panel, in a column beside the room, reserved in NATIVE px
 *          because it is part of the artwork and scales with the game. Player's fit mode.
 *   touch  a strip of `stripPx` CSS px on the left or the top, no panel, mode forced `fill`.
 *   tv     the same strip, thinner (it holds a LEGEND of the controller's buttons rather
 *          than tappable targets), plus a larger margin — a title-safe inset is exactly
 *          the "reserved margin per edge" the margin already is. Fixed 16:9, never resizes.
 *
 * TV is therefore not a third layout: it is `touch` with different numbers, which is the
 * property this model was shaped to have (PLAN.md). Nothing here builds it — it exists so
 * the model cannot be written in a way that excludes it.
 *
 * ── The strip sizes are inputs, not constants ────────────────────────────────
 * Touch is 72 wide / 66 tall today and Martin has said that is not final, so every strip
 * size is a parameter with a default rather than a constant. `tools/layout-lab.html`
 * exposes them as sliders and `tools/sweep-layout.mjs` sweeps them.
 */
import { FIT_FACTORS, PANEL_FOOTPRINT_W, PANEL_NATIVE_H, PANEL_NATIVE_W } from '../src/app/layout.js';
import type { FitMode } from '../src/app/layout.js';

export { FIT_FACTORS, PANEL_NATIVE_W, PANEL_NATIVE_H };

/** The scaling envelope, unchanged from the shipped model — see note 3 in the header. */
export const STAGE_W = 800;
export const STAGE_H = 600;

/**
 * Floor on the stage SCALE, so a tiny window still shows usable objects and a usable
 * panel rather than collapsing. Unlike the shipped `MIN_STAGE_SCALE` this can no longer
 * cut the room: it bounds `stageScale` only, and the room is bounded by `fitScale`.
 */
export const MIN_STAGE_SCALE = 0.5;

export type LayoutTarget = 'pc' | 'touch' | 'tv';
/** Which edge the touch/TV strip sits on. `none` is the PC target, which has no strip. */
export type StripEdge = 'left' | 'top' | 'none';

/**
 * Per-target defaults. Every one of these is a proposal the lab can move, not a constant
 * of the model — which is the point of them being here rather than inline.
 *
 * `margin` is the reserve per viewport edge, in CSS px, and mirrors `VIEWPORT_MARGIN`:
 * **0** on PC and touch (Martin, 2026-08-31 — `fitScale` bounds the content to the area by
 * construction, so the reserve buys air and nothing else, at a cost of ~2 x margin /
 * viewportH). TV's 27 is 2.5% of a 1080p height, the low end of the broadcast title-safe
 * convention (2.5-5%), and is the case the parameter is kept for.
 */
export const TARGET_DEFAULTS: Record<LayoutTarget, { strip: number; margin: number }> = {
  pc: { strip: 0, margin: 0 },
  touch: { strip: 72, margin: 0 },
  tv: { strip: 48, margin: 27 },
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

/** Touch and TV have no fit control, so the stored desktop setting must not bind them. */
export function effectiveMode(mode: FitMode, target: LayoutTarget): FitMode {
  return target === 'pc' ? mode : 'fill';
}

/** Native px the faithful panel column takes out of the row — PC only. */
function sideFootprint(target: LayoutTarget): number {
  return target === 'pc' ? PANEL_FOOTPRINT_W : 0;
}

/**
 * Centre `size` on the viewport, then slide it back inside `[lo, hi]` if that puts it
 * outside.
 *
 * Centring on the SCREEN rather than on what the furniture left over is #126 and is
 * confirmed correct (BRIEFING.md: it is out of scope and must not change). The clamp is
 * what makes it safe: a room too big to be screen-centred inside the leftover is pinned
 * to the space it has instead of being pushed under the strip.
 */
function centreClamped(viewport: number, size: number, lo: number, hi: number): number {
  const centred = viewport / 2 - size / 2;
  if (hi - lo < size) return lo; // no room to centre in — pin it
  return Math.min(Math.max(centred, lo), hi - size);
}

/**
 * Lay one room out on one viewport.
 *
 * The whole model, in order: take the furniture and the margins off the viewport; size the
 * 800x600 envelope into what is left (that is the object-size reference and the ONLY place
 * the floor applies); take the panel column off for the room specifically; then draw the
 * room at `min(stageScale * factor, fitScale)`.
 */
export function layoutRoom(req: LayoutRequest): LayoutResult {
  const target = req.target;
  const mode = effectiveMode(req.mode, target);
  const stripEdge: StripEdge = target === 'pc' ? 'none' : (req.stripEdge ?? 'left');
  const strip = stripEdge === 'none' ? 0 : (req.stripPx ?? TARGET_DEFAULTS[target].strip);
  const margin = req.marginPx ?? TARGET_DEFAULTS[target].margin;
  const dpr = req.dpr && req.dpr > 0 ? req.dpr : 1;

  const stripW = stripEdge === 'left' ? strip : 0;
  const stripH = stripEdge === 'top' ? strip : 0;

  // 1. What is left of the viewport once the furniture and the two margins are taken off.
  //    Both are CSS px and both are subtracted ONCE, here, which is what makes everything
  //    downstream a monotone function of the viewport.
  const availW = Math.max(0, req.viewportW - stripW - 2 * margin);
  const availH = Math.max(0, req.viewportH - stripH - 2 * margin);

  // 2. The object-size reference. The floor still yields to the WIDTH, for the reason the
  //    shipped model gives: overflowing the height letterboxes, overflowing the width puts
  //    the panel off the side of the screen.
  const footprintW = STAGE_W + sideFootprint(target);
  const raw = Math.min(availW / footprintW, availH / STAGE_H);
  const floor = Math.min(MIN_STAGE_SCALE, availW / footprintW);
  const stageScale = Number.isFinite(raw) && raw > 0 ? Math.max(floor, raw) : MIN_STAGE_SCALE;

  // 3. The panel is part of the artwork, so it is reserved in NATIVE px and scales with the
  //    game — which is also why it is the one remaining place a taller window can cost a
  //    width-bound room a little size. See sweep-layout.mjs, which reports that separately.
  const panelW = target === 'pc' ? PANEL_NATIVE_W * stageScale : 0;
  const panelH = target === 'pc' ? PANEL_NATIVE_H * stageScale : 0;
  const gap = target === 'pc' ? (PANEL_FOOTPRINT_W - PANEL_NATIVE_W) * stageScale : 0;
  const roomAvailW = Math.max(0, availW - panelW - gap);
  const roomAvailH = availH;

  // 4. The largest scale that shows the WHOLE room in that space. Nothing may exceed it,
  //    which is the property the shipped model has no term for.
  const fitScale =
    req.roomW > 0 && req.roomH > 0 ? Math.min(roomAvailW / req.roomW, roomAvailH / req.roomH) : 0;

  const contentScale = scaleFor(mode, stageScale, fitScale, dpr);

  const drawnW = contentScale * req.roomW;
  const drawnH = contentScale * req.roomH;

  // 5. Placement. The room and the panel travel as one centred row on PC, so the room's
  //    centre is the screen's centre shifted left by half the panel column — the same
  //    expression the shipped layout uses, and the reason moving the panel changes nothing.
  const rowW = drawnW + gap + panelW;
  const rowLeft = centreClamped(req.viewportW, rowW, stripW + margin, req.viewportW - margin);
  const roomX = rowLeft;
  const roomY = centreClamped(req.viewportH, drawnH, stripH + margin, req.viewportH - margin);
  const panelX = rowLeft + drawnW + gap;
  const panelY = req.viewportH / 2 - panelH / 2;

  const cutW = Math.max(0, (drawnW - roomAvailW) / (contentScale || 1));
  const cutH = Math.max(0, (drawnH - roomAvailH) / (contentScale || 1));

  return {
    mode,
    stageScale,
    contentScale,
    fitScale,
    availW,
    availH,
    roomAvailW,
    roomAvailH,
    drawnW,
    drawnH,
    roomX,
    roomY,
    panelW,
    panelH,
    panelX,
    panelY,
    gap,
    gapLeft: roomX - stripW,
    gapRight: req.viewportW - (roomX + rowW),
    gapTop: roomY - stripH,
    gapBottom: req.viewportH - (roomY + drawnH),
    cutW,
    cutH,
    // Measured in the ARTWORK's own pixels: below one native pixel nothing of the room is
    // actually hidden, and a CSS-px threshold would depend on the scale being compared.
    cut: cutW >= 1 || cutH >= 1,
    visible: Math.min(drawnW, roomAvailW) * Math.min(drawnH, roomAvailH),
  };
}

/**
 * The one line the whole scaling reduces to, plus the crisp-integer family.
 *
 * `fitScale` is a hard ceiling in every mode — that is the "wholly on screen" half of the
 * sentence this file is derived from, and it is the term the shipped model lacks.
 */
function scaleFor(mode: FitMode, stageScale: number, fitScale: number, dpr: number): number {
  if (mode === 'native' || mode === 'x1' || mode === 'x2' || mode === 'x3' || mode === 'x4') {
    const target = mode === 'native' ? Infinity : Number(mode.slice(1));
    // Whole PHYSICAL pixels per game pixel, so nearest-neighbour stays square at any
    // browser zoom. Falls back to the fitting scale when even 1:1 would not fit.
    const k = Math.min(target, Math.floor(fitScale * dpr));
    return k >= 1 ? k / dpr : fitScale;
  }
  const factor = FIT_FACTORS[mode] ?? 1;
  return Math.min(stageScale * factor, fitScale);
}

/**
 * Which edge the strip should sit on, for a landscape viewport.
 *
 * Martin's rule, unchanged (#128): lay the room out both ways and keep whichever shows
 * more of it, ties to the top. What DOES change is that under this model the whole-room
 * test it needs first can never fire — nothing is ever cut here — so the rule collapses
 * back to the plain area comparison it was originally stated as. The `cut` branch is kept
 * so the same function can score the shipped model too, and so a future change that
 * reintroduces clipping cannot silently make the comparison wrong again.
 */
export function preferredStripEdge(req: Omit<LayoutRequest, 'stripEdge'>): StripEdge {
  const top = layoutRoom({ ...req, stripEdge: 'top' });
  const left = layoutRoom({ ...req, stripEdge: 'left' });
  if (top.cut !== left.cut) return top.cut ? 'left' : 'top';
  return top.visible >= left.visible ? 'top' : 'left';
}
