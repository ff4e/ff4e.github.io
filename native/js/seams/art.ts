/**
 * Seam for `src/app/art.ts`, the browser's art layer (four tiers, the panel, the failure
 * screen). The native host draws the AI-upscaled tier only, so this keeps exactly one
 * thing: the current room's `AiRoom`, loaded by `roomLoad`'s `ensureAiRoom` on entry and
 * released when another room replaces it.
 */
import type * as Real from '../../../src/app/art.js';
import { ROOMS } from '../../../src/data/roomTable.js';
import { loadAiRoom, type AiRoom } from '../../../src/render/roomAi.js';
import { failRoomEntry } from './roomLaunch.js';

/** The room the art is for. Advances at `beginRoomArt`, as the browser's does. */
export let curNum: typeof Real.curNum = 0;
/** The current room's AI art, once it has landed; null while it loads. */
export let aiRoom: AiRoom | null = null;
let aiRoomNum = 0;

export const beginRoomArt: typeof Real.beginRoomArt = (num) => {
  curNum = num;
};

/** The native host never draws the enhanced tier. */
export const ensureEnhancedArt: typeof Real.ensureEnhancedArt = async () => {};

/** Has the room being entered got its art? The native counterpart of `!roomArtPending()`. */
export function aiRoomReady(): boolean {
  return aiRoom !== null && aiRoomNum === curNum;
}

/**
 * `roomLoad` does not await this — the browser holds the FRAME on it instead — so a failure
 * is handled here, as the browser's `ensureAiRoom` handles its own: the entry fails.
 */
export const ensureAiRoom: typeof Real.ensureAiRoom = async (num) => {
  if (aiRoom && aiRoomNum === num) return; // a restart keeps the art it already has
  try {
    const jmeno = ROOMS[num - 1]?.jmeno;
    if (!jmeno) throw new Error(`no room #${num}`);
    const loaded = await loadAiRoom('/', jmeno);
    if (!loaded) throw new Error(`room #${num} ${jmeno} has no AI art, and the native host draws no other tier`);
    if (curNum !== num) {
      loaded.dispose(); // superseded while it loaded
      return;
    }
    aiRoom?.dispose();
    aiRoom = loaded;
    aiRoomNum = num;
  } catch (e) {
    if (curNum === num) failRoomEntry(num, e);
  }
};
