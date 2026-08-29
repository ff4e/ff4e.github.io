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
  //
  // Raised 2 220 -> 2 228 for the touch buttons, and this is the whole of what they cost
  // here: one import and a seven-line wiring block handing `touchButtons.ts` a single
  // name, `panelAction`. Nothing about the bar — which regions the five buttons send,
  // when it is up, how it reserves its space — is in this file. That one name is also
  // the point: the touch buttons dispatch through the SAME table as the mouse rather
  // than calling saveGame()/showMap() themselves, so the alternative to these seven
  // lines was not fewer lines, it was a second copy of what a panel press means.
  //
  // Raised 2 228 -> 2 233 for the touch Options, and it is the same seven lines plus
  // two: one import, and a second `init*` call against the SAME host object, which is
  // why the wiring block became a named const rather than a second literal. The touch
  // Options needs exactly the name the buttons already needed — `panelAction` — because
  // its sliders dispatch through regions 17-19 like everything else.
  //
  // 2 233 -> 2 235 for the touch gestures, which is an import and a bare
  // `initTouchSwipe()`. That one takes no host at all: a swipe is delivered as a
  // synthetic arrow keydown, so it reaches the router that already lives here rather
  // than needing a name handed out of it. Nothing about either screen is in this file.
  //
  // 2 235 -> 2 250 for undo, and every one of those lines is a thing this file already
  // is. The `-` binding is a case in the keyboard router; region 24 is a case in
  // `panelAction`'s dispatch table; the history clear is one line in `buildRoom`; and the
  // save slot gains a field, in the save/load pair that has always lived here. Undo
  // ITSELF is two new modules (`src/core/undoStack.ts`, `src/app/undo.ts`) and nothing of
  // it is in this file — main.ts cannot say what an undo is, only which key asks for one.
  ['src/app/main.ts', 2250],
  // 544. The KUFRIK demo, the cutscene movies and the recorded-solution replay — one
  // machine (a CapAction queue driven per logic tick) plus the AI-tier frame cache it
  // needs. It is over the 520 tripwire on arrival rather than by growth: it left
  // `main.ts` whole because splitting the demo from the movies would have split the
  // queue that drives both. Worth revisiting if the AI frame cache grows.
  //
  // Went 560 -> 566 while the captions carried both painters, then 566 -> 540 when the
  // canvas overlay was deleted and `updateCutsceneCaptions` lost its canvas branch and
  // the signature/gate bookkeeping with it. That was the ratchet the 566 entry promised.
  //
  // 540 -> 545 for the dev solution replay. This file owns the teardown of every automated
  // playback mode, so the three points where one takes the room over — `endShowmode`, the
  // KUFRIK demonstration starting, and the briefcase cutscene starting — are where the
  // fourth mode has to be torn down too. One line each plus the import; review found live
  // hangs at two of the three, so they are not optional. The explanation lives in
  // `solveMode.ts`, not here, which is why it is a handful of lines and not thirty.
  //
  // 545 -> 560 for SHOWMODE_HOLDS (the KUFRIK demonstration's hand-lengthened pauses).
  // The table and its whole rationale live in `showmodeHolds.ts`; what is left here is the
  // hold counter itself, which has to sit in `advanceShowmode` because that is the one
  // place the recorded stream is consumed. There is no cheaper home for it.
  //
  // 560 -> 572 for the per-frame `"model": "original"` choice, which needed the AI branch
  // to stop being "draw the upscale" and become "draw the base, then whichever source
  // this frame wants". The blit that does the second half is NOT here — it went to
  // `src/render/indexedRegion.ts`, because it is mechanism and the rest of this file is
  // the cutscene machine. What is left is the decision and its reasoning, which has to
  // sit at the branch it explains.
  //
  // 572 -> 600 for the demonstration becoming SYNCHRONOUS. help.cap and the briefcase
  // story are fetched on entering KUFRIK now (`roomPreload.ts`), so `startShowmode` starts
  // from the recording in hand and both loaders left this file — but the two async paths
  // stay as backstops for `__ff.startCutscene()`/`forceShowmode()`, which can be fired
  // from any room, and each needs the sentence saying it is no longer the path.
  ['src/app/cutscene.ts', 600],
  // 1 549. The `window.__ff` surface. Grows naturally as probes need new hooks, which is
  // fine — but it is worth noticing when it does. 1 620 -> 1 644 for three of them that
  // review asked for: `blockedMoves` (so the probe can see a key that REACHED the engine
  // and was refused, which changes neither the record nor the move index), `roomSolution`
  // (so it can compare what was recorded against what was given, character for character,
  // rather than counting) and `solveSetSpeed`. Came DOWN from 1 700 when the canvas
  // subtitle overlay went and took `subPaints`, `setSubsGate`, `subsPaintAt`, `benchSubs`
  // and the renderer-preference hooks with it.
  // 1 620 -> 1 644 for the dev solution replay's hooks: `solveRoom`/`solveStatus`/
  // `solveCancel`/`solveSetSpeed`, plus `blockedMoves` (so a probe can see a key that
  // REACHED the engine and was refused, which changes neither the record nor the move
  // index) and `roomSolution` (so it can compare what was recorded against what was given,
  // character for character, rather than by counting). Both of the latter were asked for in
  // review, to replace assertions that were weaker than the claims beside them.
  // 1 644 -> 1 646 for one line: the `fitMode` setter now calls `relayout()`. The stage
  // box's width ceiling became per-mode (`stageBoxCeiling`, app/layout.ts), so a mode
  // change that only repainted would leave the box at the previous mode's width — and
  // this hook is how every probe changes the mode, so without it they would all measure a
  // stale box. It mirrors what the dev bar's own handler does; the alternative was routing
  // it through the host, which costs more lines here and widens the hook surface.
  // 1 646 -> 1 653 for the three hooks that make a failed room entry observable:
  // `fatalShown` and `fatalText` — two rather than one because the screen's WORDING is the
  // thing under test, picked from the absent/failed taxonomy, and a probe that only asked
  // whether it was up would pass just as happily on the sentence that blames the player's
  // connection for a 404 — plus `roomAudioPending`, the third hold a room entry can be
  // waiting on, which a probe otherwise cannot tell from the art hold.
  ['src/app/debugHooks.ts', 1657],
  // 638. The typed cheat codes, the sprite/film effects and the Tetris minigame. Added
  // when the tripwire below first ran and found it unwatched: it is the one file in
  // `src/app/` that had grown past the threshold without anybody noticing, which is
  // precisely the gap the tripwire exists to close. Low churn today (1 of the last 200
  // commits), so this is a ceiling rather than a concern.
  ['src/app/cheats.ts', 706],
  // 564. Which room's art is loaded, what has been REMEMBERED about it, and whether the
  // frame is still holding for it. Budgeted on arrival rather than after growth: it
  // crossed the 520 tripwire taking on the absent/failed distinction, and two pieces
  // were split off in the same series rather than landing here — the fetching and
  // decoding (`enhancedLoad.ts`) and the player-facing screen (`artFailure.ts`). What is
  // left is the state, which is the part that genuinely cannot be split: the caches, the
  // in-flight maps and the two hold predicates are one another's invariants.
  // 620 -> 660 for the three recovery paths a review found missing: a non-transient
  // failure must be filed as an absence rather than rethrown past the release (it hung
  // the room for ever), the `classic` tier's warm-cache prefetch must not raise a modal
  // over a game that needs none of that art, and the map screen must not appear over a
  // room the player has since walked into. Each is a guard plus the comment saying why.
  //
  // 660 -> 672 for the two branches the all-or-nothing rule needs. An answer that is not
  // the asset (a manifest-listed sprite that 404s, a manifest served as garbage) is
  // neither an absence to cache nor a blip to retry, and it used to be filed as the
  // former — the silent tier downgrade the whole change exists to remove. And the `ai`
  // tier's loader now rethrows everything, so the one caller that arms a hold and voids
  // the call needs an arm that releases it: a rejection escaping there is a room withheld
  // for ever, which is the frozen room the enhanced tier already documents.
  ['src/app/art.ts', 686],
  // 567. Getting a room on screen and giving it a voice. Budgeted on arrival rather than
  // after growth: it crossed the 520 tripwire taking on the two post-art entry holds and
  // `loadExtraMusic`. The preload POLICY is deliberately not here — that is
  // `roomPreload.ts` — and what stayed is the ordering, which is this file's whole
  // subject: art first, then everything the room will need to sound and to play, each
  // held for by a flag this file owns.
  ['src/app/roomLoad.ts', 600],
  // 554. The map screen's navigation and the two things shown OVER it: the story pages
  // and the credits. Budgeted on arrival, having crossed the 520 tripwire when the
  // credits stopped painting whatever was ready: each tier now loads only its own roll,
  // behind a hold, so `openCredits` carries the tier choice and the faithful loader moved
  // out of it into a named function. That is the whole of the growth — `drawCredits` got
  // shorter, not longer. If this file takes on a third overlay, the credits are the
  // coherent piece to lift out (load + hold + a draw branch per tier), not the map.
  //
  // 580 -> 583 for the touch Options hand-over: the map corner is one of the two doors
  // into the Options face, so a touch device has to be turned away here as well as in
  // `panel.ts`. The guard is three lines; the rest is the note on what deliberately is
  // NOT set with it (no `mapOverlay`, so the panel column never floats over the map),
  // which is the part a later reader would otherwise have to reconstruct.
  ['src/app/mapNav.ts', 583],
  ['src/render/glScreen.ts', 1150],
  // 1 120 -> 1 200 for the absent/failed split in loadAiRoom (assetFetch.ts): three
  // outcomes where there were two, plus closeDecoded so a rejected load does not leak
  // the bitmaps it had already decoded — which matters now that such a load is retried.
  ['src/render/roomAi.ts', 1200],
  ['src/core/room.ts', 1060],
  // 800 -> 830 for the gspec=42 ZX stripes: BG_FS gains `uZx` + a band texture, and the
  // two entry points share one `bgPass`. The stripes are the LAST gspec the `ai` tier
  // handed back to the faithful compositor, so this buys the tier its independence — see
  // the PR. The sequence itself is not here: it is `src/render/zxBands.ts`, generated
  // once and shared with the faithful renderer, which is what keeps this to a uniform.
  ['src/render/glRoomAi.ts', 830],
  ['src/core/script.ts', 780],
  // 720 -> 780 for `backgroundZx`, the canvas-2D half of the same change: the stripes
  // masked by the wall's alpha, plus the `paint`/`paintBg` split that lets it reuse the
  // wobbled-background half rather than copy it.
  ['src/render/aiTarget.ts', 780],
  // 680 -> 710 for the two things a room's music needs now that ROOM ENTRY owns its
  // download (it has to: only the entry can fail on it). `decodeMusic` is the fetch-free
  // half of `playMusic`, split out so a track that does not arrive fails the entry instead
  // of being swallowed by the "stay silent" path that is right for the menu; and
  // `beginMusicLoad` lets a start JOIN that download, because a download outside the
  // engine is invisible to `musicBufs`/`musicStarting` and KANKAN re-cues its track on the
  // first idle tick — fetching and decoding the same 1.24 MB file twice.
  //
  // 710 -> 739 for the asset door: the two music fetches here were the last bare `fetch`
  // calls in the audio layer, and "stay silent" is no longer one of the answers this file
  // is allowed to give (test/asset-fetch-discipline.test.ts). Both catches now hand the
  // reservation back and RETHROW — unless the start was already superseded, which is the
  // guard every other loader in the codebase has and this one did not: a 5-7 MB track
  // nothing cancels can outlive the room that asked for it and fail minutes later, over a
  // room whose own music is playing. `musicSnd` also returns its download instead of
  // voiding it, so the rejection has an owner and a test can hold it.
  //
  // 739 -> 790 for the in-flight JOIN on the `music()` path. `playMusic` has joined
  // `musicLoads` since room entry took over the room's own track; `playMusicFile` — the
  // path a room SCRIPT cues — had not, and DRAKAR1 cues `rybky04` (5.75 MB) from its own
  // `init`, i.e. inside `buildRoom`, which the entry's preload of that same track then
  // raced. Two concurrent writes of one cache entry that size fail with
  // net::ERR_CACHE_WRITE_FAILURE, so the entry would have ended the session over a file
  // the script was fetching successfully. The load also goes through `decodeMusic` now,
  // which is what attaches the file's native rate — a buffer decoded here and later
  // started by `playMusic` used to loop at the default 22 050 Hz whatever the file said.
  //
  // 790 -> 830 for the compressed voice packages. A package now arrives in one of two
  // forms and the engine tells them apart by looking (`isFfs2`), so `loadGlobal`/`setRoom`
  // became async and gained `makePkg` between them. The DECODE itself is not here — it is
  // `src/audio/ffs2Decode.ts`, which is also where the reasoning about why every segment
  // is decoded up front lives. What is left in this file is the package lifetime, which is
  // this file's job: `Pkg` gains its decoded buffers, so dropping a room's package drops
  // its ~13 MB of speech with it, and `cache` narrows to the one package that still ships
  // as the 1998 `.ffs`.
  //
  // 830 -> 850 for the prepare/install seam, which is a correctness fix rather than a
  // feature: installing a package used to be synchronous, so the caller's "is this still
  // the room the player is in?" check was the last word. Decoding on the way in put
  // 50-100 ms between that check and the install, in which a slow room A could replace
  // the package room B had already installed. `prepare` returns a decoded package and
  // `installRoom` puts it in place without yielding, so the check is the last word again.
  ['src/audio/audio.ts', 850],
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
