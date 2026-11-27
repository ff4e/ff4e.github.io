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
import { count, cutsceneSubs, setFont, subs } from '../../src/app/gameState.js';
import { AI_SUB_SCALE, SubtitleLayout } from './subtitleLayout.js';
import { GlyphAtlas, drawSubtitles } from './subtitleDraw.js';
import { loadFace, type NativeFace } from './subtitleFonts.js';
import { NativeSurface } from './nativeSurface.js';
import { readBytes } from './shims.js';

let face: NativeFace | null = null;
let layout: SubtitleLayout | null = null;
/** The briefcase story's captions: a layer of their own, as in the browser (`'cut'`). */
let cutLayout: SubtitleLayout | null = null;
const atlas = new GlyphAtlas();
let overlay: NativeSurface | null = null;
let cutOverlay: NativeSurface | null = null;
/** The story's box: the captions are drawn here, so nothing outside the picture is (`#domsubs-cut`'s overflow: hidden). */
let cutBox: NativeSurface | null = null;

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
  cutLayout = new SubtitleLayout(face);
}

/** The face the subtitles are drawn in, once loaded (the UI text borrows it). */
export function subtitleFace(): NativeFace | null {
  return face;
}

/**
 * The subtitle layer for a room composited at `compW`×`compH`, `alpha` of the way through
 * the tick — or null when nothing is said (or there is no window to lay it out for). `rect`
 * is where the room is shown: `presentRect`'s answer with the room's cap (`roomCapH`), or
 * for the smoke gate, with no window, the same for a window it names.
 */
export function subtitleOverlay(
  compW: number, compH: number, alpha: number,
  rect: readonly [number, number, number, number, number] | null,
): NativeSurface | null {
  if (!face || !layout) return null;
  // Nothing said: forget the rows' fits, as the browser tears its layer down
  // (`clearDomSubtitles('room')`). The next system's row ids start again at 1.
  if (!subs?.active) {
    layout.reset();
    return null;
  }
  if (!rect) return null;
  const [ox, oy, dw, dh, density] = rect;
  const { w: screenW, h: screenH } = subs.vectorScreen;
  const cssW = dw / density, cssH = dh / density;
  const boxScale = cssW / screenW;
  // No panel column and no margins natively: the stage is the whole window.
  const stage = computeStageScale((dw + 2 * ox) / density, (dh + 2 * oy) / density, false);
  const frame = layout.layout(subs, count + alpha, {
    cssW, cssH, boxScale, textScale: subtitleScale(stage, boxScale), tier: AI_SUB_SCALE,
  }, face.name);
  if (!overlay || overlay.width !== dw || overlay.height !== dh) overlay = new NativeSurface(dw, dh);
  overlay.clear();
  drawSubtitles(overlay, frame, face, atlas, density);
  return overlay;
}

/**
 * The briefcase story's KD-* captions (`cutsceneSubs`) for a story picture shown at `rect`
 * in a `winW`×`winH` window, drawn into a window-sized layer (`presentTexture` draws its
 * overlay over the whole window) — or null when nothing is said.
 *
 * The browser's `updateCutsceneCaptions`: the story's own box, and the text sized from the
 * story's own content scale rather than from the stage, because a cutscene has exactly one
 * size (720×555), so there is no room-to-room variation to normalise. The readable band and
 * the `ai` tier's shrink apply as they do to a room's lines (`SubtitleLayout`), and nothing is
 * drawn outside the story's box, which the browser's layer clips (`overflow: hidden`).
 * restates src/app/cutscene.ts `export function updateCutsceneCaptions(` @ a88a4b7e1243
 */
export function cutsceneCaptionOverlay(
  winW: number, winH: number, alpha: number,
  rect: readonly [number, number, number, number, number],
): NativeSurface | null {
  if (!face || !cutLayout) return null;
  if (!cutsceneSubs?.active) {
    cutLayout.reset();
    return null;
  }
  const [ox, oy, dw, dh, density] = rect;
  const cssW = dw / density, cssH = dh / density;
  const cs = cssW / cutsceneSubs.vectorScreen.w;
  const frame = cutLayout.layout(cutsceneSubs, count + alpha, {
    cssW, cssH, boxScale: cs, textScale: cs, tier: AI_SUB_SCALE,
  }, face.name);
  // Drawn into a surface the picture's size, as the room's are, which clips what is laid out
  // past its edges — a new line's rows start below the bottom and scroll up into it, and a
  // glyph's wave starts below its baseline — then put 1:1 into the window-sized layer
  // `presentTexture` draws over the window.
  if (!cutBox || cutBox.width !== dw || cutBox.height !== dh) cutBox = new NativeSurface(dw, dh);
  cutBox.clear();
  drawSubtitles(cutBox, frame, face, atlas, density);
  if (!cutOverlay || cutOverlay.width !== winW || cutOverlay.height !== winH) cutOverlay = new NativeSurface(winW, winH);
  cutOverlay.clear();
  cutOverlay.setSmoothing(false);
  cutOverlay.drawImage(cutBox, ox, oy);
  return cutOverlay;
}
