/**
 * Seam for `src/app/stageGeometry.ts`, whose module scope sizes the browser's stage. The
 * flow modules read only its constants, restated here. Each is typed as the real one's
 * `typeof`, and the real ones are literal types, so a changed value fails
 * `npm run typecheck:native` rather than drifting.
 */
import type * as Real from '../../../src/app/stageGeometry.js';

export const LOGIC_MS: typeof Real.LOGIC_MS = 80;
export const LOGIC_SEC: typeof Real.LOGIC_SEC = LOGIC_MS / 1000;
export const DEFAULT_LINE_TICKS: typeof Real.DEFAULT_LINE_TICKS = 12;
export const EXIT_CELLS: typeof Real.EXIT_CELLS = 5;
/** Not checkable by type (`48 / 64` is a `number`), so pinned instead. */
// restates src/app/stageGeometry.ts `export const EFFECT_VOL =` @ f01aaac9921c
export const EFFECT_VOL: typeof Real.EFFECT_VOL = 48 / 64;
