/**
 * Frame pacing: whether the next frame must be painted at all, how long the loop may
 * sleep before it, and the perf HUD that reports what actually happened.
 *
 * ── Why this could finally leave main.ts ─────────────────────────────────────
 * It could not, until now. Priced at the start of this series (branch
 * `keyboard-extraction-experiment`) extracting a region cost about a line of plumbing per
 * line of code moved, because everything it read lived at the top level of `main.ts`
 * where nothing else could see it — so each name arrived through its own getter.
 *
 * `screenState.ts` and `gameState.ts` gave that state owners, and this module is the
 * result: 4 200 tokens of pacing leave behind a host of **eight** names. Everything else
 * it needs — `room`, `count`, `ui.screen`, `ui.ostav`, `roomArtPending`, `mapLaunching`,
 * `perfHud` — is now an ordinary import.
 *
 * ── Mechanism, policy, bookkeeping ───────────────────────────────────────────
 * Three things live near each other here and are worth telling apart:
 *
 *   - `frameClock.ts` owns the MECHANISM: the rAF handle, the idle timer, the paint
 *     deadline. Nothing outside it touches those.
 *   - this file owns the POLICY (`loopThrottleOk`, `idleDelayMs`) — which screens may
 *     idle, and how fast the things that still move on an idle screen must move. Every
 *     rate here is a measured trade, and the comments carry the measurements.
 *   - and the BOOKKEEPING the policy reads: the render-on-dirty signature, the
 *     invalidation flag, the paint counters.
 *
 * ── Why the state is exported bindings ──────────────────────────────────────
 * Same reason as `gameState.ts`: `forceRoomRedraw` alone is read from twenty-nine places
 * outside this region. Live bindings make every one of those reads free and leave only
 * the writes — which do become `setForceRoomRedraw(...)`, and are the ones worth seeing.
 *
 * ── Ordering ─────────────────────────────────────────────────────────────────
 * Module scope stays side-effect-free; `initFramePacing` is called from `main.ts` at the
 * point this code used to run. See AGENTS.md, "the module-evaluation trap".
 */
import { INFO_SETTLE_FAZE } from '../render/mapInfo.js';
import { aiWaterVisible } from '../render/roomAi.js';
import { aiRoomRenderActive, roomArtPending } from './art.js';
import { perfHud } from './dom.js';
import { initFrameClock } from './frameClock.js';
import { count, cutscene, engine, loadmode, room, subs } from './gameState.js';
import { glAiFailed, glFailed } from './glPlumbing.js';
import { mapLaunching } from './roomLaunch.js';
import { O_NORMAL, ui } from './screenState.js';
import type { IntroPlayer } from './intro.js';

/**
 * The eight names this module still needs from `main.ts`, and nothing more.
 *
 * Compare `ArtHost` (eight) and `GlPlumbingHost` (five). Before the state modules landed
 * the equivalent list for a region this size was in the forties — see the header of
 * `keyboard.ts` on the parked experiment branch for what that cost.
 */
export interface FramePacingHost {
  readonly enhancedArtActive: () => boolean;
  readonly heldState: number;
  readonly intro: IntroPlayer;
  readonly inShowmode: () => boolean;
  /** The frame body. Handed to `frameClock.ts` below; nothing here calls it. */
  readonly loop: (now: number) => void;
  readonly renderOnDirty: boolean;
  readonly renderer: 'cpu' | 'webgl';
  readonly subFontReady: boolean;
}

let host!: FramePacingHost;

export let lastTime = 0;
export let acc = 0;
// Render-on-dirty bookkeeping: the last room frame's render signature, plus a
// one-shot force flag for transitions that don't change the signature (room entry,
// resize, fit-mode change, pointer interaction).
export let lastRoomSig = '';
export let forceRoomRedraw = true;
// True while a newly-entered room's assets are still being fetched (loadRoom is
// async, unlike the original's synchronous load). The `room`/`ffr` globals still
// hold the *previous* room until buildRoom() swaps them, so painting the room
// screen during this window would flash the old room (notably the boot room
// UTES, loaded at startup) until the new one lands. The draw loop clears the
// stage to black instead while this is set (see the room-draw branch).
export let roomLoading = false;
// Monotonic count of COMPLETED room loads — the tests' only race-free way to tell
// "the room I asked for has finished loading" apart from "the room I asked for was
// already the current one". Debug-only (exposed as __ff.roomLoads).
export let roomLoadSeq = 0;
// Idle-loop throttle (perf): when the room is fully idle (saver on, nothing
// animating), stop the 60fps rAF spin and wake via a timer at the logic rate so
// the loop's own per-frame overhead (JS + browser scheduling) stops too. Input
// wakes it back to 60fps instantly. Rooms, the map, the story page and the cutscene
// are throttled; the intro movie is not. IDLE_LOOP_MS = the 80ms game tick, so a
// throttled wake still does exactly one logic step + one paint (12.5fps).
let IDLE_LOOP_MS = 80; // set from LOGIC_MS by initFramePacing
// The ZX "Emulator" room (gspec=42) animates its loading bands once per paint (the
// scroll advances in blitZX), so its animation speed IS the paint rate. The 1998
// original ran at 12.5fps; 60fps is 5x too fast and pins the CPU, while the pure
// logic rate (12.5fps) looks choppy. The port uses a ~30fps compromise: when idle in
// a ZX room the loop wakes at this rate and force-repaints, so the bands scroll at
// ~2.4x the original — smoother than 12.5fps, far cheaper than 60fps.
const ZX_ANIM_MS = 33; // ~30fps
/**
 * Idle wake period during a cutscene: HALF the logic tick, deliberately.
 *
 * A cutscene advances in `logicTick` like everything else, so it wants one paint per
 * 80ms tick and no more — but it cannot ASK for 80ms, because the throttle sleeps on
 * `setTimeout`, which is never early, and `MAX_STEPS_PER_FRAME` is 1. A wake period at
 * the tick period therefore loses a tick to jitter every so often: the leftover
 * accumulates in `acc` until the backlog guard drops it. Measured on the briefcase
 * intro, an 80ms wake ran the animation at 12.33 ticks/sec against a true 12.5 — 1.3%
 * slow on an idle machine, and it degrades with load, which is where nobody measures.
 *
 * At 40ms there is a whole spare wake of margin, so `acc` reaches the tick threshold
 * without ever reaching the guard: measured 12.50 ticks/sec, exact. The extra wake costs
 * one predicate and no paint (the frame is identical), which is a great deal cheaper
 * than the 9.5 duplicate paints per animation frame this replaces.
 */
const CUTSCENE_ANIM_MS = 40; // ~25fps: two wakes per 80ms logic tick
/**
 * Idle wake period for the `ai` tier's smooth water, on the GPU path only.
 *
 * Its OWN constant rather than a borrow of ZX_ANIM_MS above: the two happen to be
 * neighbouring numbers but they answer different questions, and tying them together means
 * a future tweak to the ZX bands silently re-prices the water in 70 rooms.
 *
 * The value is a measured trade, not a guess. Idle in room 3 — the one room with no
 * chatter script, so the only one whose idle cost can actually be measured — renderer CPU
 * against the wake rate:
 *
 *     30/s                         1.05 %   <- was ~2x main, and made the GPU path more
 *                                              expensive than canvas-2D, which it had
 *                                              never been
 *     20/s   (this)                0.74 %
 *     15/s                         0.56 %
 *     12.5/s (no water animation)  0.48 %   <- the floor; `main` measures 0.51 %
 *
 * The wave the player is watching is slow — `1/wspd` rad/tick is ~0.4 Hz for the 60 rooms
 * that share wspd=5 — so 20/s is ~50 samples per cycle of the swell and comfortably above
 * the ripple carrier (~0.8 Hz). The extra 10/s bought smoothness nothing was asking for.
 *
 * Idle only, and only when a fish is not moving: `roomAnimating()` already holds the loop
 * at the full paint rate while anything is in motion, so this never affects play.
 */
// `let`, not `const`, for the same reason RIPPLE is mutable: this is a perf/smoothness
// trade that has to be JUDGED on screen, and tools/ripple-lab.html sets it live so the
// two ends can be compared without a rebuild. Nothing in the game writes to it.
export let waterAnimMs = 50; // 20fps

/**
 * Does an IDLE frame still need repainting because the `ai` tier's water is animating
 * between logic ticks?
 *
 * The GPU compositor evaluates the wobble at `count + alpha`, so its phase now advances
 * with the PAINT rate rather than the 12.5 Hz tick. Both idle gates above it are blind
 * to that: `loopThrottleOk` drops a settled room to an 80 ms timer, and the render-on-dirty
 * signature contains `count` and nothing sub-tick. Left alone, the smooth wobble would be
 * visible only while a fish happens to be moving (which already holds the loop at 60 fps
 * via roomAnimating) and would snap back to lurching the moment the room settled — a
 * worse artefact than the one it fixes.
 *
 * So an idle wobbling AI-GPU room wakes on its own schedule, `WATER_ANIM_MS`, plus a
 * forced repaint — the same shape as the ZX room's treatment, for the same reason, but
 * priced separately (see `waterAnimMs` for the measured CPU trade). The loop stays
 * THROTTLED (the timer path, not rAF), so the idle-FPS saver's contract is intact; only
 * the delay changes.
 *
 * canvas-2D is excluded on purpose: it keeps the faithful tick-rate wobble, so it has
 * nothing to animate and must keep its current idle cost, which is the higher of the two.
 */
export let lastWaterPaint = 0;

/**
 * Should THIS frame be repainted just because the water moved?
 *
 * `aiWaterAnimating` says the water is animating; this adds the rate limit, and the two
 * are separate because they answer different questions — one picks the idle WAKE rate,
 * the other decides whether an already-awake frame owes the room a repaint.
 *
 * The limit is the point. When the loop is at the full paint rate for some OTHER reason —
 * a vector subtitle waving in is the common one — an uncapped `waterAnim` would repaint
 * the ×S composite on every one of those 60 frames, three times what the water asks for
 * (`waterAnimMs`, 20fps) and exactly the cost the render-on-dirty comment below exists to
 * avoid. Measured on tools/test-aisubs.mjs, which guards it: the ai tier's subtitle rate
 * against enhanced was 0.91 before any of this, 0.77-0.81 with an uncapped water repaint,
 * and 0.60 once ripples made each composite dearer — through a gate set at 0.70. Capped
 * here it is back at parity, and the water is unaffected because it only ever asked for
 * `waterAnimMs`.
 */
export function waterOwesRepaint(now: number): boolean {
  return aiWaterAnimating() && now - lastWaterPaint >= waterAnimMs - PAINT_EPSILON_MS;
}

export function aiWaterAnimating(): boolean {
  return (
    ui.screen === 'room' &&
    room !== null &&
    // Not just `wamp !== 0`: a gspec=2 darkness room paints a flat fill and never
    // evaluates the wave, and CHODBA reaches that state with wamp = 5 the moment the
    // player switches the light off. Asking the compositor's own predicate keeps the
    // loop from waking 20x/s for a frame that cannot change.
    aiWaterVisible(room) &&
    lastRoomBackend === 'webgl' &&
    // NOTE: the water deliberately keeps animating while a vector subtitle waves in.
    // An earlier revision suppressed it there, because with the water repainting on
    // EVERY frame it cost the subtitle a third of its rate. But that was the unrestricted
    // repaint's fault, not the water's: once `waterOwesRepaint` caps it at waterAnimMs,
    // suppression buys almost nothing and is plainly visible — the wobble (and every
    // other room animation) drops to the 12.5Hz tick rate for ~1.5s each time anyone
    // speaks, which reads as a stutter triggered by the text. Measured interleaved on an
    // idle machine, tools/test-aisubs.mjs: suppressed 0.95, running 0.90, gate 0.70. Five
    // points of a metric with that much headroom is not worth a visible hitch in 70 rooms.
    aiRoomRenderActive(room)
  );
}
/**
 * Paint-rate cap. requestAnimationFrame fires at the DISPLAY refresh — 120Hz+ on
 * current Macs — but this game steps its logic at 12.5Hz (LOGIC_MS) and interpolates,
 * so painting above 60 costs GPU/battery for no visible gain. The AI tier makes that
 * worse: it composites 4x-resolution rooms every paint.
 *
 * PHASE-LOCKED, not free-running. The obvious form — skip while `now - lastPaint` is
 * under the period, then set `lastPaint = now` — re-phases the gate to each painted
 * frame, so it only yields 60fps when the refresh rate is an exact multiple of 60.
 * Everything else aliases badly: 144Hz gave 48fps, 75Hz gave 37.5, 90Hz gave 45, 165Hz
 * gave 55. (A margin under 1000/60 hides this at 120Hz, which is why it went unnoticed.)
 *
 * The deadline itself lives in `frameClock.ts` along with the rAF handle and the idle
 * timer; these are the two numbers that price it.
 */
const MAX_PAINT_FPS = 60;
/** Rounding/jitter slack: a refresh landing a hair early still counts for this period. */
const PAINT_EPSILON_MS = 1;
// Perf HUD counters (dev mode): rAF ticks vs actual screen paints, sampled ~2×/sec.
export let perfRaf = 0;
export let perfPaint = 0;
export let perfLast = 0;
// Monotonic loop-iteration counter. `perfRaf` above is reset every HUD interval and only
// runs with the dev pane open, so a probe cannot use it to measure the idle WAKE RATE —
// which is exactly what the ai-water animation gate below changes.
//
// Counts every rAF callback, INCLUDING the refreshes the paint cap drops (they arrive
// through `onSkippedRefresh` below). That is load-bearing for `test-aisubs`, which
// divides overlay repaints by it — see the comment on that callback.
export let loopTicks = 0;
// …and how often the ROOM was actually repainted, which is a different number: the loop
// can wake without redrawing (render-on-dirty). This is the one that costs — a ×S
// composite and a present — and the one the player sees as the water moving, so it is
// what a perf or smoothness probe actually wants to measure.
export let roomPaints = 0;
export let lastRoomBackend: 'cpu' | 'webgl' = 'cpu'; // which backend actually painted the last room frame
export function updatePerfHud(now: number): void {
  perfRaf++;
  if (!perfHud || !document.body.classList.contains('dev')) {
    perfLast = now;
    perfRaf = 0;
    perfPaint = 0;
    return;
  }
  if (perfLast === 0) perfLast = now;
  const elapsed = now - perfLast;
  if (elapsed >= 500) {
    const paintFps = Math.round((perfPaint * 1000) / elapsed);
    const rafFps = Math.round((perfRaf * 1000) / elapsed);
    const where = ui.screen === 'room' ? 'room' : ui.screen === 'map' ? 'map' : ui.screen;
    // Show the SET renderer and, when it's WebGL, whether it actually engaged this
    // frame — and WHY not, if it didn't. Those are two different situations and
    // collapsing them hides a real fault: a GL failure has disabled the backend for the
    // session (fallback), whereas a frame effect / ZX room / active hook / wreck /
    // sprite cheat is a frame the CPU compositor legitimately owns and the next frame
    // may well be back on the GPU.
    let backend = host.renderer.toUpperCase();
    if (host.renderer === 'webgl' && ui.screen === 'room' && lastRoomBackend === 'cpu') {
      // Either backend being disabled counts as a fallback: which one owns this frame
      // depends on the tier, and the distinction the reader needs is "disabled for the
      // session" vs "this frame only".
      backend = glFailed || glAiFailed ? 'WEBGL→cpu(fallback)' : 'WEBGL→cpu(this frame)';
    }
    perfHud.textContent =
      `paint ${paintFps} fps   rAF ${rafFps} fps\n` +
      `saver ${host.renderOnDirty ? 'ON' : 'off'} (P)   ${backend} (R)   [${where}]`;
    perfLast = now;
    perfRaf = 0;
    perfPaint = 0;
  }
}
// Smoothness harness: null = off; an array = recording per-frame fish positions.
// `n`+`a` are the GAME-TIME coordinate of the sample (count + alpha, the exact
// value the interpolated position below is a function of) and `cf` the speed tier
// in force, so a harness can express motion in px per game tick — independent of
// how many rAF frames the machine managed to deliver.
export let smoothLog: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string }[] | null = null;

/**
 * True when the room's frame changes BETWEEN logic ticks and so needs the full
 * (capped, see MAX_PAINT_FPS) paint rate — i.e. interpolated fish motion. Wobble,
 * blink, heads, subtitles and darkness advance on the 12.5fps logic tick and are
 * caught by the `count` change in the render signature, so they animate correctly at
 * the throttled rate — matching the original's 12.5fps render. The ZX "loading" bands
 * are the exception: they advance per PAINT, so the loop wakes them separately via
 * zxAnim / ZX_ANIM_MS rather than through this predicate.
 */
export function roomAnimating(): boolean {
  if (engine && engine.phase !== 'idle') return true; // fish sliding/falling/turning/exiting/cork
  return false;
}

/**
 * Whether the loop may drop to the throttled (timer) wake rate. Three idle cases
 * qualify (all need the saver on, no intro movie, no smoothness recording):
 *  - a steady ROOM: nothing animating, no held key / KUFRIK demo / load fast-forward,
 *    the panel in its normal (non-scrolling) state, no room-art hold;
 *  - a settled MAP: no overlay (credits/options), and the reveal animation finished
 *    (only the ~7fps node pulse is left, which the throttled 12.5fps wake captures); or
 *  - a CUTSCENE, which advances only on the logic tick (see below).
 * Anything else keeps 60fps. Input (incl. map hover) wakes it via wake().
 */
export function loopThrottleOk(): boolean {
  if (!host.renderOnDirty || host.intro.playing || smoothLog !== null) return false;
  // A cutscene's picture is a pure function of state that changes once per logic tick:
  // it advances in logicTick, `drawCutscene` reads no clock and no `alpha`, and its
  // captions are DOM text animated through the Web Animations API — which runs on the
  // COMPOSITOR thread and keeps its own time (subtitleDom.ts), so it does not need the
  // main thread to be awake to stay smooth. Painting it faster than the tick can
  // therefore only produce duplicate frames, and it did: measured on the briefcase
  // intro, 119.3 loop fps against a 12.49fps animation — 9.5 paints per frame, 8.5 of
  // them byte-identical, for the whole 20-odd seconds.
  //
  // This clause used to read `|| cutscene ||` and exclude every cutscene outright. There
  // is no commit explaining it — `git log -S` bottoms out at the squashed v1.0.0 root —
  // and the obvious hypothesis (that a cutscene does not mark frames dirty and would
  // stall under the saver) is not what the code does.
  if (cutscene) return true;
  // The leg story page is a static full-screen image; once blitted it can idle at the
  // throttled wake rate (a click/key wakes it via wake() to dismiss).
  if (ui.screen === 'legimage') return ui.legImageDrawn;
  if (ui.screen === 'room') {
    return (
      !forceRoomRedraw &&
      !roomAnimating() &&
      // A vector subtitle waving in / scrolling animates BETWEEN logic ticks, so it
      // needs the full rAF rate for the ~1.5s it takes to settle (it only repaints
      // the overlay, not the room). A settled line does not, and neither does the
      // classic bitmap path, which is baked into the frame at the tick rate.
      //
      // Gated on enhancedArtActive() — every tier that USES the vector overlay (see
      // useVecSubs in framePainter's `draw`), not the literal 'enhanced' tier. Checking
      // `graphics === 'enhanced'` left the ai tier idle-throttled at 12.5fps for the
      // whole line: measured rAF 12fps in ai against 121fps in enhanced, which is
      // exactly the juddering-subtitle report.
      !(host.enhancedArtActive() && host.subFontReady && subs?.vectorAnimating(count)) &&
      host.heldState === 0 &&
      !host.inShowmode() &&
      !loadmode &&
      ui.ostav === O_NORMAL &&
      !roomArtPending()
    );
  }
  if (ui.screen === 'map' && ui.worldMap && ui.mapOverlay === 'none') {
    // A launch is a short-lived state that ends on a condition nothing repaints for
    // (the room's assets landing), so keep the loop at full rate until it does —
    // otherwise the handover waits up to a whole idle tick behind the parchment.
    if (mapLaunching() !== null) return false;
    // Keep 60fps while the record-panel odometer is still rolling (so its wall-clock
    // faze advance is sampled smoothly); once settled it can idle-throttle again.
    if (ui.mapInfoRoom !== null && ui.mapInfoFaze < INFO_SETTLE_FAZE) return false;
    // Keep 60fps until the map-reveal animation has fully traced in (UMain Depth).
    const depth = Math.floor((performance.now() - ui.mapRevealStart) / 60) - 3;
    return depth > ui.worldMap.maxDepth;
  }
  return false;
}

/**
 * How long the loop may sleep before the next frame, or `null` to stay at the full paint
 * rate. This is the pacing POLICY — which screens may idle and how fast the things that
 * still move on an idle screen need to move — and it stays here with the state it reads.
 * The mechanism it feeds (the rAF handle, the idle timer, the paint deadline) is in
 * `frameClock.ts`.
 */
function idleDelayMs(): number | null {
  if (!loopThrottleOk()) return null;
  // A cutscene needs its tick delivered on time, so it wakes at half the tick — see
  // CUTSCENE_ANIM_MS for why not at the tick itself.
  if (cutscene) return CUTSCENE_ANIM_MS;
  // A ZX room keeps animating its bands, so it wakes at ~30fps; any other idle
  // room/map wakes at the 12.5fps logic rate.
  return ui.screen === 'room' && room?.gspec === 42
    ? ZX_ANIM_MS
    : aiWaterAnimating() ? waterAnimMs : IDLE_LOOP_MS;
}

export function setLastTime(v: number): void {
  lastTime = v;
}
export function setAcc(v: number): void {
  acc = v;
}
export function setLastRoomSig(v: string): void {
  lastRoomSig = v;
}
export function setForceRoomRedraw(v: boolean): void {
  forceRoomRedraw = v;
}
export function setRoomLoading(v: boolean): void {
  roomLoading = v;
}
export function setRoomLoadSeq(v: number): void {
  roomLoadSeq = v;
}
export function setWaterAnimMs(v: number): void {
  waterAnimMs = v;
}
export function setLastWaterPaint(v: number): void {
  lastWaterPaint = v;
}
export function setPerfRaf(v: number): void {
  perfRaf = v;
}
export function setPerfPaint(v: number): void {
  perfPaint = v;
}
export function setPerfLast(v: number): void {
  perfLast = v;
}
export function setLoopTicks(v: number): void {
  loopTicks = v;
}
export function setRoomPaints(v: number): void {
  roomPaints = v;
}
export function setLastRoomBackend(v: 'cpu' | 'webgl'): void {
  lastRoomBackend = v;
}
export function setSmoothLog(v: { t: number; n: number; a: number; cf: number; x: number; y: number; ph: string }[] | null): void {
  smoothLog = v;
}

/**
 * Hand this module its view of the game, and arm the frame clock.
 *
 * `logicMs` is passed rather than imported because it is the game's tick length — a
 * property of the simulation, not of pacing — and this module only needs it as the idle
 * wake rate. The same reason `frameClock.ts` takes `maxPaintFps`.
 */
export function initFramePacing(h: FramePacingHost, logicMs: number): void {
  host = h;
  IDLE_LOOP_MS = logicMs;
  // Hand `frameClock.ts` its view of the game. Only the policy above and the loop itself
  // cross this boundary; the rAF handle, the idle timer and the paint deadline stay
  // inside the module, which is what stops unrelated regions from reaching into them.
  initFrameClock({
    frame: (now) => host.loop(now),
    idleDelayMs,
    // A capped-away refresh is still a real display refresh, so both counters must see
    // it.
    //
    // `perfRaf` feeds the HUD's rAF number, which would otherwise just mirror the paint
    // rate and make the cap invisible. `loopTicks` matters more, and less obviously: it
    // is the counter probes divide BY. `test-aisubs` asserts overlay repaints against
    // loop iterations precisely because both are counted by the same loop, so the
    // machine's speed divides out — a ratio of the loop against itself. Its healthy
    // figure is 0.50 on a 120 Hz display, where the cap lets half the refreshes through,
    // and the fault it guards reads ~0.25. Counting only the frames that survive the cap
    // would pin the ratio near 1.0 and lift the fault above the 0.4 threshold, so the
    // probe would keep passing while no longer being able to fail.
    onSkippedRefresh: () => {
      perfRaf++;
      loopTicks++;
    },
    // Drop the elapsed-time origin so the idle gap we just slept through does not arrive
    // as one enormous dt.
    onWake: () => {
      lastTime = 0;
    },
    maxPaintFps: MAX_PAINT_FPS,
    epsilonMs: PAINT_EPSILON_MS,
  });
}
