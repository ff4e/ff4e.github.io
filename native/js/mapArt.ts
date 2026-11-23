/**
 * The `ai` world map's art, loaded through an injected reader so the native host and the
 * browser reference (native/compare-map.mjs) build the very same `AiWorldMap` from the very
 * same files: `io.image` is `__native.decodeImage` natively and `createImageBitmap` in the
 * browser, and everything else here is shared.
 *
 * The browser loads these pieces in four places — boot.ts (the 640×480 map and the panel
 * BMPs), art.ts → worldMapAi.ts `loadAiWorldMap` (the upscaled layers), mapDraw.ts
 * (`ensureDeskyData`, `aiPlaqueFor`) — each tangled with the page's asset tiers and its
 * loading screen. What is restated here is only which files, and how they are put together.
 */
import { parseBmp } from '../../src/data/bmp.js';
import { DESKA_X_OFFSET, DESKA_Y_OFFSET, parseDesky, type DeskyData } from '../../src/data/desky.js';
import type { InfoPanelAssets } from '../../src/render/mapInfo.js';
import type { Image2D, Surface2D } from '../../src/render/surface2d.js';
import { WorldMap } from '../../src/render/worldMap.js';
import { AI_MAP_SCALE, AiWorldMap } from '../../src/render/worldMapAi.js';

export interface MapIo {
  bytes(url: string): Promise<Uint8Array>;
  image(url: string): Promise<Image2D>;
}

export interface MapArt {
  readonly worldMap: WorldMap;
  readonly ai: AiWorldMap;
  readonly assets: InfoPanelAssets;
  desky: DeskyData;
  /** The upscaled plaques' placement, by file name (`en01.png`…). */
  readonly plaques: Record<string, { room: number; x: number; y: number }>;
}

/** The plaque language — the subtitle language (`subLang`). */
export type PlaqueLang = 'cz' | 'en';

export async function loadMapArt(io: MapIo, lang: PlaqueLang): Promise<MapArt> {
  const bmp = async (f: string) => parseBmp(await io.bytes(`/data/Menu/${f}`));
  // restates src/app/boot.ts `const files = ['mapa-0.BMP',` @ 987c0a24121a
  const files = ['mapa-0.BMP', 'mapa-1.BMP', 'maska.BMP', 'n0.BMP', 'n1.BMP', 'n2.BMP', 'n3.BMP', 'n4.BMP'];
  const bmps = await Promise.all(files.map(bmp));
  const worldMap = new WorldMap(bmps[0]!, bmps[1]!, bmps[2]!, bmps.slice(3));
  const [krokomer, ikonky, cisla] = await Promise.all(['krokomer.BMP', 'ikonky.BMP', 'cisla.BMP'].map(bmp));
  const desky = await loadDesky(io, lang);
  // restates src/render/worldMapAi.ts `export async function loadAiWorldMap(` @ 146803054ba3
  const ai = await Promise.all(
    ['mapa-0_ai.webp', 'mapa-1_ai.webp', 'krokomer_ai.webp', 'ikonky_ai.webp', 'loading_ai.webp',
      'n0_ai.png', 'n1_ai.png', 'n2_ai.png', 'n3_ai.png', 'n4_ai.png'].map((f) => io.image(`/data/Menu/${f}`)),
  );
  const [mapa0, mapa1, aiKrokomer, aiIkonky, loading, ...nodes] = ai;
  const geom = JSON.parse(new TextDecoder().decode(await io.bytes('/enhanced-ai/_desky/plaques.json'))) as {
    plaques: MapArt['plaques'];
  };
  return {
    worldMap,
    ai: new AiWorldMap(worldMap, mapa0!, mapa1!, nodes, aiKrokomer!, aiIkonky!, loading!),
    assets: { krokomer: krokomer!, ikonky: ikonky!, cisla: cisla! },
    desky,
    plaques: geom.plaques,
  };
}

/**
 * The room-name plaque data for a language: popdesk<n>.dat + desky<n>.dat, n = 1 (cz) / 2 (en).
 * restates src/app/mapDraw.ts `export async function ensureDeskyData(` @ ccf4dff4d819
 */
export async function loadDesky(io: MapIo, lang: PlaqueLang): Promise<DeskyData> {
  const n = lang === 'cz' ? '1' : '2';
  return parseDesky(await io.bytes(`/data/Menu/popdesk${n}.dat`), await io.bytes(`/data/Menu/desky${n}.dat`));
}

/**
 * The upscaled name plaque for `room` and where it goes on the map, or null when there is
 * none. The browser fetches these on hover and keeps a dozen; a native host reads files.
 * restates src/app/mapDraw.ts `export function aiPlaqueFor(` @ eac8f262427e
 */
export async function loadAiPlaque(
  io: MapIo,
  art: MapArt,
  room: number,
  lang: PlaqueLang,
): Promise<{ img: Image2D; x: number; y: number } | null> {
  const key = `${lang}${String(room).padStart(2, '0')}.png`;
  const g = art.plaques[key];
  if (!g) return null;
  const img = await io.image(`/enhanced-ai/_desky/${key.replace(/\.png$/, '.webp')}`);
  return { img, x: g.x + DESKA_X_OFFSET, y: g.y + DESKA_Y_OFFSET };
}

/**
 * The room-entry parchment from the upscaled art.
 * restates src/app/roomLaunch.ts `export function blitParchmentAi(` @ 04f242c00cfa
 */
export function paintParchmentAi(target: Surface2D, art: MapArt): void {
  target.setSmoothing(false);
  target.drawImage(art.ai.loading, 227 * AI_MAP_SCALE, 160 * AI_MAP_SCALE);
}
