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
 *     node tools/stage-xbox-wwwroot.mjs      # dist/ -> xbox/Ff4eXbox/wwwroot/
 *
 * The staged tree is large (~350 MB) and is not committed — it is a build artifact,
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

// The service worker is deliberately not registered in the xbox build (see
// src/platform/pwa.ts) — the content is already local. Ship it anyway? No: drop it so a
// stale cache can never shadow a package update.
const EXCLUDE = new Set(['sw.js']);

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

for (const entry of readdirSync(src)) {
  if (EXCLUDE.has(entry)) continue;
  // dereference: public/data may be a symlink locally, and MSBuild must see real files.
  cpSync(join(src, entry), join(dest, entry), {
    recursive: true,
    dereference: true,
    force: true,
  });
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
