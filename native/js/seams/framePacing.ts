/**
 * Seam for `src/app/framePacing.ts` (the browser's frame pacing, its perf HUD and the
 * document). The flow modules use only the room-loading guard and its sequence number;
 * the native frame loop reads `roomLoading` the same way the browser's does — no room is
 * drawn while one is being built.
 */
import type * as Real from '../../../src/app/framePacing.js';

export let roomLoading: typeof Real.roomLoading = false;
export let roomLoadSeq: typeof Real.roomLoadSeq = 0;

export const setRoomLoading: typeof Real.setRoomLoading = (v) => {
  roomLoading = v;
};
export const setRoomLoadSeq: typeof Real.setRoomLoadSeq = (v) => {
  roomLoadSeq = v;
};
/** The native loop presents every frame, so there is no redraw to force. */
export const setForceRoomRedraw: typeof Real.setForceRoomRedraw = () => {};
