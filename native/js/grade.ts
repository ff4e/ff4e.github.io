/**
 * The AI tier's colour grade, as the web shows it: the browser puts
 * `filter: contrast() saturate() brightness()` over the game's canvases on that tier
 * (`src/app/aiFilter.ts`, `index.html`), and the native host renders only that tier, so it
 * grades always — the same three numbers, read the same way: `AI_FILTER_DEFAULT`, or what the
 * web's dev bar left in `ff.aiFilter` (`initAiFilter`, imported as it is).
 *
 * On the GPU, in the pass that presents the picture to the window (`css_grade` in
 * `native/host/shaders.metal`): each function's Filter Effects matrix, in the shorthand's
 * order, on the sRGB-encoded values, clamped after each, as Chromium applies them. Not into
 * the composite: `saveComposite` and the 72-room parity sweep (`compare.mjs`) keep comparing
 * the ungraded picture with the browser's ungraded WebGL canvas, like with like.
 *
 * What it covers is what the web's covers — the `canvas` elements: the room, the world map
 * with its record panel and plaques, the story pages and KUFRIK's briefcase story. Not what
 * the web shows outside a canvas: the subtitles and the cutscene's captions (DOM text), the
 * menus and the legend (HTML; natively the UI layer, drawn over the graded picture), the AI
 * credits roll (two `<img>` layers), the intro's splash and movies (a `<div>`, a `<video>`).
 */
import { AI_FILTER_KEYS, aiFilterValues, initAiFilter, type AiFilterValues } from '../../src/app/aiFilter.js';

/** Read the grade from the store (after it is open), and hand it to the host. */
export function initGrade(): AiFilterValues {
  initAiFilter();
  const v = aiFilterValues();
  __native.setGrade(v.contrast, v.saturate, v.brightness);
  return v;
}

/**
 * The CSS filter on one sRGB pixel (0..255 each), as the spec states it and the shader runs
 * it — the reference the menu smoke holds the shader to (`gradeSmoke.ts`).
 */
export function cssGrade(rgb: readonly [number, number, number], v: AiFilterValues): [number, number, number] {
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  const [c, s, b] = AI_FILTER_KEYS.map((k) => v[k]) as [number, number, number];
  const [r0, g0, b0] = rgb.map((x) => clamp((x / 255) * c + 0.5 - 0.5 * c)) as [number, number, number];
  const sat = [
    clamp((0.213 + 0.787 * s) * r0 + (0.715 - 0.715 * s) * g0 + (0.072 - 0.072 * s) * b0),
    clamp((0.213 - 0.213 * s) * r0 + (0.715 + 0.285 * s) * g0 + (0.072 - 0.072 * s) * b0),
    clamp((0.213 - 0.213 * s) * r0 + (0.715 - 0.715 * s) * g0 + (0.072 + 0.928 * s) * b0),
  ];
  return sat.map((x) => clamp(x * b) * 255) as [number, number, number];
}
