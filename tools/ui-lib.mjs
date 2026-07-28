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
 * half a second past the last request, on every one of the 63 probes.
 *
 * Boot failure is handled explicitly: `showFatal()` reveals #fatal and `__ff` is
 * never published, so waiting on `__ff` alone would burn the whole timeout and
 * then report a bare "timeout exceeded" instead of the actual problem.
 */
export async function appReady(p, timeout = 60000) {
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

/** Open the app on the runner's port and wait until it has finished booting. */
export async function gotoApp(p) {
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

export async function withApp(fn, opts = {}) {
  const b = await launchBrowser();
  const p = await b.newPage({ viewport: { width: 1200, height: 640 } });
  const errs = [];
  p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  p.on('pageerror', (e) => errs.push('PE:' + e.message));
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
    await fn({ p, expect });
  } catch (e) {
    ok = false;
    console.log('  FAIL threw: ' + (e?.message ?? e));
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
 * Wait until a fish move settles back to the idle phase.
 *
 * The options object is the THIRD argument. Passed as the second — as this call
 * used to be — it is taken as the predicate's `arg` and silently ignored, so the
 * "5000" here was never in force and every caller was really getting Playwright's
 * 30s default. Keeping 30s rather than "fixing" it down to 5s: a move settles in
 * ~10 game ticks, but the clock slows under an 8-way parallel run, and a timeout
 * is a backstop, not an assertion.
 */
export async function idle(p) {
  await p.waitForFunction(() => window.__ff.phase() === 'idle', null, { timeout: 30000 });
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
const TICK_MS = 80;

/** Generous budget for `ticks` game ticks: 4× nominal, never below 10s. */
export const tickBudget = (ticks) => Math.max(10000, Math.ceil(ticks * TICK_MS * 4));

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
 * Wait until a room is loaded and has run more than `minCount` ticks. Throws if
 * the room never comes up: that is a real defect, not a race. The budget adds a
 * flat allowance for the asynchronous room load itself (assets are fetched from
 * the shared preview server, which several probes are hitting at once).
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
    { timeout: tickBudget(minCount) + 20000 },
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
    { timeout: 30000 },
  );
  if (minCount > 0) await waitRoom(p, minCount);
}
