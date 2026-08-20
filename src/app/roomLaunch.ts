/**
 * The room-entry parchment, and the launch it belongs to (Menu/loading.BMP,
 * UMain.pas:1489-1493).
 *
 * Clicking a room on the world map does NOT take the stage away in the original. It
 * sets doAkce:=daRun, and the map's very next paint draws itself with RTable zeroed
 * (fully unlit, no room balls — the same state the record panel puts it in), the
 * clicked room's name plaque, and a 192×161 parchment blitted at (227,160). Only
 * then does doAkce flip to daRealyRun and Spust() run the blocking load, so on a
 * single-threaded Delphi the parchment simply sits on the map for the whole wait:
 *
 *     if (doAkce=daRun)or(doAkce=daReplay) then
 *       begin
 *         kresli(Obr,Loading,227,160,192,161,0,0);
 *         if doAkce=daRun then doAkce:=daRealyRun;
 *       end
 *
 * It is a room-entry indicator ON THE MAP, not a boot splash — which is why this port
 * shipped Menu/loading.BMP unused for so long: it was looked for at boot, where it
 * never belonged.
 *
 * ── The seam ──────────────────────────────────────────────────────────────────
 * This is a state machine driven by the frame loop, so it needs to see rather a lot of
 * the running game — but it WRITES only what a screen transition is: the screen itself,
 * the two repaint invalidations, and the room picker's value. `startRoom` is the host's
 * own room entry, called back once a frame carrying the parchment has been painted.
 *
 * The three functions main.ts calls are the three moments of a launch: `beginMapLaunch`
 * (arm it, from enterRoom), `tickMapLaunch` (drive it, from loop) and `blitParchment` /
 * `blitParchmentAi` (draw it, from drawMap, which also sets `painted`). Everything else
 * — the input guards, the map's unlit rendering, its cache signature — reads
 * `mapLaunching()`.
 *
 * initRoomLaunch() is called from main.ts at the point this code used to sit. Module
 * scope is side-effect-free, so nothing runs before main.ts's phone gate.
 */
import { parseBmp, bmpToRgba } from '../data/bmp.js';
import { MAP_W } from '../render/worldMap.js';
import { AI_MAP_SCALE } from '../render/worldMapAi.js';
import { curNum } from './art.js';
import { ROOMS } from '../data/roomTable.js';
import { isAssetError, isTransient, requiredBytes } from '../render/assetFetch.js';
import { failAssets } from './loadingUi.js';
import { roomEntryHeld } from './roomLoad.js';
import type { AiWorldMap } from '../render/worldMapAi.js';

/** What this module needs to see of the running game. */
export interface RoomLaunchHost {
  /** Is the `ai` world map still loading? (No map frame to draw the parchment onto.) */
  readonly mapArtHolding: () => boolean;
  readonly mapOverlay: 'none' | 'options' | 'credits';
  /** Has a map frame been painted? (Not: is the map the current screen.) */
  readonly mapPresented: boolean;
  mapSig: string | null;
  forceRoomRedraw: boolean;
  readonly inShowmode: () => boolean;
  /** Is the help viewer up? (It replaces the map's draw — see mapWillDraw.) */
  readonly helpOpen: boolean;
  readonly roomArtPending: () => boolean;
  readonly roomLoading: boolean;
  screen: 'map' | 'room' | 'intro' | 'legimage';
  /** The dev room picker, kept in step with the room actually shown. */
  readonly setRoomPicker: (num: number) => void;
  /** The host's room entry (Spust): fetch the room and build it. */
  readonly startRoom: (num: number, replay: string | undefined, takeStage: boolean) => Promise<void>;
  readonly wake: () => void;
  readonly aiWorldMap: AiWorldMap | null;
}

let host!: RoomLaunchHost;

/** Hand this module its view of the game. Called once, from main.ts, during boot. */
export function initRoomLaunch(h: RoomLaunchHost): void {
  host = h;
}

/** kresli(Obr,Loading,227,160,192,161,0,0) — UMain.pas:1489. */
const PARCHMENT_X = 227;
const PARCHMENT_Y = 160;
/** The native parchment (null until boot decodes it, or if it is missing). */
let parchment: { w: number; h: number; rgba: Uint8ClampedArray } | null = null;
/** The native parchment as a canvas, for the `ai` path's fallback blit (built on demand). */
let parchmentCanvas: HTMLCanvasElement | null = null;

/**
 * Decode the parchment art. Awaited by boot.
 *
 * Its own fetch rather than a member of the map's Promise.all, which used to be the
 * difference between critical and optional: folding this 32 kB indicator into the map's
 * load would have turned a missing parchment into a fatal boot.
 *
 * `niceToHave`, and it is the clearest case of the tier in the codebase: the fallback is
 * not a degradation someone tolerated, it is a path that already exists and already runs.
 * `parchment` is null until boot decodes it, so a launch during that window ALREADY has
 * to do something, and `parchmentReady()` / `canLaunchFromMap()`'s overlay is what it
 * does. A player who never gets the parchment gets the overlay instead, which is the same
 * thing the first seconds of every session look like. Ending the session over that — or
 * even interrupting to mention it — would cost more than the loss.
 *
 * So this swallows its own failure rather than relying on the backstop in `loadingUi.ts`:
 * boot AWAITS it, and a throw here would take boot down however quietly it was reported.
 * The tier says how loud; the call site has to say what happens next.
 */
export async function loadParchment(): Promise<void> {
  const url = '/data/Menu/loading.BMP';
  try {
    const bmp = parseBmp(await requiredBytes(url, 'the room-entry parchment', 'niceToHave'));
    parchment = { w: bmp.w, h: bmp.h, rgba: bmpToRgba(bmp) };
  } catch (e) {
    if (!isAssetError(e)) throw e;
    // Left null, which every reader already handles. Not remembered as "tried", either:
    // nothing re-runs this, so there is nothing to re-remember.
    console.warn('the room-entry parchment did not load; launches will use the overlay', e);
  }
}

/** Is the parchment art available at all? (For the `__ff` hook and canLaunchFromMap.) */
export function parchmentReady(): boolean {
  return parchment !== null;
}

/**
 * Blit the parchment opaquely into a map-sized RGBA buffer (kresli, UMain.pas:1489).
 *
 * It is an opaque pre-composited RECTANGLE, not a sprite: `kresli` is a plain rect blit
 * with no colour key, and the dark map layer is baked into the parchment's own border
 * (measured mean per-pixel border difference 0.02 against mapa-0, 7.54 against mapa-1).
 * So where the map is lit the original overwrites it with the unlit version —
 * consistent, because a launching map is unlit anyway.
 */
export function blitParchment(rgba: Uint8ClampedArray): void {
  if (!parchment) return;
  const { w, h, rgba: src } = parchment;
  for (let r = 0; r < h; r++) {
    rgba.set(src.subarray(r * w * 4, (r + 1) * w * 4), ((PARCHMENT_Y + r) * MAP_W + PARCHMENT_X) * 4);
  }
}

/**
 * Blit the parchment onto the hi-res `ai` map context.
 *
 * Prefers the upscaled asset, which is built by the map's OWN pipeline
 * (tools/build-map-ai.mjs, Real-ESRGAN x4plus, the same model mapa-0/mapa-1 use) and
 * upscaled IN PLACE on mapa-0 before being cropped back out — because the parchment's
 * border IS map background, and upscaling the bare rectangle would give the model a
 * different neighbourhood for those pixels than mapa-0_ai got, leaving a seam.
 *
 * Falls back to the native rectangle scaled ×4 nearest-neighbour when the upscale is
 * missing, which is the same shape as the name plaques' fallback: the `ai` tier is
 * additive, and a missing asset costs resolution, never the indicator.
 */
export function blitParchmentAi(c: CanvasRenderingContext2D): void {
  const ai = host.aiWorldMap?.loading;
  c.imageSmoothingEnabled = false;
  if (ai) {
    c.drawImage(ai, PARCHMENT_X * AI_MAP_SCALE, PARCHMENT_Y * AI_MAP_SCALE);
    return;
  }
  if (!parchment) return;
  if (!parchmentCanvas) {
    parchmentCanvas = document.createElement('canvas');
    parchmentCanvas.width = parchment.w;
    parchmentCanvas.height = parchment.h;
    parchmentCanvas
      .getContext('2d')!
      .putImageData(new ImageData(new Uint8ClampedArray(parchment.rgba), parchment.w, parchment.h), 0, 0);
  }
  c.drawImage(
    parchmentCanvas,
    PARCHMENT_X * AI_MAP_SCALE,
    PARCHMENT_Y * AI_MAP_SCALE,
    parchment.w * AI_MAP_SCALE,
    parchment.h * AI_MAP_SCALE,
  );
}

// ── Launching a room FROM the world map (daRun -> daRealyRun) ─────────────────
//
// This port used to flip `screen` to 'room' synchronously in enterRoom(), which
// blacked the stage for the whole 17-27s a cold entry costs on a slow link (measured,
// Slow 4G) — and the delayed full-screen overlay existed to explain that black. The
// original never blacks anything: it paints the map with the parchment and loads
// behind it (see the file docblock). This is that, and it is the only route that can
// be, because it is the only one with a map on screen to keep.
//
// Three states, one object: armed (waiting for the parchment frame), started (the load
// is running under it), and gone. Keeping it in one nullable rather than in three flags
// is what lets drawMap, the input guards and loop() all ask the same question.
interface MapLaunch {
  room: number;
  replay?: string | undefined;
  /** Has a map frame carrying the parchment been painted yet? (daRun -> daRealyRun) */
  painted: boolean;
  /** Has Spust been run — i.e. is the room load in flight under the parchment? */
  started: boolean;
  /** Hands the load's outcome to the promise beginMapLaunch returned (see there). */
  settle: (load: Promise<void>) => void;
  done: Promise<void>;
}
let mapLaunch: MapLaunch | null = null;

/**
 * The room a launch is running for (daRun/daRealyRun), else null.
 *
 * The window in which the map stays on screen with the parchment over it. Everything
 * outside this module asks the question this way: the map draws unlit and plaqued for
 * it, the input guards go inert, and the frame loop stays at full rate.
 */
export function mapLaunching(): number | null {
  return mapLaunch?.room ?? null;
}

/** Record that a painted map frame carried the parchment (daRun -> daRealyRun). */
export function markParchmentPainted(): void {
  if (mapLaunch) mapLaunch.painted = true;
}

/**
 * Can this entry keep the map on screen?
 *
 * Everything here is about there being a MAP FRAME to draw the parchment onto: the map
 * screen, already presented (so we are not holding an unpainted stage in front of the
 * player), not covered by the credits/options overlay, not still waiting for its own
 * art — and the parchment itself decoded. That last one keeps the art optional in the
 * house style: without it this route would show a dark map and no indicator at all, so
 * a missing/undecodable loading.BMP simply falls back to the pre-existing overlay.
 */
export function canLaunchFromMap(): boolean {
  return (
    host.screen === 'map' &&
    host.mapPresented &&
    host.mapOverlay === 'none' &&
    !host.mapArtHolding() &&
    parchment !== null &&
    !host.inShowmode()
  );
}

/** daRun: arm the launch and let the map repaint. The load waits for that paint. */
export function beginMapLaunch(num: number, replay?: string): Promise<void> {
  if (mapLaunch) return mapLaunch.done; // a launch is already running; ignore the second click
  // The promise settles with the LOAD, not with the handover to the room screen — so
  // enterRoom() keeps meaning exactly what it meant before this route existed: the room
  // is built and live. It is live a beat before it is SHOWN here (that beat is the
  // parchment), and a caller that wants the stage should ask for the stage.
  let settle!: (load: Promise<void>) => void;
  const done = new Promise<void>((resolve, reject) => {
    settle = (load) => load.then(resolve, reject);
  });
  mapLaunch = { room: num, replay, painted: false, started: false, settle, done };
  host.mapSig = null; // the map now draws unlit, with the plaque and the parchment
  host.wake();
  return done;
}

/**
 * Will loop() draw the map again, given time? Mirrors its map branch — minus the one
 * condition that resolves itself.
 *
 * An armed launch is waiting for drawMap() to set `painted`, and drawMap() is the ONLY
 * thing that sets it. So a launch that is armed while the map has stopped being drawn
 * waits forever — and because the input guards are inert for the whole launch window,
 * the player cannot dismiss whatever took the map's place either. Reproduced: arm a
 * launch, then let an already-loaded credits roll commit before the next frame, and the
 * game sits at `mapLaunching() === 1` with Escape doing nothing.
 *
 * The window is small — one frame — but it is reachable, because the two screens that
 * can take the map away are ASYNC: openCredits() and showLegImage() both commit after an
 * await, so either can land between the arm and the paint.
 *
 * `mapArtHolding()` is deliberately NOT part of this, though loop() checks it too: it is
 * the `ai` tier's map art still downloading, which ends on its own (and ends even if the
 * download fails, see art.ts). A launch should WAIT for that, exactly as it waits for the
 * room's own art — treating it as "the map is gone" cancelled the parchment on every
 * entry made just after switching to `ai`, which test-ai-loading caught.
 */
function mapWillDraw(): boolean {
  return !host.helpOpen && host.screen === 'map' && host.mapOverlay !== 'credits';
}

/**
 * Drive an armed launch, called from loop()'s map branch after the map has drawn.
 *
 * daRealyRun: the load starts only once a frame carrying the parchment has been
 * painted, which is the ordering UMain.pas:1489-1493 has (the paint sets daRealyRun,
 * and Spust runs after that paint returns). Then the room takes the stage on the first
 * frame it can be drawn in its final art — `roomArtPending()` as well as `roomLoading`,
 * so the map hands straight over to the room and the stage is never black between them.
 *
 * Note the two are separate events: the promise enterRoom() returned settles with the
 * LOAD, while the handover can be several seconds later in the `ai` tier.
 */
export function tickMapLaunch(): void {
  const l = mapLaunch;
  if (!l) return;
  try {
    if (!l.painted) {
      if (mapWillDraw()) return;
      // The map is gone before it ever carried the parchment, so the frame this launch is
      // waiting for is never coming (see mapWillDraw). Enter the room the ordinary way
      // instead of waiting: that is what this entry did before the launch route existed —
      // a room entry raced by the credits used to win, because enterRoom() took the stage
      // synchronously — and it is the only outcome that cannot strand the player.
      mapLaunch = null;
      l.settle(host.startRoom(l.room, l.replay, true));
      return;
    }
    if (!l.started) {
      l.started = true;
      const load = host.startRoom(l.room, l.replay, false);
      // A load that FAILED has no room to hand over to. It used to call
      // finishMapLaunch() anyway — "take the stage" — and that is the bug this replaces:
      // the stage it took was the PREVIOUS room, still built and still live, so the
      // player who clicked an unreachable room was handed a different one, with no
      // message and with the input live. Offline on the world map, that is what every
      // click did. Go back to the map instead, and say so.
      void load.catch((e: unknown) => abortMapLaunch(l, e));
      l.settle(load);
      return;
    }
    // The room takes the stage when it can be both SEEN and HEARD — and when everything
    // its PLAY can demand is in hand too. `roomEntryHeld` is the composition of the two
    // post-art holds (roomLoad.ts) and is read straight from its owning module rather than
    // through the host: it is state that file owns, and an accessor would be one more
    // thing to mis-wire.
    if (host.roomLoading || host.roomArtPending() || roomEntryHeld()) return;
    finishMapLaunch(l);
  } catch (e) {
    // This is the one thing in loop() that STARTS a room, and loop() reschedules itself
    // on its last statement — so an exception escaping here takes the game's clock with
    // it. Measured, by poisoning the room picker's `value` write these two functions
    // make: the loop stopped dead (3 iterations in 1.5 s against 20), the launch stayed
    // armed, and the input guards left the player at a parchment that could never be
    // dismissed. Everywhere else this path is reached from an event handler, where a
    // throw costs that handler's turn and nothing more.
    //
    // Catching is what saves the clock. `abortMapLaunch` then makes the recovery
    // immediate and independent of state the failed entry may have left behind, rather
    // than relying on the next frame's `roomLoading || roomArtPending()` happening to be
    // false. Its stores are the same throw-free ones this catch used to make inline, and
    // the reporting it adds on top is guarded there for exactly this reason — see the
    // note in that function.
    //
    // The promise is settled with the failure as well, because a caller that awaited
    // enterRoom() would otherwise wait forever: `settle` is normally handed the load, and
    // on this path the load never got as far as existing. That matches the direct route,
    // where loadRoom() rejects and the same callers see it.
    console.error('room launch failed:', e);
    abortMapLaunch(l, e);
    l.settle(Promise.reject(e instanceof Error ? e : new Error(String(e))));
  }
}

/**
 * A launch that could not produce a room: put the player back on the map, and say so.
 *
 * ── Why this is not finishMapLaunch ───────────────────────────────────────────
 * Both failure paths used to end there, which flips `screen` to `room` — and on a failed
 * entry there IS no new room, so what appeared was the previous one, fully built and
 * accepting input. That is the defect: offline on the world map, every click on an
 * unvisited room opened whichever room had last loaded, silently.
 *
 * The fix is not to let the exception unwind instead. This runs (on one path) inside
 * `tickMapLaunch`'s catch, which exists because loop() reschedules itself on its last
 * statement: an escaping throw takes the game's clock with it — measured at 3 iterations
 * in 1.5 s against 20, with the launch still armed and the player stuck behind a
 * parchment. So the return to the map is DELIBERATE, and made of the same throw-free
 * stores that argument produced.
 *
 * `screen` is simply left alone: the launch route never took the stage in the first place
 * (`startRoom(..., takeStage: false)`), so the map is already what is up. Clearing
 * `mapLaunch` is what un-freezes it — every input guard and the map's own cache
 * signature read `mapLaunching()`, so the map goes back to lit, clickable and
 * parchment-free on the next frame, and the room the player wanted can simply be
 * clicked again.
 */
function abortMapLaunch(l: MapLaunch, err: unknown): void {
  if (mapLaunch !== l) return; // superseded: a later launch owns the screen now
  mapLaunch = null;
  host.forceRoomRedraw = true;
  host.mapSig = null; // drop the parchment frame: this launch is over
  // Everything below either touches the DOM or calls out, so it cannot carry the
  // guarantee the stores above do. It is guarded because ONE of this function's two
  // callers is the catch that keeps the frame loop alive, and a throw escaping there
  // would cost the game its clock to report that a room did not load. `wake()` goes
  // first: the async caller runs outside loop(), which may have parked the clock while
  // the room was loading, and nothing else here matters if the next frame never comes.
  try {
    host.wake();
    // An answer ("not there") and no answer at all want opposite sentences — see
    // src/render/assetFetch.ts. WHICH room is logged rather than shown: the screen is
    // generic now, because its one action is the same whichever file broke.
    // Unconditional. Guarding this on `isAssetError` left a NON-asset failure — a room
    // whose FFR arrives as a 200 full of garbage, which is what tools/test-roomload.mjs
    // serves — raising the generic screen with no record anywhere of which room or what
    // threw. The screen stopped naming the room in the same commit, so that combination
    // was the one path with no diagnosis left at all.
    reportEntryFailure(l.room, err);
    failAssets(isTransient(err));
    // The picker names the room actually on screen, which is the one the player came
    // from: `startRoom` pointed it at the room it was about to load, and that load is
    // what just failed. `curNum` only advances once a load succeeds.
    host.setRoomPicker(curNum);
  } catch (e2) {
    console.error('failed to report a failed room launch:', e2);
  }
}

/**
 * An entry that cannot be completed, from wherever the failure was noticed.
 *
 * `abortMapLaunch` needs the launch object, which only this module has — so the loaders
 * that fail LATE (the audio, which lands after the room is built) call this instead. If
 * the launch is still armed it is abandoned exactly as an early failure would be, and
 * the player is taken off it. Either way the failure screen goes up: it is the same
 * screen wherever the entry was noticed to have failed.
 */
export function failRoomEntry(num: number, err: unknown): void {
  const l = mapLaunch;
  if (l && l.room === num) {
    abortMapLaunch(l, err);
    return;
  }
  reportEntryFailure(num, err);
  failAssets(isTransient(err));
}

/**
 * The one line a failed room entry leaves behind — and now the only place the ASSET's
 * name is written down.
 *
 * The screen has been generic since #104 (its one action is Reload whichever file broke),
 * so a bug report's "which file was it" comes from the log. This line had the room but not
 * the file: it handed the error object to the console, whose message is the URL for a
 * transient failure, so `the voices for room 4` and `the briefcase demonstration` existed
 * in the code and appeared nowhere a reader would look. Every asset a room entry can fail
 * on now comes through here, which is why the name belongs here and not at each loader.
 */
function reportEntryFailure(num: number, err: unknown): void {
  const what = isAssetError(err) ? err.what : undefined;
  console.error(`room entry failed: ${roomLabel(num)}${what === undefined ? '' : ` — ${what}`}`, err);
}

/** The room's own name (PRVNI, KOSTE…), for the log line above. */
function roomLabel(num: number): string {
  const jmeno = ROOMS[num - 1]?.jmeno;
  return jmeno === undefined ? `Room ${num}` : `The room ${jmeno}`;
}

/** Hand the stage from the map to the room the launch `l` loaded, and end the launch. */
function finishMapLaunch(l: MapLaunch): void {
  if (mapLaunch !== l) return; // already handed over
  mapLaunch = null;
  host.screen = 'room';
  host.setRoomPicker(l.room);
  host.forceRoomRedraw = true;
  host.mapSig = null; // the next map visit must not reuse the parchment frame
  host.wake();
}
