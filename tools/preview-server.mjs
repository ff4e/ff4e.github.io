/**
 * The build + `vite preview` machinery the browser harnesses share.
 *
 * Extracted from run-ui-tests.mjs so that `tools/capture-digest.mjs` serves the app
 * EXACTLY the way the UI suite does — same production build, same public-dir links,
 * same per-run port. Two independent copies of this would be worse than one shared
 * one: the port rules below are the fix for a class of bug (stale servers, orphaned
 * vite, cross-worktree collisions) that cost this repo real debugging time, and a
 * second copy would eventually drift out of them.
 *
 * All comments here are the originals from run-ui-tests.mjs — they record why each
 * rule exists, and they matter more than the code.
 */
import { spawn } from 'node:child_process';
import { readdirSync, rmSync, lstatSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createServer } from 'node:net';

export const HOST = '127.0.0.1';
export const urlFor = (p) => `http://${HOST}:${p}/`;

const toolsDir = dirname(fileURLToPath(import.meta.url));
export const root = dirname(toolsDir);

/** Thrown for every fatal condition, so each caller decides how to report and exit. */
export class PreviewError extends Error {}

/**
 * Ask the OS for a free port: bind :0, note what we got, release it.
 *
 * This deliberately does NOT scan for "a port that looks unused" — the kernel will
 * not hand the same ephemeral port to two live listeners, so two suites starting at
 * the same instant get different ports, which is the entire point.
 *
 * Releasing before vite binds leaves a TOCTOU window, so the caller must be able to
 * retry; that is much cheaper than holding the socket, which would make vite's own
 * `--strictPort` bind fail every time.
 */
export function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, HOST, () => {
      const got = probe.address().port;
      probe.close(() => resolve(got));
    });
  });
}

export async function isUp(p) {
  try {
    const r = await fetch(urlFor(p));
    return r.ok;
  } catch {
    return false;
  }
}

/** Run a command to completion, resolving with its exit code. */
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: root, stdio: 'inherit', ...opts });
    c.on('exit', (code) => resolve(code ?? 1));
  });
}

// Always spawn a fresh server on a port we picked ourselves (strict, so we never
// silently bind elsewhere) — never reuse whatever might already be listening.
let server = null;

/**
 * Wait for OUR preview server to answer on `p`.
 *
 * Returns why it stopped, because the two failures need different handling: with
 * `--strictPort` a lost port race kills vite immediately (retry elsewhere), while a
 * live-but-silent server is a real problem worth reporting at once.
 *
 * A dead vite is never "up": whatever answers on that port afterwards belongs to
 * somebody else, and running the suite against it is precisely the stale-server
 * failure this runner exists to prevent.
 */
async function waitUp(p, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (!server || server.exitCode !== null) return 'exited';
    if ((await isUp(p)) && server.exitCode === null) return 'up';
    await new Promise((r) => setTimeout(r, 400));
  }
  return 'timeout';
}

/**
 * Stop the preview server we started. Safe to call more than once, and safe to call
 * before it exists — every exit path must go through here, because leaving an
 * orphaned `vite preview` behind wedges its port (and, since it answers on a port
 * we may later be handed again, could serve a stale build to a future run).
 */
export function stopPreview() {
  if (server && server.exitCode === null) {
    // Kill the whole process GROUP: `npx` is only a wrapper and the real vite runs as
    // its child, so server.kill() left that child holding the port. Fall back to a
    // plain kill if the group is already gone.
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      try {
        server.kill();
      } catch {
        /* already gone */
      }
    }
  }
  server = null;
}

/**
 * Build the app and stage the public dirs into `dist/`.
 *
 * Serve a PRODUCTION BUILD, not the dev server. The dev server is a single node
 * process that transpiles and serves ~120 unbundled ES modules on every page
 * load; with 8 probes booting the app at once it became the suite's bottleneck.
 * `vite build` takes ~2s and collapses that into one bundle. It is also a
 * stricter test than dev: the probes now exercise what actually ships.
 */
export async function buildApp(log = () => {}) {
  log('building the app…');
  if ((await run('npx', ['vite', 'build'], { stdio: 'ignore' })) !== 0)
    throw new PreviewError('vite build failed');

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
      throw new PreviewError(
        `public/${entry} collides with build output dist/${entry}; rename the public entry ` +
          `or stage it under a subdirectory`,
      );
    }
    rmSync(link, { force: true });
    symlinkSync(join('..', 'public', entry), link);
  }
}

/**
 * Get our own preview server listening, and return the port it got.
 *
 * On an auto-picked port, losing the race to bind it is expected-but-rare (another
 * suite, or anything else, grabbed it in the gap between our probe socket closing
 * and vite binding), so we simply ask for another one. Only that case retries: a
 * server that starts and then never answers is a real fault, and reporting it after
 * one 30s wait beats reporting it after eight.
 *
 * An explicit fixed port is never second-guessed: it is a deliberate choice, so a
 * clash there is an error the developer wants to hear about rather than something
 * to silently route around.
 */
export async function startPreview({ fixedPort = null, log = () => {} } = {}) {
  const attempts = fixedPort ? 1 : 8;
  for (let i = 0; i < attempts; i++) {
    const p = fixedPort ?? (await freePort());
    if (await isUp(p)) {
      if (fixedPort)
        throw new PreviewError(`port ${p} is already in use; stop the process on it and retry`);
      continue;
    }
    log(`starting fresh vite preview server on ${urlFor(p)} …`);
    // `detached` puts vite in its own PROCESS GROUP so cleanup can kill the whole group.
    // `npx` spawns the real vite as a CHILD, so killing only the npx wrapper orphaned it —
    // the orphan kept holding the port and, with --strictPort, the next run's own vite
    // then failed to bind while waitUp happily connected to the ORPHAN (serving a stale
    // build). When that orphan later died, probes mid-run saw ERR_CONNECTION_REFUSED.
    server = spawn('npx', ['vite', 'preview', '--port', String(p), '--strictPort', '--host', HOST], {
      cwd: root,
      stdio: 'ignore',
      detached: true,
    });
    const why = await waitUp(p, 30000);
    if (why === 'up') return p;
    // It exited or went silent; either way don't leave it behind.
    stopPreview();
    if (why === 'timeout') throw new PreviewError(`preview server on port ${p} did not come up`);
    if (fixedPort)
      throw new PreviewError(
        `vite could not bind the requested port ${p}; stop whatever is holding it and retry`,
      );
    log(`port ${p} was taken before vite could bind it; trying another…`);
  }
  throw new PreviewError(`could not start a preview server on a free port after ${attempts} attempts`);
}
