/**
 * The AI end credits, natively, reached from the map's Credits corner: the browser's
 * `src/render/creditsAi.ts` roll, on `Surface2D`.
 *
 * In the browser the roll is two DOM layers the compositor moves — the scroll strip behind,
 * flipped and translated, and the static frame over it with its transparent window — because
 * a canvas could not match the compositor byte for byte (#209). Natively there is no
 * compositor to match, so the same picture is painted: the frame's top-left colour, then the
 * strip as ONE flipped quad at the translation the browser computes (`creditsTranslate`,
 * imported, with the strip sampled bilinearly as the compositor samples a layer at a
 * fractional offset), then the static frame over it 1:1. The surface is the art's own size
 * (2560×1920) and is presented as the map is, fitted to the window.
 *
 * The timing is the browser's (mapNav.ts `drawCredits`): the roll advances continuously off
 * the wall clock at CREDIT_SPEED native px per CREDIT_TICK_MS, settles at `maxScroll`, and
 * closes itself once the stepped `creditMode` passes `closeAt`; any button closes it first
 * (FormKeyDown → DoneCredits). native/compare-media.mjs holds the picture to the browser's
 * at fixed offsets.
 */
import { ui } from '../../src/app/screenState.js';
import { AI_CREDITS_SCALE, creditsTranslate } from '../../src/render/creditsAi.js';
import { CLOSE_EXTRA, CREDIT_SPEED, CREDIT_TICK_MS, PRESAH } from '../../src/render/credits.js';
import type { Surface2D } from '../../src/render/surface2d.js';
import { NativeSurface, decodeImage, type NativeImage } from './nativeSurface.js';
import { readBytes } from './shims.js';

/** The roll's art: the static frame, the strip, and what shows where neither has ink. */
export interface CreditsArt {
  readonly stat: NativeImage;
  readonly mov: NativeImage;
  readonly scale: number;
  /** The static frame's top-left pixel (`sampleTopLeft`), as 0xRRGGBB. */
  readonly bg: number;
  readonly nativeW: number;
  readonly nativeH: number;
  /** The strip's native height: the faithful `delka`. */
  readonly delka: number;
}

/**
 * `loadAiCredits` without the page: `ai.json`'s scale, `stat.webp` and `mov.webp` from
 * `/enhanced-ai/_credits/`, decoded to premultiplied textures.
 */
export async function loadCreditsArt(bytes: (url: string) => Promise<Uint8Array> = readBytes): Promise<CreditsArt> {
  const dir = '/enhanced-ai/_credits/';
  const man = JSON.parse(new TextDecoder().decode(await bytes(`${dir}ai.json`))) as { scale?: number };
  const scale = Number(man.scale) || AI_CREDITS_SCALE;
  const statBytes = (await bytes(`${dir}stat.webp`)).slice().buffer;
  const stat = decodeImage(statBytes);
  const mov = decodeImage((await bytes(`${dir}mov.webp`)).slice().buffer);
  const px = new Uint8Array(__native.decodeWebpRgba(statBytes), 0, 4);
  return {
    stat, mov, scale,
    bg: (px[0]! << 16) | (px[1]! << 8) | px[2]!,
    nativeW: Math.round(stat.width / scale),
    nativeH: Math.round(stat.height / scale),
    delka: Math.round(mov.height / scale),
  };
}

export function releaseCreditsArt(a: CreditsArt): void {
  __native.releaseTexture(a.stat.id);
  __native.releaseTexture(a.mov.id);
}

/** `AiCredits.closeAt`: the offset past which the roll closes itself (UMain.pas:868). */
export const creditsCloseAt = (a: CreditsArt): number => a.delka + PRESAH + CLOSE_EXTRA;

/**
 * The roll at scroll offset `posun` (native px, fractional), into `s` — a surface of any size
 * at the frame's aspect, as `AiCredits.layout` sizes the layers to the display box.
 */
export function paintCredits(s: Surface2D, a: CreditsArt, posun: number): void {
  const W = s.width, H = s.height;
  const cssScale = W / a.nativeW;
  s.setSmoothing(false);
  s.fillRect(0, 0, W, H, a.bg);
  // The strip's <img>: width 100%, height auto, `translateY(t) scaleY(-1)` about its centre —
  // so it spans [t, t + height] with its first row at the bottom.
  const t = creditsTranslate(a.nativeH, a.delka, posun, cssScale);
  const mh = (a.mov.height * W) / a.mov.width;
  s.save();
  s.setSmoothing(true);
  s.translate(0, t + mh);
  s.scale(1, -1);
  s.drawImage(a.mov, 0, 0, W, mh);
  s.restore();
  s.setSmoothing(W !== a.stat.width);
  s.drawImage(a.stat, 0, 0, W, H);
}

/**
 * `ms` into the roll: the original's stepped offset (CreditMode += CreditSpeed every 100 ms),
 * which closes it, and the same ramp left continuous, which the AI tier draws.
 */
export function creditsAt(ms: number): { creditMode: number; creditScroll: number } {
  const creditElapsed = ms / CREDIT_TICK_MS;
  return { creditMode: Math.floor(creditElapsed) * CREDIT_SPEED, creditScroll: creditElapsed * CREDIT_SPEED };
}

// ── On the map ────────────────────────────────────────────────────────────────────────

let art: CreditsArt | null = null;
let surface: NativeSurface | null = null;

/**
 * daCredits: open the roll over the map. The art is loaded on the gesture, nothing is shown
 * until it is in, and a second press while it loads is a no-op — the browser's three rules.
 * A failure to load leaves the map as it was (the browser's note has no native counterpart
 * yet: it says so on the console).
 * restates src/app/mapNav.ts `export async function openCredits(` @ 5f0ee4bcb4fd
 */
export async function openCredits(): Promise<void> {
  if (ui.screen !== 'map' || ui.mapOverlay !== 'none') return;
  if (ui.creditsLoading) return;
  if (!art) {
    ui.creditsLoading = true;
    try {
      art = await loadCreditsArt();
    } catch (e) {
      console.warn('the credits did not load; the map stays', e);
      return;
    } finally {
      ui.creditsLoading = false;
    }
  }
  if (ui.screen !== 'map' || ui.mapOverlay !== 'none') return;
  ui.mapOverlay = 'credits';
  ui.creditMode = 0;
  ui.creditsStart = performance.now();
}

/**
 * DoneCredits: back to the plain map. The art goes with it, as the browser detaches its
 * layers (the strip is ~135 MB decoded): a reopen decodes it again.
 * restates src/app/mapNav.ts `export function closeMapOverlay(` @ 0a98da4014a7
 */
export function closeCredits(): void {
  if (art) releaseCreditsArt(art);
  art = null;
  surface = null;
  ui.mapOverlay = 'none';
  ui.creditMode = -1;
}

/** Any button while the roll is up closes it (FormKeyDown → DoneCredits). */
export function creditsKeyDown(): void {
  closeCredits();
}

/**
 * One frame of the roll: advance it off the wall clock, close it once it has settled and
 * held, else paint it. Returns the surface to present, or null once it has closed.
 * restates src/app/mapNav.ts `export function drawCredits(` @ d101be4e352d
 */
export function creditsFrame(now: number): NativeSurface | null {
  if (!art) return null;
  const { creditMode, creditScroll } = creditsAt(now - ui.creditsStart);
  ui.creditMode = creditMode;
  if (ui.creditMode > creditsCloseAt(art)) {
    closeCredits();
    return null;
  }
  surface ??= new NativeSurface(art.stat.width, art.stat.height);
  paintCredits(surface, art, creditScroll);
  return surface;
}
