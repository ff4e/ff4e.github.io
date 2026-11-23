/**
 * Seam for `src/app/playerSettings.ts` (persisted options, read through the audio engine and
 * the device gate). The native host draws no subtitles yet, so they are off; the language
 * is what a line's text would be taken in if they were on.
 */
import type * as Real from '../../../src/app/playerSettings.js';

export const subsOn: typeof Real.subsOn = () => false;
export const subLang: typeof Real.subLang = () => 'en';
