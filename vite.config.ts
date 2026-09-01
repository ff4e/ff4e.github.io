import { defineConfig, type PluginOption } from 'vitest/config';
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

/**
 * Tells `tools/layout-lab.html` which revision of `src/app/layout.ts` it is showing.
 *
 * The lab imports the layout straight out of the WORKING TREE, so "shipped" means whatever
 * happens to be checked out — which on a feature branch is not what `main` has and not what
 * players are running. Labelling the panel "what the game does now" was therefore wrong in
 * two ways at once, and the honest fix is for the page to name the branch and say whether
 * the file differs from `origin/main`.
 *
 * `apply: 'serve'` keeps it dev-only by construction: it adds a middleware and no build
 * output, so nothing here can reach the built site. It runs git per request rather than at
 * config load so the answer does not go stale when you commit with the server up.
 */
function labGitInfo(): PluginOption {
  const git = (args: string[]): string => {
    try {
      return execSync(`git ${args.join(' ')}`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      return '';
    }
  };
  return {
    name: 'ff-lab-git-info',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__lab/git.json', (_req, res) => {
        const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
        const head = git(['rev-parse', '--short', 'HEAD']);
        // Empty output means no difference; non-empty (or a failure, which returns '') is
        // reported as "differs" only when we positively saw a diff.
        const vsMain = git(['diff', '--stat', 'origin/main', '--', 'src/app/layout.ts']);
        const dirty = git(['status', '--porcelain', '--', 'src/app/layout.ts']);
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            branch,
            head,
            differsFromMain: vsMain.length > 0,
            uncommitted: dirty.length > 0,
          }),
        );
      });
    },
  };
}

// The original room data is served from public/data (a symlink to the extracted
// MAINDIR). copyPublicDir is disabled for builds because copying the large data
// dir flakes on this machine (endpoint security software locking files mid-copy); for a
// production build, stage the assets separately (tools/stage-pages-assets.mjs).
export default defineConfig({
  plugins: [labGitInfo()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_HASH__: JSON.stringify(gitHash()),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  server: { host: '127.0.0.1', port: 5173 },
  build: { copyPublicDir: false, target: 'es2022' },
  // The unit suite runs against a seeded Math.random so a failure always means a real
  // defect, never a 1-in-100 draw (see test/rng.ts). The game itself is untouched.
  //
  // `typescript` is externalised because test/region-cycle.test.ts imports the region
  // analyser, which uses the TypeScript compiler API. Left inlined, Vite tries to read a
  // source map that the published typescript.js does not ship and prints a four-line
  // stack on every otherwise-green run — noise in the output the suite works to keep
  // readable. Externalising also skips transforming an 8 MB file nobody is testing.
  test: {
    setupFiles: ['./test/rng.setup.ts'],
    server: { deps: { external: ['typescript'] } },
  },
});
