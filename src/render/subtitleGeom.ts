/**
 * The geometry a vector subtitle line is built from.
 *
 * Pure by design, and separate for the reason the repo's economy rules give: this is the
 * arithmetic that decides where a subtitle actually appears, and here it costs ~2.5 ms
 * unit tests to pin instead of a ~9.5 s browser probe. Measuring text needs a DOM (the
 * renderer uses a hidden span), so nothing in this file may touch one — a caller passes a
 * measurement in, which is also what makes the rules testable in `node`.
 *
 * It was extracted while there were still two renderers, each with its own copy of these
 * rules — the fit-to-room shrink twice, the damped-cosine wave twice — which is exactly
 * how they had drifted apart. Where they disagreed, the faithful port of PisStringF
 * (URoom.pas:25572) won. Only one renderer is left, but the rules stay here: this is
 * where they can be tested.
 */

// Subtitle layout constants (URoom.pas:140-161). They live here rather than in
// subtitles.ts so that this module has no imports at all: it is the leaf the renderer
// and the tick logic both measure from, and a cycle through the renderer would make the
// module-evaluation order matter (see AGENTS.md, "the module-evaluation trap").
export const ROWTITLE = 26;
export const BASETITLE = 0;
export const UNDERTITLE = 15;
export const BORDERTITLE = 20;

/**
 * How much larger the vector path draws than the bitmap line it replaces.
 *
 * Applied to the WHOLE vertical geometry — glyph size, row pitch, baseline nudge and wave
 * amplitude — never to a subset. Scaling the font alone would collide: Czech text with
 * diacritics measures 25.0-26.9px tall at SUB_FONT_PX across the four subtitle faces,
 * against a ROWTITLE pitch of 26, so it already fills the row; at 1.2 it measures
 * 30.0-32.3px and stacked lines would overlap by 4-6px.
 *
 * The bitmap path (`draw`, the classic tier) is deliberately untouched: it renders the
 * game's own font at the original's exact geometry and must stay byte-exact. So this
 * scales at render time in the vector path only, and does NOT change ROWTITLE, which the
 * shared tick logic uses to place both.
 */
export const SUB_SCALE = 1.2;
/** Native-pixel font size for the vector face. */
export const SUB_FONT_PX = 23 * SUB_SCALE;
/** Nudges the vector baseline to sit where the bitmap line sat. */
export const SUB_BASELINE_OFF = -6 * SUB_SCALE;

/** Wave length in `p` units, and the steps `p` advances per logic tick (PisStringF). */
export const WAVE_LEN = 50;
export const WAVE_PER_TICK = 5;

/**
 * The vector geometry, for renderers that place text from these numbers.
 *
 * One object rather than a scatter of imports, so a renderer cannot pick up half of it.
 * Everything is in native game pixels (the screenW x screenH space the vector path uses).
 */
export const VECTOR_GEOM = Object.freeze({
  /** Row pitch (ROWTITLE), before SUB_SCALE. */
  row: ROWTITLE,
  /** Where the wave starts, below the line's resting row (UNDERTITLE), before SUB_SCALE. */
  under: UNDERTITLE,
  /** The vector path's uniform enlargement over the bitmap geometry. */
  scale: SUB_SCALE,
  /** Font size in native px. */
  fontPx: SUB_FONT_PX,
  /** Nudge that puts the vector baseline where the bitmap line sat. */
  baselineOff: SUB_BASELINE_OFF,
  /** Wave steps per logic tick: `p` advances by this much per tick. */
  wavePerTick: WAVE_PER_TICK,
  /** Wave length in `p` units. */
  waveLen: WAVE_LEN,
  /** Side margin a line is fitted inside (BORDERTITLE), before SUB_SCALE. */
  border: BORDERTITLE,
});

/**
 * Font size for a line, after fitting it to the room.
 *
 * The renderer shrinks the font rather than wrapping or overflowing — the wrap already
 * happened in `newSubtitle`, and what reaches here is a line that still measures too wide
 * (a single long word, or a face wider than the bitmap metrics the wrap used).
 *
 * The 8px floor comes from the original vector path and is kept: without it a pathological
 * line collapses to an unreadable size, and shrinking past 8px would not make it fit
 * anyway.
 *
 * @param naturalW width of the text at `SUB_FONT_PX`, measured by the caller
 * @param screenW  the subtitle system's native screen width
 */
export function fitFontPx(naturalW: number, screenW: number): number {
  const maxW = screenW - BORDERTITLE * 2;
  // `>` and not `>=`: a line that fits to the pixel must not be shrunk by a rounding
  // hair. This also covers an unmeasurable line (0 or negative), which cannot exceed a
  // positive budget and so keeps the full size rather than dividing by it.
  if (!(naturalW > maxW)) return SUB_FONT_PX;
  return Math.max(8, (SUB_FONT_PX * maxW) / naturalW);
}

/**
 * How far through its wave glyph `index` is, at time `cas` (ticks since the line began).
 *
 * `index` is 0-based here; PisStringF's `p = cas*5 - index` counts from 1, so the +1 is
 * folded in. Negative means the glyph has not started yet and must not be drawn at all —
 * that is what makes the line appear letter by letter rather than all at once.
 */
export function wavePhase(cas: number, index: number): number {
  return cas * WAVE_PER_TICK - (index + 1);
}

/**
 * The damped cosine a glyph rides in on, at phase `p` with amplitude `amp`.
 *
 * Zero once the wave is over (`p >= WAVE_LEN`), so a settled line sits exactly on its
 * baseline rather than a rounding error away from it.
 */
export function waveDy(p: number, amp: number): number {
  if (p >= WAVE_LEN) return 0;
  return ((amp * (WAVE_LEN - p)) / WAVE_LEN) * Math.cos((3.5 * Math.PI * p) / WAVE_LEN);
}

/**
 * Where a line's baseline sits, and how far its wave swings.
 *
 * `ys` is the line's row from the tick logic, which the bitmap path draws from too, so it
 * is taken through SUB_SCALE here rather than there — the row pitch and the wave grow
 * with the glyphs, and the faithful path keeps the original's numbers.
 */
export function lineAnchor(ys: number, screenH: number): { baseline: number; amp: number } {
  const scaled = ys * SUB_SCALE;
  return {
    baseline: scaled + screenH + SUB_BASELINE_OFF,
    amp: VECTOR_GEOM.under * SUB_SCALE - scaled,
  };
}

/** Outline width for a glyph at `fs`: strokeText's lineWidth, centred on the path. */
export function strokeWidth(fs: number): number {
  return fs * 0.16;
}

/**
 * The bevel ramp, as offsets from the glyph's own baseline.
 *
 * Anchored to the baseline and NOT to the line box: the canvas builds it with
 * `createLinearGradient(0, gy - fs*0.72, 0, gy + fs*0.1)`, and spreading the same ramp
 * over a CSS line box instead puts the light end above the glyph — which is what made the
 * DOM text look washed out before it was placed this way.
 */
export function bevelSpan(fs: number): { top: number; bottom: number } {
  return { top: -fs * 0.72, bottom: fs * 0.1 };
}

/** The darker end of a speaker's bevel, from its top colour. */
export function bevelBottomRgb(r: number, g: number, b: number): [number, number, number] {
  return [Math.round(r * 0.42), Math.round(g * 0.42), Math.round(b * 0.42)];
}
