# Tests

How this port is checked, and what each net actually proves. [`AGENTS.md`](AGENTS.md) has the short
version — the table of how much checking a given change needs, and the warning that a parity probe
cannot catch a refactor that moves the oracle. This file is the detail behind it.

Moved out of `README.md` unedited.

Automated, deterministic, **non-AI** (no LLM/vision at runtime — plain assertions):

    npm test        # unit + physics (Vitest, headless, no browser, no game data needed)
    npm run test:ui # browser/integration (Playwright; builds the app and serves it)
    npm run test:ui -- cheat options   # ...or just the probes whose name matches
    npm run test:all # typecheck + unit + UI, in sequence, fail-fast (the full gate)
    npm run test:solutions # just the solvability net (also part of npm test)

`npm run test:all` chains `typecheck && test && test:ui` — the full gate, and what to run
before opening a PR (it stops at the first failing phase). For smaller changes AGENTS.md
has a table of how much checking is actually warranted; a docs-only change needs none of this.

The full UI suite is ~315 s, so for the inner loop pass a pattern and run only what your
change can break; a filtered run prints `PARTIAL RUN` and is explicitly not a gate. See
CONTRIBUTING.md for how much checking a given change actually needs, and for the
`KNOWN_FLAKY` retry rule.

`typecheck`, the unit suite and `vite build` also run in CI on every push
(`.github/workflows/checks.yml`). The browser probes do not — not for lack of data
(`public/data/` is committed) but because the suite takes ~6 minutes and the `test-gl-*`
probes need macOS/Metal. A few unit tests still default to a private extraction of the
original game (`~/.cache/ffng-orig`, via `$FFNG_DATA` / `$FF_DATA_DIR`) and skip without
it — `rooms.test.ts`, `gral-pushout.test.ts`, `render-parity.test.ts`,
`enhanced-mapping.test.ts` — 146 assertions that skip without any data. (The count used to
read 148, the extra two being `it.skip`s for rooms in `KNOWN_DIVERGENT`, which skipped even
with data; that set is empty now.) The solvability net used to be among them and no longer
is; the others could be unskipped the same way.

### What actually guarantees the rooms are still solvable

`npm test` replays 70 recorded reference solutions through the shared step-engine and asserts
each room ends won, with no death and no blocked move — the whole set in under a second. It
runs **in CI on every push**, and locally in every `npm test`.

It did not always. Until recently the replays were gated on a *private* extraction of the
original game at `~/.cache/ffng-orig`, so CI skipped every one of those assertions on every push and still
reported green. The premise was wrong: the room data is not withheld from this repo. ALTAR
GPL-released the Fish Fillets data in 2002 (see [CONTRIBUTING.md](./CONTRIBUTING.md)), all 72
`Graphic/*.ffr` are tracked under `public/data/` because the site ships them, and they are
byte-identical to a private extraction. `test/gameData.ts` resolves the directory — `$FFNG_DATA`
still overrides it — and missing data is now a **failure**, not a skip.

Three tests hold the net together:

- `test/solutions.test.ts` — the replays, plus a guard that asserts all 70 rooms it is about to
  replay are present and readable, so the file cannot contribute zero coverage while the run
  reports success. It also pins how much of each recording is consumed, because the replay stops
  at the win and would otherwise never look at what follows it.
- `test/solutionsCoverage.test.ts` — the inventory: 71 recordings, 70 mapped, 0 known
  divergences, 70 clean, every mapping pointing at a distinct real room. Dropping a mapping
  fails here even with no room data at all.
- `test/solutionsCorpus.test.ts` — whether a recording is *possible* before asking whether the
  port replays it. A fish's X changes only through its own recorded left/right move, so a
  recording's horizontal span lower-bounds the width of the room it came from. CHODBA #56 spent
  months filed as a port bug while its recording needed 1398 columns of a 34-column room.

The promise is "every room with a clean recorded solution is still solvable" — **70 of 72**, and
the two left are ZAVER #71 and SCORE #72, the ending and results screens, which are not puzzles.
So every playable room in the game is covered, and none is skipped: `KNOWN_DIVERGENT` is empty.
The coverage line is printed on every run and the uncovered rooms are pinned by name in the
coverage test, rather than rounded away. See [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

It reached that only with a second corpus. The recordings came from one collection, which was
missing seven levels — read for years as "no solution exists", and for two rooms written up as
a reason one never could. Brian Raiter's archive has every level of both games; six of its
seven relevant recordings replayed clean unmodified.

WIN #68 was one of the last to join, and not for want of a recording: `gspec=5` turned out to change
gameplay, not just the render (`URoom.pas:24825-24928`), and the corpus recording had to be
reordered because FFNG hands control to the elderly fish two moves before the Delphi trigger
fires — see `test/fixtures/solutions/README.md`.

### Randomness in the unit suite

The game keeps the original's real randomness (Pascal's `random`, `URoom.pas`): `Script.random`
(`src/core/script.ts`) calls `Math.random()` and no game behaviour was changed for the tests.
The unit suite instead installs a **seeded** `Math.random` from `test/rng.setup.ts`, so a unit
failure always means a real defect and never a 1-in-100 draw. Every draw the port makes at
runtime goes through `Math.random` — the room scripts, the ZX band width, the sound-variant
pick, the host's lip-sync and blink — so the one swap covers all of them.

- **A stream per test**, seeded from the test's file + name, so a test never depends on how many
  draws the tests before it happened to make. The seed is installed by `beforeAll`/`beforeEach`,
  so it covers hooks and test bodies; a draw in a file's module body or a `describe` callback
  runs before any hook and is *not* seeded (no file does this today). Tests within a file must
  run serially — `test.concurrent` would share one stream.
- **Where the code under test takes an `rnd`, inject it.** `StepEngine`, `ambient`, `hooks` and
  `lode-game` all accept a random function, and several tests pass `{ random: () => 0 }`. That
  stays the house style, and the pins below do *not* reach those draws, because they never call
  `Math.random`. The seeded global is the floor for everything that has no seam.
- **A test that needs a draw to go one way says so**, with `pinRandomLowest()` (every draw is
  `0`, so `random(100) < 1` is certain) or `pinRandomHighest()` (every draw is `n - 1`, so it is
  impossible). Both are exact for every `n` the port uses. See `test/kajuta1.test.ts` for the
  two sides of one draw.
- **Never stub `Math.random` to a constant.** The idle-chatter picker redraws until it gets a
  group different from the last three (`src/core/chatter.ts:235-237`, `URoom.pas:3370`), so a
  constant spins forever and hangs the suite. Both pins stay varied by construction, which is
  why they exist instead of `vi.spyOn(Math, 'random')` — and a test in `test/rng.test.ts` fails
  if a direct stub comes back.
- **`FF_TEST_SEED`** (default `1`) picks the base seed. Sweep the suite through different draw
  sequences after touching anything RNG-adjacent:

      npm run test:seeds              # seeds 1..100
      FF_SEEDS=500 npm run test:seeds

  A fixed seed proves reproducibility; a sweep proves the tests do not depend on which way a
  draw went. A failing test prints the `FF_TEST_SEED=... npx vitest run ...` line that
  reproduces it. Run a sweep on an **idle** machine: it is hundreds of full suites back to
  back, and under heavy load the suite's default 5s per-test timeout can trip on the slowest
  tests (`render-parity`), which looks like a sweep failure but is the contention class, not a
  draw. Re-run the reported seed in isolation before believing it.
- **The UI suite is deliberately left on real randomness.** `npm run test:ui` drives the built
  app in a browser, where the randomness is part of what is being validated; `setupFiles` is
  vitest-only and does not reach it.

### How the UI suite runs — read this before adding a probe

`tools/run-ui-tests.mjs` builds the app (`vite build`, ~2s), serves the result on a port it
picks for that run, and runs the probes **concurrently**. It used to run them one at a time,
each in its own cold Chromium, which took ~15 minutes; the pool is what turns roughly half an
hour of probe time into **~5–6 minutes** of wall clock, with the same probes and the same
assertions.

- **A fresh server on a per-run port.** The runner always serves the build it just made and
  never adopts a server that happens to be listening (reusing a stale dev server on 5173 once
  hid an SPA-fallback regression). The port is asked of the OS per run, so several worktrees of
  this repo can run the suite at the same time; the fixed port this used to use made the second
  run abort with "port already in use", or — worse — tore the first run's server down mid-suite
  and produced bogus `Failed to fetch` failures that passed when re-run alone. Set `FF_UI_PORT`
  to pin a port; a clash on a pinned port is then a hard error rather than something to route
  around.
- **A worker pool** runs `FF_UI_JOBS` probes at once (default: `round(cores × 0.6)`, floored at 2 and capped at 8 — more is
  counterproductive, because the game clock is wall-clock driven and slows under load). Each
  probe is still its own `node` process with its own browser context, so the isolation probes
  rely on (localStorage, saved games) is unchanged. Output is buffered per probe.
- **Two shared browser servers** (plain, and ANGLE for the WebGL probes) are launched once and
  advertised over `FF_WS_PLAIN` / `FF_WS_ANGLE`. Get a browser with `launchBrowser()` from
  `ui-lib.mjs`, never `chromium.launch()` — run a probe by hand and it launches its own.
- **Wait on conditions, never on the clock.** Use `waitRoom()`, `waitTicks()` and
  `selectRoom()` from `ui-lib.mjs`. A fixed `waitForTimeout` and a timeout sized just above a
  wait's nominal duration both become races once eight probes share the machine: the game clock
  is wall-clock driven and never fast-forwards, so under load a fixed sleep silently buys fewer
  game ticks than it did when it was written. Legacy `waitForTimeout` calls still exist in older
  probes; prefer `waitTicks()` in anything you touch.
- **`screen() === 'room'` does not mean your room is up.** `enterRoom()` flips the screen
  synchronously but loads asynchronously; act in that window and the room build landing a
  moment later discards what you did. `waitRoom()`/`selectRoom()` gate on `__ff.roomLoading()`
  and `__ff.roomNum()` for you.
- **`waitForFunction(fn, { timeout })` silently ignores that timeout** — options are the
  *third* argument; as the second it is taken as the predicate's `arg`, leaving the 30s default.
  Most existing probes still use the two-argument form (harmlessly, since 30s is more generous
  than what they ask for); new and touched code should use the three-argument form.
- If a probe asserts on **wall-clock behaviour** (frame rate, tick rate, animation pacing,
  per-frame motion), add it to `EXCLUSIVE` in the runner so it gets the machine to itself.
  Do not relax its bounds instead.

- **`npm run test:solutions`** (`test/solutions.test.ts`, also run by `npm test` and so by CI):
  the **solvability net** — replays each room's known-good FFNG solution move-string through
  the shared step-engine and asserts each ends **won, no death, 0 blocked**, off the repo's own
  `public/data` (`$FFNG_DATA` overrides). All 70 mapped solutions pass — every playable room in
  the game. The two rooms without a recording are the ending and results screens; see
  [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

  A solution is **room data**: it lives on the room's `RoomScript` as `solution`, out of the
  generated `src/rooms/solutions.ts` (`npm run gen-solutions`), keyed by the same `Jmeno` as
  the script registry. `test/fixtures/solutions/*.moves` is the staging area the generator
  reads, and `test/solutionsData.test.ts` pins the two byte-for-byte so they cannot drift.
  Resolving the ambiguous FFNG-slug → room match at generation time is the point: the running
  game never looks it up. To add a recording: drop `<slug>.moves` in the staging area, pin it
  in `test/solutionsMapping.ts`, run `npm run gen-solutions`, and move the pinned counts in
  `test/solutionsCoverage.test.ts` in the same change.

- **`test/solutionsCorpus.test.ts`**: asks whether a recording is even POSSIBLE before asking
  whether the port replays it. A fish's X moves only on its own recorded left/right move, so a
  recording's horizontal span is a lower bound on the width of the room it came from. This is
  what CHODBA #56 needed: it sat filed as a port bug while its little fish swept 1398 columns
  of a 34-column room.

- **`test/solutionsCoverage.test.ts`**: the inventory half of that net — pins the corpus
  (71 recorded / 70 mapped / 0 divergent / 70 clean), names the 2 rooms with no recording, and
  checks every mapping points at a distinct real room. Needs no room data at all, so a room
  quietly losing its solution fails even in a stripped checkout. `test/solutionsSource.ts` is the
  single accessor for where recordings live, so the assertions survive them moving into the room
  modules.

- **`npm test`** (`test/*.test.ts`, ~1 800 assertions): the move-record helpers, the `goanim` Anim-string
  interpreter, the **physics/mechanics** (movement, pushing, the light/heavy push rules, gravity/falling,
  stacking, **crushing/death** — heavy-on-fish, a box falling onto a fish, a box shoved sideways onto the
  fish, a fish stepping down under its carried box; and the counter-cases that must *not* crush — plus
  exit/win incl. swimming to the edge — via synthetic rooms in `test/roomBuilder.ts`), the world-map
  **`updatuj_soutez` progression** (linear unlock, branch enable, cheat-solve still unlocks), the **`FArray`
  grid query** + the **SCHODY** slug state machine (water/solid/push → distinct frames), the **KNIHOVNA**
  global arrays (`roompole` rotation + `globpole` crystals), the `universal` agent, `.dir`-driven doors and
  the `setBusy` primitive, the **`StdSmrt` death commentary** (Depth-gated survivor lines, the +8-tick fire
  window), and a corpus test that parses all 72 real rooms and checks their load settle (auto-skips when the
  game data isn't present; point `$FFNG_DATA` at the extracted `MAINDIR` to run it).
- **`npm run test:ui`** (`tools/test-*.mjs`, ~90 probes): the HUD (render + hit-test + button dispatch), the
  world map (compositing + node hit-test + branch unlock + navigation), the map/room **audio lifecycle**
  (menu music, `KillSnd` + dialogue-clear on leaving), per-room music, the fixed-timestep clock + dialogue
  pacing, lip-sync heads, save/restart determinism, the faithful **input map** (arrow keys move the active
  fish, Space swaps, 1/2 select, right-click steps toward the cursor, click-select is silent), **exit/win**
  (both fish out → solved → recorded in the progression), the **cheat codes** (the `X`-armed entry machine and
  every code, typed on the real keyboard — including `xwemaketherulez` returning to the map with the room
  recorded as cheat-solved and its successor still unlocked), the **Tetris minigame** (launch from a room and
  the map, its own clock, the room frozen underneath, the controls, the persistent hiscore), **save gating**
  (`CanSave` — a dead fish refuses `F2` and the panel button, and greys the button out), **`cas_hry`**
  (per-room play time banked on room close, map time excluded, surviving a reload),
  **SCHODY**/**KNIHOVNA** end-to-end smoke tests (each room's Programky runs many ticks against real game data
  without error), the **ambient idle chatter** (`StdKecej` — the x03 bank loads, a chatter timer exists in
  ported and unported rooms, and forcing it due speaks a line), and the **death model** (`StdSmrt` — a lone
  death keeps the survivor playing + speaks a line; both dead auto-restarts). Each drives the app through the
  deterministic `__ff` debug hooks and hard-fails on any bad assertion or console error. (The per-room music
  test decodes a ~5 MB WAV and can flake under machine load — re-run in isolation.)
