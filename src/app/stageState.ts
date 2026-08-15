/**
 * The stage's own state: which vector-subtitle font is in use, what the subtitle overlay
 * currently shows, and whether boot has finished.
 *
 * Small and unglamorous, but it was one of the last things every extracted module still had
 * to be handed. `booted` gates the loading overlay and the fatal-error screen; the subtitle
 * font and overlay signature are read by the painter, the cutscene and the intro. Giving
 * them an owner is what lets those modules import instead of receiving.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * `buildStage()` nests the canvases and `ff.subfont` is a stored key, so neither happens at
 * import time — `initStageState()` does both, from the point in `main.ts` where they ran
 * before. See AGENTS.md, "the module-evaluation trap".
 */
import { buildStage } from './dom.js';

// Vector-subtitle font (enhanced mode). All candidates are bundled + OFL-licensed
// so they render identically on every platform. Mulish Medium is the default — a
// clean humanist face close to Avenir Next Medium. The previewer (F key) cycles
// the alternates; the active family+weight are persisted. (Fonts + their OFL
// licenses live in public/fonts/; FreeSans is the original public/enhanced face.)
export const SUB_FONT_CANDIDATES: ReadonlyArray<{ name: string; family: string; weight: string }> = [
  { name: 'Mulish Medium', family: 'Mulish, sans-serif', weight: '500' },
  { name: 'Manrope Medium', family: 'Manrope, sans-serif', weight: '500' },
  { name: 'Jost Medium', family: 'Jost, sans-serif', weight: '500' },
  { name: 'FreeSans Bold', family: 'FFSubtitle, sans-serif', weight: '700' },
];
// The persisted pick is read in initStageState(), not here: this module must do nothing at
// import time, and `ff.subfont` is a stored key like any other. Until then these hold the
// default candidate, which is what an absent or unrecognised value falls back to anyway.
export let subFontIdx = 0;
export let subFontFamily = SUB_FONT_CANDIDATES[0]!.family;
export let subFontWeight = SUB_FONT_CANDIDATES[0]!.weight;
export let subFontReady = false;
export let booted = false; // true once boot succeeds — before that, any error is fatal

export function setSubFontIdx(v: number): void {
  subFontIdx = v;
}

export function setSubFontFamily(v: string): void {
  subFontFamily = v;
}

export function setSubFontWeight(v: string): void {
  subFontWeight = v;
}

export function setSubFontReady(v: boolean): void {
  subFontReady = v;
}

export function setBooted(v: boolean): void {
  booted = v;
}


/** Assemble the stage and load the persisted subtitle font. Call once, from `main.ts`. */
export function initStageState(): void {
  buildStage(); // the stage box + the GL/subtitle overlays (see dom.ts: not done at import time)
  const saved = localStorage.getItem('ff.subfont');
  const i = saved !== null ? SUB_FONT_CANDIDATES.findIndex((c) => c.name === saved) : -1;
  if (i >= 0) {
    subFontIdx = i;
    subFontFamily = SUB_FONT_CANDIDATES[i]!.family;
    subFontWeight = SUB_FONT_CANDIDATES[i]!.weight;
  }
}
