/**
 * Seam for `src/app/roomPreload.ts`: what a room's play can demand beyond its art — KUFRIK's
 * briefcase cutscene and the leg-final story pages, which `roomLoad` asks for after the art.
 * The native host plays no cutscene, and loads its story pages when it shows them
 * (`mapScreen.ts`), so there is nothing to preload and nothing to hold an entry for.
 */
import type * as Real from '../../../src/app/roomPreload.js';

export const roomPreloadPending: typeof Real.roomPreloadPending = () => false;
export const setRoomPreloadPending: typeof Real.setRoomPreloadPending = () => {};
export const clearRoomPreloadPending: typeof Real.clearRoomPreloadPending = () => {};
export const preloadRoomPlayAssets: typeof Real.preloadRoomPlayAssets = async () => {};
export const warmFinaleRoom: typeof Real.warmFinaleRoom = () => {};
export const preloadCutscene: typeof Real.preloadCutscene = async () => {};
export const showmodeRecording: typeof Real.showmodeRecording = () => null;
