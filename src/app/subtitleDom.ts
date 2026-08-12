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
}

let host: HTMLDivElement | null = null;
let lines = new Map<string, DomLine>();
let lastFont = '';
/** Distance from a line box's top to the text baseline, for the current font. */
let baselineInset = 0;

/** Is the DOM renderer selected? Persisted so a reload keeps it while testing. */
export function domSubsEnabled(): boolean {
  try {
    return localStorage.getItem('ff.subRenderer') === 'dom';
  } catch {
    return false;
  }
}

/** Choose the renderer. `__ff.setSubRenderer`. */
export function setDomSubs(on: boolean): void {
  try {
    localStorage.setItem('ff.subRenderer', on ? 'dom' : 'canvas');
  } catch {
    /* storage unavailable: the flag just will not persist */
  }
  if (!on) clearDomSubtitles();
}

/** Tear the overlay down (leaving the room, switching renderer, no lines left). */
export function clearDomSubtitles(): void {
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
function measureBaseline(font: string): number {
  const probe = document.createElement('div');
  probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${font}`;
  probe.textContent = 'Mg';
  const marker = document.createElement('span');
  marker.style.cssText = 'display:inline-block;width:0;height:0';
  probe.appendChild(marker);
  document.body.appendChild(probe);
  const inset = marker.getBoundingClientRect().bottom - probe.getBoundingClientRect().top;
  probe.remove();
  return inset;
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
    baselineInset = measureBaseline(font);
    lastFont = font;
    // Glyph boxes are laid out for the old size; rebuild them.
    for (const l of lines.values()) l.el.remove();
    lines.clear();
  }

  const want = new Set<string>();
  for (const t of sys.debugLines()) {
    const key = `${t.startcount}|${t.barva}|${t.obsah}`;
    want.add(key);
    let line = lines.get(key);
    if (!line) {
      const el = document.createElement('div');
      el.style.cssText =
        `position:absolute;left:0;right:0;text-align:center;white-space:pre;font:${font};` +
        `line-height:normal;transition:transform 80ms linear;will-change:transform`;
      const [r, g, b] = t.rgb;
      const top = `rgb(${r},${g},${b})`;
      const bottom = `rgb(${Math.round(r * 0.42)},${Math.round(g * 0.42)},${Math.round(b * 0.42)})`;
      const spans: HTMLSpanElement[] = [];
      // Eight offsets approximate the round outline drawFill strokes on.
      const rr = fontPx * 0.075;
      const ring = ([
        [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
      ] as ReadonlyArray<readonly [number, number]>)
        .map((d) => `${(d[0] * rr).toFixed(2)}px ${(d[1] * rr).toFixed(2)}px 0 rgb(5,5,12)`)
        .join(',');
      // The line's own age, so a line already part-way through its wave starts there
      // rather than replaying it from the beginning.
      const ageMs = ((count - t.startcount) / TICKS_PER_SEC) * 1000;
      const ysNative = t.ys * VECTOR_GEOM.scale;
      const ampCss = (VECTOR_GEOM.under * VECTOR_GEOM.scale - ysNative) * scale;
      const frames = waveFrames(ampCss);
      const stepMs = 1000 / (VECTOR_GEOM.wavePerTick * TICKS_PER_SEC);
      const durMs = (VECTOR_GEOM.waveLen / VECTOR_GEOM.wavePerTick / TICKS_PER_SEC) * 1000;
      [...t.obsah].forEach((ch, i) => {
        const sp = document.createElement('span');
        sp.textContent = ch;
        // The bevel is a gradient clipped to the glyph, so it travels with it — exactly
        // like drawVector's gradient, which is anchored to each glyph's own baseline.
        sp.style.cssText =
          `display:inline-block;opacity:0;will-change:transform;` +
          // The bevel is a gradient clipped to the glyph; the outline is a text-shadow
          // ring rather than -webkit-text-stroke, because a stroke paints OVER the fill
          // in Chromium (it honours no paint-order on HTML text) and swallows it.
          `background-image:linear-gradient(${top},${bottom});-webkit-background-clip:text;` +
          `background-clip:text;color:transparent;text-shadow:${ring}`;
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
      line = { el, spans, y: NaN };
      lines.set(key, line);
    }
    // The scroll: the only thing written per tick, and a transform, so the compositor
    // interpolates it (see the 80ms transition, one logic tick).
    const y = (t.ys * VECTOR_GEOM.scale + screenH + VECTOR_GEOM.baselineOff) * scale - baselineInset;
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
