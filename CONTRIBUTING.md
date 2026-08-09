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

## Keeping the `main.ts` map honest

- `README.md` → **Layout → Map of `src/app/main.ts`** is the entry point everyone uses to find their way
  into the largest file in the repo. A map that has drifted is worse than no map at all.
- **Any structural change to `src/app/main.ts` must update that table in the same PR** — adding, removing,
  moving or renaming a region, or moving code between regions. A change contained inside one existing
  region does not need an update; the line ranges are approximate by design and the anchor names carry
  the meaning.
- If you extract code out of `main.ts` into a new module, delete its row and add the module to the
  `## Layout` bullet list instead.

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
  pixels of animating items.

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
