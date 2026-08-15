/**
 * Where the original room data lives, for the tests that need real `.ffr` geometry.
 *
 * There was a long-standing belief in this repo that these tests could not run in CI
 * because the 1998 game data is commercial and cannot be committed. That is not true of
 * the room data: ALTAR GPL-released the Fish Fillets data in 2002 (see CONTRIBUTING.md,
 * "Assets & licensing"), which is why all 72 `Graphic/*.ffr` are tracked under
 * `public/data/` — the site ships them. They are byte-identical to the files in a private
 * extraction of the original game, verified across all 72.
 *
 * So the default is the repo's OWN data, and the solvability replays run everywhere,
 * including CI, off nothing but a fresh clone. $FFNG_DATA still overrides, for anyone
 * pointing at their own extracted MAINDIR.
 *
 * Note the other tests still defaulting to `~/.cache/ffng-orig` and skipping without it
 * (`rooms.test.ts`, `gral-pushout.test.ts`, and `$FF_DATA_DIR` in `render-parity.test.ts`,
 * `enhanced-mapping.test.ts`). They are ~208 assertions that skip in CI for the same
 * mistaken reason and could adopt this; that is a separate change from the solvability net.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The repo's own tracked copy — present in every clone. */
const COMMITTED = join(process.cwd(), 'public/data');
/** A private extraction of the original game, the historical default. */
const PRIVATE_CACHE = join(homedir(), '.cache/ffng-orig/extracted/MAINDIR');

/**
 * The MAINDIR-shaped directory to read rooms from: $FFNG_DATA if set, else a private
 * extraction if one is present, else the committed data. The private cache is preferred
 * over the committed copy only so that a contributor who has deliberately extracted their
 * own game keeps testing against it.
 */
export function gameDataDir(): string {
  if (process.env.FFNG_DATA) return process.env.FFNG_DATA;
  if (existsSync(join(PRIVATE_CACHE, 'Graphic'))) return PRIVATE_CACHE;
  return COMMITTED;
}
