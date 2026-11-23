// The native host's full gate, run locally: `npm run native:check`.
//
// The same steps, in the same order, as the `native-macos` job in .github/workflows/checks.yml,
// which no longer runs on its own: a hosted macOS runner routinely queued for 10-40 minutes
// before an ~10 minute run, so PRs waited on it for no information this machine cannot give
// in a few minutes. Run this before opening or updating a PR that touches `native/` or code
// the native bundle imports, and quote its summary in the PR. The CI job is still there for
// a manual run (Actions -> checks -> Run workflow).
//
// Each step's output goes to native/build/check/<step>.log; the terminal shows one line per
// step, and the tail of the log for a step that fails. The build steps stop the run when they
// fail (nothing after them could mean anything); the gates after them all run, so one red
// gate does not hide another, as in CI.
//
//   npm run native:check                      # everything
//   npm run native:check -- --only smoke,subs # just those steps (names below), after a build
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(root, 'native/build/check');
mkdirSync(logDir, { recursive: true });

// From a Rosetta shell the universal cmake/ninja would build x86_64 (native/README.md).
let rosetta = false;
if (process.platform === 'darwin' && process.arch === 'x64') {
  try {
    rosetta = execFileSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';
  } catch { /* not Apple silicon */ }
}
const arm64 = (cmd, args) => (rosetta ? ['arch', ['-arm64', cmd, ...args]] : [cmd, args]);

const host = 'native/build/cmake/ff4e-native';
const game = ['native/build/game.js', '--root', 'public', '--headless'];
const STEPS = [
  { name: 'typecheck', build: true, run: ['npx', ['tsc', '-p', 'native/tsconfig.json']] },
  { name: 'bundle', build: true, run: ['node', ['native/build-js.mjs']] },
  { name: 'configure', build: true, run: arm64('cmake', ['-S', 'native', '-B', 'native/build/cmake', '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']) },
  { name: 'compile', build: true, run: arm64('ninja', ['-C', 'native/build/cmake']) },
  { name: 'smoke', run: [host, [...game, '--smoke', 'all', '--smoke-player', '13,70', '--store', 'native/build/smoke-store.json']] },
  { name: 'map-smoke', run: [host, [...game, '--smoke-map', '--store', 'native/build/smoke-map-store.json']] },
  { name: 'audio-smoke', run: [host, [...game, '--smoke-audio', '--store', 'native/build/smoke-audio-store.json']] },
  { name: 'chromium', run: ['npx', ['playwright', 'install', 'chromium']] },
  { name: 'rooms', run: ['node', ['--import', 'tsx', 'native/compare.mjs', '--all']] },
  { name: 'map', run: ['node', ['--import', 'tsx', 'native/compare-map.mjs']] },
  { name: 'subs', run: ['node', ['--import', 'tsx', 'native/compare-subs.mjs', '--self-test']] },
];

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? new Set((process.argv[onlyArg + 1] ?? '').split(',').filter(Boolean)) : null;
if (only) {
  const unknown = [...only].filter((n) => !STEPS.some((s) => s.name === n));
  if (unknown.length || only.size === 0) {
    console.error(`unknown or empty --only: ${unknown.join(', ') || '(none)'}; steps: ${STEPS.map((s) => s.name).join(', ')}`);
    process.exit(2);
  }
}

/** The last line of a step's output: every gate ends with its summary line. */
function verdict(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.length ? lines[lines.length - 1].slice(0, 160) : '';
}

const failed = [];
const t0 = Date.now();
for (const step of STEPS) {
  if (only && !only.has(step.name)) continue;
  const [cmd, args] = step.run;
  const log = join(logDir, `${step.name}.log`);
  const start = Date.now();
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28, env: { ...process.env, NO_COLOR: '1' } });
  const out = (r.stdout ?? '') + (r.stderr ?? '') + (r.error ? `\n${r.error.message}` : '');
  writeFileSync(log, out);
  const secs = ((Date.now() - start) / 1000).toFixed(0).padStart(4);
  const ok = r.status === 0;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${step.name.padEnd(12)}${secs} s  ${verdict(r.stdout ?? '') || verdict(out)}`);
  if (!ok) {
    failed.push(step.name);
    if (r.error?.code === 'ENOENT' && (cmd === 'cmake' || cmd === 'ninja' || cmd === 'arch')) {
      console.log('     the build tools are missing: brew install cmake ninja');
    }
    console.log(out.trim().split('\n').slice(-15).map((l) => `     | ${l}`).join('\n'));
    console.log(`     full log: ${log}`);
    if (step.build) break;
  }
}

const total = ((Date.now() - t0) / 1000).toFixed(0);
console.log(failed.length ? `native:check FAILED (${failed.join(', ')}) in ${total} s` : `native:check passed in ${total} s`);
process.exitCode = failed.length ? 1 : 0;
