// Build the Apple TV app: the bundle, the staged assets, the Xcode project CMake generates for
// tvOS from native/CMakeLists.txt, and an xcodebuild of it.
//
//   node native/tvos/build.mjs                          # device build, unsigned: does it compile and link?
//   node native/tvos/build.mjs --simulator              # the Apple TV Simulator (signed locally, runnable)
//   node native/tvos/build.mjs --archive DIR --team ID --build N [--version V]
//                                                       # a signed .xcarchive for App Store Connect
//
// The archive is what tools/release-testflight-tvos.mjs makes (and, with --upload, exports);
// read that file's header before releasing. Nothing here uploads anything.
//
// The Xcode project is generated (native/build/tvos/xcode or xcode-sim), never checked in:
// CMake is the one list of the host's sources and the pinned dependencies for every platform.
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage } from './stage.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
/** tvOS 17: every Apple TV Apple still supports runs it (the HD and every 4K). */
export const DEPLOYMENT_TARGET = '17.0';
export const SCHEME = 'ff4e-native';
export const APP = 'FishFillets.app';

const run = (cmd, args, env = {}) => execFileSync(cmd, args, { cwd: repo, stdio: 'inherit', env: { ...process.env, ...env } });

/**
 * Bundle, stage, generate and build. `archive`: the .xcarchive path (a signed device build);
 * else a device build without signing, or with `simulator` a Simulator build. Returns the
 * Xcode project's directory.
 */
export function buildTvos({ simulator = false, archive = null, team = null, build = '1', version = '1.0' } = {}) {
  if (archive && (simulator || !team)) throw new Error('an archive is a signed device build: it needs --team and no --simulator');
  run('node', ['native/build-js.mjs']);
  const s = stage();
  console.log(`staged ${s.files} files, ${(s.shipped / 1e6).toFixed(1)} MB`);
  const dir = join('native', 'build', 'tvos', simulator ? 'xcode-sim' : 'xcode');
  run('cmake', [
    '-S', 'native', '-B', dir, '-G', 'Xcode',
    '-DCMAKE_SYSTEM_NAME=tvOS',
    `-DCMAKE_OSX_SYSROOT=${simulator ? 'appletvsimulator' : 'appletvos'}`,
    '-DCMAKE_OSX_ARCHITECTURES=arm64',
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${DEPLOYMENT_TARGET}`,
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
    run('xcodebuild', [...common, '-destination', 'generic/platform=tvOS', '-archivePath', archive,
      '-allowProvisioningUpdates', 'archive'], env);
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
  buildTvos({
    simulator: args.includes('--simulator'),
    archive: opt('--archive'),
    team: opt('--team'),
    build: opt('--build') ?? '1',
    version: opt('--version') ?? '1.0',
  });
}
