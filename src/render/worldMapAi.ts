/**
 * Hi-res AI world-map compositor (Phase B of the `ai` graphics tier).
 *
 * The world map is a runtime palette composite (`dest = mask ? mapa-1 : mapa-0`
 * with room-ball sprites on top — see WorldMap). This re-runs that exact
 * compositing at 4x from AI-upscaled art (tools/build-map-ai.mjs):
 *   - mapa-0_ai.webp / mapa-1_ai.webp — the two base layers (opaque, 2560x1920)
 *   - n0_ai.png .. n4_ai.png          — the room-ball sprites (RGBA, baked alpha)
 *   - loading_ai.webp                 — the room-entry parchment (opaque, 768x644)
 * The branch/corner MASK stays index-exact: the native 640x480 mask is nearest-
 * neighbour-scaled x4 to select lit vs dark regions, so the reveal/lighting and the
 * corner buttons behave byte-for-byte like the faithful path. All game logic (which
 * regions light, which nodes draw + their pulse frame) is delegated to the same
 * WorldMap.computeRtable / nodeDrawList used by the CPU composite, so the AI map is
 * purely a higher-resolution rendering of the identical state.
 *
 * The record panel + name plaques (digits/text) are NOT drawn here — the caller
 * overlays them nearest-neighbour-scaled so numerals and names stay crisp.
 *
 * This is only used when `graphics === 'ai'` AND every AI asset loaded; otherwise
 * the map falls back to the faithful CPU composite. classic/enhanced never touch it.
 *
 * It draws through `Surface2D` (surface2d.ts) and builds its caches with
 * `createSurface`, so a host without a DOM can composite the same map; only
 * `loadAiWorldMap` is the browser's (it decodes with `createImageBitmap`).
 */
import { MAP_W, MAP_H, type MapAction, type WorldMap } from './worldMap.js';
import { decodeAsset, requiredBlob } from './assetFetch.js';
import { createSurface, type Image2D, type Surface2D } from './surface2d.js';

/** Upscale factor of the committed AI art (must match tools/build-map-ai.mjs AI_SCALE). */
export const AI_MAP_SCALE = 4;
export const AI_MAP_W = MAP_W * AI_MAP_SCALE;
export const AI_MAP_H = MAP_H * AI_MAP_SCALE;

const NODE_FILES = ['n0_ai.png', 'n1_ai.png', 'n2_ai.png', 'n3_ai.png', 'n4_ai.png'] as const;
export interface AiMapState {
  solved: ReadonlySet<number>;
  pulse: number;
  depth: number;
  cheated: ReadonlySet<number>;
  hoverCorner: MapAction | null;
  drawNodes: boolean;
  litRegions: boolean;
}

/**
 * Load the AI world-map art from `${base}Menu/` — the two map layers, the odometer, the
 * icons, the parchment and the five node sprites, every one of which ships.
 *
 * It used to resolve null when any of them was missing and let the caller present the
 * 1998 map instead. That fallback was invisible: the `ai` setting stayed on, the map was
 * simply the wrong one, and the only symptom was art quietly a tier below what the
 * player asked for. Now it throws for both kinds of failure, and the caller asks the
 * player.
 */
export async function loadAiWorldMap(base: string, wm: WorldMap): Promise<AiWorldMap> {
  const load = async (file: string): Promise<ImageBitmap> => {
    const url = `${base}Menu/${file}`;
    const blob = await requiredBlob(url, 'the AI world map', 'mustHave');
    return decodeAsset(url, 'mustHave', () => createImageBitmap(blob));
  };
  const [mapa0, mapa1, krokomer, ikonky, loading, ...nodes] = await Promise.all([
    load('mapa-0_ai.webp'),
    load('mapa-1_ai.webp'),
    load('krokomer_ai.webp'),
    load('ikonky_ai.webp'),
    load('loading_ai.webp'),
    ...NODE_FILES.map(load),
  ]);
  return new AiWorldMap(wm, mapa0!, mapa1!, nodes, krokomer!, ikonky!, loading!);
}

export class AiWorldMap {
  private readonly base = createSurface(AI_MAP_W, AI_MAP_H);
  private readonly tmp = createSurface(AI_MAP_W, AI_MAP_H);
  private readonly maskNative = createSurface(MAP_W, MAP_H);
  /** The native mask's pixels: RGB stays 0, only alpha is written. */
  private readonly maskImage = new Uint8ClampedArray(MAP_W * MAP_H * 4);
  /** Signature of the RTable the cached base was built for (rebuild only on change). */
  private baseSig: string | null = null;

  constructor(
    private readonly wm: WorldMap,
    private readonly mapa0: Image2D,
    private readonly mapa1: Image2D,
    private readonly nodes: readonly Image2D[],
    /** AI record-panel background (krokoměr) + highlighted button icons (ikonky). */
    readonly krokomer: Image2D,
    readonly ikonky: Image2D,
    /** AI room-entry parchment (Menu/loading.BMP, blitted at 227,160 during a launch). */
    readonly loading: Image2D,
  ) {}

  /**
   * Composite the base + room-ball nodes for `state` onto `target` at (0,0), hi-res.
   * The base (the expensive per-region layer select) is cached and only rebuilt when
   * the lit-region table changes; nodes are cheap sprite blits redrawn every frame.
   */
  draw(target: Surface2D, state: AiMapState): void {
    const rtable = this.wm.computeRtable(
      state.solved,
      state.depth,
      state.cheated,
      state.hoverCorner,
      state.litRegions,
    );
    const sig = rtable.join(',');
    if (sig !== this.baseSig) {
      this.rebuildBase(rtable);
      this.baseSig = sig;
    }
    target.setSmoothing(false);
    target.drawImage(this.base, 0, 0);
    if (state.drawNodes) {
      for (const nd of this.wm.nodeDrawList(state.solved, state.pulse, state.depth, state.cheated)) {
        target.drawImage(this.nodes[nd.sprite]!, nd.x0 * AI_MAP_SCALE, nd.y0 * AI_MAP_SCALE);
      }
    }
  }

  /**
   * Rebuild the cached hi-res base = `rtable[mask] ? mapa-1 : mapa-0`. The lit mask
   * is built at native resolution (cheap) then nearest-neighbour-scaled x4, so the
   * region selection stays index-exact while the layer art is the AI upscale.
   */
  private rebuildBase(rtable: Uint8Array): void {
    // 1. Native lit-region alpha mask: opaque where this pixel's branch/corner is lit.
    const mask = this.wm.maskPixels;
    const px = this.maskImage;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      px[i * 4 + 3] = rtable[mask[i]!] ? 255 : 0;
    }
    this.maskNative.putPixels(this.maskImage);

    // 2. base = mapa-0 (dark); then paint mapa-1 (lit) through the NN-scaled mask.
    const b = this.base;
    b.setSmoothing(false);
    b.setBlend('source-over');
    b.clear();
    b.drawImage(this.mapa0, 0, 0, AI_MAP_W, AI_MAP_H);

    const t = this.tmp;
    t.setSmoothing(false);
    t.setBlend('source-over');
    t.clear();
    t.drawImage(this.mapa1, 0, 0, AI_MAP_W, AI_MAP_H);
    t.setBlend('destination-in');
    t.drawImage(this.maskNative, 0, 0, AI_MAP_W, AI_MAP_H); // NN up-scale of the lit mask
    t.setBlend('source-over');

    b.drawImage(this.tmp, 0, 0);
  }
}
