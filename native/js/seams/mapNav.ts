/**
 * Seam for `src/app/mapNav.ts` (on and off the world map, the page's way). Leaving a room —
 * the win's auto-return (`logicTick`), or the end of a map "Replay" (`replayMode`) — is
 * handed to the native composition root (`game.ts`), which goes back to the native map
 * (`mapScreen.ts`) through the story pages where the browser shows them, or, for `--demo`
 * and the smoke gate, on to the next room.
 */
import type * as Real from '../../../src/app/mapNav.js';

let leave: (why: 'won' | 'replayEnded') => void = () => {};

/** Where the native host goes when the game leaves a room. Called once, by `game.ts`. */
export function onLeaveRoom(fn: (why: 'won' | 'replayEnded') => void): void {
  leave = fn;
}

export const returnFromRoom: typeof Real.returnFromRoom = () => leave('won');
export const showMap: typeof Real.showMap = () => leave('replayEnded');
