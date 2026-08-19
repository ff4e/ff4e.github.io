/**
 * Hi-res AI control-panel compositor (the `ai` graphics tier).
 *
 * The panel is a runtime composite of sixteen colour variants of one 155x395 image
 * (render/hud.ts: horizontal bands per element state, a lit-arrow overlay, and for
 * the options sub-panel a background + highlight regions + three slider handles +
 * a scroll frame). This re-runs that EXACT compositing at ×scale from AI-upscaled
 * art, so the panel is purely a higher-resolution rendering of the identical state —
 * every rectangle here is the hud.ts rectangle multiplied by `scale`.
 *
 * Transparency differs from the faithful path by design. hud.ts overlays by testing
 * a palette index (Pruhl's key, the cudl sprite's top-left colour); an upscaler
 * invents colours near such a key, so the index test would break. stage-ui.mjs bakes
 * those keys into the alpha channel instead, and this compositor simply draws with
 * alpha — same result, and it survives interpolation.
 *
 * Falls back to null when any asset is missing, in which case the caller keeps using
 * the faithful indexed composite. classic/enhanced never touch this.
 */
import {
  PANEL_W, PANEL_H, OPTIONS_IMG, OPTAKT_IMG, SCROLL_MIN, SCROLL_MAX, SVITICI,
  type PanelState, type OptionsState,
} from './hud.js';
import { PANEL_IMAGES, CUDL_SIZE } from '../data/ffp.js';
import { requiredAsset, requiredBlob, requiredJson } from './assetFetch.js';

/** Upscale factor of the shipped panel art when its manifest doesn't say. */
export const AI_PANEL_SCALE = 4;

/** Full-width horizontal bands — must match hud.ts BANDS (Uovl.pas:480-486). */
const BANDS: [keyof PanelState, number, number][] = [
  ['velka', 0, 148],
  ['space', 149, 171],
  ['mala', 172, 317],
  ['save', 318, 335],
  ['load', 336, 353],
  ['abort', 354, 371],
  ['restart', 372, 394],
];

/** Lit-arrow overlay rects per pressed direction — must match hud.ts PRESSED_REGION. */
const PRESSED_REGION: Record<number, [number, number, number, number]> = {
  5: [51, 0, 51, 49],
  6: [52, 98, 50, 48],
  7: [3, 46, 47, 51],
  8: [105, 48, 45, 48],
  1: [52, 171, 48, 49],
  2: [52, 269, 49, 47],
  3: [3, 218, 46, 51],
  4: [105, 219, 45, 48],
};

/** Subtitle-highlight left edge per mode — must match hud.ts SUBTITLE_HIGHLIGHT_X. */
const SUBTITLE_HIGHLIGHT_X: Record<'cz' | 'en' | 'off', number> = { cz: 5, en: 52, off: 100 };
/** Slider-handle Y per category — must match hud.ts HANDLE_Y. */
const HANDLE_Y = { effect: 85, voice: 134, music: 183 } as const;

interface AiPanelManifest { scale?: number; files?: string[] }

/**
 * Load the AI panel art from `${base}enhanced-ai/_panel/`: all 16 colour variants plus
 * the slider handle, every one of which ships.
 *
 * It used to resolve null on any failure and let the caller keep the faithful panel —
 * "a partial download should fall back quietly". That is the shape the all-or-nothing
 * decision removed: the fallback is invisible, so an `ai` deploy missing its panel art
 * played as a subtly wrong game for the whole session with one console line to show for
 * it. Now it throws, and every one of these is a `requiredAsset`.
 */
export async function loadAiPanel(base: string): Promise<AiPanel> {
  {
    const dir = `${base}enhanced-ai/_panel/`;
    const man = await requiredJson<AiPanelManifest>(`${dir}ai.json`, 'the AI control panel', 'mustHave');
    const scale = Number(man.scale) || AI_PANEL_SCALE;
    const bmp = async (name: string): Promise<ImageBitmap> =>
      createImageBitmap(await requiredBlob(dir + name, 'the AI control panel', 'mustHave'));
    const images = await Promise.all(
      Array.from({ length: PANEL_IMAGES }, (_, i) => bmp(`img${String(i).padStart(2, '0')}.webp`)),
    );
    const cudl = await bmp('cudl.webp');
    return new AiPanel(images, cudl, scale);
  }
}

export class AiPanel {
  readonly scale: number;
  readonly width: number;
  readonly height: number;

  constructor(
    private readonly images: readonly ImageBitmap[],
    private readonly cudl: ImageBitmap,
    scale: number = AI_PANEL_SCALE,
  ) {
    this.scale = scale;
    this.width = PANEL_W * scale;
    this.height = PANEL_H * scale;
  }

  /** Copy a full-width row band [top..bottom] from one colour variant (Usek). */
  private band(ctx: CanvasRenderingContext2D, img: ImageBitmap, top: number, bottom: number): void {
    const S = this.scale;
    const y = top * S;
    const h = (bottom - top + 1) * S;
    ctx.drawImage(img, 0, y, PANEL_W * S, h, 0, y, PANEL_W * S, h);
  }

  /**
   * Copy a rectangle from one colour variant (Region). NOTE the source loop in hud.ts
   * runs `row <= top + height`, i.e. height+1 rows — reproduced here so the AI panel
   * matches the faithful one pixel for pixel rather than being "corrected".
   */
  private region(ctx: CanvasRenderingContext2D, img: ImageBitmap, [left, top, width, height]: readonly number[]): void {
    const S = this.scale;
    const x = left! * S, y = top! * S, w = width! * S, h = (height! + 1) * S;
    ctx.drawImage(img, x, y, w, h, x, y, w, h);
  }

  /** The 17x17 slider handle, centred at (x,y) in native coordinates (Cudlik). */
  private handle(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    const S = this.scale;
    ctx.drawImage(this.cudl, (x - 8) * S, (y - 8) * S, CUDL_SIZE * S, CUDL_SIZE * S);
  }

  /** VykresliPanel: the normal in-room panel. */
  drawPanel(ctx: CanvasRenderingContext2D, st: PanelState): void {
    ctx.clearRect(0, 0, this.width, this.height);
    for (const [key, top, bottom] of BANDS) {
      const idx = Math.min(Math.max(st[key], 0), PANEL_IMAGES - 1);
      const img = this.images[idx];
      if (img) this.band(ctx, img, top, bottom);
    }
    const reg = PRESSED_REGION[st.pressedDir];
    const lit = this.images[SVITICI];
    if (reg && lit) this.region(ctx, lit, reg);
  }

  /** KresliOptions: the options sub-panel. */
  drawOptions(ctx: CanvasRenderingContext2D, st: OptionsState): void {
    const S = this.scale;
    ctx.clearRect(0, 0, this.width, this.height);
    const base = this.images[OPTIONS_IMG];
    if (base) ctx.drawImage(base, 0, 0, this.width, this.height);
    const akt = this.images[OPTAKT_IMG];
    if (akt) this.region(ctx, akt, [SUBTITLE_HIGHLIGHT_X[st.subtitles], 250, 47, 33]);
    this.handle(ctx, 17 + 10 * clampSlider(st.volume.effect), HANDLE_Y.effect);
    this.handle(ctx, 17 + 10 * clampSlider(st.volume.voice), HANDLE_Y.voice);
    this.handle(ctx, 17 + 10 * clampSlider(st.volume.music), HANDLE_Y.music);
    if (st.helpActive && akt) this.region(ctx, akt, [18, 323, 76, 31]);
    // Scroll animation overlay (Pruhl) — the frame's key is already baked into alpha.
    if (st.scrollFrame >= SCROLL_MIN && st.scrollFrame <= SCROLL_MAX) {
      const f = this.images[st.scrollFrame];
      if (f) ctx.drawImage(f, 0, 0, PANEL_W * S, PANEL_H * S);
    }
  }
}

function clampSlider(i: number): number {
  return Math.max(0, Math.min(12, Math.floor(i)));
}
