/**
 * Seam for `src/app/mapNav.ts` (the world map). There is no map natively: leaving a room —
 * the win's auto-return (`logicTick`), or the end of a map "Replay" (`replayMode`) — is
 * handed to the native composition root, which picks the next room (`game.ts`).
 */
import type * as Real from '../../../src/app/mapNav.js';

let leave: (why: 'won' | 'replayEnded') => void = () => {};

/** Where the native host goes when the game leaves a room. Called once, by `game.ts`. */
export function onLeaveRoom(fn: (why: 'won' | 'replayEnded') => void): void {
  leave = fn;
}

export const returnFromRoom: typeof Real.returnFromRoom = () => leave('won');
export const showMap: typeof Real.showMap = () => leave('replayEnded');
