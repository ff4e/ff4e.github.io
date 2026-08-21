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

## Keeping the maps honest

[`MAP.md`](MAP.md) carries navigation maps — one for `src/app/`, one for `src/render/`. Their whole value is that
a reader trusts them enough to open one file instead of reading a directory, so a map that has drifted is
worse than no map: it sends people confidently to the wrong place.

Both are **directory maps**: one row per file, saying what that file owns. If you add, delete or rename a
file in either directory, add or remove its row in the same PR.

`test/readme-map.test.ts` checks both maps in both directions — nothing listed that is gone, nothing
present that is unlisted — so a forgotten row fails `npm test` rather than rotting silently.

**There used to be a third kind: a line-range map of `src/app/main.ts`**, generated from `//#region`
markers by `tools/gen-map.mjs`. It existed because the app was one 5 897-line file and there was no other
way to open a part of it. The app is 37 files now, so the map is a directory listing and the generator is
gone. The `//#region` markers stayed — `tools/region-graph.mjs` measures the dependencies between them,
and they are useful to grep — but nothing derives line numbers from them any more. The test rejects a new
line-range map: if a file is big enough to want one, split it instead.

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

The web build is published to **GitHub Pages** via `.github/workflows/deploy.yml` (build on
a pushed version tag `v*`, then Pages deploy — or run it manually via *workflow_dispatch*). Because `copyPublicDir` is disabled (see `vite.config.ts`),
`tools/stage-pages-assets.mjs` copies `public/*` into `dist/` (dereferencing the `public/data`
symlink) and writes `.nojekyll` before the Pages artifact is uploaded. Optional
**Cloudflare Web Analytics** is injected at build time only when the `CF_BEACON_TOKEN`
secret (→ `VITE_CF_BEACON_TOKEN`) is set; otherwise analytics is a no-op (see
`src/platform/analytics.ts`). The build stamps `__APP_VERSION__` / `__BUILD_HASH__` /
`__BUILD_DATE__` (logged to the console at boot).
