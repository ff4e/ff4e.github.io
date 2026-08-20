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
 */
import { MAP_W, MAP_H, type MapAction, type WorldMap } from './worldMap.js';
import { decodeAsset, requiredBlob } from './assetFetch.js';

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
    const blob = await requiredBlob(url, 'the AI world map');
    return decodeAsset(url, () => createImageBitmap(blob));
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
  private readonly base = makeCanvas(AI_MAP_W, AI_MAP_H);
  private readonly tmp = makeCanvas(AI_MAP_W, AI_MAP_H);
  private readonly maskNative = makeCanvas(MAP_W, MAP_H);
  private readonly maskImage: ImageData;
  /** Signature of the RTable the cached base was built for (rebuild only on change). */
  private baseSig: string | null = null;

  constructor(
    private readonly wm: WorldMap,
    private readonly mapa0: ImageBitmap,
    private readonly mapa1: ImageBitmap,
    private readonly nodes: readonly ImageBitmap[],
    /** AI record-panel background (krokoměr) + highlighted button icons (ikonky). */
    readonly krokomer: ImageBitmap,
    readonly ikonky: ImageBitmap,
    /** AI room-entry parchment (Menu/loading.BMP, blitted at 227,160 during a launch). */
    readonly loading: ImageBitmap,
  ) {
    this.maskImage = this.maskNative.ctx.createImageData(MAP_W, MAP_H);
  }

  /**
   * Composite the base + room-ball nodes for `state` onto `ctx` at (0,0), hi-res.
   * The base (the expensive per-region layer select) is cached and only rebuilt when
   * the lit-region table changes; nodes are cheap sprite blits redrawn every frame.
   */
  draw(ctx: CanvasRenderingContext2D, state: AiMapState): void {
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
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.base.canvas, 0, 0);
    if (state.drawNodes) {
      for (const nd of this.wm.nodeDrawList(state.solved, state.pulse, state.depth, state.cheated)) {
        ctx.drawImage(this.nodes[nd.sprite]!, nd.x0 * AI_MAP_SCALE, nd.y0 * AI_MAP_SCALE);
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
    const px = this.maskImage.data;
    for (let i = 0; i < MAP_W * MAP_H; i++) {
      px[i * 4 + 3] = rtable[mask[i]!] ? 255 : 0;
    }
    this.maskNative.ctx.putImageData(this.maskImage, 0, 0);

    // 2. base = mapa-0 (dark); then paint mapa-1 (lit) through the NN-scaled mask.
    const b = this.base.ctx;
    b.imageSmoothingEnabled = false;
    b.globalCompositeOperation = 'source-over';
    b.clearRect(0, 0, AI_MAP_W, AI_MAP_H);
    b.drawImage(this.mapa0, 0, 0, AI_MAP_W, AI_MAP_H);

    const t = this.tmp.ctx;
    t.imageSmoothingEnabled = false;
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, AI_MAP_W, AI_MAP_H);
    t.drawImage(this.mapa1, 0, 0, AI_MAP_W, AI_MAP_H);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.maskNative.canvas, 0, 0, AI_MAP_W, AI_MAP_H); // NN up-scale of the lit mask
    t.globalCompositeOperation = 'source-over';

    b.drawImage(this.tmp.canvas, 0, 0);
  }
}

interface Surface {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function makeCanvas(w: number, h: number): Surface {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  return { canvas, ctx };
}
