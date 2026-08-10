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

`README.md` carries navigation maps — one for `src/app/main.ts`, one for `src/render/`. Their whole value
is that a reader trusts them enough to open one region instead of a 60 000-token file, so a map that has
drifted is worse than no map: it sends people confidently to the wrong place.

**The `main.ts` map is generated, not written.** Each region is declared by a marker at its head:

```ts
//#region Room load & audio wiring | anchors: loadRoom, loadSoundPkg, talk | Fetch a room's FFR/FFS/FFT… | Hot
```

The line ranges are *derived* from where the markers sit, so ordinary edits never falsify them — which is
the point. Earlier this table was hand-maintained, and because the ranges had to tile the file exactly,
every edit that changed the line count made it wrong. That put a documentation chore on the most-edited
file in the repo.

- Changed a region's **name, anchors or purpose**? Edit its marker in `main.ts`.
- Moved a **boundary**, or added/removed a region? Move or add a marker.
- Then run **`npm run map:update`** and commit the README change.
- Do not hand-edit between the `<!-- MAP:main.ts BEGIN/END -->` sentinels; it is generated output.

`test/gen-map.test.ts` fails if the table is stale (naming the command), if a marker's anchor no longer
occurs inside its region, or if a region has no description. The `src/render/` map is still hand-written
and `test/readme-map.test.ts` checks it both ways: nothing listed that is gone, nothing present that is
unlisted.

## Assets & licensing## Assets & licensing

- Everything shipped under `public/data/` descends from ALTAR's original 1998 Fish Fillets data,
  **GPL-released in 2002** — the same basis the fillets-ng project stands on. The whole repo is
  GPL-2.0-or-later.
- The original `*.avi` movie files are **build source only**; the site ships the transcoded
  `*.mp4` produced by `tools/build-movies.mjs`. `public/data/{Writes,Program,256col}/` are
  runtime/staging/original-binary dirs and are intentionally not tracked.

## Deploy

- Pushing a `v*` tag triggers the GitHub Actions Pages build (see `.github/workflows/`).
  The live site is https://ff4e.github.io/.
