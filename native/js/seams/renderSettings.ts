/** Seam for `src/app/renderSettings.ts`: the native host draws the AI-upscaled tier only. */
import type * as Real from '../../../src/app/renderSettings.js';

export const graphics: typeof Real.graphics = 'ai';
export const enhancedArtActive: typeof Real.enhancedArtActive = () => true;
