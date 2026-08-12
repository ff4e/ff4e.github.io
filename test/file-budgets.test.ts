/**
 * Line budgets for the files that are expensive to change.
 *
 * ── Why ────────────────────────────────────────────────────────────────────────
 * Most work here is done by agents, and an agent re-sends its whole context on every
 * model call. So a large file that is also edited often is not a style problem, it is a
 * recurring bill: before the split, a session read ~87 000 tokens of `main.ts` to change
 * ~90 lines of it, on every call for the rest of the task.
 *
 * Size alone is not the problem — `src/data/roomTable.ts` is generated and nobody opens
 * it. The expensive combination is SIZE x CHURN, and it was concentrated: `main.ts` was
 * touched by 32 of the last 60 commits.
 *
 * ── What this test is for, and what it is not ──────────────────────────────────
 * It is not a limit on how much code may exist. It is a place where growth has to be
 * argued rather than accreted. `main.ts` reached 7 798 lines without anyone ever
 * deciding it should — every individual step was a reasonable "this is related, put it
 * here". This turns the next such step into a sentence someone has to write down.
 *
 * So: if your change genuinely belongs in one of these files, raise its budget in the
 * same PR and say why in the description. That is a normal outcome, not a defeat. What
 * is not normal is the budget drifting up unremarked, one commit at a time.
 *
 * Budgets ratchet DOWN only. When a file shrinks well below its budget, lower it — the
 * test says by how much, so this needs no judgement.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';

/**
 * Hot files and their ceilings, in lines.
 *
 * Set from the real counts at the time of writing plus a small working margin, so an
 * ordinary change does not trip the test and a structural one does. Only files that are
 * both large AND frequently edited are listed: a budget on a file nobody touches would
 * be noise, and noise is how a guard gets ignored.
 */
const BUDGETS: ReadonlyArray<readonly [path: string, maxLines: number]> = [
  // 5 804 today. The split took it from 7 798; it is still the largest file here and the
  // most-edited, so it is the one that matters most.
  //
  // Raised 5 800 -> 5 900 for the room-launch parchment. The launch's own state machine,
  // its art and its blitting live in `src/app/roomLaunch.ts` (303 lines) exactly so they
  // do not land here — a later change to the parchment reads that file, not this one.
  // What stayed is integration that cannot move without moving its host with it:
  // drawMap()'s unlit/plaque/parchment frame, loop()'s dispatch of the launch, the three
  // input guards, the enterRoom/startRoom split, and the new module's wiring block
  // (~48 lines of the ~171).
  ['src/app/main.ts', 3665],
  // 1 625. The `window.__ff` surface. Grows naturally as probes need new hooks, which is
  // fine — but it is worth noticing when it does.
  ['src/app/debugHooks.ts', 1700],
  // 638. The typed cheat codes, the sprite/film effects and the Tetris minigame. Added
  // when the tripwire below first ran and found it unwatched: it is the one file in
  // `src/app/` that had grown past the threshold without anybody noticing, which is
  // precisely the gap the tripwire exists to close. Low churn today (1 of the last 200
  // commits), so this is a ceiling rather than a concern.
  ['src/app/cheats.ts', 700],
  ['src/render/glScreen.ts', 1150],
  ['src/render/roomAi.ts', 1120],
  ['src/core/room.ts', 1060],
  ['src/render/glRoomAi.ts', 800],
  ['src/core/script.ts', 780],
  ['src/render/aiTarget.ts', 720],
  ['src/audio/audio.ts', 680],
];

/** Slack below which a budget is stale enough to be worth lowering. */
const RATCHET_SLACK = 120;

/**
 * The directory the budgets exist for, and the size at which a file in it has to join
 * the list above.
 *
 * Every line count here and below is the one this file measures with —
 * `split('\n').length`, which is `wc -l` plus one on a newline-terminated file. Mixing the
 * two meters is an easy way to publish a number that is off by one, so this file uses one.
 *
 * ── Why a threshold, and not a limit on everything ────────────────────────────
 * The obvious generalisation — cap every file — is the wrong shape, and this repo already
 * measured why: size only costs when it meets churn. `src/rooms/banka.ts` is 896 lines and
 * has been touched twice in the project's history, because there is one file per room; a
 * budget on it would be noise, and noise is how a guard gets ignored.
 *
 * The gap this closes is different. The list above is hand-curated, so it only protects
 * files somebody remembered to add — and after `main.ts` was decomposed, the modules that
 * came out of it (117-442 lines) are exactly where new code now lands, per rule 1 in
 * AGENTS.md. Nothing was watching them.
 *
 * So rather than capping them, this requires that a file which grows past the threshold be
 * given an explicit budget. That is not a refusal either: it forces the same sentence the
 * budgets themselves exist to force, at the moment the file starts to matter, instead of
 * whenever someone next happens to look.
 *
 * Scoped to `src/app/` because that is where churn concentrates: `main.ts` alone accounts
 * for 84 of the 180 commits in the project's history, against six for the whole of
 * `src/rooms/` (`git log --oneline --no-merges -- <path>`).
 *
 * The threshold is 520 because the largest unbudgeted file in `src/app/` today is
 * `art.ts` at 503: high enough to be silent on the status quo, low enough that the next
 * file to grow into the hundreds trips it. It is a round number chosen from the current
 * distribution, not a law — if it turns out to fire on something that should not be
 * budgeted, move it and say so.
 */
const WATCHED_DIR = 'src/app';
const MUST_BE_BUDGETED_OVER = 520;

describe('file budgets', () => {
  for (const [path, max] of BUDGETS) {
    it(`${path} stays within ${max} lines`, () => {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      expect(
        lines,
        `${path} is ${lines} lines, over its ${max}-line budget.\n` +
          `This is not a refusal: if the code belongs here, raise the budget in this same PR ` +
          `and say why in the description. If it does not, a new module is the cheaper home — ` +
          `see AGENTS.md, "Keeping this cheap to change".`,
      ).toBeLessThanOrEqual(max);
    });
  }

  it(`every ${WATCHED_DIR} file over ${MUST_BE_BUDGETED_OVER} lines has a budget`, () => {
    // A tripwire, not a cap: crossing the threshold does not fail because the file is too
    // big, it fails because nothing is watching a file that has become worth watching.
    //
    // RECURSIVE, and that is not incidental. A non-recursive read would do the same job
    // today — `src/app/` is flat — but it would also disarm itself the first time somebody
    // grouped the modules into `src/app/screens/`, `src/app/state/` and so on: the scan
    // would return directory names, the `.ts` filter would drop every one, and this test
    // would pass while watching NOTHING. That reorganisation is the natural next step after
    // a decomposition, so it is exactly when the guard must not quietly stop working.
    const budgeted = new Set(BUDGETS.map(([p]) => p));
    const scanned = readdirSync(WATCHED_DIR, { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
      .map((f) => `${WATCHED_DIR}/${f.split(sep).join('/')}`);
    const unwatched = scanned
      .filter((p) => !budgeted.has(p))
      .map((p) => ({ path: p, lines: readFileSync(p, 'utf8').split('\n').length }))
      .filter((f) => f.lines > MUST_BE_BUDGETED_OVER);

    // ...and a floor under it, for the same reason `test/readme-map.test.ts` asserts the
    // README actually contains maps: a check that silently scanned nothing would pass.
    expect(scanned.length, `no .ts files found under ${WATCHED_DIR}/ — the scan is broken`).toBeGreaterThan(5);

    expect(
      unwatched.map((f) => `  ${f.path}: ${f.lines} lines, no budget`).join('\n'),
      `A file in ${WATCHED_DIR}/ has grown past ${MUST_BE_BUDGETED_OVER} lines without a budget.\n` +
        'Add it to BUDGETS above, at its current size plus a small working margin, and say in ' +
        'the PR description what it now owns. If it should not be that big, a new module is ' +
        'the cheaper home — see AGENTS.md, "Keeping this cheap to change".',
    ).toBe('');
  });

  it('budgets track the code, so a file that shrank gets a lower ceiling', () => {
    // Without this the budgets only ever record the high-water mark, and the guard stops
    // meaning anything the moment a split lands. Reported together so one run tells you
    // every number to change.
    const stale = BUDGETS.map(([path, max]) => {
      const lines = readFileSync(path, 'utf8').split('\n').length;
      return { path, max, lines, slack: max - lines };
    }).filter((b) => b.slack > RATCHET_SLACK);

    expect(
      stale.map((b) => `${b.path}: ${b.lines} lines vs ${b.max} budget — lower it`).join('\n'),
      'these budgets have gone slack; ratchet them down',
    ).toBe('');
  });
});
