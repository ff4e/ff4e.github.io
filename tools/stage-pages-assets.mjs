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
      return !(seg && DATA_EXCLUDE.has(seg));
    };
  }
  cpSync(from, to, opts);
  console.log(`staged ${from} -> ${to}`);
}

// `.nojekyll`: serve files as-is (don't run Jekyll, which drops `_`-prefixed paths).
writeFileSync(join(DIST, '.nojekyll'), '');
console.log('wrote dist/.nojekyll');
