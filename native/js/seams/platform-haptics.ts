/** Seam for `src/platform/haptics.ts` (Capacitor's Taptic Engine): no haptics natively yet. */
import type * as Real from '../../../src/platform/haptics.js';

export const hapticBlocked: typeof Real.hapticBlocked = () => {};
export const hapticDeath: typeof Real.hapticDeath = () => {};
export const hapticSolved: typeof Real.hapticSolved = () => {};
