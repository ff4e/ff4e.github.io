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
- **The 85 UI probes** are the only real coverage of `src/app/`, and every one of them asserts on
  `window.__ff` — which is exactly the state a refactor of that area moves.
- **`tools/capture-digest.mjs`** exists to fill that hole: it takes its oracle from the *previous revision*.
  Capture on the base commit, capture on the branch, `--compare`. Read its header for what it does and does
  not cover (game state and background pixels — not foreground pixels, not tick-driven logic).

If you conclude the suite cannot prove your change is safe, say so and propose how to make it provable.
That is a better outcome than proceeding on hope.

## `window.__ff` is the test interface

`src/app/debugHooks.ts` publishes 216 entries on `window.__ff`, and all 85 UI probes read it. It is
effectively the public API of the game for testing.

- **Changing its shape changes the probes.** Ship a hook change as its own PR, never inside a PR that moves
  code — the probes are the external oracle for the move, and an oracle that moves with the code proves
  nothing.
- `main.ts` builds a `host` object of accessors that `debugHooks.ts` reads the game through.
  `test/host-accessors.test.ts` enforces that every accessor exposes the identically-named variable —
  a getter wired to a same-typed neighbour (`aiPending` vs `enhancedPending`) typechecks cleanly and
  silently corrupts every probe that reads it.

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

- **`src/app/main.ts`** is ~5 720 lines. Do not read it front to back — the README has a map of its regions
  with grep-able anchors. The map is **generated** from `//#region` markers in the file itself; edit a
  marker and run `npm run map:update`.
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
