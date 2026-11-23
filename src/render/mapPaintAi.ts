/**
 * Painting one frame of the `ai` world map: the hi-res map and its room balls, the record
 * panel's artwork, the name plaque, the native-resolution overlay (plaque, odometer
 * digits, the minigame) scaled up over it, the phone's enlarged panel, and the room-entry
 * parchment — in the original's order.
 *
 * Only the painting, and only through `Surface2D`. Deciding WHAT is on the map — which
 * panel is open, which plaque, whether a launch is running, whether anything changed since
 * the last paint — is the caller's: `src/app/mapDraw.ts` in the browser, the native map
 * screen natively. Everything that decision produces is handed in, so this module reaches
 * no page code at any import depth (test/dom-free.test.ts) and both hosts paint the same
 * picture from the same state.
 */
import { AI_MAP_H, AI_MAP_SCALE, AI_MAP_W, type AiWorldMap } from './worldMapAi.js';
import { blitDeska, type DeskyData } from '../data/desky.js';
import {
  applyInfoZoom,
  drawInfoDigits,
  drawInfoPanel,
  drawInfoPanelArtAi,
  type InfoButton,
  type InfoPanelAssets,
} from './mapInfo.js';
import { MAP_H, MAP_W, type MapAction, type WorldMap } from './worldMap.js';
import { createSurface, type Image2D, type Surface2D } from './surface2d.js';
import { nodeCenter } from './mapSelection.js';
import { aiPanelArt, drawZoomedInfoPanel } from './zoomedInfoPanel.js';

/** The open record panel: whose it is and what it shows. */
export interface MapPanel {
  readonly room: number;
  /** The best (nej) move count; null for a cheat-only room. */
  readonly count: number | null;
  readonly hover: InfoButton | null;
  /** The odometer roll frame. */
  readonly faze: number;
  readonly replayEnabled: boolean;
}

/** What the native-resolution overlay layer is drawn from. */
export interface MapOverlays {
  readonly worldMap: WorldMap;
  /** The room whose name plaque is shown (launching, panel, or hovered), if any. */
  readonly plaqueRoom: number | null;
  readonly desky: DeskyData | null;
  readonly assets: InfoPanelAssets | null;
  readonly panel: MapPanel | null;
  /** The cheat minigame's blit into a map-sized buffer, when it is up. */
  readonly minigame: ((rgba: Uint8ClampedArray) => void) | null;
}

/** Everything one `ai` map frame is painted from. */
export interface AiMapPaint extends MapOverlays {
  readonly map: AiWorldMap;
  readonly solved: ReadonlySet<number>;
  readonly cheated: ReadonlySet<number>;
  readonly pulse: number;
  readonly depth: number;
  readonly hoverCorner: MapAction | null;
  /** The map drawn fully unlit and without balls (an open panel, or a launch). */
  readonly unlit: boolean;
  /** The record panel's zoom (1 except on a phone). */
  readonly zoom: number;
  /** The upscaled name plaque and its map position, when it has loaded. */
  readonly aiPlaque: { readonly img: Image2D; readonly x: number; readonly y: number } | null;
  /** The map-sized surface the overlays are drawn into before being scaled up. */
  readonly layer: () => Surface2D;
  /** Draws the room-entry parchment, when a launch is running. */
  readonly parchment: ((target: Surface2D) => void) | null;
  /** The room node a controller has selected, ringed (`selectionRing`); none on the web. */
  readonly selectRoom?: number | null;
}

/**
 * Composite the record panel + name plaque onto a map-sized RGBA buffer (the faithful
 * path passes the base map; the AI path passes a transparent buffer to overlay). The
 * name plaque (KresliDesku, UMain.pas:1484) is drawn for the open panel's room or the
 * hovered room node; the record panel (krokoměr) is drawn when a room panel is open.
 * `aiDigitsOnly` (the AI path) draws only the panel's odometer digits, not its bg/icon
 * artwork — that is drawn straight on the hi-res surface from the AI bitmaps instead.
 * `skipPanel` leaves the record panel out entirely, and the minigame with it: the phone's
 * enlarged panel is drawn after this layer, by `drawZoomedInfoPanel`, and the minigame
 * after that, by `paintLateMinigame`.
 * Returns whether anything was drawn.
 */
export function composeMapOverlays(
  rgba: Uint8ClampedArray,
  o: MapOverlays,
  aiDigitsOnly = false,
  skipPlaque = false,
  skipPanel = false,
): boolean {
  let drew = false;
  if (o.plaqueRoom !== null && o.desky && !skipPlaque) {
    const deska = o.desky.byRoom.get(o.plaqueRoom);
    if (deska) {
      blitDeska(rgba, MAP_W, MAP_H, deska, o.desky.atlas, o.worldMap.palette);
      drew = true;
    }
  }
  if (o.panel && o.assets && !skipPanel) {
    if (aiDigitsOnly) {
      drawInfoDigits(rgba, MAP_W, MAP_H, o.assets.cisla, o.panel.count, o.panel.faze);
    } else {
      drawInfoPanel(rgba, MAP_W, MAP_H, o.assets, o.panel.count, o.panel.hover, o.panel.faze, o.panel.replayEnabled);
    }
    drew = true;
  }
  // The Tetris minigame overlays the map when the cheat opens it. It goes through
  // this shared overlay buffer so BOTH map paths get it — the AI path scales the
  // buffer up like the plaque/digits rather than needing its own hi-res blit.
  if (o.minigame && !skipPanel) {
    o.minigame(rgba);
    drew = true;
  }
  return drew;
}

/**
 * The minigame, over a panel that was drawn enlarged after the overlay layer it
 * normally rides (see `skipPanel`), so the layering stays plaque → panel → minigame.
 */
export function paintLateMinigame(
  target: Surface2D,
  layer: Surface2D,
  scale: number,
  minigame: ((rgba: Uint8ClampedArray) => void) | null,
): void {
  if (!minigame) return;
  const px = new Uint8ClampedArray(MAP_W * MAP_H * 4);
  minigame(px);
  layer.putPixels(px);
  target.setSmoothing(false);
  target.drawImage(layer, 0, 0, MAP_W * scale, MAP_H * scale);
}

/** Paint one `ai` map frame onto `target` (AI_MAP_W × AI_MAP_H). */
export function paintAiMap(target: Surface2D, p: AiMapPaint): void {
  const zoomed = p.zoom !== 1;
  // The phone's enlarged panel is drawn after the shared overlay layer, so the minigame
  // (modal over everything on the map) is drawn after it again (paintLateMinigame).
  const zoomedPanel = zoomed && p.panel !== null;
  // While the record panel is open the base map renders fully unlit (Delphi zeroes
  // RTable when InfoMode>0, UMain.pas:1446), hiding the lit paths + node artwork so
  // only the name plaque and panel stand out. Nodes (balls) are skipped too.
  // Hi-res AI base + nodes, then the record panel / name plaque overlaid at native
  // resolution and nearest-neighbour-scaled up (keeps digits + names crisp).
  p.map.draw(target, {
    solved: p.solved,
    pulse: p.pulse,
    depth: p.depth,
    cheated: p.cheated,
    hoverCorner: p.hoverCorner,
    drawNodes: !p.unlit,
    litRegions: !p.unlit,
  });
  // Record-panel *artwork* (krokoměr bg + hovered icon + disabled-Replay grey) is
  // drawn straight onto the hi-res surface from the AI-upscaled bitmaps; the odometer
  // digits + name plaque still ride the crisp NN overlay below so text stays sharp.
  // On a phone the same artwork is drawn enlarged, lifted off the map (zoomedInfoPanel.ts).
  if (p.panel && p.assets) {
    target.save();
    applyInfoZoom(target, AI_MAP_SCALE, p.zoom);
    const krokomer = zoomed ? aiPanelArt(p.map.krokomer, p.worldMap, p.assets) : p.map.krokomer;
    drawInfoPanelArtAi(target, AI_MAP_SCALE, krokomer, p.map.ikonky, p.panel.hover, p.panel.replayEnabled, zoomed);
    target.restore();
  }
  // Name plaque from the upscaled art, drawn straight on the hi-res surface. Falls back
  // to the native overlay below whenever its art is missing or still loading.
  if (p.aiPlaque) {
    target.setSmoothing(false);
    target.drawImage(p.aiPlaque.img, p.aiPlaque.x * AI_MAP_SCALE, p.aiPlaque.y * AI_MAP_SCALE);
  }
  const overlay = new Uint8ClampedArray(MAP_W * MAP_H * 4); // transparent; only drawn cells become opaque
  if (composeMapOverlays(overlay, p, true, p.aiPlaque !== null, zoomedPanel)) {
    const layer = p.layer();
    layer.putPixels(overlay);
    target.setSmoothing(false);
    target.drawImage(layer, 0, 0, AI_MAP_W, AI_MAP_H);
  }
  if (!p.unlit && p.selectRoom != null) paintSelectionRing(target, p.selectRoom);
  if (zoomedPanel) {
    const panel = p.panel!;
    drawZoomedInfoPanel(
      target, AI_MAP_SCALE, p.zoom, panel.count, panel.hover, panel.replayEnabled, true, panel.faze, p.worldMap, p.assets,
    );
    paintLateMinigame(target, p.layer(), AI_MAP_SCALE, p.minigame);
  }
  // Last, over the plaque: Delphi draws the plaque and then the parchment
  // (UMain.pas:1484 then :1489), and the two rectangles overlap.
  p.parchment?.(target);
}

/**
 * The ring round a controller-selected room node. A node has no hover art of its own —
 * the pointer's hover shows only the name plaque — so a controller needs something to see
 * where it is: the Xbox branch (#165) stroked a cyan arc there. This is that ring with
 * the same centre, radius and colour, but every pixel fully opaque or fully clear (with a
 * dark rim so it reads on the lit paths too): a soft stroke would be a different picture on
 * every backend, while a binary sprite is drawn the same, byte for byte, by any of them.
 */
const RING_RGB = [120, 230, 255] as const;
const RING_RIM_RGB = [8, 28, 36] as const;
const RING_R = 15; // map pixels, as #165
const RING_W = 2.5;
const RING_RIM = 0.75;

let ring: Surface2D | null = null;

/** The ring sprite at AI_MAP_SCALE: side `2 * half`, centred between its middle pixels. */
export function selectionRingPixels(): { rgba: Uint8ClampedArray<ArrayBuffer>; half: number } {
  const s = AI_MAP_SCALE;
  const outer = (RING_R + RING_W / 2 + RING_RIM) * s;
  const half = Math.ceil(outer) + 1;
  const n = half * 2;
  const rgba = new Uint8ClampedArray(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const off = Math.abs(Math.hypot(x + 0.5 - half, y + 0.5 - half) - RING_R * s);
      const c = off <= (RING_W / 2) * s ? RING_RGB : off <= (RING_W / 2 + RING_RIM) * s ? RING_RIM_RGB : null;
      if (!c) continue;
      const i = (y * n + x) * 4;
      rgba[i] = c[0];
      rgba[i + 1] = c[1];
      rgba[i + 2] = c[2];
      rgba[i + 3] = 255;
    }
  }
  return { rgba, half };
}

/** Draw the selection ring round `room`'s node (centre (x+0.5, y+0.5) in map space, as #165). */
export function paintSelectionRing(target: Surface2D, room: number): void {
  const { x, y } = nodeCenter(room);
  if (!ring) {
    const { rgba, half } = selectionRingPixels();
    ring = createSurface(half * 2, half * 2);
    ring.putPixels(rgba);
  }
  const half = ring.width / 2;
  target.setSmoothing(false);
  target.drawImage(ring, (x + 0.5) * AI_MAP_SCALE - half, (y + 0.5) * AI_MAP_SCALE - half);
}
