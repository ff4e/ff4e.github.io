/**
 * One room frame: all three art tiers, both backends. The room walk, the fish sprites at
 * their interpolated sub-tick position, the shake/shove transform, and the DOM subtitle
 * layer that rides it. Not the side panel, and not any screen other than the room —
 * `panel.ts` and `mapDraw.ts` own those.
 *
 * It needs only two names from `main.ts` because it decides nothing: what tier, what
 * backend and what geometry all come from modules that already own those questions.
 * `fishFrameFor` (which sprite frame each fish shows) and `hooks` (the "xfisher"
 * easter-egg fishing hooks, which the compositor paints) are the two answers that
 * still live next to the game loop.
 */
import type { AiRoomFrame } from '../render/roomAi.js';
import { Dir } from '../core/dir.js';
import type { HookSystem } from '../core/hooks.js';
import { EXIT_CELLS, roomGeometry, scalingFilterFor, stage } from './stageGeometry.js';
import { FALL_FRAMES, MOVE_FRAMES } from '../core/stepEngine.js';
import { FSIZE } from '../render/roomWalk.js';
import { aiRoom, aiRoomRenderActive, ensureEnhancedFallback, roomArtPending } from './art.js';
import { alpha, activeScript, count, engine, room, screenShoveX, subs } from './gameState.js';
import { applyFrameEffects, frameEffectsActive } from './cheats.js';
import { clearDomSubtitles, syncDomSubtitles } from './subtitleDom.js';
import { canvas, ctx, glCanvas } from './dom.js';
import { classicArtFor, drawAiGpu, drawGpu, enhancedArtFor, glAiFailed, glFailed } from './glPlumbing.js';
import { enhancedArtActive, renderer } from './renderSettings.js';
import { renderRoomRgba, type FishFrame } from '../render/renderRoom.js';
import { setLastRoomBackend, smoothLog } from './framePacing.js';
import { subtitleScale } from '../render/subtitleGeom.js';
import {
  subFontFamily,
  subFontReady,
  subFontWeight,
} from './stageState.js';
import { ui } from './screenState.js';

/**
 * The two names this module needs from `main.ts`: which sprite frame each fish is
 * showing, and the fishing-hook system whose snapshot the compositor paints.
 */
export interface FramePainterHost {
  readonly fishFrameFor: (which: 'little' | 'big') => FishFrame;
  readonly hooks: Pick<HookSystem, 'snapshot'>;
}

let host!: FramePainterHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initFramePainter(h: FramePainterHost): void {
  host = h;
}

export function draw(): void {
  if (!room) return;
  ui.mapSig = null; // this frame paints #screen with the room — invalidate the map cache
  // While this room's art is still loading, hold the previous frame rather than
  // painting a tier the player did not ask for — the classic look before enhanced
  // lands, or the enhanced look before the AI upscale does. Cleared as soon as the
  // art resolves (or is known missing), so a room with no masters still falls back.
  if (roomArtPending()) return;
  const phase = engine?.phase ?? 'idle';
  const animFrame = engine?.animFrame ?? 0;
  const exitFrames = engine?.exitFrames ?? 8;
  const corkExit = engine?.corkExit ?? null;
  // Interpolate within the current logic tick for smooth motion at the render rate.
  const sub = animFrame + alpha;
  let slide = 0;
  if (phase === 'move') slide = sub / (engine?.cellFrames ?? MOVE_FRAMES); // jizda speed-up (locked per cell)
  else if (phase === 'fall') slide = sub / FALL_FRAMES;
  else if (phase === 'exit') slide = (sub / exitFrames) * EXIT_CELLS; // slide the fish off-screen
  else if (phase === 'cork' && corkExit)
    // gspec=9 exit-slide (KresliMistnost, URoom.pas:26267): the pushed item moves
    // 5px per frame for its faziVen = 3*a frames, i.e. exactly its own width/height
    // (a cells at fsize=15) — NOT the fixed EXIT_CELLS a fish swims out by. LODE's
    // buh2 is 6 cells wide, so the old constant left it a cell short before it popped.
    slide = sub / 3;
  const fishAnim = { little: host.fishFrameFor('little'), big: host.fishFrameFor('big') };
  // Smoothness instrumentation: record the active fish's interpolated on-screen position
  // each rendered frame, so a harness can measure per-frame motion (stalls / jumps).
  if (smoothLog) {
    const af = engine?.activeAnimFish ?? 'little';
    const fit = room.items[af === 'little' ? room.littleIdx : room.bigIdx];
    if (fit) {
      const dxs = fit.dir === Dir.left ? -1 : fit.dir === Dir.right ? 1 : 0;
      const dys = fit.dir === Dir.up ? -1 : fit.dir === Dir.down ? 1 : 0;
      smoothLog.push({
        t: performance.now(),
        n: count,
        a: alpha,
        cf: engine?.cellFrames ?? MOVE_FRAMES,
        x: (fit.x + slide * dxs) * FSIZE,
        y: (fit.y + slide * dys) * FSIZE,
        ph: phase,
      });
      if (smoothLog.length > 4000) smoothLog.shift();
    }
  }
  // Subtitles: in the enhanced and ai tiers, with the vector font ready, render them as
  // real DOM text above the pixel frame instead of baking them into it. Otherwise
  // (classic, or the font failed to load) bake them in.
  const useVecSubs = enhancedArtActive() && subs !== null && subFontReady;
  // Native/fallback path (the AI room compositor above bypasses it entirely):
  // one compositor, one pass. The art source is the ONLY switch between the
  // classic (palette) and enhanced (FFNG truecolor) looks; the enhanced source
  // itself falls back to classic per element where no truecolor art exists
  // (darkness/ZX/bonus, the mirror glass, skeletons, un-mapped frames).
  const art = enhancedArtActive() ? enhancedArtFor(room) : classicArtFor(room);
  const opts = { count, slide, fishAnim, hooks: host.hooks.snapshot };
  const geom = roomGeometry(room);
  const { nativeW: sw, nativeH: sh, scale: cs, cssW, cssH } = geom;
  // TrepatRoom (URoom.pas:24955): a chatter line can shake the room — jitter the
  // active canvas left/right by 10px on alternating multiples of 3 ticks.
  const trepat = activeScript?.s.trepat ?? 0;
  const shakeX = trepat !== 0 && count % 3 === 0 ? (count % 6 === 0 ? -10 : 10) : 0;
  const off = activeScript?.s.screenOffset;
  // shake/shove/script-offset are native game px, scaled by the current display scale.
  const ox = (shakeX + screenShoveX + (off?.x ?? 0)) * cs;
  const oy = (off?.y ?? 0) * cs;
  const xform = ox || oy ? `translate(${ox}px, ${oy}px)` : '';

  // Backend dispatch. The hi-res AI room compositor (ai level, art loaded, and not
  // a ZX / active-hook / frame-effect frame — see aiRoomRenderActive) takes precedence.
  // It composites the SAME room walk (AiRoom.drawInto) into a ×S buffer on either
  // backend: GlAiScreen on the GPU, presented to #screen-gl, or canvas-2D into the
  // ×S-scaled #screen canvas which the browser then scales down to the room's CSS box.
  // Otherwise the renderInto compositor runs on the GPU (GlScreen) or CPU (RgbaScreen).
  // Any GL error falls back to the CPU path for that frame (and disables WebGL for the
  // session).
  const aiActive = aiRoomRenderActive(room);
  if (!aiActive) {
    // In the `ai` tier this frame is about to be painted by the ENHANCED compositor
    // (ZX, a cheat, a baked subtitle, or no AI art for this room) — which is the only
    // thing that still wants the enhanced art, and the tier no longer fetches it on
    // room entry. Ask for it here, where the fallback is actually taken. A no-op in
    // every other tier, and idempotent, so calling it per frame costs one map lookup.
    ensureEnhancedFallback();
  }
  if (aiActive) {
    // roomGeometry already resolved the ×S backing store for this frame — deriving it a
    // second time here is how the two drifted apart before.
    const aw = geom.backingW;
    const ah = geom.backingH;
    // `alpha` rides along so the GPU compositor can sample the water wave at the
    // display rate rather than at the 12.5 Hz logic tick (see AiTarget.background). It
    // is the same sub-tick fraction `slide` above is derived from, and it is read-only:
    // no game state, timing or logic depends on it here.
    const aiFrameState: AiRoomFrame = { count, alpha, slide, fishAnim };
    const aiGpu = renderer === 'webgl' && !glAiFailed && drawAiGpu(geom, room, aiFrameState);
    setLastRoomBackend(aiGpu ? 'webgl' : 'cpu');
    // On the GPU path #screen is only the flow anchor: it still carries the room's CSS
    // box (everything stacked over the room is positioned against it) but keeps a NATIVE
    // backing store, because allocating the ×S one for a canvas nothing paints into
    // would cost ~20 MB for nothing. On the canvas-2D path it IS the ×S composite, and
    // is then displayed smaller than it is (e.g. 3060px in a 1139px box) — which the
    // stylesheet's global `pixelated` rule would point-sample, throwing the AI detail
    // away, hence scalingFilterFor.
    const bw = aiGpu ? geom.nativeW : aw;
    const bh = aiGpu ? geom.nativeH : ah;
    const wantSmooth = aiGpu ? '' : scalingFilterFor(aw, cssW);
    if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
    if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
    if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
    glCanvas.style.display = aiGpu ? 'block' : 'none';
    if (aiGpu) glCanvas.style.transform = xform;
    else {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, aw, ah);
      aiRoom!.draw(ctx, room, aiFrameState);
    }
    canvas.style.transform = xform; // on the GPU path this keeps the anchor under the overlays
  } else {
  // Back on a native-resolution tier: restore the stylesheet's crisp scaling
  // (the AI branch switches this to smooth minification).
  if (canvas.style.imageRendering) canvas.style.imageRendering = '';
  // The frame effects (megabomb flash, silent film, interlaced, the Tetris overlay)
  // are applied by the CPU compositor only, so they force that path — same reason
  // aiRoomRenderActive() bails on them.
  const wantGpu = renderer === 'webgl' && !glFailed && !frameEffectsActive();
  const gpuOk = wantGpu && drawGpu(geom, art, opts, useVecSubs);
  setLastRoomBackend(gpuOk ? 'webgl' : 'cpu'); // the backend that ACTUALLY painted this frame (for the HUD)
  // #screen (the 2D canvas) is the flow anchor for the wrap that also holds the
  // absolutely-positioned #screen-gl canvas and the #domsubs subtitle layer, and sits
  // left of #panel, so it must ALWAYS carry the room's CSS box — even in WebGL mode
  // where we don't draw into it. Otherwise it stays at the default 300×150, the wrap
  // collapses,
  // the GL canvas overflows over the panel and #info crosses the frame.
  // (backingW/H is the native size here: only the AI branch above upscales.)
  if (canvas.width !== geom.backingW || canvas.height !== geom.backingH) {
    canvas.width = geom.backingW;
    canvas.height = geom.backingH;
  }
  // Keep the CSS box in sync every frame so it also tracks resize / fit-mode change
  // (the display scale can change while the room — and thus sw/sh — stays the same).
  if (canvas.style.width !== `${cssW}px`) canvas.style.width = `${cssW}px`;
  if (canvas.style.height !== `${cssH}px`) canvas.style.height = `${cssH}px`;
  if (gpuOk) {
    glCanvas.style.display = 'block';
    glCanvas.style.transform = xform;
    canvas.style.transform = xform; // keep the (hidden) anchor aligned under the overlays
  } else {
    // CPU path (default + fallback): render RGBA and blit into the 2D canvas.
    glCanvas.style.display = 'none';
    const screen = renderRoomRgba(room, art, opts);
    applyFrameEffects(screen, useVecSubs);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(screen.rgba), sw, sh), 0, 0);
    canvas.style.transform = xform;
  }
  }
  // The DOM subtitle layer, which rides the shake/shove transform this frame computed.
  updateRoomSubtitles(useVecSubs, xform);
}

/**
 * Reconcile the room's DOM subtitle layer with what the subtitle system is showing.
 *
 * Split out of draw() because the layer is independent of the room: while a line waves
 * in, the wave itself is running on the compositor and this only writes the line's own
 * scroll transform, once per tick. `xform` is the room's shake/shove, which the layer
 * has to ride; it is left alone when the caller has no fresh one, since a frame that did
 * not repaint the room cannot have changed it either.
 *
 * The text is sized from the STAGE, not from the room. This is a deliberate deviation
 * from what the port did before, and the fidelity argument is on its side:
 *
 *  - The 1998 game ran a fixed window with each room's playfield centred inside it, so
 *    everything — art and subtitles alike — was a constant ON-SCREEN size in every room
 *    (layout.ts, top of file). It never zoomed a room to fit.
 *  - The zoom is the port's own addition, and it made "constant relative to the room"
 *    and "constant on the player's screen" two different things for the first time. The
 *    port had been honouring the first; the original only ever demonstrated the second.
 *  - Measured over the 71 real room sizes, the room's fit factor spans 1.006 to 1.35 in
 *    the default `medium` mode (and up to 2.22 in `fill`), so the same sentence was drawn
 *    up to a third larger in a small room than in a large one. That was reported.
 *
 * So the subtitle takes `stage.scale`, which every room shares, while the room keeps its
 * own zoom — capped at the room's own scale, because the crisp-integer modes can draw a
 * room SMALLER than the stage and stage-sized text would not fit in one (`subtitleScale`
 * has the numbers, and is precise about when the cap actually fires). The layer still
 * covers the room's box and the text is still anchored to the room's bottom edge; only
 * the size is taken from elsewhere. In `fixed` the two numbers are equal by definition,
 * so nothing changes there at all.
 */
export function updateRoomSubtitles(useVecSubs: boolean, xform?: string): void {
  if (useVecSubs && subs?.active && room) {
    const g = roomGeometry(room);
    const textScale = subtitleScale(stage.scale, g.scale);
    syncDomSubtitles('room', subs, count, g.cssW, g.cssH, g.scale, textScale, subFontFamily, subFontWeight, xform);
  } else {
    // Not showing vector subtitles at all: either nothing is being said, or the font
    // never loaded and they are baked into the frame instead.
    clearDomSubtitles('room');
  }
}
