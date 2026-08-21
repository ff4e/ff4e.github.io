/**
 * Hi-res AI end-credits (the `ai` graphics tier) — GPU-composited.
 *
 * The credits are a static frame whose transparent window reveals a tall strip of text
 * scrolling upward. That is a PURE TRANSLATION of one image behind another, so nothing
 * needs re-rasterising per frame: two stacked <img> layers and a CSS transform let the
 * browser's compositor move it on the GPU. Per frame this costs one style write.
 *
 * The previous canvas implementation redrew the whole 2560x1920 frame three times per
 * frame (fill, strip, static) and kept a 2560x11684 pre-flipped canvas — ~2.4 ms of JS
 * per frame, about 20% of a core at 60fps, for an animation that moves rigidly. It also
 * tied smoothness to the paint rate; the compositor is not bound by it.
 *
 * Geometry (native units, `h` = frame height, `delka` = strip height): the faithful
 * renderer shows strip row `delka-1-yobs` at screen row y, where `yobs = y + posun - h`
 * (see render/credits.ts). `scaleY(-1)` flips the strip about its own centre, so flipped
 * row r is original row `delka-1-r`; requiring `r = y - T` gives `T = h - posun` — one
 * translation for the whole roll.
 *
 * The faithful tier keeps its per-pixel palette compositor: it is only 640x480, and it
 * must stay index-exact.
 */
import { decodeAsset, requiredAsset, requiredBlob, requiredJson } from './assetFetch.js';
import { CLOSE_EXTRA, PRESAH } from './credits.js';

/** Upscale factor of the shipped credits art when its manifest doesn't say. */
export const AI_CREDITS_SCALE = 4;

/**
 * Offset at which the roll settles (faithful `maxScroll`). Both tiers must agree, or
 * the AI one keeps sliding through the hold before auto-close.
 */
export function creditsMaxScroll(delka: number): number {
  return delka + PRESAH;
}

/**
 * CSS translateY for scroll offset `posun`, given the native frame height and the
 * display scale. Pure, and the only geometry in this file — see the header for the
 * derivation (`T = h - posun`, with `scaleY(-1)` supplying the flip).
 */
export function creditsTranslate(nativeH: number, delka: number, posun: number, cssScale: number): number {
  return (nativeH - Math.min(posun, creditsMaxScroll(delka))) * cssScale;
}

interface AiCreditsManifest { scale?: number; files?: string[] }

/**
 * Load one credits layer as an <img>, through the asset door.
 *
 * `new Image()` + `src` is a SECOND network door: it retries nothing, it applies no
 * deadline, and its `error` event cannot tell a 404 from a dropped connection — the one
 * distinction the whole failure policy rests on. So the bytes come through
 * `requiredAsset` like everything else and the element is fed from a blob URL, which is
 * also what makes a missing credits layer reach the failure screen rather than a
 * console line. The two elements live for the session, so the URLs are not revoked.
 */
async function loadImage(url: string, what: string): Promise<HTMLImageElement> {
  const blob = await requiredBlob(url, what, 'shouldHave');
  return decodeAsset(url, 'shouldHave', async () => {
    const img = new Image();
    await new Promise<void>((ok, fail) => {
      img.onload = () => ok();
      img.onerror = () => fail(new Error(`cannot decode ${url}`));
      img.src = URL.createObjectURL(blob);
    });
    return img;
  });
}

/**
 * Load the AI credits art from `${base}enhanced-ai/_credits/` — the static frame and the
 * scroll strip, both of which ship.
 *
 * Same change as `loadAiPanel`: the quiet fallback to the faithful roll is gone, because
 * a fallback nobody can see is indistinguishable from the tier working.
 */
export async function loadAiCredits(base: string): Promise<AiCredits> {
  {
    const dir = `${base}enhanced-ai/_credits/`;
    const man = await requiredJson<AiCreditsManifest>(`${dir}ai.json`, 'the AI credits', 'shouldHave');
    const scale = Number(man.scale) || AI_CREDITS_SCALE;
    const [stat, mov] = await Promise.all([
      loadImage(`${dir}stat.webp`, 'the AI credits'),
      loadImage(`${dir}mov.webp`, 'the AI credits'),
    ]);
    // A decoded image with no intrinsic size is a corrupt file, not an absent one: the
    // decoder is the only thing that can tell, and it did.
    if (!stat.naturalWidth || !mov.naturalWidth) throw new Error(`${dir}: credits art decoded to nothing`);
    return new AiCredits(stat, mov, scale);
  }
}

export class AiCredits {
  readonly scale: number;
  /** Native (pre-upscale) frame size — the same units the faithful renderer uses. */
  readonly nativeW: number;
  readonly nativeH: number;
  /** The element to mount in place of the game canvas. */
  readonly el: HTMLDivElement;
  private readonly strip: HTMLImageElement;
  private cssScale = 1;

  constructor(stat: HTMLImageElement, mov: HTMLImageElement, scale: number = AI_CREDITS_SCALE) {
    this.scale = scale;
    this.nativeW = Math.round(stat.naturalWidth / scale);
    this.nativeH = Math.round(stat.naturalHeight / scale);
    this.strip = mov;

    const layer = (img: HTMLImageElement, z: number): void => {
      img.style.position = 'absolute';
      img.style.left = '0';
      img.style.top = '0';
      img.style.width = '100%';
      img.style.height = 'auto';
      img.style.zIndex = String(z);
      img.draggable = false;
    };
    layer(mov, 1);
    layer(stat, 2);
    // Keeps this layer on the GPU instead of repainting it as the transform changes.
    mov.style.willChange = 'transform';
    // Flip about the element's centre; the translate is set per frame in setScroll.
    mov.style.transformOrigin = 'center';

    this.el = document.createElement('div');
    this.el.style.position = 'relative';
    this.el.style.overflow = 'hidden';
    this.el.style.display = 'none';
    // Shown before/after the strip passes — the faithful renderer's `black`, which is
    // the static frame's top-left pixel (UMain.pas:1179-1181).
    this.el.style.background = sampleTopLeft(stat);
    this.el.append(mov, stat);
  }

  /** Native (pre-upscale) height of the scroll strip — the faithful `delka`. */
  get delka(): number {
    return Math.round(this.strip.naturalHeight / this.scale);
  }

  /** Offset at which the roll settles and stops advancing (faithful `maxScroll`). */
  get maxScroll(): number {
    return creditsMaxScroll(this.delka);
  }

  /**
   * Offset past which the roll auto-closes (faithful `closeAt`, UMain.pas:868).
   *
   * Needed because this tier no longer loads the faithful bitmaps alongside its own art
   * — it is the whole roll now, not an overlay on one — so the auto-close has to be
   * derivable from here. Same two constants, imported rather than restated.
   */
  get closeAt(): number {
    return this.delka + PRESAH + CLOSE_EXTRA;
  }

  /** Size the layers for a display box of `cssW`×`cssH`. Call on open and on resize. */
  layout(cssW: number, cssH: number): void {
    this.cssScale = cssW / this.nativeW;
    this.el.style.width = `${Math.round(cssW)}px`;
    this.el.style.height = `${Math.round(cssH)}px`;
  }

  /**
   * Position the roll at scroll offset `posun`, in NATIVE pixels as the faithful
   * renderer counts it. Fractional values are fine and are what make the scroll smooth:
   * the transform is written once per painted frame and the compositor rasterises it on
   * the GPU, so a fractional offset costs nothing extra (unlike the canvas path, which
   * re-blitted the strip in JS every frame).
   *
   * Clamped to maxScroll exactly like the faithful renderer, so both tiers settle in the
   * same place instead of the AI one sliding on through the hold before auto-close.
   */
  setScroll(posun: number): void {
    const t = creditsTranslate(this.nativeH, this.delka, posun, this.cssScale);
    this.strip.style.transform = `translateY(${t}px) scaleY(-1)`;
  }

  show(): void { this.el.style.display = ''; }

  /**
   * Hide AND detach. The scroll strip decodes to ~135 MB (2560×13140 RGBA) and the
   * backdrop to ~20 MB; merely setting display:none kept both resident for the rest of
   * the session after a one-time ~90s roll. main.ts re-appends on the next open.
   */
  hide(): void {
    this.el.style.display = 'none';
    this.el.remove();
  }
}

/** The image's top-left pixel as a CSS colour (one 1×1 draw, once). */
function sampleTopLeft(img: HTMLImageElement): string {
  try {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const g = c.getContext('2d');
    if (!g) return '#000';
    g.drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]},${d[1]},${d[2]})`;
  } catch {
    return '#000';
  }
}
