#!/usr/bin/env node
/**
 * `npm run dev` — the Vite dev server, on a port that is actually free.
 *
 * This repo is normally checked out as a dozen-plus git worktrees, each of which may
 * have a dev server up. Plain `vite` takes 5173, finds it busy, and either dies or
 * silently moves — and a silently-moved server is worse, because the probes and the
 * mutation harnesses default to 5173 and will then be testing SOMEBODY ELSE'S
 * worktree. That has cost real debugging time here: a mutation run once reported
 * "7 mutations SURVIVED" that were entirely an artefact of a stale server on 5173.
 *
 * So: ask the kernel for a free port, bind it with --strictPort (never move silently),
 * and print the URL plus the directory being served, so what you are looking at is
 * never in doubt.
 *
 *   npm run dev              # a free port
 *   npm run dev -- --port 5199   # or name one; --strictPort still applies
 */
import { spawn } from 'node:child_process';
import { HOST, freePort, isUp, root, urlFor } from './preview-server.mjs';

const argv = process.argv.slice(2);
const at = argv.indexOf('--port');
const asked = at === -1 ? null : Number(argv[at + 1]);
const rest = at === -1 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)];

const port = asked ?? (await freePort());
if (await isUp(port)) {
  console.error(
    `[dev] port ${port} is already serving something — stop it, or let this script pick a port for you.`,
  );
  process.exit(1);
}

console.log(`[dev] serving ${root}`);
console.log(`[dev] ${urlFor(port)}`);
console.log(`[dev] probes and harnesses: FF_UI_PORT=${port}`);

const child = spawn(
  'npx',
  ['vite', '--port', String(port), '--strictPort', '--host', HOST, ...rest],
  { cwd: root, stdio: 'inherit' },
);
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
