/**
 * Room and UI art loading for the enhanced and `ai` tiers: fetch, decode, cache, and
 * the "is the room still waiting for its art?" predicates the draw path holds on.
 *
 * The area recent work kept returning to — the loading overlay, the tier switches, the
 * anti-flash holds — so it is worth having on its own. It owns the decoded art for the
 * current room, the bounded AI room cache, and the three lazily-loaded `ai` UI assets
 * (panel, world map, credits) that the map, panel and credits screens only read.
 *
 * ── The seam ──────────────────────────────────────────────────────────────────
 * Thirteen names in, three of them writable. Getting there took two collapses rather
 * than a wall of setters, and they are the interesting part of this change:
 *
 *   - loadRoom used to make SEVEN assignments into this module's state to point it at
 *     a new room. That is beginRoomArt() now — one operation, because the flags are
 *     only correct when they are set together, against the same room number and tier.
 *   - setGraphics did the same thing again for a tier switch under a live room. That is
 *     retargetArtForTier().
 *
 * The three writable members (forceRoomRedraw, mapSig, panelSig) are repaint
 * invalidations: this layer has to be able to say "the art changed, repaint" when an
 * async load lands, which is the whole point of it.
 *
 * initArt() is called from main.ts at the point this code used to sit. Module scope is
 * side-effect-free, so nothing runs before main.ts's phone gate.
 */
import { HookSystem } from '../core/hooks.js';
import { Room } from '../core/room.js';
import type { GraphicsLevel } from '../core/settings.js';
import { ROOMS } from '../data/roomTable.js';
import { loadAiCredits } from '../render/creditsAi.js';
import type { AiCredits } from '../render/creditsAi.js';
import type { EnhancedArt, EnhancedObject } from '../render/enhancedArtSource.js';
import { withLoadSlot } from '../render/loadSlot.js';
import { ui } from './screenState.js';
import { loadAiPanel } from '../render/panelAi.js';
import type { AiPanel } from '../render/panelAi.js';
import { AiRoom, aiRoomGateAllows, loadAiRoom } from '../render/roomAi.js';
import { SubtitleSystem } from '../render/subtitles.js';
import { WorldMap } from '../render/worldMap.js';
import { AiWorldMap, loadAiWorldMap } from '../render/worldMapAi.js';
import { frameEffectsActive, spriteCheats } from './cheats.js';

/** What this module needs to see of the running game. */
export interface ArtHost {
  readonly closeMapOverlay: () => void;
  readonly enhancedArtActive: () => boolean;
  forceRoomRedraw: boolean;
  readonly graphics: GraphicsLevel;
  readonly hooks: HookSystem;
  readonly subFontReady: boolean;
  readonly subs: SubtitleSystem | null;
  readonly wake: () => void;
}

let host!: ArtHost;

/** Hand this module its view of the game. Called once, from main.ts, during boot. */
export function initArt(h: ArtHost): void {
  host = h;
}

// Hi-res AI art for the two UI surfaces. Loaded once, lazily, only while graphics==='ai';
// null means "not available" and the faithful indexed path is used instead.
export let aiPanel: AiPanel | null = null;
export let aiCredits: AiCredits | null = null;
// The `ai` tier's world map (see ensureAiWorldMap). Declared with the other AI assets
// rather than with the map's own state: this layer loads all three, and the map, panel
// and credits only read them.
export let aiWorldMap: AiWorldMap | null = null;
export let enhancedArt: EnhancedArt | null = null; // decoded art for the current room (null = classic)
export let enhancedObjects: EnhancedObject[] = []; // decoded truecolor object sprites for the current room
export let curNum = 0; // current room number, for enhanced-art lookup
// True from entering a room (in enhanced mode) until its truecolor art has
// resolved. While true, draw() holds the previous frame instead of painting the
// classic look, so a room never flashes classic before popping to enhanced.
export let enhancedPending = false;
// AI room art (Phase C): the S× upscaled masters for the current room, when the ai
// level is on and every asset loaded. null ⇒ the room falls back to enhanced/classic.
export let aiRoom: AiRoom | null = null;
export let aiRoomNum = 0; // room number aiRoom belongs to (guards async races)
// The `ai` tier's counterpart to enhancedPending: true from entering a room (or
// switching to the tier) until that room's AI art has resolved. Without it the room
// painted as soon as the ENHANCED art landed and then visibly swapped to the AI art
// a beat later — measured at a 9-14s visible upgrade over Slow 4G.
export let aiPending = false;
let aiPendingNum = 0; // room aiPending refers to (the tier can change under it)

/**
 * Point the art layer at room `num`: drop the previous room's decoded art and arm the
 * two "hold the frame until it lands" flags.
 *
 * One call rather than the seven assignments loadRoom used to make into this state.
 * The comments below are that block's, and they are the reason it is one operation:
 * the flags are only correct when they are set together, against the same room number
 * and the same tier.
 */
export function beginRoomArt(num: number): void {
  // Enhanced background art for this room (async; draw() holds the previous
  // frame until it lands, so the room never flashes classic first).
  curNum = num;
  enhancedArt = null;
  enhancedObjects = [];
  enhancedPending = host.enhancedArtActive();
  aiRoom = null;
  // Symmetric with enhancedPending: hold the frame until the AI art the `ai` tier
  // will actually present has landed, so the room is never shown in enhanced art
  // first and then visibly upgraded underneath the player.
  aiPending = host.graphics === 'ai';
  aiPendingNum = aiPending ? num : 0;
}

/**
 * Re-point the art layer after the graphics tier changed under a live room.
 *
 * The counterpart to beginRoomArt, and one operation for the same reason: these flags
 * are only correct set together, against the same room number and the same tier.
 */
export function retargetArtForTier(): void {
  if (host.enhancedArtActive() && curNum) void ensureEnhancedArt(curNum);
  if (host.graphics === 'ai' && curNum) {
    // Hold the frame we already have until the AI art lands, rather than repainting
    // the room in enhanced art and then popping to AI — the same rule room entry
    // follows. Switching away releases it for free: roomArtPending() reads `graphics`.
    aiPending = aiRoom === null || aiRoomNum !== curNum;
    aiPendingNum = aiPending ? curNum : 0;
    void ensureAiRoom(curNum);
  } else {
    aiPending = false;
    aiPendingNum = 0;
    aiRoom = null;
  }
}

/**
 * Whether the current room is still waiting for the art tier it will actually paint.
 *
 * Deliberately a PREDICATE over live state rather than something the room-load promise
 * awaits. That is what makes "the player switches tier mid-load" free: press E for
 * classic and enhancedArtActive() is false on the very next frame, so the hold releases
 * itself — no generation counter, no waiter set, nothing to cancel. It also leaves
 * loadRoom()'s meaning (and so waitRoom()/roomLoading()) exactly as it was.
 */
export function roomArtPending(): boolean {
  if (host.enhancedArtActive() && enhancedPending) return true;
  return host.graphics === 'ai' && aiPending && aiPendingNum === curNum;
}
/**
 * jmeno -> loaded AI room (null = no AI art / failed). Keyed on the PROMISE so a second
 * request while a load is in flight joins it instead of starting a duplicate: the entry
 * used to be written only after the await, so cycling tiers with E fired up to five
 * concurrent loads of the same room (590 fetches for 71 distinct URLs).
 *
 * LRU-bounded because each room retains ~50 MB of ×4 pixels; unbounded, a full
 * playthrough held ~4 GB of decoded bitmaps that were never closed.
 */
const aiRoomCache = new Map<string, Promise<AiRoom | null>>();
const AI_ROOM_CACHE_MAX = 3; // current room + the two most recently visited
async function evictAiRooms(keep: string): Promise<void> {
  while (aiRoomCache.size > AI_ROOM_CACHE_MAX) {
    // Map iterates in insertion order, so the first key that is not the room we are
    // about to show is the least recently loaded.
    const oldest = [...aiRoomCache.keys()].find((k) => k !== keep);
    if (oldest === undefined) return;
    const pending = aiRoomCache.get(oldest)!;
    aiRoomCache.delete(oldest);
    const room = await pending.catch(() => null);
    // Never free the art the current frame is drawing from.
    if (room !== null && room !== aiRoom) room.dispose();
  }
}
interface RoomEnhanced {
  art: EnhancedArt | null;
  objects: EnhancedObject[];
}
const enhancedCache = new Map<string, RoomEnhanced>(); // jmeno -> art + objects (art null = no master)

interface ObjManifestEntry {
  item: number;
  frames: string[];
}

/**
 * The dev server serves index.html (HTTP 200) for a missing asset, so `res.ok`
 * is not enough to know a file exists — verify the content-type is an image.
 */
export function isPngResponse(res: Response): boolean {
  return res.ok && (res.headers.get('content-type') ?? '').startsWith('image/');
}

/**
 * Decode a PNG Response into straight RGBA using the browser's native decoder
 * (createImageBitmap + a 2D canvas) — no `node:zlib`, unlike the Node tools.
 */
export async function decodePngResponse(res: Response): Promise<{ w: number; h: number; rgba: Uint8Array }> {
  const bmp = await createImageBitmap(await res.blob());
  const w = bmp.width;
  const h = bmp.height;
  const off = document.createElement('canvas');
  off.width = w;
  off.height = h;
  const g = off.getContext('2d')!;
  g.clearRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0);
  const data = g.getImageData(0, 0, w, h).data;
  bmp.close();
  return { w, h, rgba: new Uint8Array(data.buffer.slice(0)) };
}

/**
 * Load (and cache) the enhanced background masters + object sprites for a room,
 * staged under public/enhanced/<JMENO>/ (w.png, p.png, objects.json + obj/*.png).
 * A missing master or decode failure caches an empty result so the room silently
 * falls back to classic. Applies to `num` iff it is still current when resolved.
 */
export async function ensureEnhancedArt(num: number): Promise<void> {
  const jmeno = ROOMS[num - 1]?.jmeno;
  if (!jmeno) {
    if (curNum === num) enhancedPending = false;
    return;
  }
  if (enhancedCache.has(jmeno)) {
    const c = enhancedCache.get(jmeno)!;
    if (curNum === num) {
      enhancedArt = c.art;
      enhancedObjects = c.objects;
      enhancedPending = false;
    }
    return;
  }
  try {
    // A fetch that actually returns a PNG (dev server SPA-fallback serves the
    // index HTML with 200 for missing files, so ok/status is not enough).
    const isPng = isPngResponse;
    const [w, p] = await Promise.all([
      fetch(`/enhanced/${jmeno}/w.png`),
      fetch(`/enhanced/${jmeno}/p.png`),
    ]);
    let art: EnhancedArt | null = null;
    if (isPng(w) && isPng(p)) {
      const [wall0, bg0] = await Promise.all([decodePngResponse(w), decodePngResponse(p)]);
      if (wall0.w === bg0.w && wall0.h === bg0.h) {
        // Additional animation frames (STEEL red-alert): w1.png/p1.png, w2.png/p2.png…
        const walls = [wall0.rgba];
        const bgs = [bg0.rgba];
        for (let f = 1; ; f++) {
          const [wf, pf] = await Promise.all([
            fetch(`/enhanced/${jmeno}/w${f}.png`),
            fetch(`/enhanced/${jmeno}/p${f}.png`),
          ]);
          if (!isPng(wf) || !isPng(pf)) break;
          const [wd, pd] = await Promise.all([decodePngResponse(wf), decodePngResponse(pf)]);
          if (wd.w !== wall0.w || wd.h !== wall0.h || pd.w !== wall0.w || pd.h !== wall0.h) break;
          walls.push(wd.rgba);
          bgs.push(pd.rgba);
        }
        art = { w: wall0.w, h: wall0.h, wall: walls, bg: bgs };
      }
    }
    const objects = await loadEnhancedObjects(jmeno);
    const result: RoomEnhanced = { art, objects };
    enhancedCache.set(jmeno, result);
    if (curNum === num) {
      enhancedArt = art;
      enhancedObjects = objects;
      enhancedPending = false;
    }
  } catch {
    enhancedCache.set(jmeno, { art: null, objects: [] });
    if (curNum === num) {
      enhancedArt = null;
      enhancedObjects = [];
      enhancedPending = false;
    }
  }
}

/** Decode a room's enhanced object sprites from its objects.json manifest. */
async function loadEnhancedObjects(jmeno: string): Promise<EnhancedObject[]> {
  const res = await fetch(`/enhanced/${jmeno}/objects.json`);
  // The dev server serves index.html (200) for a missing manifest, so verify it
  // is actually JSON before parsing.
  if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return [];
  const manifest = (await res.json()) as { objects?: ObjManifestEntry[] };
  const entries = manifest.objects ?? [];
  // One entry at a time was a per-object round trip: with the AI loads parallelised
  // this waterfall became the thing the first frame waits on (2.2s at a 150ms RTT
  // against 1.2s for the whole AI set). The sprites are independent, so fetch them
  // all at once and let the browser schedule.
  const loaded = await Promise.all(
    entries.map(async (e): Promise<EnhancedObject | null> => {
      if (typeof e.item !== 'number' || !Array.isArray(e.frames)) return null;
      const frames = await Promise.all(
        e.frames.map(async (f) =>
          withLoadSlot(async () => {
            const r = await fetch(`/enhanced/${jmeno}/obj/${f}`);
            if (!isPngResponse(r)) return null;
            const d = await decodePngResponse(r);
            return { w: d.w, h: d.h, rgba: d.rgba };
          }),
        ),
      );
      const valid = frames.filter((f): f is { w: number; h: number; rgba: Uint8Array } => f !== null);
      return valid.length > 0 ? { item: e.item, frames: valid } : null;
    }),
  );
  return loaded.filter((o): o is EnhancedObject => o !== null);
}

/** Load the hi-res panel art once (see panelAi.ts); null ⇒ keep the faithful path. */
export async function ensureAiPanel(): Promise<void> {
  aiPanel = await loadAiPanel('/');
  if (aiPanel) ui.panelSig = null;   // force a repaint at the new resolution
}

/**
 * ── The `ai` tier's world map: load it once, and hold the map until it lands ──
 *
 * The AI map art is 2.36 MB against 0.59 MB for the faithful BMPs, so on a slow link
 * there are seconds between the two being ready. The draw used to kick the load off and
 * paint whatever was ready, which put the faithful map up first and visibly swapped it
 * for the AI one a beat later — measured at 28.0s of enhanced map on screen (Slow 4G,
 * cold cache), on the first screen of the game. It is the same defect rooms had before
 * aiPending/roomArtPending(), and it gets the same three pieces: a live-state predicate,
 * a hold in the draw branch, and the loading overlay over the wait.
 */
let aiMapTried = false; // one-shot: the load is started at most once per session
let aiMapPending = false; // that load is in flight (independent of the tier on screen)
/**
 * Is a map frame the thing currently on screen?
 *
 * Not "has a map ever been painted": the question it answers is whether withholding the
 * map leaves the player looking at a map (a tier switch — delay the spinner, it is a
 * fine thing to keep looking at) or at the room, story page, credits or blank stage they
 * are being taken away from (show the overlay at once, there is nothing to preserve).
 * Set by drawMap()'s paint and cleared in loop(), where every branch that takes #screen
 * over is already distinguished — see there. It also decides when the reveal starts.
 */
export let mapPresented = false;

/**
 * Whether the map is still waiting for the art tier it will actually paint.
 *
 * The map's counterpart of roomArtPending(), and a PREDICATE over live state for the
 * same reason: press E for `enhanced` mid-load and the hold releases itself on the very
 * next frame — no generation counter, no waiter set, nothing to cancel — and pressing E
 * back re-applies it just as cheaply.
 */
export function mapArtPending(): boolean {
  return host.graphics === 'ai' && aiMapPending;
}

/** Whether THIS frame must withhold the map because its final art is still loading. */
/** Record whether a map frame is currently the thing on screen (see syncLoadingUi). */
export function setMapPresented(v: boolean): void {
  mapPresented = v;
}

export function mapArtHolding(): boolean {
  // The credits overlay replaces the map on the same screen, so while it is up there is
  // no map to withhold and nothing to explain.
  return ui.screen === 'map' && ui.mapOverlay !== 'credits' && mapArtPending();
}

/**
 * Start the `ai` tier's world-map load the first time the map is (about to be) on
 * screen.
 *
 * Still lazy — a player on classic/enhanced never fetches any of it — but no longer
 * kicked off from inside drawMap(): the draw is now the thing the hold suppresses, so
 * it cannot also be the thing that starts the load. Starting the load is ALL it does;
 * the overlay that covers the wait is derived in syncLoadingUi(), because this runs
 * once per session and the wait can be arrived at more than once.
 */
export function beginMapArt(): void {
  if (aiMapTried || host.graphics !== 'ai' || !ui.worldMap) return;
  aiMapTried = true;
  aiMapPending = true;
  void ensureAiWorldMap();
}

/**
 * Load the hi-res world-map art once, on first use in the `ai` tier.
 *
 * Deliberately lazy, unlike the eager call this replaced: that one ran at boot in EVERY
 * tier, so a player on `classic` still downloaded 2.36 MB of *_ai art and retained
 * ~43 MB of decoded bitmaps plus two 2560×1920 canvases, concurrently with the intro's
 * own media. It self-cancels to null on any missing/undecodable asset, so the `ai` level
 * cleanly falls back to the faithful CPU composite.
 */
async function ensureAiWorldMap(): Promise<void> {
  try {
    if (!ui.worldMap) return;
    aiWorldMap = await loadAiWorldMap('/data/', ui.worldMap);
  } finally {
    // Unconditional, so the hold cannot outlive the load on ANY exit. Note this is
    // NOT what saves the ordinary failure: loadAiWorldMap catches everything it does —
    // fetch, decode, and the AiWorldMap construction — and resolves null, so a missing
    // or undecodable asset returns here normally and the `ai` tier falls back to the
    // faithful composite. What the finally covers is the guard above, and a future
    // loadAiWorldMap that rejects instead. Either would otherwise leave aiMapPending
    // set and withhold the map for the rest of the session.
    aiMapPending = false;
    ui.mapSig = null; // force a repaint so the map switches to the AI art once ready
    host.wake();
  }
}

/** Load the hi-res credits art once (see creditsAi.ts). */
export async function ensureAiCredits(): Promise<void> {
  aiCredits = await loadAiCredits('/');
  // The pointer handlers live on #screen, which this path hides (display:none) while
  // its own overlay is up — a hidden element gets no pointer events, so "click anywhere
  // to dismiss" silently stopped working in the ai tier while the keyboard still did.
  // Bind on the overlay itself; listeners survive detach/re-attach, so bind once here.
  aiCredits?.el.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || ui.mapOverlay !== 'credits') return;
    e.preventDefault();
    host.closeMapOverlay();
  });
}

/**
 * Load (and cache) the AI-upscaled art for a room (public/enhanced-ai/<JMENO>/), for the
 * `ai` graphics level. A missing set caches null so the room falls back to the enhanced
 * render. Applies to `num` iff it is still the current room when the load resolves.
 */
export async function ensureAiRoom(num: number): Promise<void> {
  const jmeno = ROOMS[num - 1]?.jmeno;
  if (!jmeno) {
    clearAiPending(num);
    return;
  }
  let pending = aiRoomCache.get(jmeno);
  if (pending === undefined) {
    pending = loadAiRoom('/', jmeno);
    // Registered BEFORE the first await so a concurrent caller joins this load rather
    // than starting its own. Don't cache a rejection — loadAiRoom resolves null on
    // failure, but a throw would otherwise poison the room for the session.
    pending.catch(() => aiRoomCache.delete(jmeno));
    aiRoomCache.set(jmeno, pending);
  }
  try {
    const loaded = await pending;
    if (curNum === num) { aiRoom = loaded; aiRoomNum = num; }
  } finally {
    // In a finally: a room whose AI art is missing or fails to decode must release
    // the hold too (it falls back to the enhanced render), or it would never paint.
    clearAiPending(num);
  }
  // AFTER the hold is released, and not awaited: evictAiRooms awaits an older room's
  // (possibly still in-flight) load before disposing it, so with AI_ROOM_CACHE_MAX = 3
  // awaiting it here made room D's first frame wait on room A's download finishing.
  // Nothing visible depends on the eviction.
  void evictAiRooms(jmeno).catch(() => { /* a room we could not dispose is not fatal */ });
}

/** Release the `ai` tier's art hold for `num`, and present the frame it was holding. */
function clearAiPending(num: number): void {
  if (aiPendingNum !== num) return;
  aiPending = false;
  aiPendingNum = 0;
  host.forceRoomRedraw = true;
  host.wake();
}

/**
 * Whether the current frame should render through the hi-res AI room compositor:
 * the ai level is on and the room's AI art loaded.
 *
 * The compositor now covers everything the faithful path draws from index
 * read-back except the ZX render: the spec=1 mirror (drawMirror), the spec=3/4
 * elevator double rope (drawRope), the gspec=5 bonus fish swap and the gspec=2
 * darkness fill + lit-item filter. gspec=3/4 (the KAJUTA1 screen shove) needs
 * nothing here at all — the shove is a CSS transform on the canvas, applied
 * outside the compositor — and gspec=9 is only a win condition.
 *
 * Still excluded: gspec=42, the ZX-Spectrum band render (its per-scanline bands
 * are an index effect, and the low-fi look is the point), any frame with an active
 * fishing hook, which the faithful path draws on top from the palette, any frame
 * with a CPU-only frame effect running (frameEffectsActive), any frame with a
 * sprite cheat active, and any frame whose subtitle must be baked in because no
 * subtitle font loaded. LODE's falling wreck used to be here too; AiRoom.syncWreck
 * now replays its destructive swaps into a mutable ×S background, so the room no
 * longer drops to native resolution mid-fall.
 */
export function aiRoomRenderActive(r: Room): boolean {
  if (host.graphics !== 'ai' || aiRoom === null || aiRoomNum !== curNum) return false;
  // The rest of the rule lives in roomAi.ts so there is ONE definition tests can import
  // — the hand-copied duplicate in test/roomAi.test.ts had already drifted out of date.
  return aiRoomGateAllows({
    gspec: r.gspec,
    hookStates: host.hooks.snapshot.map((h) => h.stav),
    frameEffects: frameEffectsActive(),
    spriteCheatsActive: spriteCheats.length > 0,
    // Mirrors useVecSubs (drawRoom): in this tier enhancedArtActive() is always true, so
    // the vector overlay is available iff a subtitle font loaded.
    bakedSubsNeeded: (host.subs?.active ?? false) && !host.subFontReady,
  });
}

// Enhanced fish sprites are shared across all rooms, so they load once.
