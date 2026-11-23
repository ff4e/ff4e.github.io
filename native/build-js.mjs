// Bundles the native host's JS (native/js/main.ts + the game modules it imports) into
// one classic script for QuickJS: `node native/build-js.mjs` -> native/build/game.js.
//
// The game's own flow modules in src/app/ (logicTick, movement, undo, roomLoad, persist,
// …) are bundled AS THEY ARE. A few of the modules they import reach the document, the
// Web Audio graph or the browser's layout — the browser shell a native host replaces. Each
// of those is swapped, at bundle time, for a module of the same name in native/js/seams/
// (SEAMS below): the same move the unit tests make with `vi.mock`, done once for the
// whole bundle. src/ is not touched and does not know.
//
// The swap is fenced by an allowlist. Every src/app/ module that ends up in the bundle must
// be in REAL or SEAMED; anything else fails the build with the import chain that pulled it
// in. A new import FROM a seamed module fails earlier, as esbuild's "No matching export in
// js/seams/…". Either way a src/ change that adds an edge from the flow into the DOM shell
// breaks this build loudly instead of shipping a module that throws on its first
// `document` at load.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const out = join(here, 'build', 'game.js');
const appDir = join(repo, 'src', 'app');
const seamDir = join(here, 'js', 'seams');
mkdirSync(dirname(out), { recursive: true });

/** src/app/ modules replaced by native/js/seams/<same name>.ts. */
const SEAMED = new Set(readdirSync(seamDir).filter((f) => f.endsWith('.ts')).map((f) => basename(f, '.ts')));
/** src/platform/ modules replaced the same way (`platform-<name>.ts` in seams/). */
const PLATFORM_SEAMS = new Set([...SEAMED].filter((n) => n.startsWith('platform-')).map((n) => n.slice('platform-'.length)));

/**
 * The src/app/ modules the native host runs for real. DOM-free at module scope, and
 * — through the seams — at every import depth. Adding one here is a claim that it is.
 */
const REAL = new Set([
  'fishFrame', 'frameClock', 'gameState', 'initQuiet', 'keyTables', 'layout', 'logicTick', 'movement',
  'paintClock', 'panelLight', 'persist', 'phoneUndoFocus', 'replayMode', 'roomActionEvent',
  'roomGates', 'roomLoad', 'saveMigration', 'screenState', 'solveMode', 'undo',
]);

const seamPlugin = {
  name: 'native-seams',
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.importer) return undefined;
      const target = resolve(args.resolveDir, args.path);
      const dir = dirname(target);
      const name = basename(target, '.js');
      if (dir === appDir && SEAMED.has(name)) return { path: join(seamDir, `${name}.ts`) };
      if (dir === join(repo, 'src', 'platform') && PLATFORM_SEAMS.has(name)) return { path: join(seamDir, `platform-${name}.ts`) };
      return undefined;
    });
  },
};

// windows-1250's upper half, taken from the platform's own decoder at build time, so the
// shim's table cannot drift from what the browser build decodes.
const high = new TextDecoder('windows-1250').decode(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));

const result = await build({
  entryPoints: [join(here, 'js', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'neutral',
  outfile: out,
  sourcemap: false,
  legalComments: 'none',
  metafile: true,
  absWorkingDir: repo, // metafile paths relative to the repo, wherever this is run from
  // The DOM shell imports its art and styles as files. None of it may reach this bundle,
  // so they load as nothing — which lets a stray edge reach the allowlist check below and
  // be reported with its import chain, instead of as an esbuild loader error.
  loader: { '.webp': 'empty', '.png': 'empty', '.svg': 'empty', '.css': 'empty', '.woff2': 'empty' },
  define: { __CP1250_HIGH__: JSON.stringify(high) },
  plugins: [seamPlugin],
  logLevel: 'warning',
});

// The allowlist check: walk the bundle's import graph and name the chain to any src/app/
// module that is neither run for real nor seamed.
const inputs = result.metafile.inputs;
const entry = relative(repo, join(here, 'js', 'main.ts'));
const parent = new Map([[entry, null]]);
const queue = [entry];
while (queue.length) {
  const cur = queue.shift();
  for (const i of inputs[cur]?.imports ?? []) {
    if (!parent.has(i.path)) {
      parent.set(i.path, cur);
      queue.push(i.path);
    }
  }
}
const stray = Object.keys(inputs).filter((p) => p.startsWith('src/app/') && !REAL.has(basename(p, '.ts')));
if (stray.length) {
  for (const p of stray) {
    const chain = [];
    for (let c = p; c; c = parent.get(c)) chain.unshift(c);
    console.error(`native bundle pulls in ${p}, which is neither REAL nor seamed:\n  ${chain.join('\n  -> ')}`);
  }
  process.exit(1);
}
for (const s of SEAMED) {
  if (!s.startsWith('platform-') && !existsSync(join(appDir, `${s}.ts`))) {
    console.error(`native/js/seams/${s}.ts stands in for src/app/${s}.ts, which no longer exists`);
    process.exit(1);
  }
}
console.log(`wrote ${out}`);
