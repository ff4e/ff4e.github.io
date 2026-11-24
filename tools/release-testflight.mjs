/**
 * Archive and (optionally) upload a new TestFlight build.
 *
 * Method verified against real prior art: ten manual uploads across
 * `ff4e-ios-build*` worktrees (see `fish_fillets_ios_release/PROGRESS.md`), most
 * recently build 10's receipt: "xcodebuild exportArchive with destination upload
 * and automatic signing; fixed build number" (`ios-build10-upload.json`). This
 * script is that same method, scripted, so it does not get re-derived by hand
 * every time.
 *
 * ── Two stages, on purpose ──────────────────────────────────────────────────
 *   1. `-archive` (default) — builds a signed `.xcarchive`. Safe and reversible:
 *      nothing leaves this Mac.
 *   2. `--upload` — exports from that archive straight to App Store Connect via
 *      `-exportOptionsPlist` with `destination: upload` (no separate `altool`/
 *      `notarytool` step needed). This is a REAL, irreversible TestFlight
 *      release and must be explicitly requested; it is never implied by
 *      running this script without the flag.
 *
 * ── `-scmProvider xcode` + the `safe.bareRepository` override ───────────────
 * This environment's `safe.bareRepository=explicit` git setting breaks Xcode's
 * SPM package cache resolution (verified 2026-09-28 building for the
 * Simulator: fails even with `-scmProvider xcode` alone). The working fix is a
 * narrow, single-command override — `GIT_CONFIG_VALUE_0=all` — applied only to
 * the `xcodebuild` child process below, never globally.
 *
 * This deliberately signs the REAL bundle id (`io.github.ff4e.fishfillets4ever`),
 * unlike `device-build.mjs`'s throwaway id — TestFlight builds must ship under
 * the app's real identifier. That means this requires the paid Apple Developer
 * account's Distribution certificate/team, not the free personal-team one
 * `device-build.mjs` uses; the two must never be confused.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run release:testflight -- --build 11              # archive only (safe)
 *   npm run release:testflight -- --build 11 --upload      # archive AND upload
 *   FF4E_TEAM=ABCDE12345 npm run release:testflight -- --build 11 --upload
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BUNDLE_ID, dieAs, findDistributionTeam, parseArgs, uploadArchive } from './testflight-lib.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const die = dieAs('release-testflight');

const { upload, buildNumber } = parseArgs(
  die,
  'usage: npm run release:testflight -- --build <N> [--upload]\n\nN is the new CFBundleVersion (integer); check App Store Connect for the last uploaded build number first.',
);

console.log('building web assets…');
execSync('npm run build:ios', { cwd: REPO, stdio: 'inherit' });

const team = findDistributionTeam(die);
console.log(`signing as distribution team ${team}, build number ${buildNumber}`);

const archiveDir = mkdtempSync(join(tmpdir(), 'ff4e-archive-'));
const archivePath = join(archiveDir, `FishFillets-${buildNumber}.xcarchive`);

try {
  execSync(
    [
      'xcodebuild',
      '-scheme App',
      '-configuration Release',
      `-archivePath "${archivePath}"`,
      // See header: this Mac's safe.bareRepository=explicit setting has broken
      // Xcode's default SPM package resolution before.
      '-scmProvider xcode',
      '-allowProvisioningUpdates',
      `DEVELOPMENT_TEAM=${team}`,
      `PRODUCT_BUNDLE_IDENTIFIER=${BUNDLE_ID}`,
      `CURRENT_PROJECT_VERSION=${buildNumber}`,
      'CODE_SIGN_STYLE=Automatic',
      'archive',
    ].join(' '),
    {
      cwd: join(REPO, 'ios/App'),
      stdio: 'inherit',
      // Narrow override for this one command only — see header comment.
      env: { ...process.env, GIT_CONFIG_VALUE_0: 'all' },
    },
  );
} catch {
  die('archive failed — xcodebuild output above says why.');
}

if (!existsSync(archivePath)) die(`archive step reported success but ${archivePath} is missing.`);
console.log(`\narchive created: ${archivePath}`);

if (!upload) {
  console.log(
    '\n(archive only — no upload performed. Re-run with --upload to actually ship this build to TestFlight.)\n',
  );
  process.exit(0);
}

uploadArchive({
  archivePath,
  archiveDir,
  team,
  cwd: join(REPO, 'ios/App'),
  env: { ...process.env, GIT_CONFIG_VALUE_0: 'all' },
  die,
});

console.log(`\n✅ build ${buildNumber} uploaded. Archive kept at: ${archivePath}\n`);
