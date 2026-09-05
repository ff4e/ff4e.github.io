/**
 * Refuse to package a `dist/` that is not the staged payload.
 *
 * ── The failure this exists to prevent ────────────────────────────────────────
 *
 * Two different things write `dist/`, and only one of them produces what the app should
 * ship:
 *
 *   - `vite build` + `tools/stage-pages-assets.mjs` — real files, with the originals
 *     nothing fetches filtered off. 388 MB. This is the payload.
 *   - `tools/preview-server.mjs` (so: every `npm run test:ui`) — SYMLINKS each `public/`
 *     entry into `dist/`, because the suite wants the raw tree and does not want to copy
 *     650 MB to get it. It leaves them there when it finishes.
 *
 * `cap copy` dereferences symlinks. So running `npx cap sync` any time after a UI test
 * run silently packages the UNFILTERED tree — the 184 MB of `Sound/*.ffs` and 76 MB of
 * `Music/*.wav` masters that staging exists to exclude, plus the help bitmaps and the
 * `Program/` and `Writes/` directories that must never be published at all. The app
 * roughly doubles and nothing says a word: the build succeeds, the game runs, and the
 * only symptom is an App Store upload that is 250 MB heavier than it should be.
 *
 * `npm run build:ios` happens to be safe, because `vite build` empties `dist/` first and
 * staging then rewrites it. That is luck of ordering, not a guarantee, and it does not
 * help the bare `cap sync` that Capacitor's own documented workflow tells you to run.
 *
 * ── What it checks ───────────────────────────────────────────────────────────
 *
 * Two independent things, because either alone can be true without the other:
 *
 *   1. No symlinks among `dist/`'s top-level entries — the preview server's signature.
 *   2. No file that staging is supposed to have dropped — which catches a hand-copied or
 *      half-staged tree that has no symlinks in it at all.
 *
 * Deliberately cheap: a `readdir` plus a handful of `stat`s on known paths, not a walk of
 * 6 000 files. It runs on every `cap` command that copies (capacitor.config.ts calls it,
 * and the config is loaded for all of them), so it has to cost nothing.
 */
import { existsSync, lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Files staging drops. Sampled, not exhaustive: one representative per rule is enough to
 * tell a staged tree from an unstaged one, and an exhaustive list would be a second copy
 * of the staging rules to keep in sync.
 */
const MUST_BE_ABSENT: ReadonlyArray<readonly [string, string]> = [
  ['data/Music/menu.wav', 'a Music/*.wav master (the app fetches .m4a)'],
  ['data/Sound/x01.ffs', 'a Sound/*.ffs master (the app fetches .ffs2)'],
  ['data/Help/helpy.txt', 'a Help/ page (the help is text + cropped diagrams now)'],
  ['data/Menu/CredStat1.BMP', 'a credits BMP (the app fetches the .webp)'],
  ['data/Program', 'the original ALTAR engine binary'],
  ['data/Writes', 'player save games'],
] as const;

/**
 * Why `dist` is not a shippable payload, or null when it is.
 *
 * Returns the reason rather than throwing so the caller decides how loud to be — the
 * Capacitor config wants to stop the command, a CLI run wants an exit code.
 */
export function whyNotStaged(root: string = process.cwd()): string | null {
  const dist = join(root, 'dist');
  if (!existsSync(dist)) return null; // Not our problem: Capacitor reports a missing webDir itself.

  const linked = readdirSync(dist).filter((e) => lstatSync(join(dist, e)).isSymbolicLink());
  if (linked.length > 0) {
    return (
      `dist/ contains symlinks (${linked.slice(0, 4).join(', ')}${linked.length > 4 ? ', …' : ''}).\n` +
      `  That is what \`npm run test:ui\` leaves behind, and \`cap copy\` would follow them and\n` +
      `  package the unfiltered public/ tree — ~250 MB of masters the game never fetches.`
    );
  }

  for (const [rel, what] of MUST_BE_ABSENT) {
    if (existsSync(join(dist, rel))) {
      return (
        `dist/${rel} is present — ${what}.\n` +
        `  Staging is supposed to drop it, so this dist/ was not produced by\n` +
        `  tools/stage-pages-assets.mjs and must not be packaged.`
      );
    }
  }
  return null;
}

/**
 * Capacitor commands that put `webDir` into the native project.
 *
 * `copy` is the one that does it; `sync` is copy + update; `run` and `build` both sync
 * first. Everything else Capacitor offers — `doctor`, `ls`, `open`, `add`, `init`,
 * `update`, `migrate` — leaves `dist/` alone, so an unstaged one cannot hurt it.
 *
 * Listed rather than derived because the answer has to be wrong in the SAFE direction: a
 * command missing from this list only means the check does not run for it, while a
 * command wrongly in it stops work that was never in danger. A new Capacitor command that
 * copies would need adding here, and would announce itself the first time it shipped the
 * wrong tree — which is the same day the rest of us would notice anyway.
 */
const PACKAGING_COMMANDS: ReadonlySet<string> = new Set(['copy', 'sync', 'run', 'build']);

/**
 * Is this `cap` invocation one that would copy `dist/` into the native project?
 *
 * The command is the first argument that is not a flag: `cap sync ios`, `cap --verbose
 * sync`, `npx cap run ios --target=…` all name it in different positions. When there is
 * no command at all (`cap` on its own, or this module loaded by the test suite) the
 * answer is no — nothing is being packaged.
 */
export function isPackagingCommand(argv: readonly string[] = process.argv): boolean {
  const command = argv.slice(2).find((a) => !a.startsWith('-'));
  return command !== undefined && PACKAGING_COMMANDS.has(command);
}

/**
 * Stop the command unless `dist/` is the staged payload. Called from capacitor.config.ts.
 *
 * Exits rather than throws on purpose. Capacitor catches a config-load exception and
 * prints it with a ten-frame stack through its own TypeScript require hook, which buries
 * the one sentence that matters under machinery nobody needs to read. The only useful
 * response to this failure is to run `npm run build:ios`, so it says that and stops.
 *
 * Only for the commands that COPY. Capacitor loads this config for everything it does,
 * including the commands whose entire job is to tell you what is wrong — `cap doctor`
 * refused to run at all with a UI-test `dist/` in place, which is exactly backwards: the
 * tool you reach for when the build is broken should not be the tool that breaks first.
 * Same for `cap ls` and `cap open`. None of them read `webDir`, so none of them can ship
 * the wrong tree, and none of them have any business failing over it.
 */
export function assertStagedDist(root: string = process.cwd(), argv: readonly string[] = process.argv): void {
  if (!isPackagingCommand(argv)) return;
  const why = whyNotStaged(root);
  if (why === null) return;
  console.error(`\nRefusing to package dist/.\n\n  ${why}\n\n  Fix: npm run build:ios  (build + stage + sync, in that order)\n`);
  process.exit(1);
}

// Also usable on its own — `npm run check:ios-payload` — for CI or a quick check.
if (process.argv[1] !== undefined && process.argv[1].endsWith('check-ios-payload.ts')) {
  const why = whyNotStaged();
  if (why === null) {
    console.log('dist/ is the staged payload.');
  } else {
    console.error(`dist/ is not shippable:\n  ${why}`);
    process.exit(1);
  }
}
