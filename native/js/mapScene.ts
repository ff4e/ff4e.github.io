/**
 * The world-map parity scene: a fixed set of map states, painted through the shared
 * `paintAiMap` (src/render/mapPaintAi.ts) onto a `Surface2D` — the browser's canvas in
 * native/reference.ts, the GPU natively — and diffed by native/compare-map.mjs.
 *
 * Each case says whether it can be byte-exact. Per the header of src/render/surface2d.ts:
 * nearest-neighbour draws, opaque blits and uploads and a binary destination-in mask can;
 * anything smoothed, a fractional alpha, or a partial-alpha upload is only close, because
 * the canvas filters and rounds in its own way.
 */
import { paintAiMap, type AiMapPaint } from '../../src/render/mapPaintAi.js';
import { AI_MAP_SCALE } from '../../src/render/worldMapAi.js';
import type { Surface2D } from '../../src/render/surface2d.js';
import { createSurface } from '../../src/render/surface2d.js';
import { MAP_H, MAP_W } from '../../src/render/worldMap.js';
import { loadAiPlaque, loadMapArt, type MapArt, type MapIo } from './mapArt.js';

type Plaque = AiMapPaint['aiPlaque'];

export interface MapScene {
  readonly art: MapArt;
  readonly plaques: ReadonlyMap<number, NonNullable<Plaque>>;
}

/** The rooms whose upscaled plaques the cases show. */
const PLAQUE_ROOMS = [1, 3, 4, 6];

export async function loadMapScene(io: MapIo): Promise<MapScene> {
  const art = await loadMapArt(io, 'en');
  const plaques = new Map<number, NonNullable<Plaque>>();
  for (const r of PLAQUE_ROOMS) {
    const p = await loadAiPlaque(io, art, r, 'en');
    if (p) plaques.set(r, p);
  }
  return { art, plaques };
}

/**
 * The room-entry parchment from the upscaled art.
 * restates src/app/roomLaunch.ts `export function blitParchmentAi(` @ 04f242c00cfa
 */
export function paintParchmentAi(target: Surface2D, art: MapArt): void {
  target.setSmoothing(false);
  target.drawImage(art.ai.loading, 227 * AI_MAP_SCALE, 160 * AI_MAP_SCALE);
}

interface MapCase {
  readonly name: string;
  /** Can a GPU match the canvas byte for byte here? (See the header.) */
  readonly exact: boolean;
  /** What the case exercises, for the report. */
  readonly what: string;
  readonly state: (s: MapScene) => Partial<AiMapPaint>;
}

const solvedTo = (n: number): Set<number> => new Set(Array.from({ length: n }, (_, i) => i + 1));

export const MAP_CASES: readonly MapCase[] = [
  { name: 'fresh', exact: true, what: 'base map (binary lit mask), reachable balls', state: () => ({}) },
  {
    name: 'progress', exact: true, what: 'lit paths, solved/cheat/pulsing balls, corner hover, AI plaque, selection ring',
    state: (s) => ({
      solved: solvedTo(10), cheated: new Set([12]), pulse: 3, hoverCorner: 'credits',
      plaqueRoom: 4, aiPlaque: s.plaques.get(4) ?? null, selectRoom: 4,
    }),
  },
  {
    name: 'native-plaque', exact: true, what: 'the 640×480 overlay (a plaque with no upscale) scaled ×4 nearest',
    state: () => ({ solved: solvedTo(6), pulse: 1, plaqueRoom: 5, aiPlaque: null, selectRoom: 5 }),
  },
  {
    name: 'panel', exact: true, what: 'unlit map, record panel art, hovered Run, odometer digits, AI plaque',
    state: (s) => ({
      solved: solvedTo(6), unlit: true, plaqueRoom: 1, aiPlaque: s.plaques.get(1) ?? null, selectRoom: 1,
      panel: { room: 1, count: 1234, hover: 'run', faze: 27, replayEnabled: true },
    }),
  },
  {
    name: 'panel-rolling', exact: true, what: 'the odometer mid-roll, hovered Replay',
    state: (s) => ({
      solved: solvedTo(6), unlit: true, plaqueRoom: 1, aiPlaque: s.plaques.get(1) ?? null,
      panel: { room: 1, count: 98765, hover: 'replay', faze: 9, replayEnabled: true },
    }),
  },
  {
    name: 'launch', exact: true, what: 'a launch: unlit, plaque, parchment',
    state: (s) => ({
      solved: solvedTo(6), unlit: true, plaqueRoom: 6, aiPlaque: s.plaques.get(6) ?? null,
      parchment: (t) => paintParchmentAi(t, s.art),
    }),
  },
  {
    name: 'panel-noreplay', exact: false, what: 'disabled Replay: a 0.55-alpha black wash',
    state: (s) => ({
      solved: solvedTo(6), unlit: true, plaqueRoom: 3, aiPlaque: s.plaques.get(3) ?? null,
      panel: { room: 3, count: 42, hover: 'cancel', faze: 27, replayEnabled: false },
    }),
  },
  {
    name: 'panel-zoomed', exact: false, what: "the phone's enlarged panel: smoothed mask, partial-alpha shadow, fractional scale",
    state: (s) => ({
      solved: solvedTo(6), unlit: true, zoom: 1.5, plaqueRoom: 1, aiPlaque: s.plaques.get(1) ?? null,
      panel: { room: 1, count: 1234, hover: 'run', faze: 27, replayEnabled: true },
    }),
  },
];

let layer: Surface2D | null = null;

/** Paint case `name` onto `target` (AI_MAP_W × AI_MAP_H). */
export function paintMapCase(target: Surface2D, scene: MapScene, name: string): void {
  const c = MAP_CASES.find((m) => m.name === name);
  if (!c) throw new Error(`no map case ${name}`);
  const { art } = scene;
  paintAiMap(target, {
    map: art.ai,
    worldMap: art.worldMap,
    solved: new Set(),
    cheated: new Set(),
    pulse: 0,
    depth: Number.MAX_SAFE_INTEGER,
    hoverCorner: null,
    unlit: false,
    zoom: 1,
    plaqueRoom: null,
    aiPlaque: null,
    desky: art.desky,
    assets: art.assets,
    panel: null,
    minigame: null,
    layer: () => (layer ??= createSurface(MAP_W, MAP_H)),
    parchment: null,
    selectRoom: null,
    ...c.state(scene),
  });
}
