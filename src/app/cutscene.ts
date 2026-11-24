/**
 * The KUFRIK demo and the intro/ending cutscenes.
 *
 * Two drivers over one presentation. What they share is the frame: a movie painted per
 * logic tick with its own subtitle overlay, and one skip path. What differs is what feeds
 * it — KUFRIK runs `KufrDemo`, showmode steps a `CapAction` queue parsed from help.cap.
 *
 * The map's "Replay" used to live here as a third driver and now does not (`replayMode.ts`).
 * It looked like the same shape and is not: showmode IS `DalsiPrikaz` and shares the
 * keyboard's tick cadence, a replay is the original's `loadmode` and does not. Sitting in
 * this file is how it silently inherited the wrong one.
 *
 * The AI-tier upscaled frames (`aiKufr`) are cached here too, because nothing else looks
 * at them and the cache has to be dropped when the cutscene ends.
 *
 * The two drivers themselves — starting, stepping, skipping and ending the story and the
 * showmode — are `cutscenePlay.ts`: they touch no page, and the native host runs them as
 * they are. What is left here is the page's: the frame on `#screen`/the GL canvas, the DOM
 * captions, and the frame cache.
 */
import { canvas, ctx, glCanvas } from './dom.js';
import { perfPaint, setPerfPaint } from './framePacing.js';
import { count, cutscene, cutsceneSubs } from './gameState.js';
import { glCompositor, glFailed, markGlFailed } from './glPlumbing.js';
import { clearDomSubtitles, syncDomSubtitles } from './subtitleDom.js';
import { enhancedArtActive, graphics, renderer } from './renderSettings.js';
import { ui } from './screenState.js';
import { contentScaleFor, scalingFilterFor } from './stageGeometry.js';
import { subFontFamily, subFontReady, subFontWeight } from './stageState.js';
import type { AiKufr } from '../intro/kufrDemo.js';
import { IndexedScreen } from '../render/framebuffer.js';
import { assetCoolingDown, decodeAsset, isTransient, requiredBlob, requiredJson } from '../render/assetFetch.js';
import { drawIndexedRegion } from '../render/indexedRegion.js';
import { AI_ROOM_SCALE } from '../render/roomAi.js';

/**
 * Reconcile the cutscene's KD-* caption layer.
 *
 * Shared by the faithful and the AI cutscene paths: the captions are their own layer, so
 * they are identical in both and must not be duplicated per path. The cutscene's own box
 * and content scale are handed over, not the room's — a cutscene is 720x555 whatever room
 * it was started from.
 *
 * Which is also why a caption is still sized from its own content scale while a ROOM
 * subtitle is now sized from the stage (framePainter): a cutscene has exactly one size,
 * so there is no room-to-room variation here to normalise, and pinning captions to the
 * stage would resize the briefcase intro to fix a symptom it does not have.
 * The readable band still applies (it lives in `syncDomSubtitles`, not at either call
 * site): a cutscene tracks the same viewport, so only room-to-room is cutscene-exempt.
 */
export function updateCutsceneCaptions(cssW: number, cssH: number, cs: number): void {
  if (!cutsceneSubs?.active) return;
  syncDomSubtitles('cut', cutsceneSubs, count, cssW, cssH, cs, cs, subFontFamily, subFontWeight);
}

/**
 * The AI-upscaled briefcase cutscene: the static suitcase/TV canvas plus one upscaled
 * image per DECODED animation frame (see tools/studio/stage-kufr.ts).
 *
 * The deltas in demo.pck cannot be upscaled — they are per-pixel palette writes — so the
 * frames are materialised offline. The script still drives playback: this only swaps the
 * PIXEL SOURCE, so the audio-dependent timeline, the KD-* narration, the captions and
 * the Escape skip are all untouched.
 */
export let aiKufr: AiKufr | null = null;
let aiKufrTried = false;
/** Decoded frames, bounded — all 284 at ×4 would be ~37 MB resident. */
export const aiKufrFrames = new Map<string, ImageBitmap>();
const AI_KUFR_CACHE_MAX = 24;
const aiKufrLoading = new Set<string>();
let aiKufrRangeWarned = false;

const AI_KUFR_MANIFEST_URL = '/enhanced-ai/_kufr/ai.json';
const AI_KUFR_BASE_URL = '/enhanced-ai/_kufr/base.webp';

/** Fetch + decode the cutscene's base frame, with the decode classified too. */
async function decodeKufrBase(what: string): Promise<ImageBitmap> {
  const blob = await requiredBlob(AI_KUFR_BASE_URL, what, 'niceToHave');
  return decodeAsset(AI_KUFR_BASE_URL, 'niceToHave', () => createImageBitmap(blob));
}

export async function ensureAiKufr(): Promise<void> {
  // Consulted, not thrown from: this is kicked from `drawCutscene`, which runs EVERY
  // frame, and the catch below clears the latch. Without this the cooldown would bound
  // the requests and nothing else — ~60 allocated errors, rejections and log lines a
  // second for the length of the cutscene. See `assetCoolingDown`.
  if (aiKufrTried || assetCoolingDown(AI_KUFR_MANIFEST_URL)) return;
  aiKufrTried = true;
  const what = 'the AI briefcase cutscene';
  const manUrl = AI_KUFR_MANIFEST_URL;
  type Manifest = { scale: number; region: AiKufr['region']; order: string[]; original?: string[] };
  try {
    const man = await requiredJson<Manifest>(manUrl, what, 'niceToHave');
    aiKufr = {
      base: await decodeKufrBase(what),
      scale: Number(man.scale) || AI_ROOM_SCALE,
      region: man.region,
      order: man.order ?? [],
      original: new Set(man.original ?? []),
    };
  } catch (e) {
    // A FAILED load is not remembered (#66), so the next frame asks again and the
    // per-URL cooldown in assetFetch.ts keeps that from becoming a request per frame.
    if (isTransient(e)) aiKufrTried = false;
    throw e;
  }
}

/** Fetch a cutscene frame (and prefetch the next few, since playback is linear). */
export function loadAiKufrFrame(name: string): void {
  if (!name || aiKufrFrames.has(name) || aiKufrLoading.has(name)) return;
  // A `"model": "original"` frame ships no upscale, so asking for one is a certain 404.
  if (aiKufr?.original.has(name)) return;
  const url = `/enhanced-ai/_kufr/frames/${name}`;
  if (assetCoolingDown(url)) return; // the draw path prefetches five frames per frame
  aiKufrLoading.add(name);
  void (async () => {
    try {
      const blob = await requiredBlob(url, 'an AI briefcase frame', 'niceToHave');
      const bmp = await decodeAsset(url, 'niceToHave', () => createImageBitmap(blob));
      aiKufrFrames.set(name, bmp);
      while (aiKufrFrames.size > AI_KUFR_CACHE_MAX) {
        const oldest = aiKufrFrames.keys().next().value as string | undefined;
        if (oldest === undefined || oldest === name) break;
        aiKufrFrames.get(oldest)?.close();
        aiKufrFrames.delete(oldest);
      }
    } finally {
      // The in-flight set is cleaned up however this ends; "this frame stays on the
      // faithful path" is not one of the endings any more.
      aiKufrLoading.delete(name);
    }
  })();
}

/** Release the cutscene's decoded art (~37 MB of frames at ×4). */
export function disposeAiKufr(): void {
  aiKufrRangeWarned = false;
  for (const b of aiKufrFrames.values()) b.close();
  aiKufrFrames.clear();
  aiKufr?.base.close();
  aiKufr = null;
  aiKufrTried = false;
}

export function drawCutscene(): void {
  if (!cutscene) return;
  ui.mapSig = null; // cutscene paints #screen — invalidate the map cache
  const w = cutscene.width;
  const h = cutscene.height;
  const cs = contentScaleFor(w, h); // scaled + centered in the stage like the room it plays over (KUFRIK)
  const cssW = w * cs;
  const cssH = h * cs;
  const dpr = window.devicePixelRatio || 1;
  // Enhanced: render the KD-* captions in the bundled Mulish font on the vector
  // overlay (like room subtitles). Classic: keep the faithful baked bitmap font
  // composited into the 256-colour frame.
  const useVec = enhancedArtActive() && cutsceneSubs !== null && subFontReady;
  // The hi-res path draws bitmaps, so it cannot composite BAKED captions into the
  // indexed frame. When the vector overlay is unavailable (no subtitle font) it stands
  // down entirely rather than drop the narration text — same rule as the room gate.
  if (graphics === 'ai' && !aiKufrTried) void ensureAiKufr();
  const aiFrameIdx = Math.max(0, cutscene.framesShown - 1);
  const aiFrameName = aiKufr ? aiKufr.order[aiFrameIdx] ?? '' : '';
  // Running past the end means the shipped sequence and the decoder disagree. It no
  // longer drops the whole picture back to the faithful renderer (the frame plays as the
  // original region instead), so this warning is the only report of it — and that
  // mid-cutscene drop is exactly how the framesDrawn/framesShown mix-up hid.
  if (aiKufr && !aiFrameName && !aiKufrRangeWarned) {
    aiKufrRangeWarned = true;
    console.warn(`AI cutscene: frame ${aiFrameIdx} is past the shipped sequence (${aiKufr.order.length}); playing the original art`);
  }
  if (aiKufr && aiFrameName) {
    loadAiKufrFrame(aiFrameName);
    for (let i = 1; i <= 4; i++) loadAiKufrFrame(aiKufr.order[cutscene.framesShown - 1 + i] ?? '');
  }
  // Stay on the upscaled path for EVERY frame and vary only what fills the region: the
  // shipped upscale when there is one, the original pixels when there is not (a
  // `"model": "original"` pick, or a frame still streaming in).
  const aiOn = graphics === 'ai' && useVec && aiKufr !== null;
  const aiBmp = aiOn ? aiKufrFrames.get(aiFrameName) ?? null : null;
  if (aiOn && aiKufr) {
    const S = aiKufr.scale;
    glCanvas.style.display = 'none';
    if (canvas.width !== w * S || canvas.height !== h * S) { canvas.width = w * S; canvas.height = h * S; }
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.style.transform = '';
    const wantSmooth = scalingFilterFor(w * S, cssW);
    if (canvas.style.imageRendering !== wantSmooth) canvas.style.imageRendering = wantSmooth;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(aiKufr.base, 0, 0);
    if (aiBmp) ctx.drawImage(aiBmp, aiKufr.region.x * S, aiKufr.region.y * S);
    // The 1998 pixels, over the same base at the same scale — see indexedRegion.ts for
    // why the region is repainted rather than handed to the faithful renderer.
    else drawIndexedRegion(ctx, cutscene.pixels, cutscene.palette, w, aiKufr.region, S);
    updateCutsceneCaptions(cssW, cssH, cs);
    setPerfPaint(perfPaint + 1);
    return;
  }
  if (canvas.style.imageRendering) canvas.style.imageRendering = '';
  const frame = new IndexedScreen(w, h);
  frame.px.set(cutscene.pixels);
  if (!useVec) cutsceneSubs?.draw(frame, count); // baked bitmap captions
  // Enhanced upgrade: bilinear-upscale the 256-colour frame on the GPU so it isn't
  // blocky on hi-DPI displays. Classic stays crisp (faithful) via the 2D path.
  const smoothGpu = enhancedArtActive() && renderer === 'webgl' && !glFailed;
  // #screen is the layout anchor of the wrap even when the GL canvas covers it, so
  // it must carry the cutscene's CSS box (native backing, SCALE-sized on screen —
  // the same box the KUFRIK room used, so entering/leaving the cutscene doesn't
  // shift the layout). Its backing also backs the 2D fallback blit below.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.transform = '';
  let presented = false;
  if (smoothGpu) {
    const comp = glCompositor();
    if (comp) {
      try {
        comp.renderIndexed(frame.px, w, h, cutscene.palette);
        // Back the GL canvas at the on-screen device resolution so the shader's
        // LINEAR upscale (not CSS scaling) does the smoothing; present + show it.
        const bw = Math.round(cssW * dpr);
        const bh = Math.round(cssH * dpr);
        if (glCanvas.width !== bw || glCanvas.height !== bh) {
          glCanvas.width = bw;
          glCanvas.height = bh;
        }
        glCanvas.style.left = glCanvas.style.top = '0'; // a zoomed room may have left a crop offset
        glCanvas.style.width = `${cssW}px`;
        glCanvas.style.height = `${cssH}px`;
        glCanvas.style.transform = '';
        comp.present(bw, bh, true);
        glCanvas.style.display = 'block';
        presented = true;
      } catch {
        markGlFailed(); // fall through to the CPU blit for this frame
      }
    }
  }
  if (!presented) {
    glCanvas.style.display = 'none';
    const rgba = frame.toRgba(cutscene.palette);
    ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), w, h), 0, 0);
  }
  // Mulish captions, in the same coordinate convention as the room's subtitles: the
  // layer spans the on-screen box and is placed from native (720x555) game pixels.
  if (useVec && cutsceneSubs!.active) {
    updateCutsceneCaptions(cssW, cssH, cs);
  } else {
    // Baked captions, or none at all: the layer stands down.
    clearDomSubtitles('cut');
  }
}
