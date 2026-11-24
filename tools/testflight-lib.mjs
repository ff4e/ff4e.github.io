/**
 * What the two TestFlight lanes share: the iOS app's (`release-testflight.mjs`) and the Apple
 * TV app's (`release-testflight-tvos.mjs`). Both sign the same bundle id with the paid team's
 * certificate, and both upload the same way — an export with `destination: upload` — only when
 * asked with `--upload`. Read `release-testflight.mjs`'s header for where the method comes from.
 */
import { execFileSync, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const BUNDLE_ID = 'io.github.ff4e.fishfillets4ever';

/** Print `msg` as `tool`'s failure and exit non-zero. */
export const dieAs = (tool) => (msg) => {
  console.error(`\n${tool}: ${msg}\n`);
  process.exit(1);
};

const sh = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();

/** `--build N` (the new CFBundleVersion) and `--upload` from the command line; dies without N. */
export function parseArgs(die, usage) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--build');
  const buildNumber = i !== -1 ? args[i + 1] : null;
  if (!buildNumber || !/^\d+$/.test(buildNumber)) die(usage);
  return { args, upload: args.includes('--upload'), buildNumber };
}

/**
 * Find a Distribution (not Development) codesigning identity's team.
 * Mirrors `device-build.mjs`'s `findTeam()`, but filters for "Apple Distribution"
 * — the free personal-team certificate `findTeam()` looks for cannot sign an
 * App Store archive at all.
 */
export function findDistributionTeam(die) {
  if (process.env.FF4E_TEAM) return process.env.FF4E_TEAM;
  let out = '';
  try {
    out = sh('security find-identity -v -p codesigning');
  } catch {
    /* handled below */
  }
  const names = [...out.matchAll(/"(Apple Distribution[^"]*)"/g)].map((m) => m[1]);
  const teams = [];
  for (const name of names) {
    try {
      const pem = execFileSync('security', ['find-certificate', '-c', name, '-p'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const subject = execFileSync('openssl', ['x509', '-noout', '-subject'], {
        input: pem,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const ou = subject.match(/OU\s*=\s*([A-Z0-9]{10})/);
      if (ou) teams.push(ou[1]);
    } catch {
      /* unreadable cert */
    }
  }
  const unique = [...new Set(teams)];
  if (unique.length === 0) {
    die(
      'No "Apple Distribution" certificate on this Mac.\n\n' +
        'This requires the PAID Apple Developer account, unlike npm run build:device.\n' +
        'Open Xcode with the enrolled Apple ID, select the App target → Signing &\n' +
        'Capabilities, and let Xcode create a Distribution certificate for the real\n' +
        `team, or set FF4E_TEAM=<id> if you already know it.`,
    );
  }
  if (unique.length > 1) die(`Several distribution teams found: ${unique.join(', ')}. Pick one: FF4E_TEAM=<id> ...`);
  return unique[0];
}

/**
 * Export `archivePath` straight to App Store Connect (`destination: upload`). A REAL,
 * irreversible TestFlight release: call it only behind an explicit `--upload`.
 */
export function uploadArchive({ archivePath, archiveDir, team, cwd, env, die }) {
  console.log('\nexporting + uploading to App Store Connect…');
  const exportOptionsPath = join(archiveDir, 'ExportOptions.plist');
  writeFileSync(
    exportOptionsPath,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key><string>app-store-connect</string>
  <key>teamID</key><string>${team}</string>
  <key>signingStyle</key><string>automatic</string>
  <key>destination</key><string>upload</string>
</dict>
</plist>
`,
  );
  try {
    execSync(
      [
        'xcodebuild',
        '-exportArchive',
        `-archivePath "${archivePath}"`,
        `-exportOptionsPlist "${exportOptionsPath}"`,
        '-allowProvisioningUpdates',
      ].join(' '),
      { cwd, stdio: 'inherit', env },
    );
  } catch {
    die('export/upload failed — xcodebuild output above says why. The archive is preserved; re-run --upload once the issue is fixed.');
  }
}
