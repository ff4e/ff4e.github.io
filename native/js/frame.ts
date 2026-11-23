/**
 * The frame description `AiRoom.drawInto` takes, for the room `gameState.ts` holds now —
 * `src/app/framePainter.ts`'s slide (:66-76), restated because that module paints the
 * browser's canvases. Shared by the native game (`game.ts`) and by the parity scene
 * (`scene.ts`), so the two cannot describe a frame differently.
 */
import { FALL_FRAMES, MOVE_FRAMES } from '../../src/core/stepEngine.js';
import type { AiRoomFrame } from '../../src/render/roomAi.js';
import { fishFrameFor } from '../../src/app/fishFrame.js';
import { count, engine } from '../../src/app/gameState.js';
import { EXIT_CELLS } from './seams/stageGeometry.js';

// restates src/app/framePainter.ts `export function draw(` @ c887b3c4ef04
export function aiFrame(alpha: number): AiRoomFrame {
  const phase = engine?.phase ?? 'idle';
  const sub = (engine?.animFrame ?? 0) + alpha;
  let slide = 0;
  if (phase === 'move') slide = sub / (engine?.cellFrames ?? MOVE_FRAMES);
  else if (phase === 'fall') slide = sub / FALL_FRAMES;
  else if (phase === 'exit') slide = (sub / (engine?.exitFrames ?? 8)) * EXIT_CELLS;
  else if (phase === 'cork' && engine?.corkExit) slide = sub / 3; // gspec=9 exit-slide (framePainter.ts:72)
  return { count, alpha, slide, fishAnim: { little: fishFrameFor('little'), big: fishFrameFor('big') } };
}
