/**
 * Drawing the record panel (krokoměr) enlarged — see INFO_PHONE_ZOOM in `mapInfo.ts` for
 * why, and `infoPanelCutout` there for how the panel is lifted off the map so it can be
 * scaled at all.
 *
 * Only the drawing, and only through `Surface2D`: what it needs of the game (the world map,
 * the panel's art, the odometer frame) is handed in, so a host without a DOM can draw the
 * same panel. Whether the panel is zoomed at all, and the pointer's hit test against it,
 * are the page's (`src/app/mapInfoZoom.ts`).
 */
import {
  PANEL_H,
  PANEL_W,
  PANEL_X,
  PANEL_Y,
  applyInfoZoom,
  drawInfoDigits,
  drawInfoPanel,
  infoPanelCutout,
  type InfoButton,
  type InfoPanelAssets,
} from './mapInfo.js';
import { MAP_H, MAP_W, type WorldMap } from './worldMap.js';
import { createSurface, type Image2D, type Surface2D } from './surface2d.js';

/** The cutout, computed once: both of its inputs are fixed for the session. */
let cutout: Uint8ClampedArray | null = null;
function panelCutout(worldMap: WorldMap | null, assets: InfoPanelAssets | null): Uint8ClampedArray | null {
  if (!cutout && worldMap && assets) {
    // The unlit map, exactly as it is drawn under an open panel (litRegions=false).
    const unlit = worldMap.render(new Set(), 0, Number.MAX_SAFE_INTEGER, new Set(), null, false, false);
    cutout = infoPanelCutout(assets.krokomer, unlit, MAP_W);
  }
  return cutout;
}

let infoLayer: Surface2D | null = null;
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
  target: Surface2D,
  scale: number,
  zoom: number,
  count: number | null,
  hover: InfoButton | null,
  replayEnabled: boolean,
  digitsOnly: boolean,
  faze: number,
  worldMap: WorldMap | null,
  assets: InfoPanelAssets | null,
): void {
  if (!assets) return;
  infoPixels ??= new Uint8ClampedArray(MAP_W * MAP_H * 4);
  const layer = infoPixels;
  layer.fill(0);
  if (digitsOnly) {
    drawInfoDigits(layer, MAP_W, MAP_H, assets.cisla, count, faze);
  } else {
    drawInfoPanel(layer, MAP_W, MAP_H, assets, count, hover, faze, replayEnabled);
    const cut = panelCutout(worldMap, assets);
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
  infoLayer ??= createSurface(MAP_W, MAP_H);
  infoLayer.putPixels(layer);
  target.save();
  target.setSmoothing(false);
  applyInfoZoom(target, scale, zoom);
  target.drawImage(infoLayer, 0, 0, MAP_W * scale, MAP_H * scale);
  target.restore();
}

let aiArt: { source: Image2D; art: Surface2D } | null = null;

/**
 * The AI-upscaled krokomer with the same cutout applied, for drawing enlarged: the
 * device from the hi-res bitmap, masked by the cutout scaled up smoothly (a soft edge
 * rather than 4×4 steps), over the cutout's shadow. Same size as `krokomer`, so it is a
 * drop-in source for `drawInfoPanelArtAi`. Built once per bitmap.
 */
export function aiPanelArt(krokomer: Image2D, worldMap: WorldMap | null, assets: InfoPanelAssets | null): Image2D {
  const cut = panelCutout(worldMap, assets);
  if (!cut) return krokomer;
  if (aiArt?.source === krokomer) return aiArt.art;
  const w = krokomer.width;
  const h = krokomer.height;
  const device = createSurface(PANEL_W, PANEL_H);
  const mask = new Uint8ClampedArray(PANEL_W * PANEL_H * 4);
  for (let i = 3; i < mask.length; i += 4) mask[i] = cut[i] === 255 ? 255 : 0;
  device.putPixels(mask);
  const art = createSurface(w, h);
  art.drawImage(krokomer, 0, 0);
  art.setBlend('destination-in');
  art.drawImage(device, 0, 0, w, h);
  const out = createSurface(w, h);
  // Under the device the backdrop is black, not the device's own native pixels: those
  // would bleed out past the soft mask edge as a blurred low-res rim, where black only
  // deepens the outline the artwork already has.
  const shadow = new Uint8ClampedArray(cut);
  for (let i = 3; i < shadow.length; i += 4) {
    if (shadow[i] === 255) shadow[i - 3] = shadow[i - 2] = shadow[i - 1] = 0;
  }
  const small = createSurface(PANEL_W, PANEL_H);
  small.putPixels(shadow);
  out.drawImage(small, 0, 0, w, h);
  out.drawImage(art, 0, 0);
  aiArt = { source: krokomer, art: out };
  return out;
}
