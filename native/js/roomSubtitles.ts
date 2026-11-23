/**
 * The room's subtitles in the native game: the browser's `updateRoomSubtitles`
 * (src/app/framePainter.ts) and its DOM layer, as a `Surface2D` the host draws over the
 * presented room.
 *
 * The lines are the game's own `SubtitleSystem` (`subs` in gameState.ts), fed by the talk
 * hook and ticked by `logicTick.step`, exactly as in the browser. Each frame they are laid
 * out for the rect the window shows the room in (`presentRect`) — the room's on-screen box,
 * with the text sized from the stage as the browser sizes it, and the `ai` tier's shrink —
 * and drawn at one texel per window pixel (subtitleLayout.ts, subtitleDraw.ts).
 */
import { FontData } from '../../src/render/font.js';
import { subtitleScale } from '../../src/render/subtitleGeom.js';
import { computeStageScale } from '../../src/app/layout.js';
import { count, setFont, subs } from '../../src/app/gameState.js';
import { AI_SUB_SCALE, SubtitleLayout } from './subtitleLayout.js';
import { GlyphAtlas, drawSubtitles } from './subtitleDraw.js';
import { loadFace, type NativeFace } from './subtitleFonts.js';
import { NativeSurface } from './nativeSurface.js';
import { readBytes } from './shims.js';

let face: NativeFace | null = null;
let layout: SubtitleLayout | null = null;
const atlas = new GlyphAtlas();
let overlay: NativeSurface | null = null;

/**
 * The game's bitmap font (the subtitle wrap and the speaker colours are measured from it, as
 * in the browser, boot.ts) and the player's subtitle face (`ff.subfont`, as stageState.ts
 * reads it). Before the first room. The lines themselves come from the room's subtitle file
 * and the audio engine's global packages, through the talk hook (`game.ts`).
 */
export async function loadSubtitleAssets(): Promise<void> {
  setFont(await FontData.load('/data/Intro'));
  face = await loadFace(localStorage.getItem('ff.subfont'), readBytes);
  layout = new SubtitleLayout(face);
}

/**
 * The subtitle layer for a room composited at `compW`×`compH`, `alpha` of the way through
 * the tick — or null when nothing is said (or there is no window to lay it out for). `rect`
 * is where the room is shown (`presentRect`'s answer); the smoke gate, with no window, passes
 * one.
 */
export function subtitleOverlay(
  compW: number, compH: number, alpha: number,
  rect: readonly [number, number, number, number, number] | null = __native.presentRect(compW, compH),
): NativeSurface | null {
  if (!subs?.active || !face || !layout || !rect) return null;
  const [ox, oy, dw, dh, density] = rect;
  const { w: screenW, h: screenH } = subs.vectorScreen;
  const cssW = dw / density, cssH = dh / density;
  const boxScale = cssW / screenW;
  // No panel column and no margins natively: the stage is the whole window.
  const stage = computeStageScale((dw + 2 * ox) / density, (dh + 2 * oy) / density, false);
  const frame = layout.layout(subs.debugLines(), screenW, screenH, count + alpha, {
    cssW, cssH, boxScale, textScale: subtitleScale(stage, boxScale), tier: AI_SUB_SCALE,
  }, face.name);
  if (!overlay || overlay.width !== dw || overlay.height !== dh) overlay = new NativeSurface(dw, dh);
  overlay.clear();
  drawSubtitles(overlay, frame, face, atlas, density);
  return overlay;
}
