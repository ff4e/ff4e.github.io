/**
 * Build and install onto a real iPhone with a FREE Apple ID — no paid enrolment.
 *
 * ── Why this is worth a tool ────────────────────────────────────────────────
 * Two things about this app cannot be checked anywhere else:
 *
 *   - the launch storyboard, because `simctl launch` bypasses SpringBoard and the
 *     screen it would draw never appears; and
 *   - haptics, because the Simulator has no Taptic Engine, so every call succeeds
 *     and nothing happens.
 *
 * Both are shipping surfaces. A phone is the only instrument that reads them, and
 * Xcode's personal-team provisioning puts the app on one for free — a 7-day
 * profile, no App Store Connect record, no $99.
 *
 * ── The one thing this tool exists to prevent ───────────────────────────────
 * It builds under a THROWAWAY bundle id, never the real one.
 *
 * Free provisioning registers whatever bundle id you build to against your
 * personal team, and Apple gives you no way to release it again. Enrol later with
 * the same Apple ID, try to create the matching App ID, and you can be told
 * "An App ID with Identifier '…' is not available" — about your own identifier,
 * with no recourse but to pick a different one. `io.github.ff4e.fishfillets4ever`
 * is the name this app ships under; it must stay untouched until the App Store
 * Connect record claims it properly. So the device build wears a different id and
 * burns that one instead.
 *
 * The cost is that the dev build is a separate app on the phone — its own icon,
 * its own save data, sitting alongside a real install rather than replacing it.
 * That is the correct trade and, for testing a launch screen, an advantage.
 *
 * ── What you have to do by hand, once ───────────────────────────────────────
 * Xcode holds the Apple ID and this cannot be scripted:
 *
 *   1. Xcode → Settings → Accounts → + → Apple ID. Any Apple ID works; it does
 *      not have to be enrolled in anything.
 *   2. `npm run open:ios`, select the App target → Signing & Capabilities, and
 *      choose "<your name> (Personal Team)". This step is not optional bureaucracy:
 *      Xcode only mints the signing certificate when it first signs something, so
 *      until you do it there is no certificate for this tool to find. Xcode will
 *      complain about the bundle id on that screen — ignore it, the build here
 *      overrides it.
 *   3. Plug the iPhone in and unlock it. Trust the Mac if it asks.
 *   4. On the phone: Settings → Privacy & Security → Developer Mode → on. It
 *      reboots.
 *
 * Then `npm run build:device`. The first run is also the first time the phone has
 * seen this certificate, so iOS will refuse to open the app until you approve it
 * once: Settings → General → VPN & Device Management → your Apple ID → Trust.
 *
 * The profile lasts 7 days. When the app stops opening, that is what happened —
 * run this again.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   npm run build:device                 # build web assets, then build + install
 *   npm run build:device -- --skip-web   # native only, when dist/ is current
 *   FF4E_TEAM=ABCDE12345 npm run build:device     # if you have several teams
 *   FF4E_DEVICE=<udid> npm run build:device       # if detection misses the phone
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DERIVED = '/tmp/ff4e-device-dd';

/**
 * The sacrificial identifier. Deliberately NOT a suffix of the shipping one that
 * somebody could mistake for a variant of it — this id gets consumed and is meant
 * to look consumable.
 */
const DEV_BUNDLE_ID = 'io.github.ff4e.devbuild';

const die = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

/**
 * The team to sign as, read off the codesigning certificates in the keychain.
 *
 * The tempting string is the one in parentheses in the certificate's name —
 * `Apple Development: <email> (RB9543ZN3K)` — and it is the wrong one. That is
 * the certificate's own id. The Team ID lives in the subject's OU field, and on
 * a personal team the two differ, so the name has to be turned into a real
 * certificate and the subject parsed.
 */
function findTeam() {
  if (process.env.FF4E_TEAM) return process.env.FF4E_TEAM;
  let out = '';
  try {
    out = sh('security find-identity -v -p codesigning');
  } catch {
    /* handled below as "none found" */
  }
  const names = [...out.matchAll(/"(Apple Develop(?:ment|er)[^"]*)"/g)].map((m) => m[1]);
  const teams = [];
  for (const name of names) {
    try {
      const subject = sh(`security find-certificate -c "${name}" -p | openssl x509 -noout -subject`);
      const ou = subject.match(/OU\s*=\s*([A-Z0-9]{10})/);
      if (ou) teams.push(ou[1]);
    } catch {
      /* a certificate we cannot read is one we cannot sign with either */
    }
  }
  const unique = [...new Set(teams)];
  if (unique.length === 0) {
    die(
      'No development certificate on this Mac.\n\n' +
        'Adding the Apple ID is not quite enough on its own — Xcode mints the certificate\n' +
        'lazily, the first time it signs something. So do both:\n\n' +
        '  1. Xcode -> Settings -> Accounts -> + -> Apple ID\n' +
        '     (any Apple ID; it does not need a paid membership)\n' +
        '  2. npm run open:ios, then select the App target -> Signing & Capabilities,\n' +
        '     and pick your name followed by "(Personal Team)" in the Team dropdown.\n' +
        '     That is the step that creates the certificate.\n\n' +
        'Xcode will show a bundle-id error there — ignore it. This tool overrides the\n' +
        'bundle id at build time and never signs the shipping one on purpose.\n\n' +
        'Then come back and run this again.',
    );
  }
  if (unique.length > 1) {
    die(`Several teams have certificates here:\n\n  ${unique.join('\n  ')}\n\nPick one: FF4E_TEAM=<id> npm run build:device`);
  }
  return unique[0];
}

/**
 * The single connected, paired iPhone — or a clear explanation of why there isn't one.
 *
 * `devicectl` lists every device this Mac has ever paired with, not just the ones
 * present, so "known" and "reachable" are different questions and the failure
 * messages have to tell them apart. The filter is also deliberately loose, and
 * `FF4E_DEVICE` overrides it entirely: a detection rule that is wrong about a
 * phone which is in fact sitting on the desk is worse than no rule, because there
 * is nothing the user can do about it.
 */
function findDevice() {
  let json;
  try {
    json = JSON.parse(sh(`xcrun devicectl list devices --json-output /dev/stdout --quiet`));
  } catch {
    die('`xcrun devicectl` failed. Xcode 15 or newer is required for this tool.');
  }
  const all = json?.result?.devices ?? [];
  const describe = (d) => ({
    udid: d?.hardwareProperties?.udid,
    name: d?.deviceProperties?.name ?? 'iPhone',
    os: d?.deviceProperties?.osVersionNumber ?? '?',
  });

  if (process.env.FF4E_DEVICE) {
    const forced = all.find((d) => d?.hardwareProperties?.udid === process.env.FF4E_DEVICE);
    return forced ? describe(forced) : { udid: process.env.FF4E_DEVICE, name: 'iPhone', os: '?' };
  }

  const paired = all.filter(
    (d) => d?.hardwareProperties?.platform === 'iOS' && d?.connectionProperties?.pairingState === 'paired',
  );
  const reachable = paired.filter((d) => d?.connectionProperties?.tunnelState !== 'unavailable');

  if (paired.length === 0) {
    die(
      'No paired iPhone found.\n\n' +
        '  - plug it in and UNLOCK it (a locked phone will not pair)\n' +
        '  - tap Trust on the phone if it asks\n' +
        '  - Settings -> Privacy & Security -> Developer Mode must be ON (the phone reboots)',
    );
  }
  if (reachable.length === 0) {
    const known = paired.map((d) => `${describe(d).name} (${describe(d).udid})`);
    die(
      `Paired, but not reachable right now:\n\n  ${known.join('\n  ')}\n\n` +
        'Plug it in and unlock it. If it IS connected, the detection is wrong — force it:\n\n' +
        '  FF4E_DEVICE=<udid> npm run build:device',
    );
  }
  if (reachable.length > 1) {
    const names = reachable.map((d) => `${describe(d).name} (${describe(d).udid})`);
    die(`More than one iPhone is connected:\n\n  ${names.join('\n  ')}\n\nUnplug the others, or FF4E_DEVICE=<udid>.`);
  }
  return describe(reachable[0]);
}

const skipWeb = process.argv.includes('--skip-web');

if (!skipWeb) {
  console.log('building web assets…');
  execSync('npm run build:ios', { cwd: REPO, stdio: 'inherit' });
} else if (!existsSync(join(REPO, 'ios/App/App/public/index.html'))) {
  die('--skip-web was passed but ios/App/App/public is empty. Run without it once.');
}

const team = findTeam();
const device = findDevice();
console.log(`\nsigning as team ${team}`);
console.log(`installing to ${device.name} (iOS ${device.os})\n`);

// -allowProvisioningUpdates is what lets xcodebuild mint the free profile and
// register the device without opening Xcode. It still needs the Apple ID that
// findTeam() just proved is there.
try {
  execSync(
    [
      'xcodebuild',
      '-scheme App',
      '-configuration Debug',
      `-destination "platform=iOS,id=${device.udid}"`,
      `-derivedDataPath ${DERIVED}`,
      '-allowProvisioningUpdates',
      `DEVELOPMENT_TEAM=${team}`,
      `PRODUCT_BUNDLE_IDENTIFIER=${DEV_BUNDLE_ID}`,
      'CODE_SIGN_STYLE=Automatic',
      'build',
    ].join(' '),
    { cwd: join(REPO, 'ios/App'), stdio: 'inherit' },
  );
} catch {
  // xcodebuild has already printed the real reason; a Node stack on top of it
  // only buries the line that matters.
  die(
    'xcodebuild failed — its output above says why. The usual causes:\n\n' +
      '  - the phone is locked, or Developer Mode is off\n' +
      `  - the Apple ID has hit the free tier's limit of 10 new App IDs per 7 days\n` +
      '  - the device is not registered to the team yet, which -allowProvisioningUpdates\n' +
      '    can only fix if Xcode has been opened at least once with this Apple ID',
  );
}

const app = `${DERIVED}/Build/Products/Debug-iphoneos/App.app`;
if (!existsSync(app)) die(`Build reported success but ${app} is missing.`);

console.log('\ninstalling…');
try {
  execFileSync('xcrun', ['devicectl', 'device', 'install', 'app', '--device', device.udid, app], { stdio: 'inherit' });
} catch {
  die('Install failed — see above. If the phone locked mid-install, unlock it and run this again.');
}

console.log(`
Installed as ${DEV_BUNDLE_ID} — a throwaway id, so the shipping one stays
unclaimed until App Store Connect takes it.

If the app refuses to open, iOS has not been told to trust this certificate yet:

  Settings -> General -> VPN & Device Management -> your Apple ID -> Trust

Two things only this build can show you:

  - the launch screen, which the Simulator never draws
  - haptics: push a fish into a wall, and the tap on a blocked move

The profile expires in 7 days. When it stops opening, run this again.
`);
