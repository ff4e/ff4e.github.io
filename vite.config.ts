import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/** Short git hash of the build, or 'dev' outside a checkout. */
function gitHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

// The original room data is served from public/data (a symlink to the extracted
// MAINDIR). copyPublicDir is disabled for builds because copying the large data
// dir flakes on this machine (endpoint security software locking files mid-copy); for a
// production build, stage the assets separately (tools/stage-pages-assets.mjs).
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_HASH__: JSON.stringify(gitHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: '127.0.0.1', port: 5173 },
  build: { copyPublicDir: false, target: 'es2022' },
});
