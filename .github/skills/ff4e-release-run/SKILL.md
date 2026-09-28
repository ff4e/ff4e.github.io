---
name: ff4e-release-run
description: Release Fish Fillets 4ever to web or TestFlight, run it in the iOS Simulator/on a connected iPhone/iPad, check the latest released version, or launch the web build locally in a browser — using the repo's tools/*.mjs scripts instead of re-deriving the steps. Use for "release ff4e", "ship a new web/TestFlight build", "what version is live", "run ff4e locally/in the simulator", or "install ff4e on my phone".
---

# Fish Fillets 4ever — release/run automation

Every routine below is a single script invocation, run from a checkout of this
repo — run it and read its short, greppable result. Do not re-derive
`xcodebuild`/`gh`/`simctl` invocations by hand; that is exactly what these scripts
exist to replace.

```bash
export PATH="$HOME/.nvm/versions/node/v22.12.0/bin:/usr/local/bin:$PATH"   # Node 22 pinned
```

## 0. Check the latest released version

```bash
npm run release:web -- --current       # latest v* tag vs. what's actually live
npm run release:web -- --verify-only    # just the live version (no tag comparison)
```

`tools/release-web.mjs --current`. Fetches tags first (never answered from a stale
local cache) and reports both the newest pushed `v*` tag and the live deployed
version, flagging a mismatch (a deploy in progress, or stuck). This is the number
to check before picking the next release's `MAJOR.MINOR.PATCH`.

## 1. Run the web build locally in a browser

```bash
npm run dev            # Vite dev server on a free port; prints the URL
npm run dev:open        # same, and opens it in the default browser automatically
npm run dev -- --port 5199   # name a port (still --strictPort; never moves silently)
```

`tools/dev-server.mjs`. Always asks the kernel for a free port rather than assuming
5173 — this repo is normally checked out as a dozen-plus git worktrees, several of
which may already have a dev server up, and a probe/harness pointed at the wrong
one reports confident nonsense (that has happened here — see `AGENTS.md`). Also
prints direct links to the dev-only tool pages under `tools/*.html` (map viewers,
comparison tools, etc). Verified working (2026-09-28): server came up, served
`200` on its printed URL, and `--open` invoked the OS's default-browser opener.

## 2. Release to web

```bash
npm run release:web -- 1.0.NN              # tag, push, watch deploy.yml, verify live
npm run release:web -- 1.0.NN --skip-gate  # skip the local FF_UI_JOBS=4 test:all gate
npm run release:web -- --verify-only       # just re-check the live version string
```

`tools/release-web.mjs`. Requires a clean `main` worktree and `gh` authenticated as
the personal account. Fails loudly (non-zero exit) if the live version after deploy
doesn't match the tag — that is a real problem (cache lag or a bad deploy), not
something to retry silently.

**This is a real, irreversible release** (a tag + push + public site update). Only
run it when explicitly asked to release/ship/publish — never as part of building or
testing other automation.

## 3. Release for iOS (TestFlight)

```bash
npm run release:testflight -- --build N              # archive only — safe, local
npm run release:testflight -- --build N --upload      # archive AND ship to TestFlight
```

`tools/release-testflight.mjs`. `N` is the new `CFBundleVersion` — check App Store
Connect for the last uploaded build number first. Signs the REAL bundle id
(`io.github.ff4e.fishfillets4ever`) with the paid account's Distribution
certificate — set `FF4E_TEAM=<id>` if more than one distribution team's
certificate is present.

**`--upload` is a real TestFlight release** and must be explicitly requested, the
same as web release. Without `--upload` the script only produces a local
`.xcarchive` (safe, reversible, nothing leaves the Mac) — use that alone to validate
a change before asking whether to actually ship it.

## 4. Run in the iOS Simulator

```bash
npm run run:sim                              # build + boot + install + launch
npm run run:sim -- --skip-web                # native only, when dist/ is current
npm run run:sim -- --device "iPad Pro 13-inch (M5)"   # pick a specific simulator
```

`tools/run-simulator.mjs`. Fully safe to run freely — no Apple ID, team or
provisioning involved; the Simulator signs everything locally. Prefers an
already-booted simulator so repeat runs in one session don't keep rebooting.
Verified working end-to-end (2026-09-28): build, install, launch all succeeded and
`simctl launch` returned a live PID.

## 5. Run on a locally connected iPhone/iPad

```bash
npm run build:device                 # build web assets, then build + install
npm run build:device -- --skip-web   # native only, when dist/ is current
FF4E_TEAM=ABCDE12345 npm run build:device     # if several teams have certificates
FF4E_DEVICE=<udid> npm run build:device       # if detection misses the device
```

`tools/device-build.mjs` — already existed; not rewritten. Installs onto a real,
locally-connected iPhone or iPad via FREE Apple-ID personal-team provisioning, under
a deliberately THROWAWAY bundle id (`io.github.ff4e.devbuild`) — never the real one.
Read the file's own header comment before touching it; it documents why the
throwaway id exists (free provisioning permanently claims whatever bundle id it
signs, with no way to release it again). `findDevice()`'s platform filter is `'iOS'`,
which also matches connected iPads, so this covers both device types as-is.

## The one shared trap: `safe.bareRepository`

This environment's `safe.bareRepository=explicit` git setting breaks Xcode's Swift
Package Manager cache resolution (SPM stashes its package cache as a bare git repo
under derived data). Verified 2026-09-28 building for the Simulator — it fails even
with `-scmProvider xcode` alone. `release-testflight.mjs` and `run-simulator.mjs`
both work around it with a narrow, single-command `GIT_CONFIG_VALUE_0=all` override
on just their `xcodebuild` child process — never a global git config change. If
`build:device` ever hits the same "cannot use bare repository … safe.bareRepository
is 'explicit'" error, the same narrow override is the fix; that script has not been
touched to preserve its existing verified behavior.

## Never do without being explicitly asked

- Actually tag/push/release the web build, or `--upload` a TestFlight build.
- Change `device-build.mjs`'s throwaway bundle id, or sign the real id with a free
  personal-team certificate.
- Commit anything from these scripts' output (archives, derived data, logs) —
  they all write outside the repo (`/tmp`, a tempdir, or `$TMPDIR`).
