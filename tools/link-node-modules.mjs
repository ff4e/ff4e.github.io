#!/usr/bin/env node
/**
 * Share one `node_modules` between the worktrees of this repo.
 *
 * This repo is normally checked out as a dozen-plus git worktrees, one per branch, and
 * each has been getting its own 77 MB install — ~1.6 GB across 21 of them, plus a
 * minute of `npm ci` before a fresh worktree can run anything. The dependency set is
 * identical in almost all of them, so that is pure waste.
 *
 *     node tools/link-node-modules.mjs            # link this worktree to a sibling's
 *     node tools/link-node-modules.mjs --from ../ff4e.github.io
 *     node tools/link-node-modules.mjs --unlink   # go back to a private install
 *
 * ── Why it refuses more than it links ────────────────────────────────────────
 * A shared `node_modules` is correct only while the worktrees actually agree about
 * their dependencies, and silently wrong the moment they do not — the failure being a
 * mysteriously-wrong build rather than an error. So this checks `package-lock.json` is
 * byte-identical on both sides and refuses otherwise, and it never touches a real
 * directory (only a symlink it made, or nothing).
 *
 * It is deliberately opt-in. Other people have live sessions in these worktrees, and
 * quietly rearranging their environment would be a poor trade for some disk.
 *
 * After `npm install` changes dependencies, re-run `npm ci` in the SOURCE worktree; the
 * linked ones follow automatically, which is the point.
 */
import { existsSync, lstatSync, readFileSync, readdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const here = join(root, 'node_modules');
const argv = process.argv.slice(2);

const die = (m) => {
  console.error(`[link-node-modules] ${m}`);
  process.exit(1);
};

if (argv.includes('--unlink')) {
  if (!existsSync(here)) die('nothing here to unlink');
  if (!lstatSync(here).isSymbolicLink())
    die('node_modules here is a real directory, not a link — remove it yourself if you meant to');
  unlinkSync(here);
  console.log('[link-node-modules] unlinked; run `npm ci` for a private install');
  process.exit(0);
}

/** An explicit --from, else the first sibling worktree with a real install. */
function findSource() {
  const at = argv.indexOf('--from');
  if (at !== -1) {
    const p = resolve(argv[at + 1] ?? '');
    if (!p) die('--from needs a path');
    return p;
  }
  const parent = dirname(root);
  const candidates = readdirSync(parent)
    .map((d) => join(parent, d))
    .filter((d) => d !== root)
    .filter((d) => {
      const nm = join(d, 'node_modules');
      return existsSync(nm) && !lstatSync(nm).isSymbolicLink() && existsSync(join(d, 'package-lock.json'));
    });
  if (!candidates.length) die('no sibling worktree with a real node_modules; run `npm ci` somewhere first');
  return candidates[0];
}

const from = findSource();
if (!existsSync(join(from, 'package-lock.json'))) die(`${from} has no package-lock.json`);

const mine = readFileSync(join(root, 'package-lock.json'), 'utf8');
const theirs = readFileSync(join(from, 'package-lock.json'), 'utf8');
if (mine !== theirs)
  die(
    `package-lock.json differs from ${from}.\n` +
      '  A shared node_modules would be silently wrong for one of you. Run `npm ci` here instead.',
  );

if (existsSync(here)) {
  if (!lstatSync(here).isSymbolicLink())
    die('node_modules here is a real directory — delete it first if you want to link instead');
  unlinkSync(here);
}
symlinkSync(join(from, 'node_modules'), here, 'dir');
console.log(`[link-node-modules] node_modules -> ${join(from, 'node_modules')}`);
console.log('[link-node-modules] re-run `npm ci` in THAT worktree when dependencies change');
