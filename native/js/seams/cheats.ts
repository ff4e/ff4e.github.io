/**
 * Seam for `src/app/cheats.ts` (typed codes, the Tetris minigame — and the document).
 * The native host has no way to type a code, so no cheat effect is ever on.
 */
import type * as Real from '../../../src/app/cheats.js';

export const tickFrameEffects: typeof Real.tickFrameEffects = () => {};
