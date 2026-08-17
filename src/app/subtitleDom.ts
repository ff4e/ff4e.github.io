/**
 * Subtitles as DOM text, animated by the compositor.
 *
 * The renderer for the `enhanced` and `ai` tiers, and for cutscene captions. `classic`
 * is the one path this does not touch: it bakes its subtitles into the pixel frame with
 * the game's own bitmap font, and never reaches a vector renderer at all.
 *
 * This replaced a canvas overlay that redrew every glyph — shape, outline stroke,
 * gradient fill — on every animation step, handing the browser a changed backing store
 * to re-upload each time. Here each glyph is rendered ONCE as real text and only its
 * `transform` is animated, which a browser composites on the GPU without re-rasterising
 * anything.
 *
 * The point of doing it this way rather than in WebGL: a `transform` animation started
 * through the Web Animations API runs on the COMPOSITOR thread. It keeps its own time
 * and stays smooth even while the main thread is busy — which is the reported symptom
 * (subtitles juddering while the game itself holds its frame rate). A GPU renderer would
 * animate at whatever rate the main thread manages, because that is where it would be
 * driven from.
 *
 * NOT pixel-identical to the original's own glyph rendering: the browser shapes and
 * rasterises this text. What is pinned instead is the geometry — `subtitleGeom.ts` holds
 * the rules (fit-to-room size, wave phase and curve, baseline, stroke, bevel) in unit
 * tests, and test-aisubs measures the rendered text for size, bottom anchoring and
 * centring. The bitmap path is still byte-exact, and is what `classic` draws.
 */
import {
  VECTOR_GEOM,
  bevelBottomRgb,
  bevelSpan,
  clampTextScale,
  fitBlockFontPx,
  fitScreenW,
  lineAnchor,
  lineOffset,
  strokeWidth,
  waveDy,
} from '../render/subtitleGeom.js';
import { wrap } from './dom.js';
import { aiSubScale } from './introOverlay.js';
import { graphics } from './renderSettings.js';
import type { SubtitleSystem } from '../render/subtitles.js';

/** Logic ticks per second (LOGIC_MS = 80). Wave timing is derived from this. */
const TICKS_PER_SEC = 12.5;
/** Keyframes sampled along the damped cosine. Enough that the curve reads as smooth. */
const WAVE_KEYFRAMES = 24;

interface DomLine {
  el: HTMLDivElement;
  spans: HTMLSpanElement[];
  /** Last vertical position written, to skip no-op style writes. */
  y: number;
  /**
   * Fit-to-room factor for this row, kept because measuring it is a forced layout.
   *
   * `y` has to be recomputed every tick (the line scrolls) and depends on this, so
   * without it stored the measurement ran once per line PER FRAME — a synchronous
   * layout in the path whose whole purpose is keeping work off the main thread, and one
   * that gets more expensive under exactly the load this renderer exists to survive.
   *
   * Shared by every row of the same message (see the fit pass in `syncDomSubtitles`), so
   * it is NOT a function of this row's own text: it depends on (font, message), and a
   * row keeps the value it was built with for as long as it exists.
   */
  fit: number;
}

/**
 * Who a layer belongs to. The room and a cutscene each have their own subtitle system
 * (`subs` and `cutsceneSubs`), their own on-screen box and their own content scale, so
 * they get their own layer rather than sharing one — sharing would have them fighting
 * over the font cache below, rebuilding every line on alternate frames.
 */
export type SubOwner = 'room' | 'cut';

interface Layer {
  host: HTMLDivElement | null;
  /**
   * One entry per engine row, keyed by the row's own id.
   *
   * Keyed by identity and not by content: (startcount, speaker, text) can be shared by
   * two distinct rows — the same short line said twice on one tick, or a sentence
   * wrapping into two identical rows — and both then collapsed onto one element, so the
   * engine had two rows and the player saw one.
   */
  lines: Map<number, DomLine>;
  /** Font the measurements below were taken at; a change rebuilds the glyph boxes. */
  lastFont: string;
  /**
   * Fit budget the rows' `fit` was decided against; a change rebuilds them too.
   *
   * Watched separately from the font because the two can now move independently: the
   * font follows the STAGE and the budget follows the ROOM, so changing the fit mode
   * with a line up rescales the room without touching the font string. Left unwatched,
   * a row fitted to a wide room stayed too wide for a narrow one and was clipped by the
   * host's bounds — the exact failure `fitFontPx` exists to prevent.
   */
  lastFitW: number;
  /** The owner's own transform (the room's shake / shove), so the layer moves with it. */
  lastXform: string;
  /** Distance from a line box's top to the text baseline, for `lastFont`. */
  baselineInset: number;
  /** Height of a glyph's line box, for `lastFont` — the gradient is placed in it. */
  boxHeight: number;
}

const newLayer = (): Layer => ({ host: null, lines: new Map(), lastFont: '', lastFitW: 0, lastXform: '', baselineInset: 0, boxHeight: 0 });
const layers: Record<SubOwner, Layer> = { room: newLayer(), cut: newLayer() };
/** The element id each layer's host carries, so a probe can find it. */
const HOST_ID: Record<SubOwner, string> = { room: 'domsubs', cut: 'domsubs-cut' };

/**
 * Tear a subtitle layer down (leaving the room, switching tier, no lines left).
 *
 * The early return is what makes it safe to call unconditionally from the frame path and
 * from the render loop's guards, which is how an abandoned line is caught: the layer has
 * to be taken off the screen by whoever notices the room is no longer being painted,
 * because nothing that paints #screen can clear a sibling element.
 */
export function clearDomSubtitles(owner?: SubOwner): void {
  if (owner === undefined) {
    clearDomSubtitles('room');
    clearDomSubtitles('cut');
    return;
  }
  const L = layers[owner];
  if (!L.host && L.lines.size === 0) return;
  for (const l of L.lines.values()) l.el.remove();
  L.lines.clear();
  if (L.host) {
    L.host.remove();
    L.host = null;
  }
  L.lastFont = '';
  L.lastFitW = 0;
  L.lastXform = '';
}

/**
 * Where the baseline sits inside a line box, for this font.
 *
 * A zero-size inline-block sits ON the baseline of the line it is in, so its bottom edge
 * measures exactly what CSS will not tell us directly. Measured once per font, because
 * it is a forced layout.
 */
function measureBaseline(font: string): { inset: number; height: number } {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${font}`;
  probe.textContent = 'Mg';
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0';
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const box = probe.getBoundingClientRect();
  const inset = marker.getBoundingClientRect().bottom - box.top;
  probe.remove();
  return { inset, height: box.height };
}

/**
 * Width of a line at a given font, measured glyph by glyph.
 *
 * Kerning and ligatures are off because the glyphs are laid out one at a time (as
 * PisStringF advances them), so a kerned measurement would disagree with the result.
 */
function measureTextWidth(font: string, text: string): number {
  const probe = document.createElement('span');
  probe.style.cssText =
    `position:absolute;visibility:hidden;white-space:pre;font:${font};` +
    `font-kerning:none;font-variant-ligatures:none`;
  probe.textContent = text;
  document.body.appendChild(probe);
  const w = probe.getBoundingClientRect().width;
  probe.remove();
  return w;
}

/** The damped-cosine wave, as keyframes the compositor can run on its own. */
function waveFrames(ampCss: number): Keyframe[] {
  const out: Keyframe[] = [];
  for (let k = 0; k <= WAVE_KEYFRAMES; k++) {
    // PisStringF's own damped cosine (subtitleGeom.waveDy), sampled instead of
    // evaluated per frame — which is the whole trick: sampled once into keyframes, the
    // compositor runs it.
    const p = (k / WAVE_KEYFRAMES) * VECTOR_GEOM.waveLen;
    out.push({ offset: k / WAVE_KEYFRAMES, opacity: 1, transform: `translateY(${waveDy(p, ampCss).toFixed(2)}px)` });
  }
  return out;
}

/**
 * Reconcile the DOM with the subtitle system's current lines.
 *
 * Cheap per frame by construction: a line's glyphs are built once, and the only per-tick
 * write is the line's own `transform` for the scroll. The wave is not touched at all
 * after it starts — it is running on the compositor.
 *
 * `boxScale` is the content's own display scale (native px -> css px) and places the
 * bottom edge the text is anchored to. `textScale` sizes the text itself, and is
 * deliberately NOT the same number for a room — see the note on it below.
 */
export function syncDomSubtitles(
  owner: SubOwner,
  sys: SubtitleSystem,
  count: number,
  cssW: number,
  cssH: number,
  boxScale: number,
  textScale: number,
  family: string,
  weight: string | number,
  xform?: string,
): void {
  const L = layers[owner];
  const { w: screenW, h: screenH } = sys.vectorScreen;
  let host = L.host;
  if (!host) {
    host = document.createElement('div');
    L.host = host;
    host.id = HOST_ID[owner];
    host.style.cssText =
      // The 1px transparent border matches #screen (dom.ts): they are absolutely
      // positioned in the same wrapper, so without it this layer sits 1px
      // up and to the left of the canvas the text is supposed to line up with.
      'position:absolute;left:0;top:0;border:1px solid transparent;pointer-events:none;overflow:hidden';
    wrap.appendChild(host);
  }
  host.style.width = `${cssW}px`;
  host.style.height = `${cssH}px`;
  // The `ai` tier draws its subtitles smaller, shrunk about the bottom edge of the game
  // box. One transform on the container is the whole operation, and it
  // scales the row pitch and the wave amplitude with the glyphs, exactly as that does.
  const tier = graphics === 'ai' ? aiSubScale : 1;
  host.style.transformOrigin = '50% 100%';
  // The room shakes (trepat, ±10 native px — fired by the very chatter scripts that put
  // a subtitle up) and shoves (screenShoveX). This layer has to ride the room's
  // transform, or the room jitters under text that stands still. The last one is kept
  // when the caller passes nothing: no repaint means the shake cannot have changed.
  if (xform !== undefined) L.lastXform = xform;
  const scaleT = tier === 1 ? '' : `scale(${tier})`;
  // Translate first, then scale: the shake moves the whole layer, and must not itself
  // be scaled down by the tier's transform.
  host.style.transform = L.lastXform ? `${L.lastXform} ${scaleT}`.trim() : scaleT;

  // Hold the font inside the readable band, before `fitW` below so the fit is decided
  // against the size the text will really be. The band is on the faithful size and NOT on
  // what the player sees: the tier's shrink above is what makes an `ai` subtitle smaller
  // than a faithful one, and clamping past it would erase that (see `clampTextScale`).
  textScale = clampTextScale(textScale);
  const fontPx = VECTOR_GEOM.fontPx * textScale;
  const font = `${weight} ${fontPx.toFixed(2)}px ${family}`;
  // The width a row is fitted inside. Not the same thing as the font any more, so it is
  // watched on its own — see `Layer.lastFitW`.
  const fitW = fitScreenW(screenW, boxScale, textScale);
  if (font !== L.lastFont || fitW !== L.lastFitW) {
    // The baseline pair depends only on the font, so a budget change does not pay for a
    // second forced layout.
    if (font !== L.lastFont) ({ inset: L.baselineInset, height: L.boxHeight } = measureBaseline(font));
    L.lastFont = font;
    L.lastFitW = fitW;
    // Glyph boxes are laid out for the old size; rebuild them.
    for (const l of L.lines.values()) l.el.remove();
    L.lines.clear();
  }

  const lines = sys.debugLines();
  // ONE fit per message, not one per row.
  //
  // Fitting means shrinking the font rather than wrapping or overflowing: a row that
  // overflowed here was clipped by the host's bounds and lost its last word. It is
  // needed even though `newSubtitle` already wrapped the text, because that wraps
  // against the ORIGINAL BITMAP font's metrics (NovyTitulek, URoom.pas:592, deliberately
  // faithful) while this draws a different face 20% larger (SUB_SCALE), so a faithfully
  // wrapped row can still measure too wide.
  //
  // Applied per row, that shrank the long first row of a sentence and left its short
  // remainder at full size — two sizes in one spoken line. So the fits of a message's
  // rows are collected first and the smallest is given to all of them
  // (`fitBlockFontPx`), and the result is known BEFORE any element is built, because
  // everything below is derived from the size a row ends up at: the baseline offset in
  // `y`, the stroke width and the bevel stops. Shrinking afterwards (by writing
  // fontSize onto a finished element) leaves all three sized for a font the row is no
  // longer drawn in.
  //
  // A row already on screen keeps the fit it was built with, so no measurement is
  // repeated — the rows of a message are all added by the same `newSubtitle` call and
  // therefore always built together, in this one pass.
  const blockFit = new Map<number, number>();
  const blockNatural = new Map<number, number[]>();
  for (const t of lines) {
    const built = L.lines.get(t.id);
    if (built) {
      const cur = blockFit.get(t.block);
      if (cur === undefined || built.fit < cur) blockFit.set(t.block, built.fit);
      continue;
    }
    // Measured at the display scale, but fitted in NATIVE units, because that is where
    // the rule is defined (subtitleGeom) — dividing out `textScale` keeps a fit-to-room
    // decision from depending on the window size. Measured ONLY for a row being built:
    // it is a forced layout, and it cannot change while the row exists.
    const natural = measureTextWidth(font, t.obsah) / textScale;
    const list = blockNatural.get(t.block);
    if (list) list.push(natural);
    else blockNatural.set(t.block, [natural]);
  }
  for (const [block, naturals] of blockNatural) {
    const f = fitBlockFontPx(naturals, fitW) / VECTOR_GEOM.fontPx;
    const cur = blockFit.get(block);
    if (cur === undefined || f < cur) blockFit.set(block, f);
  }

  const want = new Set<number>();
  for (const t of lines) {
    want.add(t.id);
    let line = L.lines.get(t.id);
    const fit = line ? line.fit : blockFit.get(t.block)!;
    // A scalable font's baseline inset and line-box height scale with its size, so the
    // measured pair can be scaled rather than re-measured (which would be a second
    // forced layout per line).
    const fs = fontPx * fit;
    const inset = L.baselineInset * fit;
    const boxH = L.boxHeight * fit;
    const lineFont = fit === 1 ? font : `${weight} ${fs.toFixed(2)}px ${family}`;
    // Where this line sits right now. Computed before the element exists, because it has
    // to be part of the element's FIRST style: a `transition` plus a transform written
    // after insertion animates from the untransformed position — the top of the game box
    // — so a new line visibly fell from the ceiling before starting its wave.
    //
    // Two scales, deliberately: the bottom edge of the ROOM is a position in the room
    // (boxScale), while the line's distance up from it is a distance in the TEXT
    // (textScale). While the two were the same number this was one multiplication.
    const y = screenH * boxScale + lineOffset(t.ys) * textScale - inset;
    if (!line) {
      const el = document.createElement('div');
      el.style.cssText =
        `position:absolute;left:0;right:0;text-align:center;white-space:pre;font:${lineFont};` +
        `line-height:normal;transform:translateY(${y.toFixed(2)}px);` +
        `transition:transform 80ms linear;will-change:transform`;
      const [r, g, b] = t.rgb;
      const top = `rgb(${r},${g},${b})`;
      const [dr, dg, db] = bevelBottomRgb(r, g, b);
      const bottom = `rgb(${dr},${dg},${db})`;
      const spans: HTMLSpanElement[] = [];
      // The bevel gradient, placed where the original vector path put it:
      // createLinearGradient(0, gy - fs*0.72, 0, gy + fs*0.1) — a ramp across the
      // glyph's cap height, anchored to ITS OWN baseline, not to the line box. Spreading
      // it over the whole box (which is what a bare `linear-gradient` does) puts the
      // light end above the glyph and lands it in the wrong part of the ramp, which is
      // what made the text look washed out and flat.
      const ramp = bevelSpan(fs);
      const gTop = ((inset + ramp.top) / boxH) * 100;
      const gBottom = ((inset + ramp.bottom) / boxH) * 100;
      const bevel =
        `linear-gradient(to bottom,${top} 0%,${top} ${gTop.toFixed(2)}%,` +
        `${bottom} ${gBottom.toFixed(2)}%,${bottom} 100%)`;
      // The outline is strokeText's: lineWidth = fs*0.16, centred on the
      // path, so it reaches fs*0.08 outwards. -webkit-text-stroke is the same thing —
      // but it paints OVER the fill in Chromium (which honours no paint-order on HTML
      // text), so the stroke goes on its own layer BEHIND the fill instead.
      const strokeW = strokeWidth(fs);
      // The line's own age, so a line already part-way through its wave starts there
      // rather than replaying it from the beginning.
      const ageMs = ((count - t.startcount) / TICKS_PER_SEC) * 1000;
      // The wave is a distance the glyph travels, so it rides the TEXT's scale — the
      // amplitude has to grow and shrink with the glyphs it moves, not with the room.
      const ampCss = lineAnchor(t.ys, screenH).amp * textScale;
      const frames = waveFrames(ampCss);
      const stepMs = 1000 / (VECTOR_GEOM.wavePerTick * TICKS_PER_SEC);
      const durMs = (VECTOR_GEOM.waveLen / VECTOR_GEOM.wavePerTick / TICKS_PER_SEC) * 1000;
      [...t.obsah].forEach((ch, i) => {
        // Two layers per glyph so the outline sits behind the fill in every engine.
        // The outer span is what the wave animates, so both move as one.
        const sp = document.createElement('span');
        sp.style.cssText =
          `position:relative;display:inline-block;opacity:0;will-change:transform;` +
          // Per-character advances, as PisStringF lays them out one glyph at a time:
          // kerning and ligatures would shift the letters against that.
          `font-kerning:none;font-variant-ligatures:none;-webkit-font-smoothing:antialiased`;
        const strokeEl = document.createElement('span');
        strokeEl.textContent = ch;
        strokeEl.style.cssText =
          `position:absolute;left:0;top:0;color:rgb(5,5,12);` +
          `-webkit-text-stroke:${strokeW.toFixed(2)}px rgb(5,5,12)`;
        const fillEl = document.createElement('span');
        fillEl.textContent = ch;
        fillEl.style.cssText =
          `position:relative;background-image:${bevel};-webkit-background-clip:text;` +
          `background-clip:text;color:transparent`;
        sp.append(strokeEl, fillEl);
        el.appendChild(sp);
        spans.push(sp);
        if (ch === ' ') return; // a space inks nothing; PisStringF skips it too
        // Glyph i is due when its phase reaches zero, which `wavePhase` puts at (i+1)
        // steps -- PisStringF counts characters from 1. This used to start at `i`, one
        // step (16ms) early per glyph, which is exactly the kind of drift that having
        // two copies of the rule produces and sharing one removes.
        sp.animate(frames, { duration: durMs, delay: (i + 1) * stepMs - ageMs, fill: 'forwards', easing: 'linear' });
      });
      host.appendChild(el);
      line = { el, spans, y, fit };
      L.lines.set(t.id, line);
    }
    // The scroll: the only thing written per tick, and a transform, so the compositor
    // interpolates it (see the 80ms transition, one logic tick).
    if (y !== line.y) {
      line.el.style.transform = `translateY(${y.toFixed(2)}px)`;
      line.y = y;
    }
  }
  for (const [id, l] of L.lines) {
    if (want.has(id)) continue;
    l.el.remove();
    L.lines.delete(id);
  }
}
