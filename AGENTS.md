# Working in this repo

Notes for anyone — human or agent — making changes here. `CONTRIBUTING.md` has the rules; this file has the
things that cost people time to find out. Everything below was learned the expensive way at least once.

## What this project is, and the one constraint that matters

A faithful browser port of *Fish Fillets* (ALTAR, 1998), ported from the original Delphi/Pascal source.
**Fidelity to the original is the entire value of the project.** A change that makes the code nicer and the
game subtly different is a bad change.

Two consequences worth internalising:

- **The comments are the most valuable content in the repo.** They carry the porting reasoning and citations
  into the Delphi source (`URoom.pas:15576` and ~190 others). When you move code, the comments move with it,
  verbatim. Do not summarise them away — the reasoning is the part that was expensive.
- **"While I was here" changes are not welcome in a refactor.** If you find a real bug, write it down and
  leave it. Mixing a fix into a restructuring makes both unreviewable.

## Setup, and the two things that will bite you first

This repo is normally checked out as **many git worktrees**, one per branch. Two consequences:

- **A fresh worktree has no `node_modules`.** Either `npm ci` (~1 min, 77 MB) or share one:
  `node tools/link-node-modules.mjs` — opt-in, and it refuses unless `package-lock.json` is byte-identical
  on both sides.
- **Ports 5173+ are usually taken by other worktrees' dev servers.** Use `npm run dev`, which picks a free
  port and prints both the URL and the directory it is serving. Never assume 5173 is yours: a probe or a
  mutation harness pointed at another worktree tests the wrong code and reports confident nonsense. That has
  happened here — a mutation run once reported "7 mutations SURVIVED" that were entirely an artefact of a
  stale server on 5173.

Node is pinned to 22. `export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:$PATH"`.

## How much checking a change needs

The full gate is ~6 minutes, and paying it for a typo is why people stop checking things. Match the gate to
the risk:

| Change | Run |
| --- | --- |
| Docs only | nothing (CI covers it) |
| Logic with unit coverage | `npm run typecheck && npm run test` (~10 s) |
| Anything touching the DOM, the loop, or a screen | the above + `npm run test:ui -- <pattern>` (~15–40 s) |
| Before opening a PR | the full `npm run test:ui` (~315 s) |
| Render path | + the relevant `tools/mutate-*.mjs`, and report survivors |
| Moving code between files | + `tools/capture-digest.mjs` against the base commit |

`npm run test:ui -- cheat options` runs only matching probes. A filtered run says `PARTIAL RUN` and is not
a gate. CI runs `typecheck`, the unit suite and `vite build` on every push.

## Keeping this cheap to change

Most work here is done by agents, and an agent pays for its **whole context on every model call**. So the
cost of a change is not what you write — it is what you had to read to write it, multiplied by how many
calls the task takes. Measured on this repo before the `main.ts` split: a session read ~87 000 tokens of
`main.ts` in order to change ~90 lines of it, and did that on every call for the rest of the task.

That is the lens for the rules below. They are not tidiness for its own sake.

**What the code already looks like** (404 files under `src/`, `tools/`, `test/`): median **126 lines**, 90th
percentile **388**, and only 14 files over 700. The codebase is already small-module. The cost was never
spread evenly — it was concentrated in one file, which also happened to be the most-changed file in the repo
(32 of the last 60 commits touched `main.ts`). **Size only costs when it meets churn.** A large generated
table nobody opens is free; a large file everyone edits is the expensive thing.

### Rules

1. **New code starts in a new module.** `main.ts` reached 7 798 lines by accretion — every step was a
   reasonable "this is related, put it here". Default to a new file in the right directory and import it. Put
   code in an existing large file only when splitting it would genuinely duplicate state, and say so in the PR.
2. **Do not read a big file to change a small part of it.** `README.md` maps `src/app/` and `src/render/`
   file by file, drift-guarded by `test/readme-map.test.ts`. Open the file, not the directory. If a map
   sends you to the wrong place, fixing the map is part of your change.
3. **A hot file needs internal structure.** Any file over ~600 lines that changes often should carry
   `//#region` markers with `anchors:` you can grep for. `tools/region-graph.mjs` measures the
   dependencies BETWEEN those regions, but only for `src/app/main.ts` — it is pointed at that one file.
   README maps are per-file now; there is no line-range table to regenerate.
4. **Do not grow the hot files.** `test/file-budgets.test.ts` holds a line budget per hot file and fails when
   one is exceeded. The budgets only ever ratchet **down**: if your change genuinely belongs there and the
   budget must rise, raise it in the same PR and justify it in the description. The test exists to force that
   sentence to be written, not to forbid growth.

   The list is hand-curated, so it used to protect only the files somebody remembered to add. A tripwire in the
   same file now closes that gap: **any file in `src/app/` over 520 lines must have a budget.** It is not a cap
   — crossing the line does not fail because the file is too big, it fails because nothing was watching a file
   that had become worth watching. It is scoped to `src/app/` because that is where churn concentrates
   (`main.ts` alone is 84 of the project's 180 commits, against six for all of `src/rooms/`), and set just above
   the largest unbudgeted file there today, so it stays quiet on the status quo. A blanket limit on every file
   would be the wrong shape: `src/rooms/banka.ts` is 896 lines and has been touched twice, and budgeting it
   would only teach people to ignore the guard.
5. **Iterate with a filtered gate, not the full one.** `npm run test:ui -- <pattern>` is the loop; the full
   suite is for before the PR.
6. **Delete what you replace.** A superseded file that stays behind is read by everyone who greps for it
   afterwards, and eventually followed by someone. This has happened here.

### Tests: buy coverage, and know what it costs

Test time is the other recurring bill, and the numbers are lopsided enough to settle most questions on their
own:

| | cost |
| --- | --- |
| one unit test | **~2.5 ms** (1 609 of them run in ~5 s) |
| one UI probe | **~7.4 s** median — about **3 000×** a unit test |
| the fixed part of any probe | 1.3–2.7 s, just to launch a browser and boot the app |
| the full UI suite | 86 probes, ~1 450 s of serial work, ~5 min wall |

So, in order:

7. **Reach for a unit test first.** Use a probe only when the browser is genuinely the thing under test — a
   real pointer, a real canvas, real timing. Most "does this state change" questions do not need one.
8. **Prefer an assertion in an existing probe over a new file** when they share setup. A new probe pays the
   1.3–2.7 s launch again however little it asserts.
9. **Judge a probe by coverage per second, not by seconds.** The three ~100 s probes sweep all 72 rooms for
   byte-exact GPU-vs-CPU parity — 1.6 s per room, and the strongest evidence in the repo. A 30 s probe that
   checks one thing is the expensive one. A new probe should land near the median; if it is much heavier, say
   in the PR what coverage buys that.
10. **Slowing an EXISTING probe is a regression**, and belongs in the PR description. The suite roughly
    doubled once already when the `ai` tier moved to the GPU, and nobody noticed until it was measured.

`npm run test:ui` ends with a `cost:` line and flags probes over 8× that run's own median. It is a report,
not a gate: see the comment on `reportCost` in `tools/run-ui-tests.mjs` for why gating on wall-clock here
would only produce a flaky gate that people learn to bypass. Which probes get flagged also moves with load —
at load average 11 the three 72-room sweeps topped the list; at load 20 `test-showmode` and `test-legimage`
did. Read it as "look at these", never as a ranking.

**A passing probe prints its verdict and nothing else**, so a green run is cheap to read and a failure is
not buried. A FAIL still prints in full, including the `ok` lines before it — those are the context for the
one that broke. A FLAKY pass prints in full too, and a `console errors:` line survives a passing probe.
`--verbose` restores the old behaviour.

The same was done to the other commands. What a green run prints, now:

| command | before | after |
| --- | --- | --- |
| `npm run test:ui` | ~16 600 tokens | **~1 900** |
| `npm run test` | ~3 200 | **~1 500** (half of it was ANSI escape codes — `NO_COLOR=1`) |
| `npm run test:seeds` | **~292 000** | **~3** ("100 seeds passed") |

**An honest note on what that buys.** Those are the sizes of the OUTPUT, not what an agent necessarily reads:
the habit here is `npm run test:ui > /tmp/log 2>&1` followed by a grep for the summary, and measured across
real sessions that lands 200–400 tokens in context, not 16 600. So the saving is smaller than the table looks.
What it actually removes is the reliance on that habit — an undocumented trick a fresh session may not know —
plus two things the habit never fixed: `test:seeds`, where even a grep cannot tell you which seed failed
because the reports are interleaved, and the ANSI codes, which are pure noise however you invoke it.

`test:seeds` was the extreme case: `--silent` mutes the tests' own `console.log` but **not** the reporter, so
100 seeds printed 100 full reports. It now captures each run and prints it **only** for the seed that failed,
prefixed `seed N FAILED` — which is also the seed to reproduce with.

**If you are an agent: send test output to a file and read the summary.**

```
npm run test:ui > /tmp/ui.log 2>&1; echo "exit=$?"
grep -E "passed in|^  FAIL |cost:" /tmp/ui.log
```

Everything above shrinks what a run prints; this decides what you *read*, and it is the bigger lever of the
two. Open the log properly when something fails — that is what it is there for — but a green run needs three
lines, not the whole thing. The same goes for `npm run test` and any long build.

**A filtered run is not evidence the suite is green.** `-- <pattern>` is the iteration loop, but the full run
executes probes in parallel and this suite's flakes are load-driven — a probe can pass alone and fail under
that contention. That is what `PARTIAL RUN` is warning about. Run the whole thing before opening a PR.

### The rule these serve

**A change should not have to read much more than it changes.** If you find yourself needing a whole large
file to make a small edit, that is the codebase's fault, not yours — say so in the PR, and where it is cheap
to do so, leave the seam a little better than you found it.

## What the tests actually prove — read this before trusting them

This is the trap the repo has already articulated:

> *A parity probe cannot catch a refactor that moves the oracle.*

A test that reads its expectation from the same code it is testing will pass happily while the game changes
underneath it. So know what each net is actually watching:

- **`test/solutions.test.ts`** replays the committed FFNG solutions (64 of the 72 rooms have one) through the shared step engine. Strong
  evidence about physics and room scripts. It exercises `src/core/stepEngine.ts` — **not** `src/app/`.
- **The two mutation harnesses** (`tools/mutate-room-walk.mjs`, `tools/mutate-gl-room-ai.mjs`) break one
  rule at a time and assert the suite goes red. They are the strongest evidence in the repo — but they
  mutate `src/render/*` and `src/core/room.ts` only. **Neither can see `src/app/`.**
- **`tools/test-gl-live.mjs`** is byte-exact, but compares GPU against CPU — two implementations that both
  live in `src/render/`. It proves the two agree, not that either is right.
- **The 86 UI probes** are the only real coverage of `src/app/`, and every one of them asserts on
  `window.__ff` — which is exactly the state a refactor of that area moves.
- **`tools/capture-digest.mjs`** exists to fill that hole: it takes its oracle from the *previous revision*.
  Capture on the base commit, capture on the branch, `--compare`. Read its header for what it does and does
  not cover (game state and background pixels — not foreground pixels, not tick-driven logic).

If you conclude the suite cannot prove your change is safe, say so and propose how to make it provable.
That is a better outcome than proceeding on hope.

## `window.__ff` is the test interface

`src/app/debugHooks.ts` publishes 216 entries on `window.__ff`, and all 86 UI probes read it. It is
effectively the public API of the game for testing.

- **Changing its shape changes the probes.** Ship a hook change as its own PR, never inside a PR that moves
  code — the probes are the external oracle for the move, and an oracle that moves with the code proves
  nothing.
- `main.ts` builds a `host` object of accessors that `debugHooks.ts` reads the game through.
  `test/host-accessors.test.ts` enforces that every accessor exposes the identically-named variable —
  a getter wired to a same-typed neighbour (`aiPending` vs `enhancedPending`) typechecks cleanly and
  silently corrupts every probe that reads it.
- **State that has an owning module does not go through the host at all.** `debugHooks.ts` imports
  `room` from `gameState.ts` and reads `ui.screen` from `screenState.ts` directly, which is both
  cheaper (no accessor to write, in either file) and safer (nothing in between to mis-wire). Reach for
  the host only for values that genuinely live nowhere but `main.ts`.

## Ordering: the module-evaluation trap

`src/app/main.ts` is a **top-level-`await` module with side effects at module scope**, and the order is
load-bearing:

- It **refuses to run on a phone before any other side effect** (`isUnsupportedDevice`), via a
  never-settling `await`. Anything that must not happen on a phone must come after it.
- **An imported module is evaluated before any statement of its importer.** So a new module that touches
  the document, `localStorage`, or the network *at module scope* jumps ahead of that gate. This is why
  `dom.ts` exposes `buildStage()`, `persist.ts` exposes `openSaveStore()`, and the others expose `init*()` —
  each is called from `main.ts` at the point the code originally ran. Keep module scope side-effect-free.
- `migrateSaves()` must run before any `ff.*` key is read. That is why the save store is a function, not a
  set of module-scope consts.

## Finding your way around

- **`src/app/`** is 37 files and the README maps them. `main.ts` is the composition root — the leftover
  state, the boot-time wiring, and the keyboard and pointer routers — and at ~2 200 lines it is no longer
  the place to start. Find the thing by name: `logicTick.ts` is one game step, `renderLoop.ts` is one
  frame, `roomLoad.ts` gets a room on screen.
- **`src/render/`** has its own map in the README. Start at `roomWalk.ts` (what is drawn, in what order) and
  `artSource.ts` (what colour) — nearly everything else implements one side of those two.
- **`src/rooms/`** is 74 independent room scripts. Large in total, but a change touches one file.

## Flaky probes

`tools/run-ui-tests.mjs` has a `KNOWN_FLAKY` list. **Only listed probes are ever retried**, and a retried
pass reports `FLAKY` with every failed attempt printed — never a silent pass. A probe that has not flaked
before is reporting a real regression the first time it fails.

Before blaming a failure on flakiness, **prove it is pre-existing**. The cheap way is a paired A/B: two
preview servers, one per revision, alternating runs so both sides see the same machine load. Machine load
matters more than you would expect — this suite's flakes are load-driven, and results taken at load average
20+ are not evidence of anything.

## Before you push

- Commit with the **personal** identity (`mobratil` / `martin.obratil@gmail.com`), never a work account.
  With `gh`: `gh auth switch --user mobratil` first.
- **No session-id or internal trailers** in commit messages. `Co-authored-by: Copilot …` is fine.
- **No absolute paths, work emails, or internal references** in committed files. This is a public repo, and
  it is easier to leak one than you would think — a generated type annotation once carried a full
  `/Users/...` path into a committed file, which typechecks on exactly one machine.
- Never commit to the default-branch worktree; always work on a feature branch.
