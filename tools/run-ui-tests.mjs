/**
 * UI-test runner: builds the app (`vite build`), serves it with `vite preview`,
 * launches the shared browser servers, then runs every Playwright browser test
 * (tools/test-*.mjs) — most of them CONCURRENTLY — aggregating pass/fail from their exit codes. Non-AI and
 * CI-friendly: `npm run test:ui`.
 *
 * Each browser test must exit 0 on pass / non-zero on fail.
 *
 * ── Concurrency model (read this before adding a probe) ────────────────────────
 * The suite used to run strictly serially, one cold Chromium per probe, and took
 * ~15 minutes while the CPU sat idle >47 % of the wall clock. Three things fixed
 * that, none of which touch a single assertion:
 *
 *  1. A worker pool runs FF_UI_JOBS probes at once (default: round(cores * 0.6), floored
 *     at 2 and capped at 8 — see the note on `jobs` below).
 *     Each probe is still its own `node` process with its own browser CONTEXT, so
 *     the isolation the probes rely on (localStorage, cookies, saved games) is
 *     unchanged. Probe output is buffered and printed as one block on completion,
 *     so parallel logs never interleave.
 *  2. Two shared browser SERVERS are launched once here and advertised over
 *     FF_WS_PLAIN / FF_WS_ANGLE; `ui-lib.mjs` connects to them instead of paying
 *     for a cold `chromium.launch()` in all 81 probes. Two servers, not one,
 *     because the WebGL probes need ANGLE/Metal and the CPU-oracle probes must
 *     NOT get those flags (they could change 2D rasterization).
 *     Single-sample A/B when this was added: 164s with, 226s without. Treat that
 *     gap as indicative, not exact — repeat runs of one configuration on this
 *     machine span 164-205s, so the noise is a sizeable fraction of the delta.
 *  3. Probes are scheduled longest-first from a cached timing file, so the long
 *     tail doesn't strand the pool at the end of the run.
 *
 * Probes whose assertions measure real time (tick rate, idle-throttle, animation
 * pacing, per-frame motion) cannot share the machine with a poolful of busy Chromiums, so
 * they are listed in EXCLUSIVE below and run alone, after the pool has drained,
 * each in its own freshly launched browser. If you add a probe that asserts on
 * wall-clock rates, add it there — do not relax its bounds.
 *
 * The preview server's port is picked per run (see FIXED_PORT below) so that two
 * worktrees of this repo can run the suite concurrently.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';
import { chromium } from 'playwright';
import {
  HOST,
  PreviewError,
  buildApp,
  isUp,
  root,
  startPreview,
  stopPreview,
} from './preview-server.mjs';

// A freshly-spawned server on a port of OUR choosing every run, so the UI tests
// always validate the CURRENT build — never a stale dev server the developer
// happens to have open on 5173 (that reuse hid the SPA-fallback regression).
//
// The port is picked PER RUN rather than fixed, because this repo is normally
// checked out as several git worktrees (one directory per branch) and a fixed port
// let two concurrent suites wreck each other: the loser aborted with "port already
// in use", or — worse — the winner's server was torn down mid-suite and probes
// reported bogus `Failed to fetch` / `ERR_CONNECTION_REFUSED` failures that
// disappeared when re-run individually. Choosing a port costs nothing and gives up
// none of the freshness guarantee: we still spawn our own `--strictPort` server and
// still never adopt one that is already listening.
//
// Set FF_UI_PORT to pin the port anyway (handy when something outside the runner
// has to know it in advance, e.g. a manual probe run against a hand-started server).
const FIXED_PORT = Number(process.env.FF_UI_PORT) || null;
// The port this run actually got. Assigned by startPreview(), read by runProbe().
let port = FIXED_PORT;
const toolsDir = dirname(fileURLToPath(import.meta.url));

// Chromium flags. Keep in sync with ui-lib.mjs (which uses the same two sets when
// it has to launch a private browser, i.e. when a probe is run directly by hand).
const PLAIN_ARGS = ['--autoplay-policy=no-user-gesture-required'];
const ANGLE_ARGS = ['--use-gl=angle', '--use-angle=metal', ...PLAIN_ARGS];

// Probes that assert on wall-clock behaviour — they must not share the machine.
// This lane is for probes that measure a RATE (something per second of real time).
// A probe that measures how the game evolves per GAME TICK does not belong here:
// normalising by the tick count makes it immune to a loaded machine outright, which
// is both cheaper (it goes back in the pool) and stronger than a quiet lane.
// test-smoothness used to sit here for exactly that reason and flaked anyway — the
// lane guarantees no other PROBE, not a quiet machine — so it was reworked instead.
/**
 * Probes known to fail intermittently for reasons that are NOT the change under test,
 * and how many extra attempts each may have.
 *
 * Retries are dangerous and this list is deliberately narrow, because a retry is a way
 * to make a real failure disappear. Two rules keep that from happening:
 *
 *   1. ONLY probes named here are ever retried. A probe that has never flaked before is
 *      reporting a regression the first time it fails, and it is reported as a failure.
 *      Never add a probe here to quiet a failure you have not diagnosed.
 *   2. A retried pass is NOT a silent pass. It is reported as FLAKY, counted separately
 *      in the summary, and the failed attempts are printed. If a probe here stops being
 *      flaky, the summary stops mentioning it and the entry should be deleted.
 *
 * Each entry needs a reason and, where known, who owns the fix.
 */
const KNOWN_FLAKY = new Map([
  // "a cached room entry never flashes the loading overlay" — fails on a clean main.
  // Measured 2026-08-09 with a paired A/B (two preview servers, alternating runs so both
  // revisions saw the same machine load): base 4/10, unrelated branch 5/10. Owned by the
  // fish_fillets_cached_entry_flash work; delete this entry when that lands.
  //
  // Two retries MITIGATE it and do not fix it: over five filtered runs the outcome was
  // 1 clean pass, 2 flaky passes, and 2 runs where all three attempts failed. The count
  // is deliberately not raised further — a probe this unreliable should be able to go
  // red, because burying it under six attempts teaches everyone to distrust the suite
  // instead of fixing the bug.
  ['test-ai-loading.mjs', 2],
]);

const EXCLUSIVE = new Set([
  'test-timing.mjs', // asserts the game clock keeps up with wall clock, frame budget permitting
  'test-idlefps.mjs', // asserts the render loop drops to the idle timer
  'test-mapinfo.mjs', // world-map animation pacing, measured over rAF frames
  // Samples the loop's throttle decision across a wave-in, and counts room repaints
  // against a wall-clock window to check the water cap.
  'test-aisubs.mjs',
  // Samples loopThrottleOk() over wall-clock windows to catch a line while it is
  // still animating; a loaded machine can settle the line before it samples.
  'test-tierperf.mjs',
]);

// Pool width. Sized by measurement, and the right number went DOWN once the probes
// stopped failing early: a probe is mostly waiting on the GAME clock, which is
// wall-clock driven and shares the machine, so an extra worker slows every other
// worker's clock rather than buying throughput.
//
// CALIBRATED, NOT DERIVED. The evidence is one 10-core machine with the suite green
// (81/81): 8 workers 443/427s, 6 workers 394/407s, 5 workers 438s — and at 6 the total
// probe-seconds are ~510s LOWER than at 8, i.e. nearly every probe finishes sooner.
// `cores - 2` used to give 8 here, which is past the knee. The 0.6 ratio is a way of
// carrying "6 on this box" to other core counts, not a law; nothing has been measured on
// a 4-core CI runner or a 32-core workstation. Set FF_UI_JOBS if your machine disagrees.
const jobs = Math.max(1, Number(process.env.FF_UI_JOBS) || Math.min(8, Math.max(2, Math.round(cpus().length * 0.6))));

// Deadlock backstop for a single probe (see runProbe). The slowest probe is ~150s.
/** A probe over this multiple of the run's median is reported. Set so today's 72-room
 *  sweeps (~15x) surface, while the ordinary long tail (p90 is ~5x) does not. */
const COST_RATIO = 8;
const PROBE_TIMEOUT_MS = Math.max(60000, Number(process.env.FF_UI_PROBE_TIMEOUT_MS) || 600000);

// Longest-first scheduling needs to know how long each probe took last time.
// Cached outside the working tree so it is never committed and never stale-checked.
const cacheDir = join(root, 'node_modules', '.cache');
const cacheFile = join(cacheDir, 'ff-ui-timings.json');
function readTimings() {
  try {
    return JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    return {};
  }
}
function writeTimings(t) {
  try {
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(t, null, 1));
  } catch {
    /* a missing cache only costs scheduling quality, never correctness */
  }
}

/**
 * Run one probe, capturing its output so parallel probes don't interleave.
 *
 * Resolves on `close`, not `exit`: `exit` can fire while the stdout/stderr pipes
 * still hold buffered bytes, which would silently truncate the diagnostics of the
 * very run you are trying to debug.
 *
 * PROBE_TIMEOUT_MS is a deadlock backstop, not a race participant — without it a
 * single wedged probe holds a worker forever, `Promise.all` never settles, and
 * the browser servers and preview server are never cleaned up. Sized far above
 * the slowest probe (~150s) so it can only ever fire on a genuine hang.
 */
function runProbe(file, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn('node', [join('tools', file)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FF_UI_PORT: String(port), ...env },
    });
    let out = '';
    let note = '';
    let escalate = null;
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));

    const kill = setTimeout(() => {
      note = `probe exceeded ${PROBE_TIMEOUT_MS / 1000}s and was killed`;
      c.kill('SIGTERM');
      // SIGTERM can be swallowed by a wedged Chromium client; make sure the worker
      // is released either way.
      escalate = setTimeout(() => c.kill('SIGKILL'), 5000);
    }, PROBE_TIMEOUT_MS);

    c.on('error', (e) => {
      note = `failed to spawn: ${e.message}`;
    });
    c.on('close', (code, signal) => {
      clearTimeout(kill);
      clearTimeout(escalate);
      if (!note && signal) note = `killed by ${signal}`;
      resolve({ t: file, ok: code === 0 && !note, ms: Date.now() - t0, out, note });
    });
  });
}

/**
 * How much of a probe's own output to print.
 *
 * A passing probe's body is a list of assertions that held, and it is the bulk of what
 * this suite prints: measured on a green run, 1 019 `ok` lines were 81% of the output
 * (13 400 of 16 600 tokens). Nobody reads them, and an agent that runs the suite then
 * carries all of it in context on every subsequent model call for the rest of the task.
 *
 * So a PASS prints its verdict line only. Everything that could carry information is
 * kept in full:
 *   - a FAIL prints its whole body — the assertions that held are the context for the
 *     one that did not, and are exactly what you need to see;
 *   - a FLAKY pass prints in full too, because the failed attempts are the interesting
 *     part and a retried pass must never look like a clean one;
 *   - a `console errors:` line means the page threw even though the probe passed, which
 *     is a real signal and is surfaced rather than swallowed.
 *
 * `--verbose` (or FF_UI_VERBOSE=1) restores the old behaviour for when you genuinely
 * want to read what a green probe checked.
 */
const VERBOSE = process.argv.includes('--verbose') || process.env.FF_UI_VERBOSE === '1';

/** Lines worth keeping from an otherwise-quiet passing probe. */
function signalLines(out) {
  return out
    .split('\n')
    .filter((l) => /^\s*(console errors:|FAIL|WARN|SKIP)/.test(l))
    .join('\n');
}

function report(r) {
  const why = r.note ? ` (${r.note})` : '';
  const verdict = r.ok ? (r.flaky ? `FLAKY (passed after ${r.flaky} retr${r.flaky === 1 ? 'y' : 'ies'})` : 'PASS') : 'FAIL';
  console.log(`\n=== ${r.t} — ${(r.ms / 1000).toFixed(1)}s — ${verdict}${why} ===`);
  const full = VERBOSE || !r.ok || r.flaky;
  const body = full ? r.out : signalLines(r.out);
  if (body.trim()) process.stdout.write(body.endsWith('\n') ? body : body + '\n');
}

/**
 * Run one probe, retrying it only if it is on the KNOWN_FLAKY list.
 *
 * The output of every failed attempt is kept and printed, so a "flaky pass" still shows
 * you what went wrong — the point is to stop a known-bad probe from failing the run, not
 * to hide it.
 */
async function runProbeWithRetries(file, env) {
  const extra = KNOWN_FLAKY.get(file) ?? 0;
  let r = await runProbe(file, env);
  if (r.ok || extra === 0) return r;
  const attempts = [r];
  for (let i = 0; i < extra && !r.ok; i++) {
    r = await runProbe(file, env);
    attempts.push(r);
  }
  // Total the time actually spent, so the summary does not under-report a probe that
  // cost three runs, and the scheduler still learns a single run's duration.
  const spent = attempts.reduce((s, a) => s + a.ms, 0);
  return r.ok
    ? { ...r, flaky: attempts.length - 1, ms: spent, out: attempts.map((a) => a.out).join('\n') }
    : { ...r, ms: spent, note: `${attempts.length} attempts, all failed${r.note ? `; ${r.note}` : ''}` };
}

/** Worker pool: `limit` probes in flight, longest-first. */
async function runPool(files, limit, env, results) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const r = await runProbeWithRetries(files[i], env);
      report(r);
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
}

let plainServer = null;
let angleServer = null;

/**
 * Tear down everything we started. Safe to call more than once, and safe to call
 * before any of it exists — every exit path goes through here, because leaving an
 * orphaned `vite preview` behind wedges its port (and, since it answers on a port
 * we may later be handed again, could serve a stale build to a future run).
 */
async function cleanup() {
  await plainServer?.close().catch(() => {});
  await angleServer?.close().catch(() => {});
  plainServer = angleServer = null;
  stopPreview();
}

/** Progress line from the shared preview machinery, tagged like the rest of this runner. */
const log = (m) => console.log(`[test:ui] ${m}`);

/** Bail out with a message, leaving nothing running behind us. */
async function die(msg) {
  console.error(`[test:ui] ${msg}`);
  await cleanup();
  process.exit(1);
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    void cleanup().finally(() => process.exit(130));
  });
}

// Only meaningful for a pinned port — fail before the build rather than after it.
// An auto-picked port is chosen below, once there is something to serve.
if (FIXED_PORT && (await isUp(FIXED_PORT)))
  await die(`port ${FIXED_PORT} is already in use; stop the process on it and retry`);

try {
  await buildApp(log);
} catch (e) {
  await die(e instanceof PreviewError ? e.message : String(e?.message ?? e));
}

try {
  port = await startPreview({ fixedPort: FIXED_PORT, log });
} catch (e) {
  await die(e instanceof PreviewError ? e.message : String(e?.message ?? e));
}

/**
 * Run a SUBSET: `npm run test:ui -- cheat options` runs every probe whose filename
 * contains "cheat" or "options".
 *
 * For the inner loop. The whole suite is 315s wall, and a session fixing one bug
 * usually cares about three probes — paying 315s per iteration is what makes people
 * stop checking. The full run is still what a PR needs; this is for the twenty runs
 * before it.
 *
 * A pattern that matches nothing is an error, not an empty green run: silently passing
 * zero probes is the one outcome that would let a typo look like success.
 */
const patterns = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const every = readdirSync(toolsDir)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort();
const all = patterns.length ? every.filter((f) => patterns.some((p) => f.includes(p))) : every;
if (!all.length) await die(`no probe matches ${patterns.map((p) => `"${p}"`).join(', ')}`);
if (patterns.length)
  console.log(`[test:ui] filtered to ${all.length}/${every.length} probes: ${all.join(', ')}`);

const timings = readTimings();
// Longest-first so the long tail starts early; unknown probes go first (they are
// new, and guessing them long is the cheap mistake).
const byLongest = (a, b) => (timings[b] ?? Infinity) - (timings[a] ?? Infinity);
const parallel = all.filter((f) => !EXCLUSIVE.has(f)).sort(byLongest);
const exclusive = all.filter((f) => EXCLUSIVE.has(f)).sort(byLongest);

console.log(
  `[test:ui] ${all.length} probes · ${parallel.length} in a pool of ${jobs} · ${exclusive.length} exclusive`,
);

const t0 = Date.now();
const results = [];
try {
  // One warm browser server per flag set, shared by every probe (see the header).
  // Inside the try, so a launch failure still tears the preview server down.
  plainServer = await chromium.launchServer({ args: PLAIN_ARGS });
  angleServer = await chromium.launchServer({ args: ANGLE_ARGS });
  const env = { FF_WS_PLAIN: plainServer.wsEndpoint(), FF_WS_ANGLE: angleServer.wsEndpoint() };

  await runPool(parallel, jobs, env, results);
  // Drained: the wall-clock-sensitive probes now have the machine to themselves.
  // They also get PRISTINE browsers — passing no FF_WS_* makes each launch its own
  // (see launchBrowser in ui-lib). The shared servers have by this point hosted
  // ~60 contexts, and a probe that fails on a single dropped frame should not be
  // measuring that: test-smoothness reported 14px "teleports" out of the shared
  // browser while passing repeatedly against a fresh one. Four cold launches cost
  // ~2s, against a lane that exists precisely to be measured accurately.
  await runPool(exclusive, 1, {}, results);
} finally {
  await cleanup();
}
const wall = (Date.now() - t0) / 1000;

// Only record timings for probes that actually ran to completion — a probe that
// failed fast would otherwise teach the scheduler to start it last forever.
for (const r of results) if (r.ok) timings[r.t] = r.ms;
writeTimings(timings);

results.sort((a, b) => a.t.localeCompare(b.t));
const failed = results.filter((r) => !r.ok);
const flaky = results.filter((r) => r.ok && r.flaky);
console.log('\n──────── UI test summary ────────');
for (const r of results)
  console.log(
    `  ${r.ok ? (r.flaky ? 'FLAKY' : 'PASS ') : 'FAIL '} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}${r.note ? `  (${r.note})` : ''}`,
  );
console.log(`${results.length - failed.length}/${results.length} passed in ${wall.toFixed(1)}s wall`);
// Never let a retried pass slip by unmentioned: it is a green run that cost extra
// attempts, and if the reason ever changes somebody has to notice.
for (const r of flaky)
  console.log(`  FLAKY: ${r.t} failed ${r.flaky}x then passed — see KNOWN_FLAKY in this file`);
if (patterns.length)
  console.log(`  PARTIAL RUN: ${all.length} of ${every.length} probes (filtered). Not a full gate.`);
/**
 * Flag probes that are expensive RELATIVE TO THIS RUN, and say what the suite costs.
 *
 * Deliberately a report, not a gate, and deliberately a ratio rather than seconds.
 * Wall-clock here is not a property of the code: the same suite has been measured at
 * 277s and at 690s on one machine, purely by how loaded it was. A time-based gate would
 * therefore fail for reasons no PR caused, and a gate that fires at random is one people
 * learn to bypass. A ratio against the median of the SAME run is load-independent —
 * contention slows every probe together, so it barely moves.
 *
 * Being flagged is not an accusation. The three ~100s probes sweep all 72 rooms for
 * byte-exact GPU-vs-CPU parity, which is about 1.6s per room and the best coverage in
 * the suite. The number to think about is coverage per second, not seconds. What this
 * catches is the other shape: a probe near the top of the list that only asserts one
 * thing, which usually wants to be a unit test (~2.5ms) or an assertion added to a probe
 * that has already paid for its browser.
 */
function reportCost(results, filtered) {
  if (results.length < 8) return; // too few to have a meaningful median
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  const median = ms[Math.floor(ms.length / 2)];
  const serial = ms.reduce((a, b) => a + b, 0);
  const heavy = results.filter((r) => r.ms > median * COST_RATIO).sort((a, b) => b.ms - a.ms);
  console.log(
    `  cost: ${(serial / 1000).toFixed(0)}s serial across ${results.length} probes, median ${(median / 1000).toFixed(1)}s`,
  );
  if (!heavy.length) return;
  console.log(`  heavy (over ${COST_RATIO}x this run's median — justify by coverage, not speed):`);
  for (const r of heavy.slice(0, 6))
    console.log(`    ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${(r.ms / median).toFixed(1)}x  ${r.t}`);
  if (filtered) console.log('    (filtered run: the median is over few probes, so treat this as noisy)');
}

console.log('  slowest:');
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5))
  console.log(`    ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}`);
reportCost(results, patterns.length > 0);
// exitCode rather than exit(), so buffered stdout is flushed before we go.
process.exitCode = failed.length === 0 ? 0 : 1;
