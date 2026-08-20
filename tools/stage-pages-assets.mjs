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
 * ...nor the music ORIGINALS. The site fetches `Music/<name>.m4a` (see tools/stage-music.ts);
 * the 17 `.wav` they were encoded from are a repo artefact, kept so that `--check`,
 * `--verify` and `test/musicStaging.test.ts` have something to encode from and measure
 * against, and so anyone can listen to what was given up. Nothing downloads them.
 *
 * Worth the two lines because the budget here is real and shared: GitHub Pages publishes at
 * most 1 GB, and `public/` is already ~621 MB. Staging both tiers would spend 64 MB of the
 * remaining headroom on bytes no player ever asks for — and the whole point of compressing
 * the music was to make the site smaller.
 */
const isMusicOriginal = (rest) => rest.startsWith(`Music${sep}`) && rest.endsWith('.wav');

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
      return !isMusicOriginal(rest);
    };
  }
  cpSync(from, to, opts);
  console.log(`staged ${from} -> ${to}`);
}

// `.nojekyll`: serve files as-is (don't run Jekyll, which drops `_`-prefixed paths).
writeFileSync(join(DIST, '.nojekyll'), '');
console.log('wrote dist/.nojekyll');
