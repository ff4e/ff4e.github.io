/**
 * Seam for `src/app/cutscene.ts`: KUFRIK's briefcase story as the browser draws it, on its
 * canvases, with its AI frames cached as `ImageBitmap`s. The story's driver is not here —
 * it is `src/app/cutscenePlay.ts`, which the native host runs as it is — so all that is
 * left to stand in for is the one thing the tick does to the picture: drop the AI frames
 * once the story has played. The native host plays no story yet, so there are none.
 */
import type * as Real from '../../../src/app/cutscene.js';

export const disposeAiKufr: typeof Real.disposeAiKufr = () => {};
