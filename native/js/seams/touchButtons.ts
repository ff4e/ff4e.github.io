/** Seam for `src/app/touchButtons.ts`: the touch bar. A native host is never the phone UI. */
import type * as Real from '../../../src/app/touchButtons.js';

export const phoneUi: typeof Real.phoneUi = () => false;
