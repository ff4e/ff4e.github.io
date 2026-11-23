/**
 * Seam for `src/app/stageState.ts` (which builds the DOM stage). `roomLoad` reads only
 * `booted`, and only to tell the browser's boot load of room 7 — which fetches no voices, no
 * music and no story assets — from every later entry. The native host makes no such boot
 * load, so every entry it makes is a real one: art, room data, the room's voices and music.
 */
import type * as Real from '../../../src/app/stageState.js';

export const booted: typeof Real.booted = true;
