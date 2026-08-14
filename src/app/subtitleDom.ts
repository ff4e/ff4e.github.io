/**
 * PROTOTYPE: the room's subtitles as DOM text, animated by the compositor.
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
 * Behind `__ff.setSubRenderer('dom')` and off by default. It is NOT a replacement yet:
 * the browser shapes and rasterises this text, so it is not pixel-identical to
 * `drawVector`, and `test-subtitles-parity` still pins the canvas path.
 */
import { VECTOR_GEOM } from '../render/subtitles.js';
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
}

let host: HTMLDivElement | null = null;
let lines = new Map<string, DomLine>();
let lastFont = '';
/** Distance from a line box's top to the text baseline, for the current font. */
let baselineInset = 0;
/** Height of a glyph's line box, for the current font — the gradient is placed in it. */
let boxHeight = 0;

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

/** The persisted preference. Absent — the normal case — means `auto`. */
export function subRendererPref(): SubRendererPref {
  try {
    return asSubRendererPref(localStorage.getItem('ff.subRenderer'));
  } catch {
    return 'auto';
  }
}

/** Is the DOM renderer the one painting right now? Asked once per frame. */
export function domSubsEnabled(): boolean {
  return resolveSubRenderer(subRendererPref(), graphics, domSubsSupported()) === 'dom';
}

/** Persist the preference. Low-level: use `selectSubRenderer` unless you own the overlay. */
export function setSubRendererPref(pref: SubRendererPref): void {
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
export function clearDomSubtitles(): void {
  if (!host && lines.size === 0) return;
  for (const l of lines.values()) l.el.remove();
  lines.clear();
  if (host) {
    host.remove();
    host = null;
  }
  lastFont = '';
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

/** The damped-cosine wave, as keyframes the compositor can run on its own. */
function waveFrames(ampCss: number): Keyframe[] {
  const out: Keyframe[] = [];
  for (let k = 0; k <= WAVE_KEYFRAMES; k++) {
    const p = (k / WAVE_KEYFRAMES) * VECTOR_GEOM.waveLen;
    const dy = ampCss * ((VECTOR_GEOM.waveLen - p) / VECTOR_GEOM.waveLen) * Math.cos((3.5 * Math.PI * p) / VECTOR_GEOM.waveLen);
    out.push({ offset: k / WAVE_KEYFRAMES, opacity: 1, transform: `translateY(${dy.toFixed(2)}px)` });
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
  sys: SubtitleSystem,
  count: number,
  cssW: number,
  cssH: number,
  scale: number,
  family: string,
  weight: string | number,
): void {
  const { w: screenW, h: screenH } = sys.vectorScreen;
  if (!host) {
    host = document.createElement('div');
    host.id = 'domsubs';
    host.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;overflow:hidden';
    document.getElementById('subs')?.parentElement?.appendChild(host);
  }
  host.style.width = `${cssW}px`;
  host.style.height = `${cssH}px`;
  // The `ai` tier draws its subtitles smaller, shrunk about the bottom edge of the game
  // box (applySubScale). One transform on the container is the same operation, and it
  // scales the row pitch and the wave amplitude with the glyphs, exactly as that does.
  const tier = graphics === 'ai' ? aiSubScale : 1;
  host.style.transformOrigin = '50% 100%';
  host.style.transform = tier === 1 ? '' : `scale(${tier})`;

  const fontPx = VECTOR_GEOM.fontPx * scale;
  const font = `${weight} ${fontPx.toFixed(2)}px ${family}`;
  if (font !== lastFont) {
    ({ inset: baselineInset, height: boxHeight } = measureBaseline(font));
    lastFont = font;
    // Glyph boxes are laid out for the old size; rebuild them.
    for (const l of lines.values()) l.el.remove();
    lines.clear();
  }

  const want = new Set<string>();
  for (const t of sys.debugLines()) {
    const key = `${t.startcount}|${t.barva}|${t.obsah}`;
    want.add(key);
    // Where this line sits right now. Computed before the element exists, because it has
    // to be part of the element's FIRST style: a `transition` plus a transform written
    // after insertion animates from the untransformed position — the top of the game box
    // — so a new line visibly fell from the ceiling before starting its wave.
    const y = (t.ys * VECTOR_GEOM.scale + screenH + VECTOR_GEOM.baselineOff) * scale - baselineInset;
    let line = lines.get(key);
    if (!line) {
      const el = document.createElement('div');
      el.style.cssText =
        `position:absolute;left:0;right:0;text-align:center;white-space:pre;font:${font};` +
        `line-height:normal;transform:translateY(${y.toFixed(2)}px);` +
        `transition:transform 80ms linear;will-change:transform`;
      const [r, g, b] = t.rgb;
      const top = `rgb(${r},${g},${b})`;
      const bottom = `rgb(${Math.round(r * 0.42)},${Math.round(g * 0.42)},${Math.round(b * 0.42)})`;
      const spans: HTMLSpanElement[] = [];
      // The bevel gradient, placed exactly where the canvas puts it:
      // createLinearGradient(0, gy - fs*0.72, 0, gy + fs*0.1) — a ramp across the
      // glyph's cap height, anchored to ITS OWN baseline, not to the line box. Spreading
      // it over the whole box (which is what a bare `linear-gradient` does) puts the
      // light end above the glyph and lands it in the wrong part of the ramp, which is
      // what made the text look washed out and flat.
      const gTop = ((baselineInset - fontPx * 0.72) / boxHeight) * 100;
      const gBottom = ((baselineInset + fontPx * 0.1) / boxHeight) * 100;
      const bevel =
        `linear-gradient(to bottom,${top} 0%,${top} ${gTop.toFixed(2)}%,` +
        `${bottom} ${gBottom.toFixed(2)}%,${bottom} 100%)`;
      // The outline is drawVector's strokeText: lineWidth = fs*0.16, centred on the
      // path, so it reaches fs*0.08 outwards. -webkit-text-stroke is the same thing —
      // but it paints OVER the fill in Chromium (which honours no paint-order on HTML
      // text), so the stroke goes on its own layer BEHIND the fill instead.
      const strokeW = fontPx * 0.16;
      // The line's own age, so a line already part-way through its wave starts there
      // rather than replaying it from the beginning.
      const ageMs = ((count - t.startcount) / TICKS_PER_SEC) * 1000;
      const ysNative = t.ys * VECTOR_GEOM.scale;
      const ampCss = (VECTOR_GEOM.under * VECTOR_GEOM.scale - ysNative) * scale;
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
        sp.animate(frames, { duration: durMs, delay: i * stepMs - ageMs, fill: 'forwards', easing: 'linear' });
      });
      host.appendChild(el);
      // Fit the line inside the room like vectorLayout does: it shrinks the font rather
      // than wrapping or overflowing, and a line that overflowed here was clipped by the
      // host's own bounds — losing the last word of a long line.
      const maxCss = (screenW - VECTOR_GEOM.border * 2) * scale;
      const natural = el.scrollWidth;
      if (natural > maxCss) {
        const shrunk = Math.max(8, (fontPx * maxCss) / natural);
        el.style.fontSize = `${shrunk.toFixed(2)}px`;
      }
      line = { el, spans, y };
      lines.set(key, line);
    }
    // The scroll: the only thing written per tick, and a transform, so the compositor
    // interpolates it (see the 80ms transition, one logic tick).
    if (y !== line.y) {
      line.el.style.transform = `translateY(${y.toFixed(2)}px)`;
      line.y = y;
    }
  }
  for (const [key, l] of lines) {
    if (want.has(key)) continue;
    l.el.remove();
    lines.delete(key);
  }
}
