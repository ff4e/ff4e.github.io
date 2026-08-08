/**
 * Shared harness for the Playwright UI tests: gets a headless Chromium (audio
 * autoplay allowed), opens the app, collects console errors, and exits non-zero
 * if any assertion fails or the page logged an error. Deterministic, no AI.
 */
import { chromium } from 'playwright';

// Chromium flags. Keep in sync with run-ui-tests.mjs, which launches the shared
// browser servers with exactly these two sets.
const PLAIN_ARGS = ['--autoplay-policy=no-user-gesture-required'];
const ANGLE_ARGS = ['--use-gl=angle', '--use-angle=metal', ...PLAIN_ARGS];

/**
 * Get a browser for a probe.
 *
 * Under `npm run test:ui` the runner has already launched two warm browser
 * SERVERS and advertised them over FF_WS_PLAIN / FF_WS_ANGLE, so a probe just
 * connects (milliseconds) instead of paying for a cold `chromium.launch()` —
 * which the suite used to do 63 times per run. Isolation is unchanged: every
 * probe still gets its own context (own localStorage/cookies/saved games), and
 * `browser.close()` on a connected browser drops just this probe's contexts and
 * disconnects, leaving the server up for the other workers.
 *
 * Run a probe by hand (`node tools/test-x.mjs`) with no server advertised and it
 * transparently launches its own private browser, exactly as before.
 *
 * @param {{gl?: boolean}} opts `gl: true` selects the ANGLE/Metal browser, which
 *   the WebGL probes need. The CPU-oracle probes must NOT get those flags: they
 *   can change 2D rasterization, and byte-exact CPU output is what they assert.
 */
export async function launchBrowser(opts = {}) {
  const ws = opts.gl ? process.env.FF_WS_ANGLE : process.env.FF_WS_PLAIN;
  if (ws) return await chromium.connect(ws);
  return await chromium.launch({ args: opts.gl ? ANGLE_ARGS : PLAIN_ARGS });
}

/**
 * Wait for the app to be READY. `window.__ff` is published at the very end of
 * boot (main.ts), after the world map, the panel and every other critical asset
 * has loaded — so this is a strictly *stronger* condition than the
 * `waitUntil: 'networkidle'` it replaces, and far cheaper: networkidle lingers
 * half a second past the last request, on every one of the 81 probes.
 *
 * Boot failure is handled explicitly: `showFatal()` reveals #fatal and `__ff` is
 * never published, so waiting on `__ff` alone would burn the whole timeout and
 * then report a bare "timeout exceeded" instead of the actual problem.
 */
export async function appReady(p, timeout = WAIT_BACKSTOP) {
  await p.waitForFunction(
    () => window.__ff !== undefined || document.getElementById('fatal')?.hidden === false,
    null,
    { timeout },
  );
  if (await p.evaluate(() => window.__ff === undefined)) {
    const msg = await p.evaluate(() => document.getElementById('fatal-msg')?.textContent ?? '');
    throw new Error(`the app failed to boot: ${msg.trim()}`);
  }
}

/**
 * Open the app on the runner's port and wait until it has finished booting.
 *
 * Also installs the one wait backstop this page will use. It goes here rather than in
 * `withApp` because a dozen probes (the WebGL ones, test-fonts, test-ai-wreck) drive their
 * own page and never call `withApp` — they would otherwise silently keep Playwright's 30s
 * default, which is the very mismatch this replaced.
 */
export async function gotoApp(p) {
  p.setDefaultTimeout(WAIT_BACKSTOP);
  const port = process.env.FF_UI_PORT ?? '5173';
  await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded' });
  await appReady(p);
}

/** Reload the app and wait until it has finished booting again. */
export async function reloadApp(p) {
  await p.reload({ waitUntil: 'domcontentloaded' });
  await appReady(p);
}

/**
 * Exit a probe with its verdict, flushing stdout first.
 *
 * `process.exit()` discards whatever is still queued on the pipe to the runner —
 * measured: a child writing 500 kB then exiting delivers only the first 8 kB. The
 * runner captures probe output through that pipe, so on a mass failure (say a GL
 * parity probe reporting all 72 rooms) plain `process.exit()` would throw away
 * exactly the diagnostics you need. Writes are ordered, so a zero-length write's
 * completion callback fires only once everything before it has drained.
 */
export function exitProbe(code) {
  process.stdout.write('', () => process.exit(code));
}

/**
 * The probe line that threw, appended to the failure message.
 *
 * A wait that times out reports `page.waitForFunction: Timeout 30000ms exceeded` and
 * nothing else — and a probe has up to eighteen waits in it. Recovering which one fired
 * used to mean re-running the probe under an instrumented harness; the frame is already
 * in the error, so print it. Only frames inside a probe are useful (the top frames are
 * Playwright's own), and a missing stack must not itself throw.
 */
function failureSite(e) {
  const frame = (e?.stack ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /tools[/\\]test-[\w-]+\.mjs:\d+/.test(l));
  if (!frame) return '';
  const at = frame.match(/(test-[\w-]+\.mjs:\d+:\d+)/);
  return at ? `  [at ${at[1]}]` : '';
}

export async function withApp(fn, opts = {}) {
  const b = await launchBrowser();
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  const errs = [];
  // Errors a probe DELIBERATELY provokes (`opts.allowErrors`, a RegExp).
  //
  // A page error normally fails the probe, and that default is load-bearing — it is how
  // this suite catches the exceptions nobody thought to assert on. But a probe that
  // breaks an asset ON PURPOSE, to test how the game copes, cannot live with it: the
  // thing it is testing IS the error. Rather than deleting the check for those probes,
  // matching errors are diverted here and handed to the probe, which then has to ASSERT
  // it saw them. That makes the exemption stronger than the default, not weaker: an
  // allowed error that never arrives is a failure, and an error outside the allowlist
  // still fails the probe as usual.
  const allowed = [];
  const keep = (t) => {
    if (opts.allowErrors?.test(t)) allowed.push(t);
    else errs.push(t);
  };
  p.on('console', (m) => m.type() === 'error' && keep(m.text()));
  p.on('pageerror', (e) => keep('PE:' + e.message));
  // By default, boot as a returning player (skip the first-run intro): the intro
  // is a full-screen overlay that swallows input, so tests that drive keys/mouse
  // must not sit behind it. The intro test opts into first-run via { firstRun: true }.
  if (!opts.firstRun) {
    await p.addInitScript(() => {
      try {
        const raw = localStorage.getItem('ff.options');
        const o = raw ? JSON.parse(raw) : {};
        o.introSeen = true; // merge, so a test's persisted volume/subtitle settings survive
        localStorage.setItem('ff.options', JSON.stringify(o));
      } catch {
        /* storage unavailable */
      }
    });
  }
  // Probes that read pixels off #screen (the CPU 2D canvas) must pin the CPU
  // backend: it is the deterministic oracle surface. In WebGL mode the room is
  // presented on the stacked #screen-gl canvas and #screen is left blank, so a
  // getImageData read there would see nothing. WebGL parity is covered separately
  // by the test-gl-* probes (byte-exact vs this CPU path).
  if (opts.cpu) {
    await p.addInitScript(() => {
      try {
        localStorage.setItem('ff.renderer', 'cpu');
      } catch {
        /* storage unavailable */
      }
    });
  }
  // Probes that assert on a SPECIFIC art tier must pin it rather than inherit the
  // default (which is `ai`). Anything comparing pixels against the enhanced/classic
  // art, or measuring a redraw region, needs the tier it was written for — the AI
  // tier substitutes different (upscaled) art for the same elements.
  if (opts.graphics) {
    const g = opts.graphics;
    await p.addInitScript((lvl) => {
      try {
        localStorage.setItem('ff.graphics', lvl);
      } catch {
        /* storage unavailable */
      }
    }, g);
  }
  // The tuning chrome (room dropdown + fit/renderer/saver controls) and the one-key
  // dev toggles (E/R/P/F/G) are gated behind the developer pane, which is off for
  // players and enabled with Ctrl+Alt+D (persisted as ff.devEnabled). Enable it for
  // automation so selectOption('#room') and the dev hotkeys work; set it in
  // localStorage before boot so it survives reloads (test-options reloads mid-run).
  await p.addInitScript(() => {
    try {
      localStorage.setItem('ff.devEnabled', '1');
    } catch {
      /* storage unavailable */
    }
  });
  let ok = true;
  const expect = (cond, msg) => {
    if (!cond) ok = false;
    console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
  };
  try {
    // Inside the try: a boot failure is a probe failure like any other, and this
    // way it is reported with the console/page errors collected above rather than
    // escaping as an unhandled rejection with no context.
    await gotoApp(p);
    await fn({ p, expect, allowed });
  } catch (e) {
    ok = false;
    console.log('  FAIL threw: ' + (e?.message ?? e) + failureSite(e));
  }
  if (errs.length) {
    ok = false;
    console.log('  console errors:', errs);
  }
  await b.close().catch(() => {});
  console.log(ok ? 'PASS' : 'FAIL');
  exitProbe(ok ? 0 : 1);
}

/**
 * Did a wait see its condition inside its budget? Use where the WAIT IS THE ASSERTION.
 *
 * For a transient condition — a sound playing, a line on screen — re-reading it after the
 * wait is a race with the thing itself: `test-ves` waited for the head to sing, the wait
 * succeeded, and the separate re-read a moment later reported failure because the vocal
 * had finished. The wait already observed it; that is the evidence.
 *
 * A bare `.catch(() => false)` would do this, and is wrong: it also swallows a predicate
 * that THREW. A renamed hook would then be reported as "the head never sang" instead of
 * as the TypeError it is. Only a timeout means "the condition did not happen".
 */
export async function observed(wait) {
  try {
    await wait;
    return true;
  } catch (e) {
    if (e?.name !== 'TimeoutError') throw e;
    return false;
  }
}

/**
 * Wait until a fish move settles back to the idle phase.
 *
 * The options object is the THIRD argument. Passed as the second it lands in Playwright's
 * `arg` slot and the timeout is silently discarded — the mistake this call used to make,
 * and 240 others across the probes did too. `test/uiProbeWaits.test.ts` now fails the
 * build if it comes back.
 *
 * No timeout here: a move settles in ~10 game ticks, well inside the page-wide
 * WAIT_BACKSTOP, and a number that is never reached teaches the next reader nothing.
 */
export async function idle(p) {
  await p.waitForFunction(() => window.__ff.phase() === 'idle');
}

// ── Waiting on GAME time ──────────────────────────────────────────────────────
// The game clock is wall-clock driven (LOGIC_MS ≈ 80ms per tick, ~12.5 ticks/s)
// and deliberately never fast-forwards a backlog: under load the game simply runs
// slower (main.ts `loop`). So a timeout sized just above a wait's nominal duration
// is not a check, it is a race — and it is the *timeout* that loses, reporting a
// fake failure while the assertion below it would have passed. Those tight budgets
// (test-sloupy waited 200 ticks ≈ 16s with a 20s timeout) are exactly what broke
// once the suite began running 8 probes at a time.
//
// So: budget game-time waits generously here, in one place. This weakens nothing —
// the probes' own assertions ("advanced >= 200") still decide pass/fail; the
// timeout only bounds a genuinely stuck clock.
//
// The same reasoning applies one level up, to the WAIT ITSELF: `waitForTimeout(N)`
// as a stand-in for "let the game run a while" is a race with the machine, because
// the game time it buys is whatever is left over after the load. Use `tickSleep` /
// `forTicks` below instead — they wait on the clock the assertion is really about.
// Wall-clock sleeps are legitimate only for things that genuinely run on wall time
// (CSS transitions, the play-time odometer, an HTTP throttle) and for the handful
// of EXCLUSIVE probes that measure a rate.
export const TICK_MS = 80;

/**
 * The backstop every wait gets by default, applied once per page in `gotoApp`.
 *
 * A wait's timeout is not a check — the probe's own assertion decides pass/fail — so the
 * only job this number has is to stop a genuinely stuck condition from hanging the probe
 * forever. Sizing it per call site was tried and was worse than useless: 241 of 297 sites
 * had their number in Playwright's `arg` slot where it was silently discarded, so the
 * source said one thing and the suite did another for years.
 *
 * 60s is ~8x the slowest ordinary wait measured in an 8-way parallel run, and small enough
 * that a probe which trips several of these still reports its own failure before the
 * runner's 10-minute per-probe backstop kills it (see PROBE_TIMEOUT_MS in run-ui-tests).
 * That upper bound is the real constraint: `expect` does not throw, so a broken probe runs
 * every remaining wait, and a budget generous enough to look safe in isolation turns a
 * readable assertion failure into "probe exceeded 600s and was killed".
 */
export const WAIT_BACKSTOP = 60000;

/**
 * A LARGER budget for the few waits that genuinely need one: 12x the nominal duration on
 * an idle machine, never below the backstop, never above 5 minutes.
 *
 * Only for waits measured to outrun WAIT_BACKSTOP under load — a story page that arrives
 * after a 30-tick win countdown, a replay that has to reach its 289th recorded action.
 * Everything else inherits the backstop and says nothing, because a number that is never
 * reached teaches the next reader nothing.
 *
 * 12x is from measurement: tracing every wait alone and again in the 8-way pool put the
 * contention factor at 4-22x, median ~8x. The game clock is the reason it is that wide —
 * it is wall-clock driven and never fast-forwards a backlog, so under load the game simply
 * runs slower and every game-time wait stretches with it.
 */
export const budget = (nominalMs) => Math.min(300000, Math.max(WAIT_BACKSTOP, Math.ceil(nominalMs * 12)));

/**
 * Budget for a wait on `ticks` of GAME time — `budget()` applied to their nominal duration.
 *
 * On a deliberately loaded machine (4 CPU hogs + the 8-way probe pool) the observed clock
 * ran at 0.5-3 ticks/s against a nominal 12.5 — a 4-25x slowdown — and a 4x/10s budget
 * turned that into fake failures (`ZDVIZ1 ran 28 ticks` where 30 were asked for).
 *
 * Below ~62 ticks the backstop dominates and this returns WAIT_BACKSTOP. That is the
 * intended shape, not a lost parameter: a short tick wait needs no more than the backstop,
 * and the multiplier only starts to matter for the long ones (the suite's longest asks for
 * 250 ticks, i.e. 240s).
 */
export const tickBudget = (ticks) => budget(ticks * TICK_MS);

/**
 * Wait for the game clock to advance `ticks` from `start`. Never throws — the
 * caller asserts on how far the clock actually got.
 */
export async function waitTicks(p, start, ticks) {
  await p
    .waitForFunction(([s, n]) => window.__ff.count() >= s + n, [start, ticks], {
      timeout: tickBudget(ticks),
    })
    .catch(() => {});
}

/**
 * Wait for `n` RENDERED frames.
 *
 * The right unit when the assertion is about what is ON SCREEN — a canvas' pixels or
 * an element's display — after a state change. Those land on the next paint, not with
 * the state write, so waiting on the state alone races the compositor (and waiting a
 * fixed number of milliseconds races the machine). This waits exactly as long as the
 * machine needs to deliver the frames, and no longer.
 */
export async function waitFrames(p, n = 2, timeout = 30000) {
  await p.evaluate(
    ([want, ms]) =>
      new Promise((done) => {
        let seen = 0;
        // rAF stops being delivered on a hidden or occluded page (test-idlefps fakes
        // exactly that), so the frame chain alone can wedge a probe until the runner's
        // 10-minute backstop. Bound it here and let the caller's assertion be the
        // verdict, as everywhere else in this file.
        const bail = setTimeout(done, ms);
        const step = () => {
          if (++seen >= want) {
            clearTimeout(bail);
            done();
          } else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    [n, timeout],
  );
}

/**
 * Sleep `ticks` of GAME time — the load-independent replacement for
 * `waitForTimeout(ticks * 80)`.
 *
 * A wall-clock sleep buys a number of game ticks that depends on how busy the
 * machine is, so every assertion about what the game did during it is really an
 * assertion about the machine. Under load such a sleep either fails (the game did
 * not get far enough) or silently weakens (a "nothing happened in this window"
 * check observes a window with almost no game time in it). Waiting on the clock
 * itself removes both, and is faster on an idle machine.
 *
 * Returns the ticks actually elapsed, so a caller that cares can assert on it.
 *
 * THROWS if the clock does not get there inside the budget. That is deliberate: most
 * callers use this before a "nothing happened" assertion, and a stuck clock would let
 * every one of them pass vacuously — the same silent weakening this helper exists to
 * remove, just caused by a real defect instead of by load. The budget is generous
 * enough (12x nominal) that only a genuinely stalled clock reaches this.
 */
export async function tickSleep(p, ticks) {
  const start = await p.evaluate(() => window.__ff.count());
  const t0 = Date.now();
  await waitTicks(p, start, ticks);
  const advanced = (await p.evaluate(() => window.__ff.count())) - start;
  if (advanced < ticks) {
    const where = await p.evaluate(() => window.__ff.screen());
    throw new Error(
      `the game clock advanced only ${advanced} of ${ticks} ticks in ${Date.now() - t0}ms ` +
        `(screen=${where}) — it is stalled, or this wait ran outside a room (count only ` +
        `advances while screen === 'room')`,
    );
  }
  return advanced;
}

/**
 * Sample repeatedly until the game clock has advanced `ticks` from now — the
 * load-independent replacement for `for (i < N) { waitForTimeout(ms); sample() }`.
 *
 * Those loops observe `N * ms` of WALL time, i.e. a variable and (under load,
 * badly) shrinking amount of GAME time; this one observes exactly the game time
 * asked for. `sample` may return `false` to stop early (condition met). Returns
 * the ticks actually elapsed.
 */
export async function forTicks(p, ticks, sample, everyMs = 60) {
  const start = await p.evaluate(() => window.__ff.count());
  const deadline = Date.now() + tickBudget(ticks);
  let n = start;
  for (;;) {
    const more = await sample();
    n = await p.evaluate(() => window.__ff.count());
    if (more === false || n - start >= ticks || Date.now() >= deadline) break;
    await p.waitForTimeout(everyMs);
  }
  return n - start;
}

/**
 * Wait until a room is loaded and has run more than `minCount` ticks. Throws if
 * the room never comes up: that is a real defect, not a race. The budget adds a
 * flat allowance for the asynchronous room load itself (assets are fetched from
 * the shared preview server, which several probes are hitting at once).
 *
 * The budget comes from `minCount` so it still means something if a caller ever asks for a
 * long run-in; for the counts callers actually use (<= 25 ticks) it resolves to the plain
 * backstop, which already covers the asynchronous room load.
 *
 * `!roomLoading()` is the load-complete gate, and it is not optional: enterRoom()
 * sets `screen = 'room'` synchronously but loads the room asynchronously, so for
 * a moment `screen() === 'room' && count() > 0` is satisfied by the PREVIOUS
 * room. Act inside that window and the room build landing a moment later
 * silently discards whatever you did.
 */
export async function waitRoom(p, minCount = 0) {
  await p.waitForFunction(
    (n) => window.__ff.screen() === 'room' && !window.__ff.roomLoading() && window.__ff.count() > n,
    minCount,
    { timeout: tickBudget(minCount) },
  );
}

/**
 * Pick a room from the developer room dropdown and wait until that room really
 * is the live one.
 *
 * `selectOption` only fires the change handler; the room load it starts is
 * asynchronous and unawaited (unlike `__ff.enterRoomAwait()`, which returns the
 * load promise).
 *
 * Waiting on `roomNum()` alone is NOT enough, which is subtle enough to spell
 * out: boot itself loads room 7, so for the many probes whose first act is
 * `selectRoom(p, 7)` the condition "we are in room 7" is already true while the
 * app still sits on the map — the wait would return before the change handler had
 * even run. So we anchor on `roomLoads()`, the count of COMPLETED loads: waiting
 * for it to exceed the value we sampled *before* selecting means we are looking
 * at a load this call caused, not one that had already happened. That also covers
 * re-selecting the room you are already in.
 */
export async function selectRoom(p, num, minCount = 0) {
  const seq = await p.evaluate(() => window.__ff.roomLoads());
  await p.selectOption('#room', String(num));
  await p.waitForFunction(
    ([n, before]) =>
      window.__ff.roomLoads() > before &&
      !window.__ff.roomLoading() &&
      window.__ff.roomNum() === n &&
      window.__ff.screen() === 'room',
    [Number(num), seq],
  );
  if (minCount > 0) await waitRoom(p, minCount);
}
