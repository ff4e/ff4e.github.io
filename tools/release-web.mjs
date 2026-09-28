/**
 * Release the web build: tag + push, watch the `deploy.yml` run, then verify the
 * live version string on ff4e.github.io.
 *
 * GitHub builds the site; nothing is built locally. `deploy.yml` triggers on a
 * `v*` tag. This wraps the manual sequence documented in the `fish_fillets_hub`
 * task briefing so it runs as one command instead of being re-derived by hand.
 *
 * ── Why "verify" is its own step ────────────────────────────────────────────
 * A green `deploy.yml` run is not proof the site actually updated (CDN/cache lag,
 * a build that silently shipped stale assets). And a naive `curl` of the page's
 * first `<script>` tag finds nothing useful: that tag is a thin gate (checks
 * `browserAvailability`, then dynamically `import()`s the real app), so the
 * version string (`console.info('Fish Fillets 4ever v...')`, from `boot.ts`) only
 * ever appears in the dynamically-loaded `/assets/main-*.js` chunk. This script
 * resolves that real chunk rather than assuming the first script tag is it.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run release:web -- 1.0.39                 # full release
 *   npm run release:web -- 1.0.39 --skip-gate     # skip the local test gate
 *   npm run release:web -- --verify-only          # only re-check the live site
 *   npm run release:web -- --current              # latest tag vs. what's actually live
 *
 * Requires: `gh` authenticated as the personal account, a clean `main` worktree,
 * `FF_UI_JOBS=4` is set for you (see AGENTS.md — the default job count produces
 * false-red UI probes on this machine).
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const die = (msg) => {
  console.error(`\nrelease-web: ${msg}\n`);
  process.exit(1);
};

const sh = (cmd, opts = {}) =>
  execSync(cmd, { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

function verifyLive() {
  console.log('verifying live site…');
  const html = sh(`curl -fsS "https://ff4e.github.io/?cb=$(date +%s)"`);
  const gateScript = html.match(/\/assets\/game-[^"']+\.js/)?.[0];
  if (!gateScript) die('could not find the gate <script src="/assets/game-*.js"> tag in the live HTML.');

  const gateJs = sh(`curl -fsS "https://ff4e.github.io${gateScript}"`);
  // The gate script dynamically imports the real chunk; pull its literal path out
  // rather than assuming a naming convention, since Vite's hash changes per build.
  const mainScript = gateJs.match(/["'](\.?\/?assets\/main-[^"']+\.js)["']/)?.[1];
  if (!mainScript) die(`gate script ${gateScript} did not reference a main-*.js chunk (page structure changed?).`);
  const mainPath = mainScript.startsWith('/') ? mainScript : `/${mainScript.replace(/^\.?\//, '')}`;

  const mainJs = sh(`curl -fsS "https://ff4e.github.io${mainPath}"`);
  const version = mainJs.match(/version:"?(1\.0\.\d+)"?/)?.[1] ?? mainJs.match(/v(1\.0\.\d+)/)?.[1];
  if (!version) die(`found ${mainPath} but no version string inside it.`);
  return version;
}

/**
 * The latest released version, from the source of truth for "released": the
 * `v*` tags actually pushed to origin — not the local `package.json` version,
 * which a half-finished `npm version` bump could have already changed without
 * a push, and not just the newest local tag, which could be stale against a
 * teammate's release. Fetches tags first so this is never answered from a
 * cache.
 */
function latestTag() {
  sh('git fetch --tags --quiet');
  const tag = sh(`git tag --list "v*" --sort=-v:refname`).split('\n').find(Boolean);
  if (!tag) die('no v* tags found — has this repo ever been released?');
  return tag.replace(/^v/, '');
}

const args = process.argv.slice(2);
const verifyOnly = args.includes('--verify-only');
const current = args.includes('--current');
const skipGate = args.includes('--skip-gate');
const versionArg = args.find((a) => /^\d+\.\d+\.\d+$/.test(a));

if (current) {
  const tagged = latestTag();
  const live = verifyLive();
  console.log(`latest tag: v${tagged}`);
  console.log(`live version: v${live}`);
  console.log(tagged === live ? '✅ live matches the latest tag' : '⚠️  live does NOT match the latest tag (deploy in progress, or stuck)');
  process.exit(0);
}

if (verifyOnly) {
  const live = verifyLive();
  console.log(`live version: ${live}`);
  process.exit(0);
}

if (!versionArg) die('usage: npm run release:web -- <MAJOR.MINOR.PATCH> [--skip-gate]');

const dirty = sh('git status --porcelain');
if (dirty) die(`working tree is not clean:\n${dirty}`);

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') die(`must release from main, not "${branch}".`);

sh('git pull --ff-only', { stdio: 'inherit' });

if (!skipGate) {
  console.log('running local test gate (FF_UI_JOBS=4 npm run test:all)…');
  execSync('npm run test:all', { cwd: REPO, stdio: 'inherit', env: { ...process.env, FF_UI_JOBS: '4' } });
} else {
  console.log('--skip-gate passed: NOT running the local test gate.');
}

console.log(`tagging v${versionArg}…`);
execSync(`npm version ${versionArg} -m "Release v%s"`, { cwd: REPO, stdio: 'inherit' });
execSync(`git push origin main && git push origin v${versionArg}`, { cwd: REPO, stdio: 'inherit' });

console.log('watching deploy.yml…');
const runId = sh(`gh run list --workflow=deploy.yml --limit 1 --json databaseId --jq '.[0].databaseId'`);
execSync(`gh run watch ${runId} --exit-status`, { cwd: REPO, stdio: 'inherit' });

const live = verifyLive();
if (live !== versionArg) {
  die(`deploy succeeded but live version is "${live}", expected "${versionArg}". Cache lag? Re-run --verify-only shortly.`);
}
console.log(`\n✅ released and verified live: v${live}\n`);
