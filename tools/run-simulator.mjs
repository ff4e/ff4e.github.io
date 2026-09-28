/**
 * Build + boot + install + launch the app in the iOS Simulator — for a quick
 * visual check, without touching a real device or any provisioning/team state.
 *
 * Unlike `device-build.mjs`, the Simulator needs no Apple ID, certificate or
 * team at all (Xcode's built-in simulator signing identity covers it), so
 * this script is safe to run repeatedly with no throwaway-bundle-id concern —
 * it always builds the real `io.github.ff4e.fishfillets4ever` id, because a
 * Simulator install can never claim that id against any team.
 *
 * ── The `safe.bareRepository` git override ──────────────────────────────────
 * This environment's `safe.bareRepository=explicit` git setting breaks Xcode's
 * Swift Package Manager cache resolution: SPM stashes its package cache as a
 * bare git repo under derived data, and `explicit` makes the system `git`
 * refuse to operate on any bare repo it wasn't told about by path (verified
 * here 2026-09-28 — the build fails with "cannot use bare repository … safe.
 * bareRepository is 'explicit'" even with `-scmProvider xcode`). The fix is a
 * narrow, single-command override — `GIT_CONFIG_VALUE_0=all` — not a global
 * git config change.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run run:sim                      # build web + native, boot, install, launch
 *   npm run run:sim -- --skip-web        # native only, when dist/ is current
 *   npm run run:sim -- --device "iPhone 16"   # pick a specific simulator by name
 */
import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = '/tmp/ff4e-sim-dd';
const BUNDLE_ID = 'io.github.ff4e.fishfillets4ever';

const die = (msg) => {
  console.error(`\nrun-simulator: ${msg}\n`);
  process.exit(1);
};

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

const args = process.argv.slice(2);
const skipWeb = args.includes('--skip-web');
const deviceFlagIdx = args.indexOf('--device');
const requestedDevice = deviceFlagIdx !== -1 ? args[deviceFlagIdx + 1] : null;

/**
 * Find (or pick) a simulator by name, preferring one already booted so repeat
 * runs during a session don't keep rebooting a fresh instance.
 */
function findSimulator() {
  const json = JSON.parse(sh('xcrun simctl list devices --json'));
  const all = Object.entries(json.devices ?? {}).flatMap(([runtime, devices]) =>
    devices.map((d) => ({ ...d, runtime })),
  );
  const iosDevices = all.filter((d) => d.isAvailable && d.runtime.includes('iOS'));
  if (iosDevices.length === 0) die('no available iOS simulators found. Install one via Xcode → Settings → Platforms.');

  if (requestedDevice) {
    const match = iosDevices.find((d) => d.name === requestedDevice);
    if (!match) {
      const names = [...new Set(iosDevices.map((d) => d.name))].join(', ');
      die(`no simulator named "${requestedDevice}". Available: ${names}`);
    }
    return match;
  }

  const booted = iosDevices.find((d) => d.state === 'Booted');
  if (booted) return booted;

  // No preference given and nothing booted: pick the newest iOS runtime's first device.
  const newestRuntime = iosDevices.map((d) => d.runtime).sort().at(-1);
  return iosDevices.find((d) => d.runtime === newestRuntime);
}

if (!skipWeb) {
  console.log('building web assets…');
  execSync('npm run build:ios', { cwd: REPO, stdio: 'inherit' });
} else if (!existsSync(join(REPO, 'ios/App/App/public/index.html'))) {
  die('--skip-web was passed but ios/App/App/public is empty. Run without it once.');
}

const device = findSimulator();
console.log(`using simulator: ${device.name} (${device.udid}), state=${device.state}`);

console.log('building for simulator…');
try {
  execSync(
    [
      'xcodebuild',
      '-scheme App',
      '-configuration Debug',
      '-sdk iphonesimulator',
      `-destination "platform=iOS Simulator,id=${device.udid}"`,
      `-derivedDataPath ${DERIVED}`,
      '-scmProvider xcode',
      'build',
    ].join(' '),
    {
      cwd: join(REPO, 'ios/App'),
      stdio: 'inherit',
      // Narrow override for this one command only — see header comment.
      env: { ...process.env, GIT_CONFIG_VALUE_0: 'all' },
    },
  );
} catch {
  die('xcodebuild failed — its output above says why.');
}

const app = `${DERIVED}/Build/Products/Debug-iphonesimulator/App.app`;
if (!existsSync(app)) die(`Build reported success but ${app} is missing.`);

if (device.state !== 'Booted') {
  console.log('booting simulator…');
  execFileSync('xcrun', ['simctl', 'boot', device.udid], { stdio: 'inherit' });
  // The Simulator.app UI is optional for install/launch, but opening it makes the
  // launch actually visible for a manual visual check, which is the point of this script.
  execFileSync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.udid], { stdio: 'inherit' });
  execFileSync('xcrun', ['simctl', 'bootstatus', device.udid, '-b'], { stdio: 'inherit' });
}

console.log('installing…');
execFileSync('xcrun', ['simctl', 'install', device.udid, app], { stdio: 'inherit' });

console.log('launching…');
execFileSync('xcrun', ['simctl', 'launch', device.udid, BUNDLE_ID], { stdio: 'inherit' });

console.log(`\n✅ ${BUNDLE_ID} installed and launched on ${device.name} (${device.udid})\n`);
