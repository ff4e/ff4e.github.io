/**
 * The record panel (krokoměr) enlarged on a phone — see INFO_PHONE_ZOOM in
 * `render/mapInfo.ts` for why, and `infoPanelCutout` there for how the panel is lifted
 * off the map so it can be scaled at all.
 *
 * The faithful 1:1 panel is still `mapDraw.ts`'s; this module only takes over when the
 * zoom is not 1, and its hit test is the one the pointer routers use either way, so the
 * buttons are hit where they are drawn.
 */
import {
  INFO_PHONE_ZOOM,
  PANEL_H,
  PANEL_W,
  PANEL_X,
  PANEL_Y,
  applyInfoZoom,
  drawInfoDigits,
  drawInfoPanel,
  hitInfoButton,
  infoPanelCutout,
  type InfoButton,
} from '../render/mapInfo.js';
import { MAP_H, MAP_W } from '../render/worldMap.js';
import { ctx } from './dom.js';
import { phoneUi } from './touchButtons.js';
import { ui } from './screenState.js';

/** How big the record panel is drawn: enlarged on a phone, the original's 1:1 elsewhere. */
export function infoPanelZoom(): number {
  return phoneUi() ? INFO_PHONE_ZOOM : 1;
}

/** The panel button under map coordinate (mx,my), on the panel as it is drawn now. */
export function hitZoomedInfoButton(mx: number, my: number): InfoButton | null {
  return hitInfoButton(mx, my, infoPanelZoom());
}

/** The cutout, computed once: both of its inputs are fixed for the session. */
let cutout: Uint8ClampedArray | null = null;
function panelCutout(): Uint8ClampedArray | null {
  if (!cutout && ui.worldMap && ui.infoPanelAssets) {
    // The unlit map, exactly as it is drawn under an open panel (litRegions=false).
    const unlit = ui.worldMap.render(new Set(), 0, Number.MAX_SAFE_INTEGER, new Set(), null, false, false);
    cutout = infoPanelCutout(ui.infoPanelAssets.krokomer, unlit, MAP_W);
  }
  return cutout;
}

/** A canvas of `w×h`, with its context. */
function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d')! };
}

let infoLayer: ReturnType<typeof makeCanvas> | null = null;
/** The layer's pixels, reused: the panel repaints every frame of its ~2.7 s digit roll. */
let infoPixels: Uint8ClampedArray<ArrayBuffer> | null = null;

/**
 * The enlarged panel on the faithful (640×480) map, or — `digitsOnly` — just its
 * odometer digits over the AI map, whose artwork `aiPanelArt` supplies. Composited
 * exactly as the 1:1 panel, with the same blits at the original's map coordinates, into
 * a transparent map-sized layer; the cutout then clears what is only map, and the layer
 * is drawn scaled about the panel's centre, nearest-neighbour so the numerals stay crisp.
 */
export function drawZoomedInfoPanel(
  scale: number,
  zoom: number,
  count: number | null,
  hover: InfoButton | null,
  replayEnabled: boolean,
  digitsOnly: boolean,
): void {
  const assets = ui.infoPanelAssets;
  if (!assets) return;
  infoPixels ??= new Uint8ClampedArray(MAP_W * MAP_H * 4);
  const layer = infoPixels;
  layer.fill(0);
  if (digitsOnly) {
    drawInfoDigits(layer, MAP_W, MAP_H, assets.cisla, count, ui.mapInfoFaze);
  } else {
    drawInfoPanel(layer, MAP_W, MAP_H, assets, count, hover, ui.mapInfoFaze, replayEnabled);
    const cut = panelCutout();
    // Icons and digits sit wholly inside the device, where the cutout is opaque, so
    // only the baked-in map around it is replaced.
    if (cut) {
      for (let y = 0; y < PANEL_H; y++) {
        for (let x = 0; x < PANEL_W; x++) {
          const s = (y * PANEL_W + x) * 4;
          if (cut[s + 3] === 255) continue;
          const d = ((PANEL_Y + y) * MAP_W + PANEL_X + x) * 4;
          layer[d] = cut[s]!;
          layer[d + 1] = cut[s + 1]!;
          layer[d + 2] = cut[s + 2]!;
          layer[d + 3] = cut[s + 3]!;
        }
      }
    }
  }
  infoLayer ??= makeCanvas(MAP_W, MAP_H);
  infoLayer.ctx.putImageData(new ImageData(layer, MAP_W, MAP_H), 0, 0);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  applyInfoZoom(ctx, scale, zoom);
  ctx.drawImage(infoLayer.canvas, 0, 0, MAP_W * scale, MAP_H * scale);
  ctx.restore();
}

let aiArt: { source: ImageBitmap; canvas: HTMLCanvasElement } | null = null;

/**
 * The AI-upscaled krokomer with the same cutout applied, for drawing enlarged: the
 * device from the hi-res bitmap, masked by the cutout scaled up smoothly (a soft edge
 * rather than 4×4 steps), over the cutout's shadow. Same size as `krokomer`, so it is a
 * drop-in source for `drawInfoPanelArtAi`. Built once per bitmap.
 */
export function aiPanelArt(krokomer: ImageBitmap): CanvasImageSource {
  const cut = panelCutout();
  if (!cut) return krokomer;
  if (aiArt?.source === krokomer) return aiArt.canvas;
  const w = krokomer.width;
  const h = krokomer.height;
  const device = makeCanvas(PANEL_W, PANEL_H);
  const mask = new Uint8ClampedArray(PANEL_W * PANEL_H * 4);
  for (let i = 3; i < mask.length; i += 4) mask[i] = cut[i] === 255 ? 255 : 0;
  device.ctx.putImageData(new ImageData(mask, PANEL_W, PANEL_H), 0, 0);
  const art = makeCanvas(w, h);
  art.ctx.drawImage(krokomer, 0, 0);
  art.ctx.globalCompositeOperation = 'destination-in';
  art.ctx.drawImage(device.canvas, 0, 0, w, h);
  const out = makeCanvas(w, h);
  // Under the device the backdrop is black, not the device's own native pixels: those
  // would bleed out past the soft mask edge as a blurred low-res rim, where black only
  // deepens the outline the artwork already has.
  const shadow = new Uint8ClampedArray(cut);
  for (let i = 3; i < shadow.length; i += 4) {
    if (shadow[i] === 255) shadow[i - 3] = shadow[i - 2] = shadow[i - 1] = 0;
  }
  const small = makeCanvas(PANEL_W, PANEL_H);
  small.ctx.putImageData(new ImageData(shadow, PANEL_W, PANEL_H), 0, 0);
  out.ctx.drawImage(small.canvas, 0, 0, w, h);
  out.ctx.drawImage(art.canvas, 0, 0);
  aiArt = { source: krokomer, canvas: out.canvas };
  return out.canvas;
}
