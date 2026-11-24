/**
 * Seam for `src/app/roomPreload.ts`: what a room's play can demand beyond its art — KUFRIK's
 * briefcase cutscene and the leg-final story pages, which `roomLoad` asks for after the art.
 *
 * KUFRIK's half is the browser's, restated: entering room 2 fetches the story (kufr256.BMP,
 * demo.pck, script.txt) and the tutorial recording (help.cap) and the entry waits for them,
 * so that reaching the briefcase's phase 8 or the demonstration spot is a moment of play
 * that reads nothing (`cutscenePlay.ts`). The real module cannot be bundled as it is: its
 * other half fetches the leg's story page at room entry, as a Blob in the `ai` tier, and the
 * native host loads its story pages when it shows them (`mapScreen.ts`).
 */
import type * as Real from '../../../src/app/roomPreload.js';
import { cutsceneAssets, setCutsceneAssets } from '../../../src/app/gameState.js';
import { parseHelpCap } from '../../../src/intro/helpCap.js';
import type { CapAction } from '../../../src/intro/helpCap.js';
import { requiredBytes, requiredText } from '../../../src/render/assetFetch.js';

/** restates src/app/roomPreload.ts `const KUFRIK_ROOM =` @ 37d6cf6ee4c2 */
const KUFRIK_ROOM = 2;

let preloadPendingNum = 0;
// restates src/app/roomPreload.ts `export const roomPreloadPending =` @ d3efa025d365
export const roomPreloadPending: typeof Real.roomPreloadPending = () => preloadPendingNum !== 0;
// restates src/app/roomPreload.ts `export function setRoomPreloadPending(` @ be38d75dd288
export const setRoomPreloadPending: typeof Real.setRoomPreloadPending = (num) => {
  preloadPendingNum = num;
};
// restates src/app/roomPreload.ts `export function clearRoomPreloadPending(` @ b7848857f7d0
export const clearRoomPreloadPending: typeof Real.clearRoomPreloadPending = (num) => {
  if (preloadPendingNum === num) preloadPendingNum = 0;
};

/**
 * KUFRIK's story and recording, held for by the entry — minus the leg-final story page,
 * which `mapScreen.ts` loads when it shows one.
 * restates src/app/roomPreload.ts `export async function preloadRoomPlayAssets(` @ d2e31cbffbf1
 */
export const preloadRoomPlayAssets: typeof Real.preloadRoomPlayAssets = async (num) => {
  if (num === KUFRIK_ROOM) await preloadCutscene();
};

/** ZAVER's warm-up: the native host reads its rooms from disk, so there is nothing to warm. */
export const warmFinaleRoom: typeof Real.warmFinaleRoom = () => {};

let showmodeCap: CapAction[] | null = null;
let cutscenePreload: Promise<void> | null = null;

// restates src/app/roomPreload.ts `export const showmodeRecording =` @ fb83b8d7db23
export const showmodeRecording: typeof Real.showmodeRecording = () => showmodeCap;

/** Single-flighted, and retracted on failure, as the browser's is. */
// restates src/app/roomPreload.ts `export async function preloadCutscene(` @ 3b6efa34d4eb
export const preloadCutscene: typeof Real.preloadCutscene = async () => {
  if (cutscenePreload === null) {
    const done = Promise.all([loadCutsceneAssets(), loadShowmodeCap()]).then(() => {});
    cutscenePreload = done;
    void done.catch(() => {
      if (cutscenePreload === done) cutscenePreload = null;
    });
  }
  await cutscenePreload;
};

// restates src/app/roomPreload.ts `async function loadCutsceneAssets(` @ 2d2ee1510b22
async function loadCutsceneAssets(): Promise<void> {
  if (cutsceneAssets) return;
  const what = 'the briefcase demonstration';
  const bytes = (u: string): Promise<Uint8Array> => requiredBytes(u, what, 'mustHave');
  const [bmp, pck, script] = await Promise.all([
    bytes('/data/Intro/kufr256.BMP'),
    bytes('/data/Intro/demo.pck'),
    requiredText('/data/Intro/script.txt', what, 'mustHave'),
  ]);
  setCutsceneAssets({ bmp, pck, script });
}

// restates src/app/roomPreload.ts `async function loadShowmodeCap(` @ beaf8ae848f2
async function loadShowmodeCap(): Promise<void> {
  if (showmodeCap) return;
  showmodeCap = parseHelpCap(await requiredBytes('/data/Intro/help.cap', 'the KUFRIK demonstration', 'mustHave'));
}
