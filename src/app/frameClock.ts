/**
 * The frame clock: when the next frame happens, and at what rate.
 *
 * ── Why this is a module and not four variables in main.ts ────────────────────
 * `wake()` was the single most entangling symbol in `main.ts`. Eight regions called it —
 * tier switching, movement, the panel, the map, room loading, the cutscene, input — and
 * every one of those calls was an edge INTO the frame-pacing region, from code that has
 * no interest in requestAnimationFrame and only wants to say "the player did something,
 * do not sleep through it". Measured with `tools/region-graph.mjs`, removing it takes the
 * region cycle from 20 to 17: more than any other symbol in the file.
 *
 * None of that coupling was to the pacing *policy*, which is genuinely game-specific and
 * stays in main.ts (`loopThrottleOk`, the ZX band rate, the ai-water rate). It was all to
 * the four variables underneath — the rAF handle, the idle timer, the paint deadline —
 * which are pure mechanism and have no business being reachable from a keypress handler.
 * They live here now, and the callers see three verbs.
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Two wake sources, one at a time:
 *
 *   - **requestAnimationFrame**, the normal case, throttled to `maxPaintFps` by a
 *     phase-locked deadline (see paintClock.ts — the naive form aliases badly on any
 *     refresh rate that is not a multiple of the cap);
 *   - **a timer**, when the host says the screen is idle. The loop's own per-frame cost
 *     is then gone as well, not merely its painting, which is the point of the saver.
 *
 * `wake()` moves from the second back to the first immediately, so a keypress never waits
 * out a throttled timer.
 *
 * ── Module scope stays side-effect-free ──────────────────────────────────────
 * Nothing here runs until `initFrameClock`, which `main.ts` calls at the point the code
 * originally ran. `main.ts` is a top-level-`await` module whose boot order is
 * load-bearing, and an imported module is evaluated before any statement of its
 * importer — see AGENTS.md, "the module-evaluation trap".
 */
import { advancePaintDeadline, shouldSkipPaint } from './paintClock.js';

export interface FrameClockOptions {
  /**
   * One frame. Called with the timestamp exactly as `requestAnimationFrame` would, and
   * only for refreshes that survive the paint cap.
   */
  frame(now: number): void;
  /**
   * How long to sleep before the next frame, in ms, or `null` to stay on
   * requestAnimationFrame. Asked once per frame, at the end of it, so the answer can
   * depend on what that frame just did.
   */
  idleDelayMs(): number | null;
  /**
   * A refresh that the paint cap skipped. It is still a real display refresh, so a perf
   * HUD that wants to show the rAF rate has to count it here — otherwise the number just
   * mirrors the paint rate and the cap becomes invisible.
   */
  onSkippedRefresh?(): void;
  /**
   * Woken from the idle timer. The host uses this to drop its own timing state, so the
   * gap it slept through does not arrive as one enormous delta.
   */
  onWake?(): void;
  /** Paint-rate cap. */
  maxPaintFps: number;
  /** Rounding/jitter slack: a refresh landing a hair early still counts for this period. */
  epsilonMs: number;
}

let opts: FrameClockOptions | null = null;
// Nothing cancels this — the loop runs for the lifetime of the page — but the handle is
// kept because a rAF id that is never stored is a rAF that cannot be stopped, and the
// day something needs to stop it is not the day to go looking for where it was started.
let rafId = 0;
let idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
let nextPaint = 0;
let paintPeriodMs = 0;

function must(): FrameClockOptions {
  if (!opts) throw new Error('[frameClock] used before initFrameClock()');
  return opts;
}

/** One refresh: honour the paint cap, then hand the frame to the host. */
function tick(now: number): void {
  const o = must();
  // Skip this refresh entirely when it would exceed the cap. The host's own elapsed-time
  // accounting is deliberately left alone, so the skipped interval still accumulates:
  // the simulation sees real elapsed time either way, and capping paint therefore cannot
  // change game speed.
  if (shouldSkipPaint(now, nextPaint, o.epsilonMs)) {
    o.onSkippedRefresh?.();
    rafId = requestAnimationFrame(tick);
    return;
  }
  nextPaint = advancePaintDeadline(now, nextPaint, paintPeriodMs);
  o.frame(now);
}

/** Wire the clock to its host. Call once, from `main.ts`, before `startFrames()`. */
export function initFrameClock(o: FrameClockOptions): void {
  opts = o;
  paintPeriodMs = 1000 / o.maxPaintFps;
}

/** Begin running frames. */
export function startFrames(): void {
  must();
  rafId = requestAnimationFrame(tick);
}

/**
 * Schedule the next frame: requestAnimationFrame normally, a timer when the host reports
 * the screen idle. Call at the end of every frame.
 */
export function scheduleNextFrame(): void {
  const delay = must().idleDelayMs();
  if (delay === null) {
    rafId = requestAnimationFrame(tick);
  } else {
    idleTimer = setTimeout(() => {
      idleTimer = 0;
      tick(performance.now());
    }, delay);
  }
}

/**
 * Return to the full paint rate immediately. Called from input handlers so a keypress or
 * click never waits out a throttled timer and movement stays smooth from its first frame.
 * A no-op when we are already on requestAnimationFrame.
 */
export function wake(): void {
  if (!idleTimer) return;
  clearTimeout(idleTimer);
  idleTimer = 0;
  // Do not let the paint cap swallow the first frame after idling, and let the host drop
  // whatever it was measuring elapsed time from.
  nextPaint = 0;
  must().onWake?.();
  rafId = requestAnimationFrame(tick);
}

/**
 * Whether the clock is currently sleeping on the idle timer rather than on rAF.
 *
 * This is what `__ff.loopInfo().onTimer` reports, and several probes assert on it to
 * prove the idle-FPS saver actually engaged (or that `wake()` cancelled it) rather than
 * inferring it from a frame rate, which is load-dependent and therefore useless.
 */
export function framesIdle(): boolean {
  return idleTimer !== 0;
}
