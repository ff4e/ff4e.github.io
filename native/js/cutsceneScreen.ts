/**
 * KUFRIK's briefcase story on screen, natively: the picture half of the browser's
 * `drawCutscene` (src/app/cutscene.ts), on `Surface2D`.
 *
 * What plays it is not here. `src/app/cutscenePlay.ts` starts the story, `logicTick.step`
 * advances it one script step per game tick with its KD-* narration and captions, and a skip
 * ends it — all imported, unchanged. This module only turns the story's state into a picture,
 * as the browser's `ai` tier does: the upscaled suitcase-and-TV canvas (`/enhanced-ai/_kufr/`
 * `base.webp`, ×4), with the upscaled image of the frame being shown (`frames/fNNNN.webp`,
 * one per DISPLAYED canvas state, `framesShown`) over the animation's region. A frame shipped
 * without an upscale (`"model": "original"`), or one still being read, plays as the 1998
 * pixels inside the upscaled scene, nearest-neighbour at the base's scale — never by swapping
 * the whole picture back to the faithful renderer, which flashes the background.
 *
 * Until the base has been read (the first frame or two), the story is the faithful 720×555
 * frame, which `presentTexture` upscales bilinearly — the browser's enhanced GPU path. The
 * captions are their own layer (`roomSubtitles.ts`, `cutsceneCaptionOverlay`).
 *
 * The frames are read from the draw path, the next four ahead, as the browser fetches them,
 * and at most a few are held: all 284 at ×4 would be ~2 GB of textures. `disposeKufrArt`
 * releases everything; the story's end (`logicTick`, through the `cutscene` seam) and a skip
 * (`cutscenePlay.skipCutscene`, through its host) both call it.
 */
import { cutscene } from '../../src/app/gameState.js';
import { regionRgba, type IndexedRegion } from '../../src/render/indexedRegion.js';
import { NativeSurface, decodeImage, type NativeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';

const DIR = '/enhanced-ai/_kufr/';
/** Decoded frames held at once: the one shown and the four read ahead, with a little slack. */
const CACHE_MAX = 8;

interface KufrArt {
  readonly base: NativeImage;
  readonly scale: number;
  readonly region: IndexedRegion;
  readonly order: readonly string[];
  readonly original: ReadonlySet<string>;
}

let art: KufrArt | null = null;
let artTried = false;
/** Bumped by every dispose, so a read that lands after it is released rather than kept. */
let generation = 0;
const frames = new Map<string, NativeImage>();
const loading = new Set<string>();
let rangeWarned = false;

/** The upscaled picture (720×555 × scale), repainted only when what it shows changes. */
let picture: NativeSurface | null = null;
let painted = '';
/** The animation's region as the original pixels, for a frame with no upscale to show. */
let regionPx: NativeSurface | null = null;
/** The whole faithful frame, before the upscaled art is in. */
let faithful: NativeSurface | null = null;
let faithfulShown = -1;

/** `ensureAiKufr`: the manifest and the base, read once per story. */
function ensureArt(): void {
  if (artTried) return;
  artTried = true;
  const gen = generation;
  void (async () => {
    try {
      const man = JSON.parse(new TextDecoder().decode(await readBytes(`${DIR}ai.json`))) as {
        scale?: number; region: IndexedRegion; order?: string[]; original?: string[];
      };
      const base = decodeImage((await readBytes(`${DIR}base.webp`)).slice().buffer);
      if (gen !== generation) {
        __native.releaseTexture(base.id);
        return;
      }
      art = {
        base,
        scale: Number(man.scale) || 4,
        region: man.region,
        order: man.order ?? [],
        original: new Set(man.original ?? []),
      };
    } catch (e) {
      console.warn('the AI briefcase story did not load; it plays as the original pixels', e);
    }
  })();
}

/** `loadAiKufrFrame`: read and decode one frame, and keep the cache bounded. */
function loadFrame(name: string): void {
  if (!name || frames.has(name) || loading.has(name) || art?.original.has(name)) return;
  loading.add(name);
  const gen = generation;
  void (async () => {
    try {
      const img = decodeImage((await readBytes(`${DIR}frames/${name}`)).slice().buffer);
      if (gen !== generation) {
        __native.releaseTexture(img.id);
        return;
      }
      frames.set(name, img);
      while (frames.size > CACHE_MAX) {
        const oldest = frames.keys().next().value as string | undefined;
        if (oldest === undefined || oldest === name) break;
        __native.releaseTexture(frames.get(oldest)!.id);
        frames.delete(oldest);
      }
    } catch (e) {
      console.warn(`the AI briefcase frame ${name} did not load; it plays as the original pixels`, e);
    } finally {
      if (gen === generation) loading.delete(name);
    }
  })();
}

/** Release the story's art: the base, the frames, and the pictures painted from them. */
export function disposeKufrArt(): void {
  generation++;
  for (const f of frames.values()) __native.releaseTexture(f.id);
  frames.clear();
  loading.clear();
  if (art) __native.releaseTexture(art.base.id);
  art = null;
  artTried = false;
  rangeWarned = false;
  picture = null;
  regionPx = null;
  faithful = null;
  painted = '';
  faithfulShown = -1;
}

/**
 * The story's picture this frame — the surface to present — or null with no story playing.
 * restates src/app/cutscene.ts `export function drawCutscene(` @ b7f86f365c2e
 */
export function cutsceneFrame(): NativeSurface | null {
  if (!cutscene) return null;
  ensureArt();
  const w = cutscene.width, h = cutscene.height;
  const shown = Math.max(0, cutscene.framesShown - 1);
  const name = art ? art.order[shown] ?? '' : '';
  if (art && !name && !rangeWarned) {
    rangeWarned = true;
    console.warn(`AI cutscene: frame ${shown} is past the shipped sequence (${art.order.length}); playing the original art`);
  }
  if (art && name) {
    loadFrame(name);
    for (let i = 1; i <= 4; i++) loadFrame(art.order[cutscene.framesShown - 1 + i] ?? '');
  }
  if (!art) {
    // The faithful frame, until the upscaled base is in.
    if (!faithful || faithful.width !== w || faithful.height !== h) {
      faithful = new NativeSurface(w, h);
      faithfulShown = -1;
    }
    if (faithfulShown !== cutscene.framesShown) {
      const rgba = cutscene.toRgba();
      faithful.putPixels(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength) as Uint8ClampedArray<ArrayBuffer>);
      faithfulShown = cutscene.framesShown;
    }
    return faithful;
  }
  const S = art.scale;
  const r = art.region;
  if (!picture || picture.width !== w * S || picture.height !== h * S) {
    picture = new NativeSurface(w * S, h * S);
    painted = '';
  }
  const img = name ? frames.get(name) ?? null : null;
  // The pixels change only when a frame is shown, so this is the whole of what can change.
  const what = `${cutscene.framesShown}:${img ? name : 'pixels'}`;
  if (what !== painted) {
    picture.setSmoothing(false);
    picture.drawImage(art.base, 0, 0);
    if (img) picture.drawImage(img, r.x * S, r.y * S);
    else {
      if (!regionPx || regionPx.width !== r.w || regionPx.height !== r.h) regionPx = new NativeSurface(r.w, r.h);
      regionPx.putPixels(regionRgba(cutscene.pixels, cutscene.palette, w, r));
      picture.drawImage(regionPx, r.x * S, r.y * S, r.w * S, r.h * S);
    }
    painted = what;
  }
  return picture;
}

/** For the gates: is the upscaled art in, its frame order, the frames shipped without an upscale, and those decoded. */
export function kufrArtState(): { art: boolean; order: readonly string[]; original: ReadonlySet<string>; frames: readonly string[] } {
  return { art: art !== null, order: art?.order ?? [], original: art?.original ?? new Set(), frames: [...frames.keys()] };
}
