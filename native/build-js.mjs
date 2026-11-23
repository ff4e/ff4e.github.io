// Bundles the native spike's JS (native/js/main.ts + the game modules it imports) into
// one classic script for QuickJS: `node native/build-js.mjs` -> native/build/game.js.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'build', 'game.js');
mkdirSync(dirname(out), { recursive: true });

// windows-1250's upper half, taken from the platform's own decoder at build time, so the
// shim's table cannot drift from what the browser build decodes.
const high = new TextDecoder('windows-1250').decode(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i));

await build({
  entryPoints: [join(here, 'js', 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  platform: 'neutral',
  outfile: out,
  sourcemap: false,
  legalComments: 'none',
  define: { __CP1250_HIGH__: JSON.stringify(high) },
  logLevel: 'warning',
});
console.log(`wrote ${out}`);
