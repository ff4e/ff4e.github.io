# Contributing / repo hygiene

This is the **single source of truth** for Fish Fillets 4ever. All development happens here;
there is no separate private repo. Keep it clean and public-safe.

## Identity

- Commit with the **personal** GitHub identity `mobratil` / `martin.obratil@gmail.com`.
  Never commit or push with an enterprise/work account.
- If pushing with `gh`, ensure the personal account is active first:
  `gh auth switch --user mobratil`.

## Commit hygiene — no private trailers

- **Do not add a `Copilot-Session:` trailer** (or any session-id / internal trailer) to commits
  in this repo. A `Co-authored-by: Copilot …` line is fine, but the session UUID must not leak.
- Do not commit absolute personal paths, work email addresses, internal tooling references,
  or task-hub artifacts (briefings, progress logs, `.copilot/` / `.claude/` session state).
  These are also blocked by `.gitignore` as a backstop.

## Keeping the README maps honest

`README.md` carries navigation maps — a line-range table for `src/app/main.ts`, a file table for
`src/render/`. Their whole value is that a reader trusts them enough to open one region instead of a
60 000-token file, so a map that has drifted is worse than no map: it sends people confidently to the
wrong place.

**This is enforced, not requested.** `test/readme-map.test.ts` fails when a map stops matching the code,
which means `npm test` and CI fail. It checks:

- for a **file** map, that the ranges tile the file exactly — no gap, no overlap, last row ending on the
  last line — and that every backticked anchor really occurs inside the region claiming it;
- for a **directory** map, that every file listed exists and every source file in the directory is listed.

Line numbers move whenever a file changes size, so the tiling check fires on any structural edit. When it
does, fix the ranges — that is the point, not an obstacle. A change *within* one region still needs its
range adjusted if it changed the line count; the anchor names are what carry the meaning, and they are why
the map survives small edits without becoming misleading.

To add a map, write a `### Map of \`<path>\`` heading and a table; the test discovers it automatically.
A path ending in `/` is treated as a directory map. If you extract code out of `main.ts` into a new module,
delete its row and add the module to the `## Layout` list instead.

## Restructuring `src/app/main.ts` — the rules for that series

`main.ts` is being split into modules over a series of PRs (see the map in `README.md`). Two rules apply
to every PR in that series, and the second one applies to *everyone else* too:

- **`window.__ff` is frozen while the series runs.** No PR that MOVES code may add, remove, rename or
  change the shape of an `__ff` key. All 85 UI probes assert on that object, so it is the only external
  oracle a refactor of `main.ts` has — and an oracle that moves with the code proves nothing. If you need
  a new probe hook, ship it as its own PR, before or after a move, never inside one.
- **Prove it, don't assert it.** Every code-moving PR must show a byte-identical
  `node tools/capture-digest.mjs` result against its base commit:

      git checkout <base> && node tools/capture-digest.mjs --out /tmp/before.json
      git checkout <branch> && node tools/capture-digest.mjs --out /tmp/after.json
      node tools/capture-digest.mjs --compare /tmp/before.json /tmp/after.json

  Read the header of that file before trusting it: it covers game state and background pixels, not the
  pixels of animating items or tick-driven logic. Note `--compare` is a deep comparison of the recorded
  values, not a byte comparison of the files.

## Running and checking your work

- **`npm run dev`** picks a free port, binds it strictly, and prints both the URL and the directory it is
  serving. Do not go back to a bare `vite`: this repo is normally a dozen-plus worktrees, several with a
  server up, and a dev server that silently moves off 5173 means the probes and mutation harnesses (which
  default to 5173) end up testing *somebody else's worktree*. That has produced a bogus "7 mutations
  SURVIVED" here before.
- **`npm run test:ui -- <pattern>…`** runs only the probes whose filename matches, e.g.
  `npm run test:ui -- cheat options`. The full suite is ~315 s; three probes are ~15 s. Use the filter for
  the inner loop and the full suite before you open the PR — a filtered run says `PARTIAL RUN` in its
  summary and is not a gate.
- **CI** (`.github/workflows/checks.yml`) runs `typecheck`, the unit suite and `vite build` on every push.
  It does not run the browser probes — not for lack of data (`public/data/` is committed) but because they
  take ~6 minutes and the `test-gl-*` ones need macOS/Metal. They stay a local pre-PR step.

### How much checking does a change need?

Match the gate to the risk rather than paying the full 5.7 minutes for a typo:

| Change | Run |
| --- | --- |
| Docs only | nothing (CI covers it) |
| Logic with unit coverage | `npm run typecheck && npm run test` |
| Anything reaching the DOM, the loop, or a screen | the above + relevant `npm run test:ui -- <pattern>` |
| Before opening the PR | the full `npm run test:ui` |
| Render-path changes | also the relevant mutation harness (`tools/mutate-*.mjs`), and report survivors |

### One `node_modules` for many worktrees

This repo is normally a dozen-plus worktrees, and each having its own install costs ~77 MB and an `npm ci`
before a fresh one can run anything — ~1.6 GB across 21 of them, measured. Optional:

    node tools/link-node-modules.mjs          # link to a sibling worktree's install
    node tools/link-node-modules.mjs --unlink # go back to a private one

It refuses unless `package-lock.json` is byte-identical on both sides, because a shared `node_modules`
across differing dependencies fails as a mysteriously-wrong build rather than an error. It never replaces a
real directory. When dependencies change, `npm ci` in the source worktree and the linked ones follow.

Opt-in on purpose: other people have live sessions in these worktrees, and quietly rearranging their
environment is a poor trade for some disk.

### Flaky probes

`tools/run-ui-tests.mjs` has a `KNOWN_FLAKY` list of probes that may be retried, with the reason and the
owner of the fix. **Only probes on that list are ever retried**, and a retried pass is reported as `FLAKY`
with every failed attempt printed — never as a silent pass. A probe that has not flaked before is reporting
a real regression the first time it fails.

Do not add a probe to that list to quiet a failure you have not diagnosed. Prove it is pre-existing first;
the cheap way is a paired A/B — two preview servers, one per revision, alternating runs so both sides see
the same machine load.

Retrying is mitigation, not a fix, and the entry should say how well it works. The current one still fails
a full run about two times in five, which is deliberate: a probe that unreliable should be able to go red,
because burying it under six attempts teaches everyone to distrust the suite instead of fixing the bug.

## Assets & licensing

- Everything shipped under `public/data/` descends from ALTAR's original 1998 Fish Fillets data,
  **GPL-released in 2002** — the same basis the fillets-ng project stands on. The whole repo is
  GPL-2.0-or-later.
- The original `*.avi` movie files are **build source only**; the site ships the transcoded
  `*.mp4` produced by `tools/build-movies.mjs`. `public/data/{Writes,Program,256col}/` are
  runtime/staging/original-binary dirs and are intentionally not tracked.

## Deploy

- Pushing a `v*` tag triggers the GitHub Actions Pages build (see `.github/workflows/`).
  The live site is https://ff4e.github.io/.
