/**
 * Stage the built site for GitHub Pages.
 *
 * `vite build` is configured with `copyPublicDir: false` (copying the large local
 * `public/data` symlink flakes on the dev Mac), so this script copies the runtime
 * assets from `public/` into `dist/` after the build, dereferencing symlinks. It
 * also drops a `.nojekyll` marker so Pages serves the files verbatim.
 *
 * Run after `npm run build` (the CI Pages workflow does exactly this). In CI the
 * `public/` subdirs are the committed real files; locally `public/data` is a
 * symlink to the extracted game data (365 MB) — dereferencing copies it in full.
 */
import { cpSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const DIST = 'dist';
const PUBLIC = 'public';

// Never publish these `public/data` subdirs: the original ALTAR engine binary and
// player-private save games are not part of the GPL game assets the site loads.
const DATA_EXCLUDE = new Set(['Program', 'Writes', '256col']);

/**
 * ...nor the ORIGINALS of anything that ships compressed. Two tiers, one rule:
 *
 *   - `Music/*.wav` — the site fetches `Music/<name>.m4a` (tools/stage-music.ts).
 *   - `Sound/*.ffs` — the site fetches `Sound/<id>.ffs2` (tools/stage-voices.ts), EXCEPT
 *     `x00`, the effects package, which is not staged and is the one `.ffs` that must
 *     still be published. `isRawPkg` in `src/audio/ffs2.ts` is the rule; this reproduces
 *     it by name because a build script cannot import a browser module.
 *
 * The originals are a repo artefact, kept so that `--check`, `--verify` and the staging
 * drift tests have something to encode from and measure against, and so anyone can listen
 * to (or decode) what was given up. Nothing downloads them.
 *
 * Worth the lines because the budget here is real and shared: GitHub Pages publishes at
 * most 1 GB, and `public/` was ~621 MB before the voices were staged. Publishing both
 * tiers would spend 248 MB of the remaining headroom on bytes no player ever asks for —
 * and the whole point of compressing them was to make the site smaller.
 */
const isMusicOriginal = (rest) => rest.startsWith(`Music${sep}`) && rest.endsWith('.wav');
const isVoiceOriginal = (rest) => rest.startsWith(`Sound${sep}`) && rest.endsWith('.ffs') && rest !== `Sound${sep}x00.ffs`;

/**
 * ...nor the help bitmaps. The twenty 640x480 pages of `data/Help/` are 5.9 MB, and the
 * site does not fetch them any more: the help is text (`src/data/helpText.ts`) plus the
 * twelve cropped diagrams in `public/help/`, which is 205 kB and IS published.
 *
 * They stay in the repo for the same reason the `.wav` and `.ffs` originals do — the
 * transcription was made from them and `tools/crop-help-diagrams.ts` still crops from
 * them, so they are the thing both are checked against. `public/restored/README.md` is
 * the standing promise that `public/data/` is the ALTAR release byte for byte; this is a
 * decision about what the SITE serves, which is the only place that promise allows it to
 * be made.
 *
 * The index files (`helpy.txt`/`helps.txt`) go with them: the page order and the tab names
 * they carry are compiled into `helpText.ts` and pinned against these files by
 * `test/helpText.test.ts`, so nothing downloads them either.
 */
const isHelpPage = (rest) => rest.startsWith(`Help${sep}`) && /\.(bmp|txt)$/i.test(rest);

if (!existsSync(DIST)) {
  console.error(`${DIST}/ is missing — run \`npm run build\` first.`);
  process.exit(1);
}
if (!existsSync(PUBLIC)) {
  console.error(`${PUBLIC}/ is missing — nothing to stage.`);
  process.exit(1);
}

// Copy every top-level entry of public/ (data, enhanced, fonts, …) into dist/.
for (const entry of readdirSync(PUBLIC)) {
  const from = join(PUBLIC, entry);
  const to = join(DIST, entry);
  const opts = { recursive: true, dereference: true };
  if (entry === 'data') {
    // Skip the excluded top-level subdirs of public/data/ during the copy.
    const prefix = from + sep;
    opts.filter = (src) => {
      const rest = src.startsWith(prefix) ? src.slice(prefix.length) : '';
      const seg = rest.split(sep)[0];
      if (seg && DATA_EXCLUDE.has(seg)) return false;
      return !isMusicOriginal(rest) && !isVoiceOriginal(rest) && !isHelpPage(rest);
    };
  }
  // The restored package is a sound package like any other and is staged like one, so
  // its `.ffs` original is dropped for the same reason the room packages' are.
  if (entry === 'restored') opts.filter = (src) => !src.endsWith('.ffs');
  cpSync(from, to, opts);
  console.log(`staged ${from} -> ${to}`);
}

// `.nojekyll`: serve files as-is (don't run Jekyll, which drops `_`-prefixed paths).
writeFileSync(join(DIST, '.nojekyll'), '');
console.log('wrote dist/.nojekyll');
