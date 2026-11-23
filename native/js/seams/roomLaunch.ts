/**
 * Seam for `src/app/roomLaunch.ts` (the world map's launch parchment and the failure
 * screen). There is no map natively, so no launch is ever in flight; and a room that cannot
 * be entered ends the session, as the browser's failure screen does — with the reason on
 * the console instead of on a screen.
 */
import type * as Real from '../../../src/app/roomLaunch.js';

export const mapLaunching: typeof Real.mapLaunching = () => null;
// restates src/app/roomLaunch.ts `export function failRoomEntry(` @ 844490c3c2cf
export const failRoomEntry: typeof Real.failRoomEntry = (num, err) => {
  console.error(`room ${num} could not be entered:`, err);
  __native.quit(1);
};
