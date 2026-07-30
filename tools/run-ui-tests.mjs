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
 *  1. A worker pool runs FF_UI_JOBS probes at once (default: max(2, cores-2), capped 8).
 *     Each probe is still its own `node` process with its own browser CONTEXT, so
 *     the isolation the probes rely on (localStorage, cookies, saved games) is
 *     unchanged. Probe output is buffered and printed as one block on completion,
 *     so parallel logs never interleave.
 *  2. Two shared browser SERVERS are launched once here and advertised over
 *     FF_WS_PLAIN / FF_WS_ANGLE; `ui-lib.mjs` connects to them instead of paying
 *     for a cold `chromium.launch()` in all 63 probes. Two servers, not one,
 *     because the WebGL probes need ANGLE/Metal and the CPU-oracle probes must
 *     NOT get those flags (they could change 2D rasterization).
 *     Single-sample A/B when this was added: 164s with, 226s without. Treat that
 *     gap as indicative, not exact — repeat runs of one configuration on this
 *     machine span 164-205s, so the noise is a sizeable fraction of the delta.
 *  3. Probes are scheduled longest-first from a cached timing file, so the long
 *     tail doesn't strand the pool at the end of the run.
 *
 * Probes whose assertions measure real time (tick rate, idle-throttle, animation
 * pacing, per-frame motion) cannot share the machine with 8 busy Chromiums, so
 * they are listed in EXCLUSIVE below and run alone, after the pool has drained,
 * each in its own freshly launched browser. If you add a probe that asserts on
 * wall-clock rates, add it there — do not relax its bounds.
 */
import { spawn } from 'node:child_process';
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  lstatSync,
  symlinkSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { cpus } from 'node:os';
import { chromium } from 'playwright';

const HOST = '127.0.0.1';
// A dedicated test port + a freshly-spawned server every run, so the UI tests
// always validate the CURRENT build — never a stale dev server the developer
// happens to have open on 5173 (that reuse hid the SPA-fallback regression).
const PORT = 5273;
const BASE = `http://${HOST}:${PORT}/`;
const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);

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
const EXCLUSIVE = new Set([
  'test-timing.mjs', // asserts the game clock keeps up with wall clock, frame budget permitting
  'test-idlefps.mjs', // asserts the render loop drops to the idle timer
  // Counts vector-subtitle overlay repaints against logic ticks and rendered
  // frames — a ratio, but both sides are sampled over wall-clock windows.
  'test-subtitles-perf.mjs',
  'test-mapinfo.mjs', // world-map animation pacing, measured over rAF frames
  // Subtitle overlay repaints and loop rAF ticks, both per second of real time.
  'test-aisubs.mjs',
  // Samples loopThrottleOk() over wall-clock windows to catch a line while it is
  // still animating; a loaded machine can settle the line before it samples.
  'test-tierperf.mjs',
]);

const jobs = Math.max(1, Number(process.env.FF_UI_JOBS) || Math.min(8, Math.max(2, cpus().length - 2)));

// Deadlock backstop for a single probe (see runProbe). The slowest probe is ~150s.
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

async function isUp() {
  try {
    const r = await fetch(BASE);
    return r.ok;
  } catch {
    return false;
  }
}

async function waitUp(timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await isUp()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** Run a command to completion, resolving with its exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
    c.on('exit', (code) => resolve(code ?? 1));
  });
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
      env: { ...process.env, FF_UI_PORT: String(PORT), ...env },
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

function report(r) {
  const why = r.note ? ` (${r.note})` : '';
  console.log(`\n=== ${r.t} — ${(r.ms / 1000).toFixed(1)}s — ${r.ok ? 'PASS' : 'FAIL'}${why} ===`);
  process.stdout.write(r.out.endsWith('\n') || r.out === '' ? r.out : r.out + '\n');
}

/** Worker pool: `limit` probes in flight, longest-first. */
async function runPool(files, limit, env, results) {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= files.length) return;
      const r = await runProbe(files[i], env);
      report(r);
      results.push(r);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, files.length) }, worker));
}

// Always spawn a fresh server on the dedicated test port (strict, so we never
// silently bind elsewhere) — never reuse whatever might be on the dev port.
let server = null;
let plainServer = null;
let angleServer = null;

/**
 * Tear down everything we started. Safe to call more than once, and safe to call
 * before any of it exists — every exit path goes through here, because leaving an
 * orphaned `vite preview` behind wedges port 5273 for the next run.
 */
async function cleanup() {
  await plainServer?.close().catch(() => {});
  await angleServer?.close().catch(() => {});
  plainServer = angleServer = null;
  if (server && server.exitCode === null) {
    // Kill the whole process GROUP: `npx` is only a wrapper and the real vite runs as
    // its child, so server.kill() left that child holding the port. Fall back to a
    // plain kill if the group is already gone.
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      try { server.kill(); } catch { /* already gone */ }
    }
  }
  server = null;
}

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

if (await isUp()) await die(`port ${PORT} is already in use; stop the process on it and retry`);

// Serve a PRODUCTION BUILD, not the dev server. The dev server is a single node
// process that transpiles and serves ~120 unbundled ES modules on every page
// load; with 8 probes booting the app at once it became the suite's bottleneck.
// `vite build` takes ~2s and collapses that into one bundle. It is also a
// stricter test than dev: the probes now exercise what actually ships.
console.log('[test:ui] building the app…');
if ((await run('npx', ['vite', 'build'], { stdio: 'ignore' })) !== 0) await die('vite build failed');

// `copyPublicDir` is off (copying the large data dir flakes on this machine — see
// vite.config.ts), so dist/ has no assets. Link each public root in instead, so
// /data, /enhanced and /fonts resolve exactly as they do under the dev server.
// Getting this wrong is not silent: the enhanced art 404s and test-enhanced fails
// its truecolor assertions.
for (const entry of readdirSync(join(root, 'public'))) {
  const link = join(root, 'dist', entry);
  // Only ever replace a link we made ourselves. A real file/dir here is a build
  // output (`dist/assets`, `dist/index.html`), and silently deleting it to make
  // room for a public/ entry of the same name would serve a broken app while the
  // probes reported... something. Fail loudly instead.
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing && !existing.isSymbolicLink()) {
    await die(
      `public/${entry} collides with build output dist/${entry}; rename the public entry ` +
        `or stage it under a subdirectory`,
    );
  }
  rmSync(link, { force: true });
  symlinkSync(join('..', 'public', entry), link);
}

console.log('[test:ui] starting fresh vite preview server…');
// `detached` puts vite in its own PROCESS GROUP so cleanup can kill the whole group.
// `npx` spawns the real vite as a CHILD, so killing only the npx wrapper orphaned it —
// the orphan kept holding port 5273 and, with --strictPort, the next run's own vite
// then failed to bind while waitUp happily connected to the ORPHAN (serving a stale
// build). When that orphan later died, probes mid-run saw ERR_CONNECTION_REFUSED.
server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', HOST], {
  cwd: root,
  stdio: 'ignore',
  detached: true,
});
if (!(await waitUp(30000))) await die('preview server did not come up');

const all = readdirSync(toolsDir)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort();

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
console.log('\n──────── UI test summary ────────');
for (const r of results)
  console.log(
    `  ${r.ok ? 'PASS' : 'FAIL'}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}${r.note ? `  (${r.note})` : ''}`,
  );
console.log(`${results.length - failed.length}/${results.length} passed in ${wall.toFixed(1)}s wall`);
console.log('  slowest:');
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5))
  console.log(`    ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}`);
// exitCode rather than exit(), so buffered stdout is flushed before we go.
process.exitCode = failed.length === 0 ? 0 : 1;
