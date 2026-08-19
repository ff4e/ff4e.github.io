/**
 * Drawing the world map: the branch map itself, the room-name plaques, and the record
 * panel (krokoměr) that opens on an already-solved room.
 *
 * Only the DRAWING. Deciding to go somewhere — entering a room, leaving one, the story
 * pages, the credits roll — is `main.ts`'s map navigation, which calls in here. The split
 * is why this needs four names and not fourteen: everything it asks about is the player's
 * RECORD (solved, cheated, best move count, best solution), never what the game is doing
 * right now.
 */
import { AI_MAP_H, AI_MAP_SCALE, AI_MAP_W } from '../render/worldMapAi.js';
import { assetBlob, assetBytes, assetJson, requiredAsset } from '../render/assetFetch.js';
import { DESKA_X_OFFSET, DESKA_Y_OFFSET, blitDeska, parseDesky } from '../data/desky.js';
import { INFO_SETTLE_FAZE, drawInfoDigits, drawInfoPanel, drawInfoPanelArtAi } from '../render/mapInfo.js';
import { MAP_H, MAP_W } from '../render/worldMap.js';
import { aiWorldMap, mapPresented, setMapPresented } from './art.js';
import { blitParchment, blitParchmentAi, mapLaunching, markParchmentPainted } from './roomLaunch.js';
import { blitTetris, tetris, tetrisArt, tetrisTick } from './cheats.js';
import { canvas, ctx } from './dom.js';
import { contentScaleFor, scalingFilterFor } from './stageGeometry.js';
import { graphics } from './renderSettings.js';
import { perfPaint, setPerfPaint } from './framePacing.js';
import { subLang } from './playerSettings.js';
import { ui } from './screenState.js';
import { wake } from './frameClock.js';

/**
 * The four names this module needs from `main.ts` — all of them the persisted record the
 * map is a view of.
 */
export interface MapDrawHost {
  readonly bestRecord: (room: number) => string | undefined;
  readonly cheated: ReadonlySet<number>;
  readonly scores: ReadonlyMap<number, number>;
  readonly solved: ReadonlySet<number>;
}

let host!: MapDrawHost;

/** Hand this module its view of the game. Called once, from `main.ts`, during boot. */
export function initMapDraw(h: MapDrawHost): void {
  host = h;
}

export async function ensureDeskyData(): Promise<void> {
  const lang = subLang();
  if (ui.deskyLang === lang && ui.deskyData) return;
  const n = lang === 'cz' ? '1' : '2';
  const popdeskUrl = `/data/Menu/popdesk${n}.dat`;
  const atlasUrl = `/data/Menu/desky${n}.dat`;
  const [popdesk, atlas] = await Promise.all([
    requiredAsset(popdeskUrl, 'the map name plaques').then((r) => assetBytes(popdeskUrl, r)),
    requiredAsset(atlasUrl, 'the map name plaques').then((r) => assetBytes(atlasUrl, r)),
  ]);
  ui.deskyData = parseDesky(popdesk, atlas);
  ui.deskyLang = lang;
}

/** Open the record info panel for a solved/cheated room (daInfo, UMain.pas:1008). */
export function openMapInfo(roomNum: number): void {
  ui.mapInfoRoom = roomNum;
  ui.mapInfoHover = null;
  ui.mapInfoFaze = 0; // InfoFaze := 0 — restart the odometer roll
  ui.mapInfoOpenAt = performance.now();
  ui.mapSig = null; // force a repaint (the panel is new)
  void ensureDeskyData(); // in case the language changed since boot
  wake();
}

/** Close the record info panel (daCancel, UMain.pas:1018). */
export function closeMapInfo(): void {
  if (ui.mapInfoRoom === null) return;
  ui.mapInfoRoom = null;
  ui.mapInfoHover = null;
  ui.mapSig = null;
  wake();
}

/** Render the world-map screen to the main canvas. */
export function drawMap(): void {
  if (!ui.worldMap) return;
  // Advance the reachable-node pulse ~every 140ms (kPul cadence, UMain.pas timer).
  const pulse = Math.floor(performance.now() / 140);
  // The reveal is wall-clock driven, so the `ai` tier's art hold would have traced it
  // out behind the loading overlay and handed the player a map that never animated.
  // Start it on the frame that actually reaches them — which is this one, since the
  // hold withholds this call entirely. Gated on arrival: switching tier over a map that
  // is already up must not re-trace a reveal the player has watched once already.
  if (!mapPresented) ui.mapRevealStart = performance.now();
  // The reveal (Depth, UMain.pas): from -3, +1 per ~60ms, tracing the map in from
  // the start; once it passes the deepest room the whole enabled map is shown.
  const depth = Math.floor((performance.now() - ui.mapRevealStart) / 60) - 3;
  const cs = contentScaleFor(MAP_W, MAP_H);
  // The `ai` graphics level draws the map from AI-upscaled art re-composited at 4x,
  // so the backing store is 4x larger (still CSS-scaled to the same display box).
  // Reaching here at all means the art for this tier is ready: loop() withholds the
  // draw while mapArtHolding(), so the map is only ever presented in its final art.
  const useAi = graphics === 'ai' && aiWorldMap !== null;
  const cw = useAi ? AI_MAP_W : MAP_W;
  const ch = useAi ? AI_MAP_H : MAP_H;
  if (canvas.width !== cw || canvas.height !== ch) {
    canvas.width = cw;
    canvas.height = ch;
    ui.mapSig = null; // backing store was cleared by the resize — force a repaint
  }
  const cssW = `${MAP_W * cs}px`;
  const cssH = `${MAP_H * cs}px`;
  if (canvas.style.width !== cssW) canvas.style.width = cssW;
  if (canvas.style.height !== cssH) canvas.style.height = cssH;
  // #screen is shared with the room, which sets its own filter — set ours explicitly
  // rather than inheriting whatever the last room left behind (an AI room left 'auto',
  // which blurred a FALLBACK map; a fresh boot straight to the map left 'pixelated',
  // which aliased the AI one).
  const mFilter = scalingFilterFor(cw, Math.round(MAP_W * cs));
  if (canvas.style.imageRendering !== mFilter) canvas.style.imageRendering = mFilter;
  // The 640×480 palette conversion + node compositing is the map's whole cost, and
  // it only changes when its inputs do: the pulse frame (6-phase, ~140ms), the
  // reveal depth (until it passes maxDepth, then frozen), the hover corner, and the
  // solved/cheated sets (which only ever grow, so their size is a sufficient key).
  // The record info panel adds its own inputs: the open room, hovered button, and
  // the odometer roll frame (capped once settled so the sig stops churning), plus
  // the hovered room node (its name plaque). The AI flag is in the key so toggling
  // the graphics level repaints.
  const infoFazeKey = Math.min(ui.mapInfoFaze, INFO_SETTLE_FAZE);
  const sig =
    `${useAi ? 'ai' : 'n'}|${pulse % 6}|${Math.min(depth, ui.worldMap.maxDepth + 1)}|${ui.mapHoverCorner ?? ''}|${host.solved.size}|${host.cheated.size}|${host.cheated.size ? 1 : 0}` +
    `|${ui.mapInfoRoom ?? ''}|${ui.mapInfoHover ?? ''}|${infoFazeKey}|${ui.mapHoverRoom ?? ''}|${mapLaunching() ?? ''}`;
  // The minigame is modal over the map too (UMain.pas:1764), and animates, so its
  // frame counter joins the cache key.
  const sigT = tetris ? `|ttr${tetrisTick}` : '';
  if (sig + sigT === ui.mapSig) return; // nothing visibly changed — skip the redraw entirely
  ui.mapSig = sig + sigT;
  setPerfPaint(perfPaint + 1); // an actual map paint (past the cache check)
  setMapPresented(true); // a map frame is now the thing on screen (see syncLoadingUi)
  // A room launch (daRun/daReplay) darkens the map exactly as an open record panel
  // does — Delphi zeroes RTable for all three cases in the same statement
  // (UMain.pas:1445) and skips the room balls with it — and draws the launching room's
  // name plaque over that (KresliDesku, :1484).
  const launching = mapLaunching() !== null;
  const panelOpen = ui.mapInfoRoom !== null;
  const unlit = panelOpen || launching;
  // While the record panel is open the base map renders fully unlit (Delphi zeroes
  // RTable when InfoMode>0, UMain.pas:1446), hiding the lit paths + node artwork so
  // only the name plaque and panel stand out. Nodes (balls) are skipped too.
  if (useAi) {
    // Hi-res AI base + nodes, then the record panel / name plaque overlaid at native
    // resolution and nearest-neighbour-scaled up (keeps digits + names crisp).
    aiWorldMap!.draw(ctx, {
      solved: host.solved,
      pulse,
      depth,
      cheated: host.cheated,
      hoverCorner: ui.mapHoverCorner,
      drawNodes: !unlit,
      litRegions: !unlit,
    });
    // Record-panel *artwork* (krokoměr bg + hovered icon + disabled-Replay grey) is
    // drawn straight onto the hi-res ctx from the AI-upscaled bitmaps; the odometer
    // digits + name plaque still ride the crisp NN overlay below so text stays sharp.
    if (panelOpen && ui.infoPanelAssets && ui.mapInfoRoom !== null) {
      const replayEnabled = host.bestRecord(ui.mapInfoRoom) !== undefined;
      drawInfoPanelArtAi(ctx, AI_MAP_SCALE, aiWorldMap!.krokomer, aiWorldMap!.ikonky, ui.mapInfoHover, replayEnabled);
    }
    // Name plaque from the upscaled art, drawn straight on the hi-res ctx. Falls back
    // to the native overlay below whenever its art is missing or still loading.
    const plaqueRoom = mapLaunching() ?? ui.mapInfoRoom ?? ui.mapHoverRoom;
    const plaque = plaqueRoom !== null ? aiPlaqueFor(plaqueRoom) : null;
    if (plaque) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(plaque.bmp, plaque.x * AI_MAP_SCALE, plaque.y * AI_MAP_SCALE);
    }
    const overlay = new Uint8ClampedArray(MAP_W * MAP_H * 4); // transparent; only drawn cells become opaque
    if (drawMapOverlays(overlay, true, plaque !== null)) {
      if (!ui.mapOverlayCanvas) {
        ui.mapOverlayCanvas = document.createElement('canvas');
        ui.mapOverlayCanvas.width = MAP_W;
        ui.mapOverlayCanvas.height = MAP_H;
        ui.mapOverlayCtx = ui.mapOverlayCanvas.getContext('2d');
      }
      ui.mapOverlayCtx!.putImageData(new ImageData(overlay, MAP_W, MAP_H), 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ui.mapOverlayCanvas, 0, 0, cw, ch);
    }
    // Last, over the plaque: Delphi draws the plaque and then the parchment
    // (UMain.pas:1484 then :1489), and the two rectangles overlap.
    if (launching) {
      blitParchmentAi(ctx);
      markParchmentPainted(); // daRun -> daRealyRun: the load may now start
    }
    return;
  }
  const rgba = ui.worldMap.render(host.solved, pulse, depth, host.cheated, ui.mapHoverCorner, !unlit, !unlit);
  drawMapOverlays(rgba);
  if (launching) {
    blitParchment(rgba);
    markParchmentPainted(); // daRun -> daRealyRun: the load may now start
  }
  ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), MAP_W, MAP_H), 0, 0);
}

/**
 * Composite the record panel + name plaque onto a map-sized RGBA buffer (the faithful
 * path passes the base map; the AI path passes a transparent buffer to overlay). The
 * name plaque (KresliDesku, UMain.pas:1484) is drawn for the open panel's room or the
 * hovered room node; the record panel (krokoměr) is drawn when a room panel is open.
 * `aiDigitsOnly` (the AI path) draws only the panel's odometer digits, not its bg/icon
 * artwork — that is drawn straight on the hi-res ctx from the AI bitmaps instead.
 * Returns whether anything was drawn.
 */
/**
 * AI-upscaled world-map name plaques (_desky).
 *
 * KresliDesku blits the plaque OPAQUELY, and the rectangle carries a slice of the map
 * background baked in with the lettering. Drawn at native resolution over the ×4 AI map
 * that pastes a 640×480-resolution patch into an upscaled picture — a visibly pixelated
 * band around the name. So the plaque gets upscaled like everything else, with the SAME
 * model as the map (enforced by test/aiShippedArt.test.ts) so the patch matches.
 */
let aiDeskyGeom: Record<string, { room: number; x: number; y: number; w: number; h: number }> | null = null;
let aiDeskyTried = false;
/** Decoded plaques, bounded: 140 of them at ×4 would be ~30 MB held for hovering. */
const aiDeskyCache = new Map<string, ImageBitmap>();
const AI_DESKY_CACHE_MAX = 12;

export async function ensureAiDeskyGeom(): Promise<void> {
  if (aiDeskyTried) return;
  aiDeskyTried = true;
  const url = '/enhanced-ai/_desky/plaques.json';
  const res = await requiredAsset(url, 'the AI map name plaques', { expect: 'json' });
  aiDeskyGeom = (await assetJson<{ plaques: typeof aiDeskyGeom }>(url, res)).plaques ?? null;
  ui.mapSig = null; // repaint now that plaques can be drawn hi-res
}

/** The upscaled plaque for `room` in the current subtitle language, if decoded. */
export function aiPlaqueFor(room: number): { bmp: ImageBitmap; x: number; y: number } | null {
  if (graphics !== 'ai') return null;
  if (!aiDeskyGeom) { void ensureAiDeskyGeom(); return null; }
  const key = `${ui.deskyLang ?? subLang()}${String(room).padStart(2, '0')}.png`;
  const g = aiDeskyGeom[key];
  if (!g) return null;
  const bmp = aiDeskyCache.get(key);
  if (!bmp) { void loadAiPlaque(key); return null; }
  return { bmp, x: g.x + DESKA_X_OFFSET, y: g.y + DESKA_Y_OFFSET };
}

const aiPlaqueLoading = new Set<string>();
export async function loadAiPlaque(key: string): Promise<void> {
  if (aiPlaqueLoading.has(key)) return;
  aiPlaqueLoading.add(key);
  try {
    const url = `/enhanced-ai/_desky/${key.replace(/\.png$/, '.webp')}`;
    const res = await requiredAsset(url, 'an AI map name plaque', { expect: 'image' });
    const bmp = await createImageBitmap(await assetBlob(url, res));
    aiDeskyCache.set(key, bmp);
    while (aiDeskyCache.size > AI_DESKY_CACHE_MAX) {
      const oldest = aiDeskyCache.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === key) break;
      aiDeskyCache.get(oldest)?.close();
      aiDeskyCache.delete(oldest);
    }
    ui.mapSig = null; // the plaque can now be drawn hi-res
    wake();
  } finally {
    // The `finally` stays and the `catch` goes: the in-flight set must be cleaned up
    // however this ends, but "leave the native plaque in place" is exactly the quiet
    // half-upscaled map the all-or-nothing rule exists to stop.
    aiPlaqueLoading.delete(key);
  }
}

export function drawMapOverlays(rgba: Uint8ClampedArray, aiDigitsOnly = false, skipPlaque = false): boolean {
  if (!ui.worldMap) return false;
  let drew = false;
  const plaqueRoom = mapLaunching() ?? ui.mapInfoRoom ?? ui.mapHoverRoom;
  if (plaqueRoom !== null && ui.deskyData && !skipPlaque) {
    const deska = ui.deskyData.byRoom.get(plaqueRoom);
    if (deska) {
      blitDeska(rgba, MAP_W, MAP_H, deska, ui.deskyData.atlas, ui.worldMap.palette);
      drew = true;
    }
  }
  if (ui.mapInfoRoom !== null && ui.infoPanelAssets) {
    const count = host.scores.get(ui.mapInfoRoom) ?? null; // best (nej) count; null = cheat-only
    if (aiDigitsOnly) {
      drawInfoDigits(rgba, MAP_W, MAP_H, ui.infoPanelAssets.cisla, count, ui.mapInfoFaze);
    } else {
      const replayEnabled = host.bestRecord(ui.mapInfoRoom) !== undefined;
      drawInfoPanel(rgba, MAP_W, MAP_H, ui.infoPanelAssets, count, ui.mapInfoHover, ui.mapInfoFaze, replayEnabled);
    }
    drew = true;
  }
  // The Tetris minigame overlays the map when the cheat opens it. It goes through
  // this shared overlay buffer so BOTH map paths get it — the AI path scales the
  // buffer up like the plaque/digits rather than needing its own hi-res blit.
  if (tetris && tetrisArt) {
    blitTetris(rgba, MAP_W, MAP_H);
    drew = true;
  }
  return drew;
}

/** The menu/map music (SpustHudbu, UMain.pas:217): menu.wav, looped at sample 419772. */
