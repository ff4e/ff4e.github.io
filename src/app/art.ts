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
import { loadEnhancedRoom, type RoomEnhanced } from './enhancedLoad.js';
import { isTransient } from '../render/assetFetch.js';
import { artFailureShown, hideArtFailure, showArtFailure } from './artFailure.js';
// Re-exported so the one other consumer of the decode helpers (main.ts's leg-story art)
// keeps its existing import. They live in enhancedLoad.ts now, with the loaders.
export { decodePngResponse, isPngResponse } from './enhancedLoad.js';
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
  // Any failure screen still up belongs to the room being LEFT, and its retry would
  // reload art nobody is waiting for. Entering a room supersedes it; if this room's art
  // fails too, its own loader raises a fresh one a moment later.
  hideArtFailure();
  // Enhanced background art for this room (async; draw() holds the previous
  // frame until it lands, so the room never flashes classic first).
  curNum = num;
  enhancedArt = null;
  enhancedObjects = [];
  // Only the `enhanced` tier holds for this. The `ai` tier does not load the enhanced
  // art on entry at all any more (see ensureEnhancedFallback), so arming the flag here
  // would hold the room for art no one asked for and nothing is fetching.
  enhancedPending = host.graphics === 'enhanced';
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
  // Switching INTO the `enhanced` tier is now the moment that art is fetched, not a
  // cache hit: no other tier loads it on room entry any more. So the hold has to be
  // armed here, or the switch would show classic for the length of the download and
  // then pop. Armed from the CACHE rather than from `enhancedArt`, because a room whose
  // masters are legitimately absent caches a null and must not hold forever.
  //
  // The `ai` tier deliberately does not arm or fetch here: it paints enhanced art only
  // in the fallback cases, and ensureEnhancedFallback() owns those.
  if (host.graphics === 'enhanced' && curNum) {
    const jmeno = ROOMS[curNum - 1]?.jmeno;
    enhancedPending = jmeno !== undefined && !enhancedCache.has(jmeno);
    void ensureEnhancedArt(curNum);
  } else {
    enhancedPending = false;
  }
  // A tier switch answers the question the screen was asking: whatever failed, the
  // player is now asking for something else, and the load below will raise it again if
  // the new tier fails too.
  hideArtFailure();
  // Selecting `ai` is the discrete event the one-shot UI assets retry on.
  if (host.graphics === 'ai') retryAiUiAssets();
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
 *
 * One hold per tier, and only for the tier that paints. This used to read
 * `enhancedArtActive() && enhancedPending`, which is true in the `ai` tier as well — so
 * an `ai` room entry waited for the enhanced art too, and stayed on the previous frame
 * after the art it actually paints had already arrived. The two tiers are independent
 * at render time (framePainter picks ONE compositor per frame); this makes them
 * independent at load time.
 */
export function roomArtPending(): boolean {
  if (host.graphics === 'ai') return aiPending && aiPendingNum === curNum;
  return host.enhancedArtActive() && enhancedPending;
}

/**
 * Load the current room's enhanced art because the `ai` tier is about to paint through
 * the enhanced compositor after all.
 *
 * The `ai` tier does not fetch this on room entry — that was 0.3-2.1 MB per room, on
 * every entry, for art the AI compositor does not use. But the tier is not quite
 * self-sufficient: framePainter falls back to the enhanced compositor for a whole frame
 * whenever aiRoomRenderActive() says no — a cheat's hooks / sprites / film effects
 * running, or a subtitle that must be baked in because no subtitle font loaded. (The
 * gspec=42 ZX render used to be on that list and is not any more; it composites at ×S.)
 *
 * Each of those is a DISCRETE event rather than a steady state, so paying the fetch at
 * the moment it happens is the right shape — the same argument the map/panel/credits AI
 * assets already make. The cost is that those frames draw 1998 bitmaps until it lands;
 * that is the trade, and it is one room's sprites, not a room's background.
 *
 * ── Why the failure-screen guard ──────────────────────────────────────────────
 * This is called from the DRAW PATH, once per frame, and it used to be safe on the
 * strength of "a cached result returns immediately" — which stopped being true when
 * failures deliberately stopped being cached. A failed load retracts its own
 * `enhancedLoads` entry, so without this guard the next frame starts a fresh one, for
 * ever: precisely the request-per-frame trap `beginMapArt` documents, arrived at by a
 * change three commits away from here.
 *
 * The screen being up IS the guard, and it is the honest one: the player has been asked,
 * and the button they were given is the retry. Anything automatic underneath it would be
 * a second retry loop competing with theirs.
 */
export function ensureEnhancedFallback(): void {
  if (host.graphics !== 'ai' || !curNum) return;
  if (artFailureShown()) return;
  void ensureEnhancedArt(curNum);
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
const enhancedCache = new Map<string, RoomEnhanced>(); // jmeno -> art + objects (art null = no master)
/**
 * jmeno -> the load in flight for it, so concurrent callers join one load.
 *
 * The AI cache has always been keyed on the promise for this reason; the enhanced one
 * was not, and wrote its entry only after the await — so every caller that arrived
 * during a load started another complete one. Harmless while the only caller was room
 * entry, and not harmless now that ensureEnhancedFallback() can call from a frame.
 */
const enhancedLoads = new Map<string, Promise<RoomEnhanced>>();

/**
 * Load (and cache) the enhanced background masters + object sprites for a room,
 * staged under public/enhanced/<JMENO>/ (w.png, p.png, objects.json + obj/*.png).
 * A missing master or decode failure caches an empty result so the room silently
 * falls back to classic. Applies to `num` iff it is still current when resolved.
 *
 * Idempotent and safe to call repeatedly, including once per frame: a second call while
 * a load is in flight JOINS it (enhancedLoads) instead of starting a duplicate. That was
 * already worth having — cycling tiers with E fired one full load per press — but it is
 * now load-bearing, because ensureEnhancedFallback() calls this from the draw path.
 */
export async function ensureEnhancedArt(num: number): Promise<void> {
  const jmeno = ROOMS[num - 1]?.jmeno;
  if (!jmeno) {
    if (curNum === num) enhancedPending = false;
    return;
  }
  let pending = enhancedLoads.get(jmeno);
  if (pending === undefined) {
    const cached = enhancedCache.get(jmeno);
    if (cached !== undefined) {
      applyEnhanced(num, cached);
      return;
    }
    pending = loadEnhanced(jmeno);
    // Registered BEFORE the first await, so a caller arriving during the load joins
    // this one rather than starting a second.
    enhancedLoads.set(jmeno, pending);
    // A rejection must not be joined by the NEXT caller — that is the whole point of
    // not remembering a failure. Attached here rather than in the await below because
    // every joiner runs that, and only the originator should retract the entry.
    pending.catch(() => enhancedLoads.delete(jmeno));
  }
  try {
    const result = await pending;
    enhancedLoads.delete(jmeno);
    applyEnhanced(num, result);
  } catch (e) {
    if (!isTransient(e)) throw e;
    // Nothing was learned about this room, so nothing is remembered: enhancedCache is
    // untouched and a retry genuinely refetches.
    //
    // The hold is deliberately NOT released. Releasing it would paint the room in 1998
    // bitmaps — a downgrade the player did not ask for and cannot see — so the game
    // stops and offers the retry instead (see artFailure.ts). An outcome for a room
    // that is no longer on screen is dropped: the player has already moved on.
    console.warn(`[art] enhanced art for ${jmeno} did not load`, e);
    if (curNum === num) raiseArtFailure('room', () => void ensureEnhancedArt(num));
  }
}

/** Point the live art state at a loaded result, iff `num` is still the room on screen. */
function applyEnhanced(num: number, r: RoomEnhanced): void {
  if (curNum !== num) return;
  enhancedArt = r.art;
  enhancedObjects = r.objects;
  enhancedPending = false;
  // The art arrived, so whatever the screen was asking has been answered — including
  // when the answer came from a retry the player did not press (a later room entry, a
  // tier switch back). Leaving it up would strand a working game behind it.
  hideArtFailure();
}

/**
 * Fetch one room's enhanced art and remember it — but only if an answer arrived.
 *
 * The fetching and decoding is `enhancedLoad.ts`. The only thing added here is the
 * cache, and that is the interesting half: caching is a judgement about what an empty
 * result MEANS, so it belongs with the state rather than with the transport. An empty
 * result that the server confirmed is a fact about the room and is kept; a rejection is
 * the absence of a fact and propagates untouched.
 */
async function loadEnhanced(jmeno: string): Promise<RoomEnhanced> {
  const result = await loadEnhancedRoom(jmeno);
  enhancedCache.set(jmeno, result);
  return result;
}

/** Load the hi-res panel art once (see panelAi.ts); null ⇒ keep the faithful path. */
export async function ensureAiPanel(): Promise<void> {
  aiPanelPending = true;
  try {
    aiPanel = await loadAiPanel('/');
    if (aiPanel) ui.panelSig = null;   // force a repaint at the new resolution
  } finally {
    aiPanelPending = false;
  }
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
// The same "in flight" flags for the panel and the credits, so retryAiUiAssets() can
// tell an asset that FAILED from one that simply has not finished yet.
let aiPanelPending = false;
let aiCreditsPending = false;

/**
 * Give the three one-shot `ai` UI assets (world map, panel, credits) another go.
 *
 * Each is latched by a `…Tried` flag that is set BEFORE its load resolves, so a load
 * that failed got no second attempt for the whole session — and the world map is the
 * game's hub screen, so that was the same user-visible bug rooms had.
 *
 * The latch cannot be cleared where the load fails: `beginMapArt` runs from the map's
 * draw branch, so clearing it there would be a request per frame on a flaky link. It
 * hangs instead on a discrete, player-initiated event — selecting the `ai` tier — which
 * bounds it at one retry per switch. An asset still in flight is left alone; an asset
 * that legitimately resolved null is retried, because at this level "absent" and
 * "failed" are not distinguished and one wasted request per deliberate tier switch is
 * a price worth paying to make the hub screen recoverable.
 */
export function retryAiUiAssets(): void {
  if (!aiWorldMap && !aiMapPending) aiMapTried = false;
  if (!aiPanel && !aiPanelPending) ui.aiPanelTried = false;
  if (!aiCredits && !aiCreditsPending) ui.aiCreditsTried = false;
}
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
  // `held` rather than an early return out of the try: a `finally` runs even after a
  // `return` in the catch, so the release below cannot be skipped that way — it has to
  // be told not to. Getting that wrong would present the faithful map under an `ai`
  // setting, which is the exact silent downgrade this change exists to stop.
  let held = false;
  try {
    if (!ui.worldMap) return;
    aiWorldMap = await loadAiWorldMap('/data/', ui.worldMap);
  } catch (e) {
    if (!isTransient(e)) throw e;
    // Nothing was learned, so the hold STAYS and the player is asked. The retry has to
    // re-arm the one-shot latch too, or beginMapArt would refuse to start a second load.
    console.warn('[art] AI world map did not load', e);
    held = true;
    raiseArtFailure('map', () => {
      aiMapTried = false;
      beginMapArt();
    });
  } finally {
    // Released on every exit EXCEPT a transient failure, which is what `held` marks.
    // An ordinary absence still releases here and falls back to the faithful composite:
    // loadAiWorldMap resolves null for anything the server actually answered, so a
    // missing or undecodable asset returns normally and the map is simply the 1998 one.
    // The guard above (no worldMap yet) releases too, or the map would be withheld for
    // the rest of the session.
    if (!held) {
      aiMapPending = false;
      ui.mapSig = null; // force a repaint so the map switches to the AI art once ready
      host.wake();
    }
  }
}

/** Load the hi-res credits art once (see creditsAi.ts). */
export async function ensureAiCredits(): Promise<void> {
  aiCreditsPending = true;
  try {
    await loadAiCreditsOnce();
  } finally {
    aiCreditsPending = false;
  }
}

async function loadAiCreditsOnce(): Promise<void> {
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
 * `ai` graphics level. Applies to `num` iff it is still the current room when the load
 * resolves.
 *
 * A room whose AI art is genuinely ABSENT caches null and falls back to the enhanced
 * render — a stable fact, and the right thing to remember. A room whose load FAILED
 * caches nothing, so the next entry (or tier switch) tries again. Before that
 * distinction existed, one aborted request left the room drawing enhanced art with the
 * setting still reading `ai`, for the whole session, with no way back but a reload.
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
    // than starting its own, and retracted if it rejects so the failure is not what the
    // next caller joins. The identity check matters: by the time this runs, a later
    // entry may already have started a REPLACEMENT load and stored it under the same
    // key, and deleting that one would mean two live loads for one room.
    pending.catch(() => { if (aiRoomCache.get(jmeno) === pending) aiRoomCache.delete(jmeno); });
    aiRoomCache.set(jmeno, pending);
  }
  try {
    const loaded = await pending;
    if (curNum === num) {
      aiRoom = loaded;
      aiRoomNum = num;
      hideArtFailure(); // answered — see applyEnhanced
    }
    // `null` is not a failure: it is the room saying, authoritatively, that it has no
    // AI art. That is permanent, there is nothing to retry, and the fallback below it
    // is correct — so the hold is released and the room paints one tier down, silently,
    // exactly as it always has.
    clearAiPending(num);
  } catch (e) {
    if (!isTransient(e)) throw e;
    console.warn(`[art] AI art for ${jmeno} did not load`, e);
    // The hold STAYS, and the player is asked. Both the guard and the hold matter:
    // these loads outlive the room that started them, so a stale failure must not
    // raise a screen over the room the player has since walked into. (The mirror of
    // that was measured on the note this replaces — a stale SUCCESS cleared it.)
    if (curNum === num) raiseArtFailure('room', () => void ensureAiRoom(num));
    else clearAiPending(num);
  }
  // AFTER the hold is released, and not awaited: evictAiRooms awaits an older room's
  // (possibly still in-flight) load before disposing it, so with AI_ROOM_CACHE_MAX = 3
  // awaiting it here made room D's first frame wait on room A's download finishing.
  // Nothing visible depends on the eviction.
  void evictAiRooms(jmeno).catch(() => { /* a room we could not dispose is not fatal */ });
}

/**
 * Put the failure screen up, and WAKE THE LOOP.
 *
 * The wake is not decoration. Every other exit from these loaders releases a hold and
 * wakes on the way out; the failure path holds instead, so without this the loop can
 * still be asleep — and `syncLoadingUi` only runs from the loop, so the loading spinner
 * it is supposed to stand down would stay up ON TOP of this screen (same z-index, later
 * in the DOM) and swallow the click on Try again. Found exactly that way.
 */
function raiseArtFailure(what: 'room' | 'map', again: () => void): void {
  showArtFailure(what, again);
  host.forceRoomRedraw = true;
  host.wake();
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
