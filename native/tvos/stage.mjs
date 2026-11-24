// The Apple TV app's game files: the bundle (native/build/game.js) and the part of public/
// the native host reads — the `ai` tier and what plays around it — copied to
// native/build/tvos/bundle/, which the tvOS build copies into the app (native/tvos/copy-bundle.sh).
//
//   node native/tvos/stage.mjs                  # stage, and print what it holds
//   node native/tvos/stage.mjs --check DIR      # every asset the smokes read (DIR/*.log, the
//                                               # host's --read-log) is one the app ships
//
// What ships is decided by the rules below, by directory and kind, not by a list of files: a
// list taken from a run would miss what that run did not reach (ZAVER's art, a story page,
// a subtitle face nobody picked). `--check` closes the gap the other way: `npm run native:check`
// runs every smoke with `--read-log` and then this check, so a change that makes the game read
// a file these rules leave out fails there, not on a television.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const pub = join(repo, 'public');
export const STAGE = join(repo, 'native', 'build', 'tvos', 'bundle');

/**
 * A 1998 `.ffs` with no staged `.ffs2` beside it: the game reads the `.ffs2` when it is there
 * (`voiceUrl`), so the `.ffs` behind one is the audio smoke's reference, not the game's.
 */
const rawFfs = { test: (path) => path.endsWith('.ffs') && existsSync(join(pub, `${path}2`)) === false };

/**
 * What the app ships, as `[pattern, why]`; a path under public/ (`/data/Graphic/001.ffr`)
 * ships when a pattern matches it. Everything else in public/ is the web's and never read
 * natively: the faithful and `enhanced` tiers' art, the 1998 help bitmaps (the native Help
 * draws `help/`'s figures), the original-music WAVs (the AAC is the game's), the faithful
 * movies (the `ai` tier plays the AI encodes, which are all there), the page's icons.
 */
const SHIP = [
  [/^\/enhanced-ai\//, 'the ai tier: every room, the fish, the map plaques and panel, the story pages, the credits, KUFRIK'],
  [/^\/data\/(Graphic|Title|Intro|Menu)\//, 'the rooms (FFR), their subtitles, KUFRIK\'s demo, the map'],
  [/^\/(data\/Sound|restored)\/[^/]+\.(ffs2|fft)$/, 'the speech, staged as AAC (and the restored lines\' subtitles)'],
  [rawFfs, 'a sound package that still ships as the 1998 .ffs (x00, the effects: ffs2.ts `isRawPkg`)'],
  [/^\/data\/Music\/[^/]+\.m4a$/, 'the music, as AAC'],
  [/^\/data\/Movie\/[^/]+_ai\.mp4$/, 'the AI-upscaled logo and intro'],
  [/^\/enhanced\/subtitle(\.ttf|-FONT-LICENSE\.txt)$/, 'FreeSans Bold, a subtitle face in Options, and its licence'],
  [/^\/fonts\//, 'the UI and subtitle faces'],
  [/^\/help\//, 'the help pages\' figures'],
  [/^\/cover\.webp$/, 'the start splash'],
];

/**
 * Read by a smoke but not by the game: `[pattern, the smokes' logs it is excused in, why]`.
 * Excused only in the log of the smoke that needs it, so the game itself starting to read
 * one of these still fails the check.
 */
const SMOKE_ONLY = [
  [/^\/(data\/Sound|restored)\/[^/]+\.ffs$/, /^audio-smoke/, 'it checks each staged .ffs2 against the 1998 .ffs it was encoded from'],
  [/^\/data\/Music\/[^/]+\.wav$/, /^audio-smoke/, 'it compares the decoded AAC with the original WAV'],
  [/^\/\.\.\//, /./, 'a smoke\'s own output, outside the asset root'],
];

export const ships = (path) => SHIP.some(([re]) => re.test(path));

function* files(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* files(p);
    else yield p;
  }
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

export function stage() {
  const game = join(repo, 'native', 'build', 'game.js');
  if (!existsSync(game)) throw new Error('no native/build/game.js: run node native/build-js.mjs first');
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  cpSync(game, join(STAGE, 'game.js'));
  let shipped = statSync(game).size, left = 0, n = 0;
  for (const f of files(pub)) {
    const path = `/${relative(pub, f).split('\\').join('/')}`;
    const size = statSync(f).size;
    if (!ships(path)) {
      left += size;
      continue;
    }
    cpSync(f, join(STAGE, 'public', path));
    shipped += size;
    n++;
  }
  return { files: n + 1, shipped, left };
}

function check(dir) {
  const read = new Set(), missing = new Set();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.log'))) {
    for (const p of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!p) continue;
      read.add(p);
      if (!ships(p) && !SMOKE_ONLY.some(([re, log]) => re.test(p) && log.test(f))) missing.add(p);
    }
  }
  if (read.size === 0) throw new Error(`no reads logged in ${dir}`);
  for (const p of [...missing].slice(0, 20)) console.log(`  read by the game but not shipped: ${p}`);
  console.log(missing.size
    ? `tvos assets: ${missing.size} of ${read.size} files read are not in the app`
    : `tvos assets: all ${read.size} files the smokes read are in the app`);
  return missing.size ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--check');
  if (at >= 0) process.exitCode = check(process.argv[at + 1]);
  else {
    const r = stage();
    console.log(`staged ${r.files} files, ${mb(r.shipped)}, in ${relative(repo, STAGE)} (left out of public/: ${mb(r.left)})`);
  }
}
