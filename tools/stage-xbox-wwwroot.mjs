/**
 * Stage the built web app into the Xbox UWP package as local content.
 *
 * The console app is fully self-contained: it never loads anything over the network.
 * MainPage.xaml.cs maps the packaged `wwwroot` folder onto https://ff4e.example via
 * WebView2's SetVirtualHostNameToFolderMapping, so whatever we copy here is exactly
 * what the game sees at runtime.
 *
 * Run AFTER building the site with the xbox target:
 *
 *     VITE_TARGET=xbox npm run build
 *     node tools/stage-pages-assets.mjs      # copies public/ (incl. game data) into dist/
 *     node tools/stage-xbox-wwwroot.mjs      # dist/ -> xbox/Ff4eXbox/wwwroot/, AAC audio -> originals
 *
 * The staged tree is large (~590 MB, most of it the audio originals below) and is not committed — it is a build artifact,
 * rebuilt by the xbox-msix workflow on every run.
 */
import { rmSync, mkdirSync, cpSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(repo, 'dist');
const dest = join(repo, 'xbox', 'Ff4eXbox', 'wwwroot');

if (!existsSync(src)) {
  console.error(
    'dist/ not found. Build first:\n' +
      '  VITE_TARGET=xbox npm run build && node tools/stage-pages-assets.mjs',
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const entry of readdirSync(src)) {
  // dereference: public/data may be a symlink locally, and MSBuild must see real files.
  cpSync(join(src, entry), join(dest, entry), {
    recursive: true,
    dereference: true,
    force: true,
  });
}

/**
 * Swap the AAC-staged audio for the 1998 originals it was encoded from.
 *
 * The console's WebView2 cannot decode AAC (src/audio/audioTier.ts), so the xbox build
 * fetches `Sound/<id>.ffs` and `Music/<name>.wav` — exactly the files
 * tools/stage-pages-assets.mjs leaves out of dist/ to fit GitHub Pages' 1 GB. That
 * budget does not apply to a package read from the console's own storage, so the
 * originals go in from public/, and the staged files nothing here will ever fetch come
 * out. Same pairs as stage-pages-assets.mjs: Sound/*.ffs (x00's is already there),
 * Music/*.wav, and the restored lines.
 */
const pub = join(repo, 'public');
const swaps = [
  { dir: join('data', 'Sound'), original: '.ffs', staged: '.ffs2' },
  { dir: join('data', 'Music'), original: '.wav', staged: '.m4a' },
  { dir: 'restored', original: '.ffs', staged: '.ffs2' },
];
for (const { dir, original, staged } of swaps) {
  let swapped = 0;
  for (const name of readdirSync(join(pub, dir))) {
    if (name.endsWith(original)) {
      cpSync(join(pub, dir, name), join(dest, dir, name), { dereference: true, force: true });
      swapped++;
    }
  }
  for (const name of readdirSync(join(dest, dir))) {
    if (name.endsWith(staged)) rmSync(join(dest, dir, name));
  }
  if (swapped === 0) {
    console.error(`ERROR: no ${original} originals in public/${dir} — the console cannot play ${staged}.`);
    process.exit(1);
  }
  console.log(`Audio: ${swapped} ${original} original(s) in place of ${staged} -> ${dir}`);
}

/** Total bytes + file count of a directory tree (for a sanity line in the build log). */
function measure(dir) {
  let bytes = 0;
  let files = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = measure(p);
      bytes += sub.bytes;
      files += sub.files;
    } else {
      bytes += statSync(p).size;
      files++;
    }
  }
  return { bytes, files };
}

const { bytes, files } = measure(dest);
const mb = (bytes / (1024 * 1024)).toFixed(1);
console.log(`Staged ${files} file(s), ${mb} MB -> xbox/Ff4eXbox/wwwroot/`);

if (!existsSync(join(dest, 'index.html'))) {
  console.error('ERROR: wwwroot/index.html is missing — the package would not load.');
  process.exit(1);
}
if (!existsSync(join(dest, 'data'))) {
  console.error('ERROR: wwwroot/data is missing — run tools/stage-pages-assets.mjs first.');
  process.exit(1);
}
