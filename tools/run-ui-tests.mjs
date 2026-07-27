/**
 * UI-test runner: starts a Vite dev server, launches the shared browser servers,
 * then runs every Playwright browser test (tools/test-*.mjs) — most of them
 * CONCURRENTLY — aggregating pass/fail from their exit codes. Non-AI and
 * CI-friendly: `npm run test:ui`.
 *
 * Each browser test must exit 0 on pass / non-zero on fail.
 *
 * ── Concurrency model (read this before adding a probe) ────────────────────────
 * The suite used to run strictly serially, one cold Chromium per probe, and took
 * ~15 minutes while the CPU sat idle >47 % of the wall clock. Three things fixed
 * that, none of which touch a single assertion:
 *
 *  1. A worker pool runs FF_UI_JOBS probes at once (default: cores-2, capped 8).
 *     Each probe is still its own `node` process with its own browser CONTEXT, so
 *     the isolation the probes rely on (localStorage, cookies, saved games) is
 *     unchanged. Probe output is buffered and printed as one block on completion,
 *     so parallel logs never interleave.
 *  2. Two shared browser SERVERS are launched once here and advertised over
 *     FF_WS_PLAIN / FF_WS_ANGLE; `ui-lib.mjs` connects to them instead of paying
 *     for a cold `chromium.launch()` in all 63 probes. Two servers, not one,
 *     because the WebGL probes need ANGLE/Metal and the CPU-oracle probes must
 *     NOT get those flags (they could change 2D rasterization).
 *  3. Probes are scheduled longest-first from a cached timing file, so the long
 *     tail doesn't strand the pool at the end of the run.
 *
 * Probes whose assertions measure real time (tick rate, idle-throttle, animation
 * pacing) cannot share the machine with 8 busy Chromiums, so they are listed in
 * EXCLUSIVE below and run alone, after the pool has drained. If you add a probe
 * that asserts on wall-clock rates, add it there — do not relax its bounds.
 */
import { spawn } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
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
const EXCLUSIVE = new Set([
  'test-timing.mjs', // asserts the game clock runs at ~12.5 ticks/s (8 < rate < 16)
  'test-idlefps.mjs', // asserts the render loop drops to the idle timer
  'test-mapinfo.mjs', // world-map animation pacing, measured over rAF frames
  // Measures the fish's displacement in every RENDERED frame and fails a jump of
  // more than half a cell. A loaded machine drops rAF frames, so each surviving
  // frame covers more game ticks and the per-frame delta grows — a false
  // "teleport". The assertion is right; it just needs the machine to itself.
  'test-smoothness.mjs',
]);

const jobs = Math.max(1, Number(process.env.FF_UI_JOBS) || Math.min(8, Math.max(2, cpus().length - 2)));

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

/** Run one probe, capturing its output so parallel probes don't interleave. */
function runProbe(file, env) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const c = spawn('node', [join('tools', file)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, FF_UI_PORT: String(PORT), ...env },
    });
    let out = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (out += d));
    c.on('exit', (code) => resolve({ t: file, ok: code === 0, ms: Date.now() - t0, out }));
  });
}

function report(r) {
  console.log(`\n=== ${r.t} — ${(r.ms / 1000).toFixed(1)}s — ${r.ok ? 'PASS' : 'FAIL'} ===`);
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
if (await isUp()) {
  console.error(`[test:ui] port ${PORT} is already in use; stop the process on it and retry`);
  process.exit(1);
}

// Serve a PRODUCTION BUILD, not the dev server. The dev server is a single node
// process that transpiles and serves ~120 unbundled ES modules on every page
// load; with 8 probes booting the app at once it became the suite's bottleneck.
// `vite build` takes ~2s and collapses that into one bundle. It is also a
// stricter test than dev: the probes now exercise what actually ships.
console.log('[test:ui] building the app…');
if ((await run('npx', ['vite', 'build'], { stdio: 'ignore' })) !== 0) {
  console.error('[test:ui] vite build failed');
  process.exit(1);
}
// `copyPublicDir` is off (copying the large data dir flakes on this machine — see
// vite.config.ts), so dist/ has no assets. Link each public root in instead, so
// /data, /enhanced and /fonts resolve exactly as they do under the dev server.
// Getting this wrong is not silent: the enhanced art 404s and test-enhanced fails
// its truecolor assertions.
for (const entry of readdirSync(join(root, 'public'))) {
  const link = join(root, 'dist', entry);
  rmSync(link, { recursive: true, force: true });
  symlinkSync(join('..', 'public', entry), link);
}
console.log('[test:ui] starting fresh vite preview server…');
server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort', '--host', HOST], {
  cwd: root,
  stdio: 'ignore',
});
if (!(await waitUp(30000))) {
  console.error('[test:ui] preview server did not come up');
  server?.kill();
  process.exit(1);
}

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

// One warm browser server per flag set, shared by every probe (see the header).
const plainServer = await chromium.launchServer({ args: PLAIN_ARGS });
const angleServer = await chromium.launchServer({ args: ANGLE_ARGS });
const env = { FF_WS_PLAIN: plainServer.wsEndpoint(), FF_WS_ANGLE: angleServer.wsEndpoint() };

const t0 = Date.now();
const results = [];
try {
  await runPool(parallel, jobs, env, results);
  // Drained: the wall-clock-sensitive probes now have the machine to themselves.
  await runPool(exclusive, 1, env, results);
} finally {
  await plainServer.close().catch(() => {});
  await angleServer.close().catch(() => {});
  server?.kill();
}
const wall = (Date.now() - t0) / 1000;

for (const r of results) timings[r.t] = r.ms;
writeTimings(timings);

results.sort((a, b) => a.t.localeCompare(b.t));
const failed = results.filter((r) => !r.ok);
console.log('\n──────── UI test summary ────────');
for (const r of results)
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}`);
console.log(`${results.length - failed.length}/${results.length} passed in ${wall.toFixed(1)}s wall`);
console.log('  slowest:');
for (const r of [...results].sort((a, b) => b.ms - a.ms).slice(0, 5))
  console.log(`    ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.t}`);
process.exit(failed.length === 0 ? 0 : 1);
