/**
 * Subtitles as DOM text, animated by the compositor.
 *
 * The renderer for the `enhanced` and `ai` tiers, and for cutscene captions. `classic`
 * is the one path this does not touch: it bakes its subtitles into the pixel frame with
 * the game's own bitmap font, and never reaches either vector renderer.
 *
 * The canvas overlay redraws every glyph — shape, outline stroke, gradient fill — on
 * every animation step, and hands the browser a changed backing store to re-upload each
 * time. This renders each glyph ONCE as real text and then animates only its
 * `transform`, which a browser composites on the GPU without re-rasterising anything.
 *
 * The point of doing it this way rather than in WebGL: a `transform` animation started
 * through the Web Animations API runs on the COMPOSITOR thread. It keeps its own time
 * and stays smooth even while the main thread is busy — which is the reported symptom
 * (subtitles juddering while the game itself holds its frame rate). A GPU renderer would
 * animate at whatever rate the main thread manages, because that is where it would be
 * driven from.
 *
 * NOT pixel-identical to `drawVector`: the browser shapes and rasterises this text. What
 * is pinned instead is the geometry — `subtitleGeom.ts` holds the rules both renderers
 * measure from, in unit tests, and `test-subtitles` compares this renderer's line
 * against the canvas one in the same tier (0.992 of its width, the remainder being the
 * browser's own shaping). `__ff.setSubRenderer('canvas')` still forces the old path.
 */
import {
  VECTOR_GEOM,
  bevelBottomRgb,
  bevelSpan,
  fitFontPx,
  lineAnchor,
  strokeWidth,
  waveDy,
} from '../render/subtitleGeom.js';
import { subRendererSelect } from './dom.js';
import { wake } from './frameClock.js';
import { aiSubScale } from './introOverlay.js';
import { graphics } from './renderSettings.js';
import { setSubOverlaySig } from './stageState.js';
import { asSubRendererPref, resolveSubRenderer } from './subRendererChoice.js';
import type { SubtitleSystem } from '../render/subtitles.js';
import type { SubRendererPref } from './subRendererChoice.js';

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
   * Fit-to-room factor for this line, kept because measuring it is a forced layout.
   *
   * `y` has to be recomputed every tick (the line scrolls) and depends on this, so
   * without it stored the measurement ran once per line PER FRAME — a synchronous
   * layout in the path whose whole purpose is keeping work off the main thread, and one
   * that gets more expensive under exactly the load this renderer exists to survive.
   * It only depends on (font, text), both of which are already in the line's cache key.
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
  lines: Map<string, DomLine>;
  /** Font the measurements below were taken at; a change rebuilds the glyph boxes. */
  lastFont: string;
  /** The owner's own transform (the room's shake / shove), so the layer moves with it. */
  lastXform: string;
  /** Distance from a line box's top to the text baseline, for `lastFont`. */
  baselineInset: number;
  /** Height of a glyph's line box, for `lastFont` — the gradient is placed in it. */
  boxHeight: number;
}

const newLayer = (): Layer => ({ host: null, lines: new Map(), lastFont: '', lastXform: '', baselineInset: 0, boxHeight: 0 });
const layers: Record<SubOwner, Layer> = { room: newLayer(), cut: newLayer() };
/** The element id each layer's host carries, so a probe can find it. */
const HOST_ID: Record<SubOwner, string> = { room: 'domsubs', cut: 'domsubs-cut' };

/**
 * Can this browser run the DOM renderer at all?
 *
 * `Element.animate` is the whole point (see resolveSubRenderer), so its absence is the
 * one honest reason to refuse. Feature-detected rather than assumed, because the
 * fallback has to be a decision taken up front, not an error thrown mid-frame.
 */
function domSubsSupported(): boolean {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
}

/**
 * The persisted preference. Absent — the normal case — means `auto`.
 *
 * Cached, because `domSubsEnabled()` asks for it once per frame and this whole change
 * exists to take work off the main thread; a synchronous `localStorage` read is a poor
 * thing to add to the path that paints the animation. Only the STORAGE read is cached —
 * the art tier is read live in `domSubsEnabled`, so switching tier still takes effect on
 * the next frame, which is what makes `auto` work at all.
 */
let prefCache: SubRendererPref | null = null;
export function subRendererPref(): SubRendererPref {
  if (prefCache !== null) return prefCache;
  try {
    prefCache = asSubRendererPref(localStorage.getItem('ff.subRenderer'));
  } catch {
    prefCache = 'auto';
  }
  return prefCache;
}

/** Is the DOM renderer the one painting right now? Asked once per frame. */
export function domSubsEnabled(): boolean {
  return resolveSubRenderer(subRendererPref(), domSubsSupported()) === 'dom';
}

/** Persist the preference. Low-level: use `selectSubRenderer` unless you own the overlay. */
export function setSubRendererPref(pref: SubRendererPref): void {
  prefCache = pref;
  try {
    if (pref === 'auto') localStorage.removeItem('ff.subRenderer');
    else localStorage.setItem('ff.subRenderer', pref);
  } catch {
    /* storage unavailable: the choice just will not persist */
  }
  if (!domSubsEnabled()) clearDomSubtitles();
}

/**
 * Switch renderer and make the change visible now — the whole switch, in one place.
 *
 * Two callers ask for this (`__ff.setSubRenderer` and the dev bar's Subtitles select),
 * and each of the three steps matters: the canvas overlay caches on a signature, so
 * without clearing it the handover can leave the previous renderer's paint on screen
 * until something else happens to invalidate it; and an idle room is not repainting at
 * all, so without `wake()` nothing would redraw until the player moved.
 */
export function selectSubRenderer(pref: SubRendererPref): SubRendererPref {
  setSubRendererPref(pref);
  setSubOverlaySig(''); // the other renderer owns the overlay now
  if (subRendererSelect) subRendererSelect.value = pref;
  wake();
  return pref;
}

/**
 * Tear the overlay down (leaving the room, switching renderer or tier, no lines left).
 *
 * The early return is what makes it safe to call unconditionally from the canvas branch
 * of the frame path, which is how a TIER switch mid-line is caught: under `auto` the
 * renderer can change with no setter being called at all, and the abandoned DOM text
 * would otherwise sit on screen with the canvas overlay painting underneath it.
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
 * Width of a line at a given font, measured the way the canvas path measures it.
 *
 * Kerning and ligatures are off because `drawVector` advances glyph by glyph, so a
 * kerned measurement here would disagree with what actually gets drawn there.
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
    // The same curve the canvas path rides, sampled instead of evaluated per frame —
    // which is the whole trick: sampled once into keyframes, the compositor runs it.
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
 */
export function syncDomSubtitles(
  owner: SubOwner,
  sys: SubtitleSystem,
  count: number,
  cssW: number,
  cssH: number,
  scale: number,
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
      // The 1px transparent border matches #screen and #subs (dom.ts): they are all
      // absolutely positioned in the same wrapper, so without it this layer sits 1px
      // up and to the left of the canvas the text is supposed to line up with.
      'position:absolute;left:0;top:0;border:1px solid transparent;pointer-events:none;overflow:hidden';
    document.getElementById('subs')?.parentElement?.appendChild(host);
  }
  host.style.width = `${cssW}px`;
  host.style.height = `${cssH}px`;
  // The `ai` tier draws its subtitles smaller, shrunk about the bottom edge of the game
  // box (applySubScale). One transform on the container is the same operation, and it
  // scales the row pitch and the wave amplitude with the glyphs, exactly as that does.
  const tier = graphics === 'ai' ? aiSubScale : 1;
  host.style.transformOrigin = '50% 100%';
  // The room shakes (trepat, ±10 native px — fired by the very chatter scripts that put
  // a subtitle up) and shoves (screenShoveX). The canvas overlay rides that by taking
  // the room's transform; this layer has to as well, or the room jitters under text
  // that stands still. Kept when the caller passes nothing, exactly as the canvas path
  // keeps the last one: no repaint means the shake cannot have changed either.
  if (xform !== undefined) L.lastXform = xform;
  const scaleT = tier === 1 ? '' : `scale(${tier})`;
  // Translate first, then scale: the shake moves the whole layer, and must not itself
  // be scaled down by the tier's transform.
  host.style.transform = L.lastXform ? `${L.lastXform} ${scaleT}`.trim() : scaleT;

  const fontPx = VECTOR_GEOM.fontPx * scale;
  const font = `${weight} ${fontPx.toFixed(2)}px ${family}`;
  if (font !== L.lastFont) {
    ({ inset: L.baselineInset, height: L.boxHeight } = measureBaseline(font));
    L.lastFont = font;
    // Glyph boxes are laid out for the old size; rebuild them.
    for (const l of L.lines.values()) l.el.remove();
    L.lines.clear();
  }

  const want = new Set<string>();
  for (const t of sys.debugLines()) {
    const key = `${t.startcount}|${t.barva}|${t.obsah}`;
    want.add(key);
    // Fit the line inside the room the way vectorLayout does: it shrinks the font
    // rather than wrapping, and a line that overflowed here was clipped by the host's
    // bounds, losing its last word. Measured on the TEXT and BEFORE the element is
    // built, because everything below is derived from the size the line ends up at —
    // the baseline offset in `y`, the stroke width, and the bevel stops. Shrinking
    // afterwards (by writing fontSize onto a finished element) left all three sized for
    // a font the line was no longer drawn in.
    // Measured at the display scale, but fitted in NATIVE units, because that is where
    // the rule is defined and where drawVector applies it — dividing out `scale` keeps a
    // fit-to-room decision from depending on the window size. Measured ONLY for a line
    // being built: it is a forced layout, and it cannot change while the line exists.
    let line = L.lines.get(key);
    const fit = line ? line.fit : fitFontPx(measureTextWidth(font, t.obsah) / scale, screenW) / VECTOR_GEOM.fontPx;
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
    const y = lineAnchor(t.ys, screenH).baseline * scale - inset;
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
      // The bevel gradient, placed exactly where the canvas puts it:
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
      // The outline is drawVector's strokeText: lineWidth = fs*0.16, centred on the
      // path, so it reaches fs*0.08 outwards. -webkit-text-stroke is the same thing —
      // but it paints OVER the fill in Chromium (which honours no paint-order on HTML
      // text), so the stroke goes on its own layer BEHIND the fill instead.
      const strokeW = strokeWidth(fs);
      // The line's own age, so a line already part-way through its wave starts there
      // rather than replaying it from the beginning.
      const ageMs = ((count - t.startcount) / TICKS_PER_SEC) * 1000;
      const ampCss = lineAnchor(t.ys, screenH).amp * scale;
      const frames = waveFrames(ampCss);
      const stepMs = 1000 / (VECTOR_GEOM.wavePerTick * TICKS_PER_SEC);
      const durMs = (VECTOR_GEOM.waveLen / VECTOR_GEOM.wavePerTick / TICKS_PER_SEC) * 1000;
      [...t.obsah].forEach((ch, i) => {
        // Two layers per glyph so the outline sits behind the fill in every engine.
        // The outer span is what the wave animates, so both move as one.
        const sp = document.createElement('span');
        sp.style.cssText =
          `position:relative;display:inline-block;opacity:0;will-change:transform;` +
          // Per-character advances, like the canvas path, which measures each glyph on
          // its own: kerning and ligatures would shift the letters against it.
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
        if (ch === ' ') return; // a space inks nothing; drawVector skips it too
        // Glyph i is due when its phase reaches zero, which `wavePhase` puts at (i+1)
        // steps -- PisStringF counts characters from 1. This used to start at `i`, one
        // step (16ms) early per glyph, which is exactly the kind of drift that having
        // two copies of the rule produces and sharing one removes.
        sp.animate(frames, { duration: durMs, delay: (i + 1) * stepMs - ageMs, fill: 'forwards', easing: 'linear' });
      });
      host.appendChild(el);
      line = { el, spans, y, fit };
      L.lines.set(key, line);
    }
    // The scroll: the only thing written per tick, and a transform, so the compositor
    // interpolates it (see the 80ms transition, one logic tick).
    if (y !== line.y) {
      line.el.style.transform = `translateY(${y.toFixed(2)}px)`;
      line.y = y;
    }
  }
  for (const [key, l] of L.lines) {
    if (want.has(key)) continue;
    l.el.remove();
    L.lines.delete(key);
  }
}
