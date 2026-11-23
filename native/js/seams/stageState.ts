/**
 * Seam for `src/app/stageState.ts` (which builds the DOM stage). `roomLoad` reads only
 * `booted`, and only to tell the boot load — which fetches no voices, no music and no
 * story assets — from every later entry. The native host has no audio yet, so every
 * entry it makes is that kind: art and room data, nothing to hear.
 */
import type * as Real from '../../../src/app/stageState.js';

export const booted: typeof Real.booted = false;
