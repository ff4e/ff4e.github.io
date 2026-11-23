/**
 * Seam for `src/app/cutscene.ts` (KUFRIK's briefcase cutscene and its tutorial
 * demonstration, drawn on the browser's canvases). The native host plays neither yet:
 * `game.ts` never starts one, so `cutscene` and `showmode` stay null and the two tick
 * hooks below are never reached with anything to do.
 */
import type * as Real from '../../../src/app/cutscene.js';
import { activeScript, engine, setLoadmode, setReplaymode, setShowmode, setShowmodeHold, setShowmodeLoading, setShowmodeRestarted, setShowmodeSave, showmode, showmodeLoading } from '../../../src/app/gameState.js';
import { cancelSolve } from '../../../src/app/solveMode.js';
import { DEFAULT_LINE_TICKS } from './stageGeometry.js';

export const advanceShowmode: typeof Real.advanceShowmode = () => {};
export const disposeAiKufr: typeof Real.disposeAiKufr = () => {};
export const cutsceneCaption: typeof Real.cutsceneCaption = () => DEFAULT_LINE_TICKS;

/**
 * `endShowmode`, restated: every playback a room change, restart or load must end. All of
 * it is `gameState` and `solveMode`, but it lives in the DOM-bound module, so the native
 * composition root takes it from here.
 */
export const endShowmode: typeof Real.endShowmode = () => {
  setShowmode(null);
  setShowmodeLoading(false);
  setShowmodeRestarted(false);
  setShowmodeHold(0);
  setShowmodeSave(null);
  setLoadmode(null);
  setReplaymode(null);
  cancelSolve();
  if (engine) engine.swim = null;
  if (activeScript) activeScript.s.showmode = false;
};

export const inShowmode: typeof Real.inShowmode = () => showmode !== null || showmodeLoading;
