// Build the Apple TV app: the bundle, the staged assets, the Xcode project CMake generates for
// tvOS from native/CMakeLists.txt, and an xcodebuild of it.
//
//   node native/tvos/build.mjs                          # device build, unsigned: does it compile and link?
//   node native/tvos/build.mjs --simulator              # the Apple TV Simulator (signed locally, runnable)
//   node native/tvos/build.mjs --archive DIR --team ID --build N [--version V]
//                                                       # an .xcarchive for App Store Connect (signed at export)
//
// The archive is what tools/release-testflight-tvos.mjs makes (and, with --upload, exports);
// read that file's header before releasing. Nothing here uploads anything.
//
// The Xcode project is generated (native/build/tvos/xcode or xcode-sim), never checked in:
// CMake is the one list of the host's sources and the pinned dependencies for every platform.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from './stage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
/**
 * The tvOS the app needs: 27, so the Apple TV 4K 2nd generation (A12) and newer. Read from
 * native/CMakeLists.txt (`FF4E_TVOS_DEPLOYMENT_TARGET`), which says why: SDL GPU needs an A9,
 * and the A8 Apple TV HD runs up to tvOS 26.
 */
export const DEPLOYMENT_TARGET = /set\(FF4E_TVOS_DEPLOYMENT_TARGET ([\d.]+)\)/.exec(
  readFileSync(join(repo, 'native', 'CMakeLists.txt'), 'utf8'),
)?.[1];
if (!DEPLOYMENT_TARGET) throw new Error('native/CMakeLists.txt sets no FF4E_TVOS_DEPLOYMENT_TARGET');

const newer = (a, b) => {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return true; // equal
};

/**
 * Stop before anything is built when the installed tvOS SDK cannot build for the deployment
 * target (CMake checks again when it configures). Returns the SDK's version.
 */
export function checkTvosSdk(simulator = false) {
  const sdk = simulator ? 'appletvsimulator' : 'appletvos';
  let version = '';
  try {
    version = execFileSync('xcrun', ['--sdk', sdk, '--show-sdk-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* no such SDK */ }
  if (!version || !newer(version, DEPLOYMENT_TARGET)) {
    throw new Error(
      `the installed tvOS SDK (${sdk}: ${version || 'none'}) is older than the app's deployment target, tvOS ${DEPLOYMENT_TARGET}.\n` +
        `Install an Xcode with the tvOS ${DEPLOYMENT_TARGET} SDK, select it (xcode-select -s), and its tvOS Simulator ` +
        'runtime (xcodebuild -downloadPlatform tvOS). Why tvOS ' + `${DEPLOYMENT_TARGET}: native/CMakeLists.txt.`,
    );
  }
  return version;
}
export const SCHEME = 'ff4e-native';
export const APP = 'FishFillets.app';

const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } });

export const BUNDLE_ID = 'io.github.ff4e.fishfillets4ever';
export const ENTITLEMENTS = join(here, 'FishFillets.entitlements');

/** FishFillets.entitlements with Xcode's `$(…)` variables filled in for `team`. */
export function resolvedEntitlements(team) {
  return readFileSync(ENTITLEMENTS, 'utf8')
    .replaceAll('$(TeamIdentifierPrefix)', `${team}.`)
    .replaceAll('$(CFBundleIdentifier)', BUNDLE_ID);
}

/**
 * Sign the archived (unsigned) app locally with its entitlements, so that the App Store export,
 * which re-signs it, carries them: an unsigned app exports without the iCloud key-value store.
 */
function stampEntitlements(app, team) {
  if (!existsSync(app)) throw new Error(`the archive has no ${app}`);
  const dir = mkdtempSync(join(tmpdir(), 'ff4e-tvos-ent-'));
  const file = join(dir, 'FishFillets.entitlements');
  writeFileSync(file, resolvedEntitlements(team));
  run('codesign', ['--force', '--sign', '-', '--entitlements', file, app]);
}

/**
 * Bundle, stage, generate and build. `archive`: the .xcarchive path (an unsigned device build
 * with its entitlements stamped on, signed for the App Store at export); else a device build
 * without signing, or with `simulator` a Simulator build. Returns the Xcode project's directory.
 */
export function buildTvos({ simulator = false, archive = null, team = null, build = '1', version = '1.0' } = {}) {
  if (archive && (simulator || !team)) throw new Error('an archive is a signed device build: it needs --team and no --simulator');
  const sdk = checkTvosSdk(simulator);
  console.log(`tvOS SDK ${sdk}, deployment target tvOS ${DEPLOYMENT_TARGET}`);
  run('node', ['native/build-js.mjs']);
  const s = stage();
  console.log(`staged ${s.files} files, ${(s.shipped / 1e6).toFixed(1)} MB`);
  const dir = join('native', 'build', 'tvos', simulator ? 'xcode-sim' : 'xcode');
  run('cmake', [
    '-S', 'native', '-B', dir, '-G', 'Xcode',
    '-DCMAKE_SYSTEM_NAME=tvOS',
    `-DCMAKE_OSX_SYSROOT=${simulator ? 'appletvsimulator' : 'appletvos'}`,
    '-DCMAKE_OSX_ARCHITECTURES=arm64',
    `-DFF4E_BUILD=${build}`,
    `-DFF4E_VERSION=${version}`,
    ...(team ? [`-DCMAKE_XCODE_ATTRIBUTE_DEVELOPMENT_TEAM=${team}`] : []),
  ]);
  const project = join(dir, 'ff4e_native.xcodeproj');
  if (!existsSync(join(repo, project))) throw new Error(`cmake did not write ${project}`);
  // An archive leaves the products folder's app as a symlink into the archive's intermediates,
  // and a later build cannot create the app there: drop the link (never a real app).
  const products = join(repo, dir, `Release-${simulator ? 'appletvsimulator' : 'appletvos'}`, APP);
  if (lstatSync(products, { throwIfNoEntry: false })?.isSymbolicLink()) rmSync(products);
  const common = ['-project', project, '-scheme', SCHEME, '-configuration', 'Release'];
  // No Swift packages here, so the iOS lane's safe.bareRepository override is not needed.
  const env = {};
  if (archive) {
    // Unsigned, then the entitlements stamped on with a local signature: the export signs it for
    // the App Store and keeps them. An automatically signed archive would first need a tvOS
    // development profile, which Apple makes only for a team with a registered Apple TV
    // ("Your team has no devices from which to generate a provisioning profile", 2026-11-24);
    // the App Store profile the export makes needs no device.
    run('xcodebuild', [...common, '-destination', 'generic/platform=tvOS', '-archivePath', archive,
      'CODE_SIGNING_ALLOWED=NO', 'archive'], env);
    stampEntitlements(join(archive, 'Products', 'Applications', APP), team);
  } else if (simulator) {
    run('xcodebuild', [...common, '-destination', 'generic/platform=tvOS Simulator', 'build'], env);
  } else {
    run('xcodebuild', [...common, '-destination', 'generic/platform=tvOS', 'CODE_SIGNING_ALLOWED=NO', 'build'], env);
  }
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
  try {
    checkTvosSdk(args.includes('--simulator'));
  } catch (e) {
    console.error(`\nnative/tvos/build.mjs: ${e.message}\n`);
    process.exit(1);
  }
  buildTvos({
    simulator: args.includes('--simulator'),
    archive: opt('--archive'),
    team: opt('--team'),
    build: opt('--build') ?? '1',
    version: opt('--version') ?? '1.0',
  });
}
