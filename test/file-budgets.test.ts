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
import { readFileSync } from 'node:fs';

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
  ['src/app/main.ts', 4740],
  // 1 625. The `window.__ff` surface. Grows naturally as probes need new hooks, which is
  // fine — but it is worth noticing when it does.
  ['src/app/debugHooks.ts', 1700],
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
