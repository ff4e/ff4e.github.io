/**
 * Archive and (optionally) upload a new TestFlight build of the APPLE TV app — the native host
 * (native/, QuickJS + SDL3) built for tvOS, not the iOS app's web view. Same two stages, same
 * signing and the same upload as the iOS lane (`release-testflight.mjs`, whose header explains
 * the method; the shared parts are `testflight-lib.mjs`):
 *
 *   1. archive (default) — an `.xcarchive` in a temp dir, then a LOCAL App Store export of it
 *      (`destination: export`) that proves the signing: the Apple Distribution certificate,
 *      an App Store profile and the iCloud key-value entitlement. Nothing leaves this Mac.
 *   2. `--upload` — exports that archive straight to App Store Connect. A REAL, irreversible
 *      TestFlight release: run it only when explicitly asked to.
 *
 * ── The same app, its own build train ───────────────────────────────────────
 * The TV app is the iOS app's App Store record (a universal purchase): the same bundle id,
 * `io.github.ff4e.fishfillets4ever`. App Store Connect keeps each platform's versions and
 * builds apart, so the tvOS build numbers are their own sequence (from 1), independent of the
 * iOS ones, and so is the version (`--version`, default 1.0). Before the first upload the tvOS
 * platform must be added to the app in App Store Connect (the app's page → "+" beside the
 * platforms → tvOS), or the upload is refused.
 *
 * ── tvOS 27 ─────────────────────────────────────────────────────────────────
 * The app requires tvOS 27 (Apple TV 4K 2nd generation and newer: native/CMakeLists.txt says
 * why), so it needs an Xcode with the tvOS 27 SDK; the script stops at once without one.
 *
 * ── Signing ─────────────────────────────────────────────────────────────────
 * Not the iOS lane's way. An automatically signed archive first needs a tvOS DEVELOPMENT
 * profile, and Apple makes one only for a team with a registered Apple TV ("Your team has no
 * devices from which to generate a provisioning profile", 2026-11-24). So the app is archived
 * unsigned, its entitlements (native/tvos/FishFillets.entitlements: iCloud key-value storage)
 * are stamped on with a local signature (native/tvos/build.mjs), and the export signs it for
 * the App Store with automatic signing — an App Store profile, which needs no device, and the
 * stamped entitlements kept. (An unsigned app would export WITHOUT the iCloud entitlement;
 * Xcode refuses its own managed profile for a manually signed archive.) Before any of it: the
 * developer account's current Program License Agreement accepted, and Xcode signed in to the
 * account (Settings → Accounts) — native/README.md, "Apple TV".
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run release:testflight:tvos -- --build 1                  # archive only (safe)
 *   npm run release:testflight:tvos -- --build 1 --upload         # archive AND upload
 *   npm run release:testflight:tvos -- --build 2 --version 1.0.1
 *   FF4E_TEAM=ABCDE12345 npm run release:testflight:tvos -- --build 1
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { BUNDLE_ID, dieAs, exportArchiveLocally, findDistributionTeam, parseArgs, uploadArchive } from './testflight-lib.mjs';
import { DEPLOYMENT_TARGET, buildTvos, checkTvosSdk } from '../native/tvos/build.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const die = dieAs('release-testflight-tvos');

const { args, upload, buildNumber } = parseArgs(
  die,
  'usage: npm run release:testflight:tvos -- --build <N> [--version V] [--upload]\n\n' +
    'N is the new tvOS CFBundleVersion (integer). The tvOS platform has its own build numbers:\n' +
    'check its last uploaded build in App Store Connect (TestFlight → tvOS builds) first.',
);
const v = args.indexOf('--version');
const version = v !== -1 ? args[v + 1] : '1.0';
if (!/^\d+(\.\d+){0,2}$/.test(version ?? '')) die(`--version ${version}: want MAJOR[.MINOR[.PATCH]]`);

// Before anything else: without the tvOS SDK the app targets, nothing below can work.
try {
  checkTvosSdk();
} catch (e) {
  die(e.message);
}

const team = findDistributionTeam(die);
console.log(`signing as distribution team ${team}, tvOS version ${version} build ${buildNumber}, for tvOS ${DEPLOYMENT_TARGET}+`);

const archiveDir = mkdtempSync(join(tmpdir(), 'ff4e-tvos-archive-'));
const archivePath = join(archiveDir, `FishFillets-tvOS-${buildNumber}.xcarchive`);

try {
  buildTvos({ archive: archivePath, team, build: buildNumber, version });
} catch (e) {
  die(
    `archive failed (${e.message.split('\n')[0]}) — the output above says why. "PLA Update available": accept the new Program\n` +
      'License Agreement at developer.apple.com. "No profiles … were found" / "no devices": see\n' +
      'native/README.md, "Apple TV" → Signing.',
  );
}

if (!existsSync(archivePath)) die(`archive step reported success but ${archivePath} is missing.`);
console.log(`\narchive created: ${archivePath}`);

// Always: sign it for the App Store into a local folder and check what Apple would get — the
// distribution certificate, an App Store profile, and the iCloud key-value entitlement.
console.log('\nexporting locally to check the App Store signing (nothing is uploaded)…');
const exportPath = exportArchiveLocally({ archivePath, archiveDir, team, cwd: REPO, env: process.env, die });
const summary = execFileSync('plutil', ['-convert', 'json', '-o', '-', join(exportPath, 'DistributionSummary.plist')], { encoding: 'utf8' });
const app = Object.values(JSON.parse(summary)).flat()[0] ?? {};
const kvs = app.entitlements?.['com.apple.developer.ubiquity-kvstore-identifier'];
if (app.certificate?.type !== 'Apple Distribution') die(`the export is not signed with Apple Distribution (${app.certificate?.type ?? 'none'}).`);
if (app.entitlements?.['get-task-allow'] !== false) die('the export allows debugging (get-task-allow): not an App Store signature.');
if (kvs !== `${team}.${BUNDLE_ID}`) die(`the export lacks the iCloud key-value entitlement (got ${kvs ?? 'none'}, want ${team}.${BUNDLE_ID}).`);
console.log(`signed for the App Store: ${app.certificate.type}, profile "${app.profile?.name}", iCloud key-value store ${kvs}`);
console.log(`exported: ${join(exportPath, 'FishFillets.ipa')}`);

if (!upload) {
  console.log('\n(archive only — no upload performed. Re-run with --upload to actually ship this build to TestFlight.)\n');
  process.exit(0);
}

uploadArchive({ archivePath, archiveDir, team, cwd: REPO, env: process.env, die });

console.log(`\n✅ tvOS build ${buildNumber} uploaded. Archive kept at: ${archivePath}\n`);
