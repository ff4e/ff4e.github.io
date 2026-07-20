/**
 * UI-test runner: starts a Vite preview/dev server if one isn't already up, then
 * runs every Playwright browser test (tools/test-*.mjs) in turn, aggregating
 * pass/fail from their exit codes. Non-AI and CI-friendly: `npm run test:ui`.
 *
 * Each browser test must exit 0 on pass / non-zero on fail.
 */
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HOST = '127.0.0.1';
// A dedicated test port + a freshly-spawned server every run, so the UI tests
// always validate the CURRENT build — never a stale dev server the developer
// happens to have open on 5173 (that reuse hid the SPA-fallback regression).
const PORT = 5273;
const BASE = `http://${HOST}:${PORT}/`;
const toolsDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(toolsDir);

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

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: root,
      ...opts,
      env: { ...process.env, FF_UI_PORT: String(PORT), ...opts.env },
    });
    c.on('exit', (code) => resolve(code ?? 1));
  });
}

// Always spawn a fresh server on the dedicated test port (strict, so we never
// silently bind elsewhere) — never reuse whatever might be on the dev port.
let server = null;
if (await isUp()) {
  console.error(`[test:ui] port ${PORT} is already in use; stop the process on it and retry`);
  process.exit(1);
}
console.log('[test:ui] starting fresh vite dev server…');
server = spawn('npx', ['vite', '--port', String(PORT), '--strictPort', '--host', HOST], {
  cwd: root,
  stdio: 'ignore',
});
if (!(await waitUp(30000))) {
  console.error('[test:ui] dev server did not come up');
  server?.kill();
  process.exit(1);
}

const tests = readdirSync(toolsDir)
  .filter((f) => /^test-.*\.mjs$/.test(f))
  .sort();

const results = [];
for (const t of tests) {
  console.log(`\n=== ${t} ===`);
  const code = await run('node', [join('tools', t)]);
  results.push({ t, ok: code === 0 });
}

server?.kill();

const failed = results.filter((r) => !r.ok);
console.log('\n──────── UI test summary ────────');
for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.t}`);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length === 0 ? 0 : 1);
