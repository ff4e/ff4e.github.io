/**
 * Seam for `src/app/roomPreload.ts`: what a room's play can demand beyond its art — KUFRIK's
 * briefcase cutscene and the leg-final story pages. The native host shows neither yet, and
 * `roomLoad`'s boot-load path (see `stageState.ts` here) already asks for none of it.
 */
import type * as Real from '../../../src/app/roomPreload.js';

export const roomPreloadPending: typeof Real.roomPreloadPending = () => false;
export const setRoomPreloadPending: typeof Real.setRoomPreloadPending = () => {};
export const clearRoomPreloadPending: typeof Real.clearRoomPreloadPending = () => {};
export const preloadRoomPlayAssets: typeof Real.preloadRoomPlayAssets = async () => {};
export const warmFinaleRoom: typeof Real.warmFinaleRoom = () => {};
