/**
 * Seam for `src/app/cutscene.ts`: KUFRIK's briefcase story as the browser draws it, on its
 * canvases, with its AI frames cached as `ImageBitmap`s. The story's driver is not here —
 * it is `src/app/cutscenePlay.ts`, which the native host runs as it is — so all that is
 * left to stand in for is the one thing the tick does to the picture: drop the story's art
 * once it has played. The native picture is `native/js/cutsceneScreen.ts`.
 */
import type * as Real from '../../../src/app/cutscene.js';
import { disposeKufrArt } from '../cutsceneScreen.js';

export const disposeAiKufr: typeof Real.disposeAiKufr = disposeKufrArt;
