/**
 * Which renderer paints the room's vector subtitles, and why.
 *
 * Its own module, with no imports, for one reason: this is the decision that says what
 * a player actually sees, and here it costs a ~2.5 ms unit test to pin the whole matrix.
 * Left inside `subtitleDom.ts` it would be reachable only from a real browser (that file
 * touches the DOM at module scope, and vitest runs in `node` with no jsdom here), so the
 * shipping default would be guarded by a ~7.4 s probe or by nothing at all.
 */

/** Which renderer paints the vector subtitles. */
export type SubRenderer = 'canvas' | 'dom';
/** What was asked for. `auto` lets the art tier decide, and is the default. */
export type SubRendererPref = 'auto' | SubRenderer;

/**
 * Resolve a preference against what the browser can do.
 *
 * `auto` is the shipped behaviour, and it is now simply "DOM": every tier that draws
 * subtitles as vector text wants the compositor, measured in WebKit on a settling line
 * (room 7, two long lines, three rounds) —
 *
 *     enhanced   canvas 28.0 fps / 68.6% jank      dom 59.1 fps / 0.9%
 *     ai         canvas 25-30 fps / 67-80% jank    dom 59.3 fps / 0.9%
 *
 * `classic` does not appear because it never reaches either renderer: it bakes its
 * subtitles into the frame itself (`useVecSubs` in framePainter is false there), which
 * is a third path this choice has no say over.
 *
 * The two explicit values force one renderer — for probes, for A/B-ing the two by eye,
 * and for anyone the new path renders badly for.
 *
 * `supported` is the deliberate fallback (PLAN D3), and it OVERRIDES an explicit 'dom'
 * rather than deferring to it. The DOM renderer needs the Web Animations API, because a
 * compositor-run transform IS the feature: without it the text would still be correct
 * but animated from the main thread — the exact stutter this replaces — so falling back
 * to canvas is the better picture, not a degraded one. It is silent because it is a
 * capability gap, not an asset failure, and nothing a player could act on.
 *
 * A missing subtitle FONT is a different failure with a different owner, and is
 * deliberately NOT handled here: `useVecSubs` (framePainter) already gates BOTH
 * renderers on `subFontReady`, so the DOM path inherits the existing baked fallback and
 * introduces no new failure mode of its own.
 */
export function resolveSubRenderer(pref: SubRendererPref, supported: boolean): SubRenderer {
  if (!supported) return 'canvas';
  if (pref === 'canvas' || pref === 'dom') return pref;
  return 'dom';
}

/** Read a persisted preference. Anything unrecognised — including absent — is `auto`. */
export function asSubRendererPref(raw: string | null | undefined): SubRendererPref {
  return raw === 'dom' || raw === 'canvas' ? raw : 'auto';
}
