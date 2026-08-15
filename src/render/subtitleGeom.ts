/**
 * The geometry a vector subtitle line is built from.
 *
 * Pure by design, and separate for the reason the repo's economy rules give: this is the
 * arithmetic that decides where a subtitle actually appears, and here it costs ~2.5 ms
 * unit tests to pin instead of a ~10 s browser probe. Measuring text needs a DOM (the
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
 * One font size for a whole message, from the natural widths of its lines.
 *
 * A wrapped sentence is several `TitleLine`s, and `fitFontPx` applied to each of them
 * independently gives them DIFFERENT sizes: the long line overflows and shrinks, the
 * short remainder does not. That is visible — reported from KUFRIK, where
 * "…nahrát uloženou pozici" rendered noticeably smaller than "klávesou F3." on the row
 * below it.
 *
 * The overflow itself is not a defect to fix here. `newSubtitle` wraps against the
 * ORIGINAL BITMAP font's metrics (NovyTitulek, URoom.pas:592) and must keep doing so —
 * the wrap points are part of the port's fidelity. The vector face is a different font
 * drawn at SUB_SCALE (+20%), so a faithfully wrapped line can still measure too wide for
 * it, and `fitFontPx` is the compensation. What was wrong was the GRANULARITY of that
 * compensation: it belongs to the message, not to the row.
 *
 * The smallest of the per-line fits, because it is the only one that fits every line.
 */
export function fitBlockFontPx(naturalWs: readonly number[], screenW: number): number {
  let px = SUB_FONT_PX;
  for (const w of naturalWs) px = Math.min(px, fitFontPx(w, screenW));
  return px;
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
 *
 * `baseline` is measured from the TOP of the content box, so it carries the box's own
 * height in it. That is only usable while the text and the box are drawn at the same
 * scale; when they are not, use `lineOffset` and add the box's bottom edge separately
 * (`lineAnchor(ys, h).baseline === h + lineOffset(ys)`, pinned in the tests).
 */
export function lineAnchor(ys: number, screenH: number): { baseline: number; amp: number } {
  const scaled = ys * SUB_SCALE;
  return {
    baseline: scaled + screenH + SUB_BASELINE_OFF,
    amp: VECTOR_GEOM.under * SUB_SCALE - scaled,
  };
}

/**
 * A line's baseline as an offset from the BOTTOM edge of the content box.
 *
 * Negative: the rows sit above the bottom edge, and the further up a line has scrolled
 * the more negative it gets. Split out of `lineAnchor` because the subtitle is no longer
 * necessarily drawn at the content's own scale — the room zooms to fit and the text
 * deliberately does not (see `syncDomSubtitles`) — so the two halves of the old sum have
 * to be scaled by different factors: the bottom edge is a position in the ROOM, and this
 * is a distance in the TEXT.
 */
export function lineOffset(ys: number): number {
  return ys * SUB_SCALE + SUB_BASELINE_OFF;
}

/**
 * The scale a subtitle is drawn at: constant on screen, but never bigger than the room
 * it sits in can carry.
 *
 * The first half is the point — `stageScale` is the same number in every room, so the
 * text stops changing size as the player walks between rooms (the room's own zoom spans
 * 1.006x to 1.35x in the default fit mode). The second half is what makes that hold in
 * the fit modes that draw a room SMALLER than the stage.
 *
 * The crisp-integer modes ('native', 'x1'..'x4') snap the room down to a whole number of
 * physical pixels, so at dpr 2 an 'x1' room is drawn at 0.5 while the stage sits near
 * 1.65 — the text would be over three times too big for the room it is centred in, and
 * `fitFontPx` would then shrink nearly every line by whatever that particular room's
 * width and that particular sentence's length demanded. The result is text that varies
 * per room AND per line: exactly the symptom this is supposed to remove, reintroduced
 * through the fit. Reported from 'x1'.
 *
 * Capping at the room's own scale makes those modes behave as they did before any of
 * this (text scales with the room) while the graded modes — where the room is never
 * drawn smaller than the stage, and which include the shipped default — get the constant
 * size. In 'fixed' the two are equal and the cap does nothing.
 */
export function subtitleScale(stageScale: number, boxScale: number): number {
  return Math.min(stageScale, boxScale);
}

/**
 * The width `fitFontPx` must fit inside, when the text is drawn at a different scale
 * from the content it sits on.
 *
 * `fitFontPx` works in the subtitle's own native units, and its budget is the room's
 * width in those units. While text and room shared a scale that was simply `screenW`.
 * With the text pinned to the stage and the room zoomed to fit, the room is physically
 * `boxScale / textScale` times wider than the text's units say, and a budget of plain
 * `screenW` would shrink long lines that have room to spare — the more so in exactly the
 * small rooms the zoom enlarges most.
 */
export function fitScreenW(screenW: number, boxScale: number, textScale: number): number {
  if (!(textScale > 0)) return screenW;
  return (screenW * boxScale) / textScale;
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
