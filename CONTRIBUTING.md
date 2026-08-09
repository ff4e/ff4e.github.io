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
