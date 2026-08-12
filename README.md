# Fish Fillets 4ever — Delphi-faithful web port

Faithful web port of the **1998 ALTAR Fish Fillets**, ported line-by-line from the original
Delphi engine source (not the FFNG remake). Published as **Fish Fillets 4ever**.
GPL-2.0-or-later.

## Feedback

Play it at **<https://ff4e.github.io/>**. If something goes wrong, or you want something,
open the **Options** panel — right-click the control panel in a room, or the *Options*
corner of the world map — and use the **Send feedback** strip at the bottom of it. It
writes the report for you — what you type, the room you were in, the build, the renderer,
and the **move record** for that room, so the moves that led to the bug can be replayed
instead of guessed at — shows you the finished message, and then offers three ways out,
none of which happen on their own:

- **Open a GitHub issue** — prefills [the bug or idea form](.github/ISSUE_TEMPLATE/).
- **Send an email** — `mailto:` to `fish_fillets@icloud.com`, no account needed.
- **Copy report** — for when neither of those works; paste it wherever you like. (If the
  browser blocks the clipboard, the report is on screen to copy by hand.)

**Nothing is ever sent automatically.** There is no server behind this — the site is static
on GitHub Pages — so a report only leaves the browser when you click one of those three, and
the whole payload is on screen before you do. An *idea* collects only which build it was
written against (version, hash and date); the room and browser diagnostics above are
gathered for bug reports and nowhere else. See
[`src/platform/feedback.ts`](src/platform/feedback.ts) (what a report may contain, and why)
and [`src/app/feedback.ts`](src/app/feedback.ts) (why it lives under the Options panel and
is never painted into the original panel bitmap).

One honest limit: the game's `random()` is **unseeded** (`src/core/script.ts`), so replaying a
move record will not reproduce a bug that depended on a random draw. The record still pins
down everything else.

## Status

- **M0 — format proof (done):** the FFR (room graphics + logic) loader is ported from
  `URoom.pas` → `TRoom.Init`. All 72 original rooms parse **byte-exactly** and match the
  `Desc[].DFFR` size integrity checks from `zaklad.pas`.
- **M1 — static render (done):** faithful port of `TRoom.Priprav`'s resting frame
  (`Kresli2` wall-over-water-background, items, fish base pose) on a software-paletted
  8-bit framebuffer. All 72 rooms render correctly to PNG (`out/`).
- **M2 — movement core + browser host (done):** recursive push physics
  (`posun_objekt`/`posun_ryby`/`priprav_pole`/`posun_predmety`) ported to `core/room.ts`
  (pure logic). A Vite + Canvas host (`src/app/`) renders a room and drives the two fish
  with the faithful input map (`ZaznamenejPrikazKlavesou`/`ZaznamenejPrikazRoom`): **WASD** drives the big
  fish, **IJKL** the little fish (the moved fish becomes active); **arrow keys** move the *active* fish;
  **Space** swaps the active fish (if the other is alive); **1**/**2** select the little/big fish; **left-click**
  a fish to select it or water to swim there; **right-click** steps the active fish toward the cursor. Movement
  animates and is verified end-to-end in a headless browser.
- **M3 — gravity / crush / death (done):** ported `padani` + `zkameneni_pevnych` (anchoring)
  + `zavislosti_nezkamenelych` (support graph). The fall loop (`while padani do posun_predmety`)
  runs after every move and at load; unsupported items fall, and fish crushed by falling/pushed
  objects die (→ skeleton → room restart). All 72 rooms settle deterministically with no false
  deaths; crush (PRAVIDLA) and falling (PARTY1) verified in the browser. Horizontal moves
  turn-first-then-move, faithful to the original.
- **M4 — pathfinding (done):** ported `najdi_smer` + `priprav_hledani` (BFS with fish-size
  obstacle dilation) into `core/room.ts`. In the host, left-click a fish to select it, left-click
  water to BFS-swim the active fish there (one planned step per tick, re-planned each step,
  routing around obstacles). Verified headless and in the browser.
- **Animation (done):** the host reproduces the engine's animated tick — horizontal presses
  first **turn** the fish (stav_otocka, `tl_otocka`), a second press **swims** it while cycling
  the swim body frames (`tl_plav` / `tl_nahoru` / `tl_dolu`, `dxhlavy` head overlay + `hl_mrk`
  blink); objects then settle by **falling one cell per step** (stav_ma_padat → padani →
  stav_padani); and a crushed fish is drawn as its **skeleton** (`tl_kostra`) **eroding via
  `KresliK`/`rozpad`** before the room restarts. Idle fish gently cycle `tl_zaklad` and blink.
- **M5 — subtitles / dialog (done):** ported the FFT format (`MemAll`/`GetTit`) and the subtitle
  display — the bitmap font (`Chars.dat`/`Chartab.dat`/`Charcol.dat`, `IniFont`/`PisStringF`),
  per-room colour mapping (`SearchColors`, nearest-palette), and the scrolling line manager
  (`NovyTitulek`/`PosunTitulky`/`KresliTitulky`) with the cosine wave-in. In the host, clicking a
  fish makes it speak one of its lines (blue for the big fish, orange for the small); **G** toggles
  Czech / English. (Authentic scripted triggers await the per-room `Programky`.)
- **Exit / win (done):** ported `kontroluj_okraje` (a fish touching a room border → exit) and the
  `stav_ven` swim-out, tracking `venku` separately from death. When a fish reaches an edge it swims
  off; when **both** fish are `venku` the room is **solved** — the cheer plays, the solve's move count is
  recorded (`RoomVysl := LengthOfRecord`, best kept), and after the `countdown:=30` the room auto-returns to
  the world map. A crushed fish erodes to a skeleton at the faithful `rychlost_rozpadu=30`/tick (~14 ticks)
  and the room then restarts (`pokus++`).
  Verified: the win logic (both-exit), ZRC's big fish exiting left, and the browser exit animation +
  SOLVED screen.
- **M6 — sound (done):** ported the FFS audio codec (`Decompres`, a second-order delta PCM) — byte-exact
  vs the reference WAVs (within ±4 = the codec's 14-bit precision), and **all 1818 sounds** across the 72
  rooms + global `x00`–`x03` packages decode cleanly. A Web Audio engine (`src/audio/`) decodes on demand
  and plays: **fish voices** on talk (room FFS), **landing thuds** (`sp-zuch`/`sp-ocel`), **death cries**
  (`sp-smrt`), and **exit cheers** (`jo-m`/`jo-v`) from the global effects package. **Room music** loops per
  room (`src/audio/music.ts`): the room's `cHud` index maps to a `rybky*.wav` track (the `TDirect.Spust`
  remapping) and loops from its `MusCycle` sample point (intro once, body repeats).
- **Faithful timing (done):** all game logic advances on a fixed **wall-clock** timestep (~80 ms/step,
  ~12.5 fps) reproducing the original `TRoom.Jedeme` busy-wait loop — not the display refresh and not the
  audio buffer. Rendering interpolates within a tick for smoothness; under load the game slows (one step per
  frame) rather than fast-forwarding, matching the original.
- **Save / load / restart (done):** the original's move-command log (`srecord`, `ToRecord`) — every accepted
  move appends a char (`I/J/K/L` little, `W/A/S/D` big). Because the physics is deterministic, replaying the
  log from the initial state restores exactly. **Restart** (`Backspace`, or the panel button) is the original's
  `TRoom.Restart` (`URoom.pas:1577`): it discards the whole record, resets every object to its start, and
  counts a fresh attempt (`pokus++`) — *not* a single-move undo, which the 1998 Delphi game never had (the
  tutorial's `1st-m-backspace` line teaches Backspace = start over). **Save**/**load** (`F2`/`F3`) persist the
  log to `localStorage` **plus a snapshot of the script state** (every object's Vars + `roompole`/`globpole`),
  so loading restores the "already said"/progress flags and the fish don't re-say lines they already spoke
  (the original re-derives these by re-running `Programky` during a suppressed load replay). Saving is gated
  on `CanSave` (`URoom.pas:26900`): the original only allows it from a recoverable position — both fish alive,
  or one alive with the other already out — so **a dead fish blocks saving**, and the panel's save button
  greys out to say so. `src/core/record.ts`
  + a headless replay engine in `main.ts`. (Single-slot; the stats/competition system is deferred.)
- **Object animation (`goanim`, done):** the `Anim`-string interpreter (`src/core/script.ts`) that runs each
  object's compact animation program (`a`=frame, `d`=delay, `s`=set-var, `l`/`g` loop, `r` restart, `?a-b`
  random) — the shared primitive behind most rooms' background object animations.
- **Control-panel HUD (done):** the original `TOvl` overlay, rendered faithfully from `panel.ffp`
  (`src/data/ffp.ts` + `src/render/hud.ts`). The 16 colour-variant panel images composite into the seven
  bands (big-fish D-pad, swap, little-fish D-pad, save, load, exit, restart) by element state — **active fish
  yellow, available orange, disabled grey, pressed lit** — and the mouse hit-regions (`oblmysi` circles/rects)
  dispatch moves, fish-select, swap, save/load, and restart. (The options sub-panel and exit-to-menu are
  deferred to the world-navigation work.)
- **World map (done):** the branch-map screen (`src/data/world.ts` + `src/render/worldMap.ts`), rendered
  faithfully from the menu art with the original **`updatuj_soutez` progression**. The 640×480 map is two
  layers (`mapa-0` dark, `mapa-1` lit) selected per-pixel by `maska` — a branch's region lights once it's
  enabled (`dest = RTable[maska] ? mapa1 : mapa0`). Each room has a **Resena** state computed from the
  persisted solved-set: **solved** (drawn `n0`), **reachable/next** (the single next room per open branch,
  drawn pulsing `n1`–`n4`), or **hidden** (not drawn). Rooms unlock **strictly in order** within a branch
  (room 0 needs its feeder room solved; room *j* needs room *j-1* solved), and only reachable-or-solved nodes
  are clickable. The state recomputes on every map entry, so a freshly-solved room flips to solved and its
  successor becomes the reachable next. Solving both fish out of a room records it in the `localStorage`
  progression; entering a node loads that room; leaving restores the menu music. Opening the map plays the
  **`Depth` reveal animation** — the glowing paths and nodes trace in from the start outward (`Hloubka`
  depth gate). The four **corner "buttons"** (mask-colour hit-test, `UMain.pas:1636`) are wired: top-left
  replays the **intro** movie, bottom-right opens the **Options** panel over the map, bottom-left rolls the
  **credits** (`src/render/credits.ts`, `CredStat1`+`CredMov` scroll); the Exit corner is intentionally inert
  on the web. (Room-name plaques and the step counter are deferred.)
- **Intro movies (done):** on first run the ALTAR **logo → intro** play full-screen before the map
  (`src/app/intro.ts`, HTML5 `<video>`), then the persisted `introSeen` flag suppresses it (the original's
  `START`→`NO`, `UMain.pas:677`); a "click to start" splash unlocks audio, and click/Esc/any key skips. Also
  replayable from the map's top-left corner. Transcode the AVIs first (see *Intro movies* under Original data).
- **Cheat codes (all twelve, done):** the original's cheat table (`Uovl.pas:166-182`) ships XOR-obfuscated;
  decoded, it is `MEGABOMB TETRIS UNDEAD MORPH FISHER STORM INTERLACED SILENT WEMAKETHERULEZ IAMACHEATER
  SCORE ULTRAVIOLENCE`. Entry follows `ZaznamenejPrikazKlavesou` (`Uovl.pas:744`): press **`X`** to arm, then
  type the word — a key repeated immediately is not counted twice, and the first letter that cannot continue
  any code parks the machine until the next `X`. In a room (`URoom.pas:24534-24690`):

  | Code | Effect |
  |---|---|
  | `xmegabomb` | kills both fish, with a white flash |
  | `xtetris` | opens the **Tetris minigame** (below) |
  | `xundead` | flips the fish sprites — zombie fish |
  | `xmorph` | each fish takes the other's shape |
  | `xfisher` | drops a fishing hook (`Hacky`) |
  | `xstorm` | whips the water up |
  | `xinterlaced` | collapses the screen in on itself |
  | `xsilent` | silent-movie mode: sepia, film grain, intertitle cards, sound off |
  | `xwemaketherulez` | marks the room solved-by-cheat and returns to the map |
  | `xiamacheater` | accepted, and deliberately does nothing (its Delphi body is commented out) |

  All of them are room-scoped: they survive a restart and die on a room change, because `TRoom.Init` clears
  them in the same block that zeroes `roompole` (`URoom.pas:1430-1433`). `xwemaketherulez` still unlocks the
  room's successor, but its map node shows the cheat state rather than a clean solve, persisted in
  `localStorage` (`ff.cheated`); `__ff.cheat()` does the same. `Escape` toggles between the current room and
  the world map.
- **Map-screen cheats (`xscore`, `xultraviolence`, done):** two codes only work on the world map, exactly as
  in the original (`UMain.pas:1773-1780`; `URoom` has no case for either). `xscore` opens the hidden **SCORE**
  bonus room (room 72, a line-up-the-blocks score puzzle), deliberately kept off the map and out of the
  endgame, so this is the only way in. `xultraviolence` arms hooks mode: every room entered afterwards starts
  with a fishing hook already descending (`URoom.pas:1503`). The **ZAVER** finale (room 71) is SCORE's
  counterpart: it auto-launches once all 70 registered rooms are genuinely solved (`pustitzaver`,
  `USoutez.pas:729` → `av:=9`, `UMain.pas:948`).
- **Tetris minigame (done):** `Ttr/Ttr.pas`, one of the nine units in `Fillets.dpr`'s compile closure and a
  complete playable game, launched by `xtetris` from a room or the map. Not to be confused with the **TETRIS
  room** (room 65), an ordinary dialogue room where the fish reminisce about falling blocks. The original
  opens it as a modal window that freezes the room's timer; the port draws the 150×300 board over the frozen
  room and takes the keyboard until `Escape`. Faithful to the quirks that make it *this* game: rotation runs
  backwards, **Down rotates** and **Space slams** (there is no soft drop), a full row is blanked for a tick
  before it collapses, consecutive rows pay 50 × a rising bonus, and the fall speed steps from 11 ticks per
  row down to 2. The top-ten table persists (`ff.tetris`; the original's `ttr.pic`). `src/core/tetris.ts`,
  `src/render/tetrisRender.ts`.
- **M8 — room scripting (in progress):** built the script runtime — the dialog scheduler
  (`addd`/`addm`/`addv`/`dialogy`, a serial speech queue), the context helpers (`Vars`, `dist`/`xdist`/
  `ydist`/`look_at`, `zije`/`natoceni`/`venku`, `busy`/`delay` idle-timers, `playing`, `random`, `pokus`),
  and the briefcase-cutscene player. Ported **9 rooms** (`src/rooms/`) — the whole **Fish House opening branch
  (1–8)** plus KNIHOVNA: **PRVNI** (the tutorial), **KUFRIK** (the briefcase message + cutscene), **PRAVIDLA**
  (Rehearsal in Cellar — the long positional-hint chain), **VRAK** (Library Flotsam — random keep/throw-out
  book lists via a bitmask pick), **SCHODY** (Plants on the Stairs — the slug/snail creatures driven by
  per-tick state machines reading the **`FArray` grid** and the push state), **KOSTE** (Boiler Room — the
  broom-sweep animation), **UTES** (Under the Reef — shell/snail animation), **WC** (Closed in the Closet —
  the delayed second conversation), and **KNIHOVNA** (Hall of Ali-baba — the global-array crystals, the
  `universal` agent animating a chosen object, and `.dir`-driven doors + PC flicker).
  The **briefcase story cutscene** (`src/intro/kufrDemo.ts`) plays the `demo.pck` delta animation over
  `kufr256.bmp` with the `KD-*` narration (the FDTO-logo intro) — it fires when the briefcase is dropped. The
  looping `kufrik` music starts with the demo and **persists into the room afterward** (InitKufrDemo →
  DoneKufrDemo never stops it), and the demo is **skippable** by clicking or pressing Escape (`zrus_kufr`).
  The idle-chatter timer is held during the demo so the fish don't immediately start chattering when it ends.
  **Lip-sync talking heads** are wired: while a fish's voice sounds, its head cycles the `hl_mluvi` mouth
  frames (and a `busy` fish turns to its partner via the `tl_mluvi_na` body). **Ambient idle chatter**
  (`StdKecej`/`vyber_hlasku`, `src/core/chatter.ts`) runs in **every** room: left alone with no active
  dialogue for ~60–120s (growing each time, `CasKecu`), the fish spontaneously say a random line from the
  global `x03` bank — including the `zvykacka` chewing-gum easter egg that pays off on solving the room.
  **Death commentary** (`StdSmrt`, `src/core/deathlines.ts`): when one fish dies while the other lives, the
  survivor comments ~8 ticks later with a `smrt-*` line (global `x02` bank), the mix chosen by room `Depth`
  (normal / joke / love / "from beyond the grave"). Faithful to the original, a lone death does **not**
  auto-restart — control passes to the survivor and it keeps playing until you restart; only *both* fish dying
  restarts the room. **Ambient bubbles** (`Zvuky_okoli`) sound at random underwater, and the `TrepatRoom`
  shake jolts the view on the matching chatter line. The remaining 63 rooms follow the same translation
  pattern; the showmode capture-replay autoplay (`help.cap`) is a follow-up.

## Run

    npm install
    npm run dev                     # browser host on a FREE port (it prints the URL), with sound
    npm run dump-ffr -- --all       # M0: validate all 72 FFR (byte-exact, DFFR sizes)
    npm run render-room -- UTES     # M1: render a room's resting frame -> out/UTES.png
    npm run test-move -- UTES       # headless movement/push probe + render (exploratory)
    npm run test-path -- UTES little  # BFS-drive a fish to a target + render (exploratory)
    npm run dump-fft -- UTES        # list a room's subtitles (CZ + EN)
    npm run typecheck

## Tests

Automated, deterministic, **non-AI** (no LLM/vision at runtime — plain assertions):

    npm test        # unit + physics (Vitest, headless, no browser, no game data needed)
    npm run test:ui # browser/integration (Playwright; builds the app and serves it)
    npm run test:ui -- cheat options   # ...or just the probes whose name matches
    npm run test:all # typecheck + unit + UI, in sequence, fail-fast (the full gate)
    npm run test:solutions # replay known FFNG solutions per room (needs $FFNG_DATA)

`npm run test:all` chains `typecheck && test && test:ui` — the full gate, and what to run
before opening a PR (it stops at the first failing phase). For smaller changes CONTRIBUTING.md
has a table of how much checking is actually warranted; a docs-only change needs none of this.

The full UI suite is ~315 s, so for the inner loop pass a pattern and run only what your
change can break; a filtered run prints `PARTIAL RUN` and is explicitly not a gate. See
CONTRIBUTING.md for how much checking a given change actually needs, and for the
`KNOWN_FLAKY` retry rule.

`typecheck`, the unit suite and `vite build` also run in CI on every push
(`.github/workflows/checks.yml`). The browser probes do not — not for lack of data
(`public/data/` is committed) but because the suite takes ~6 minutes and the `test-gl-*`
probes need macOS/Metal. A few unit tests need the original extracted data
(`$FFNG_DATA`), which genuinely is not in the repo; they skip themselves, and 1529 of
1597 still run without it.

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
each in its own cold Chromium, which took ~15 minutes; it now takes ~3, with the same probes and
the same assertions.

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

- **`npm run test:solutions`** (`test/solutions.test.ts`, also run by `npm test`): the
  **solvability net** — replays committed known-good FFNG solution move-strings
  (`test/fixtures/solutions/`) per room through the shared step-engine and asserts each ends
  **won, no death, 0 blocked** (auto-skips when the game data isn't present). 62/64 mapped
  solutions pass; the remaining gaps and two confirmed same-layout divergences (CHODBA #56,
  WIN #68) are documented in [`KNOWN_ISSUES.md`](./KNOWN_ISSUES.md).

- **`npm test`** (`test/*.test.ts`, 66 assertions): the move-record helpers, the `goanim` Anim-string
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
- **`npm run test:ui`** (`tools/test-*.mjs`, 68 probes): the HUD (render + hit-test + button dispatch), the
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


## Working here

**[`AGENTS.md`](AGENTS.md)** is the orientation for anyone — human or agent — making changes: setup and the
port traps, how much checking a change needs, what each test net actually proves (and what it cannot), the
module-evaluation ordering rule, and the pre-push hygiene. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the
rules; `AGENTS.md` has the things that cost people time to find out.

## Layout

- `src/app/main.ts` — the browser host: boot, the frame loop, every screen and all input.
  ~5 890 lines — **see the map below before you open it**.
- `src/app/dom.ts` — the element handles and 2D contexts everything else draws into.
- `src/app/frameClock.ts` — when the next frame happens: the rAF handle, the idle timer and
  the paint-rate cap. The MECHANISM only, so a keypress handler can say `wake()` without
  reaching into it.
- `src/app/framePacing.ts` — the pacing POLICY that feeds it: which screens may idle
  (`loopThrottleOk`), how fast the things that still move on an idle screen must move
  (`idleDelayMs`), the render-on-dirty bookkeeping, and the perf HUD. Every rate here is a
  measured trade and the comments carry the measurements.
- `src/app/screenState.ts` — `ui`: which screen is showing and the state of everything
  layered over it (panel, options, credits, map info, help, leg image). A deliberately plain
  mutable bag — its value is that other modules can **import** it, so nothing needs a getter
  per name to see it.
- `src/app/stageGeometry.ts` — how big the game is drawn (the stage box, the fit-mode scale,
  a room's geometry) and the constants the simulation is timed by (`LOGIC_MS` and friends).
  Needs exactly one name from `main.ts`; the device gate deliberately stays behind, because
  it must be the first side effect the app performs.
- `src/app/mapDraw.ts` — drawing the world map: the branch map, the room-name plaques and the
  record panel (krokoměr). Only the drawing — deciding to go somewhere is `main.ts`'s map
  navigation, which is why this needs four names and all four are the player's record.
- `src/app/panel.ts` — the side panel the original game is played through, the options
  sub-panel that scrolls up over it, and the help overlay. Faithful to `Uovl.pas`, so most
  of it is frame and hit-region matching rather than drawing.
- `src/app/loadingUi.ts` — the loading overlay, the fatal-error screen and `relayout()`: the
  chrome shown when the game is not yet showing the game, and the only code that writes to
  the page outside the canvases.
- `src/app/mapDraw.ts` — drawing the world map: the branch map, the room-name plaques and the
  record panel (krokoměr). Only the drawing — deciding to go somewhere is `main.ts`'s map
  navigation, which is why this needs four names and all four are the player's record.
- `src/app/panel.ts` — the side panel the original game is played through, the options
  sub-panel that scrolls up over it, and the help overlay. Faithful to `Uovl.pas`, so most
  of it is frame and hit-region matching rather than drawing.
- `src/app/loadingUi.ts` — the loading overlay, the fatal-error screen and `relayout()`: the
  chrome shown when the game is not yet showing the game, and the only code that writes to
  the page outside the canvases.
- `src/app/playerSettings.ts` — the player's own options: subtitle language and the three
  volume buses. Tiny, but read from nearly everywhere and depending on almost nothing, which
  is the shape that costs most while it sits inside `main.ts`.
- `src/app/renderSettings.ts` — what the game is drawn WITH: art tier, render backend, the
  idle-FPS saver, the dev pane. All four are persisted, so they are read in an `init` rather
  than at module scope — `migrateSaves()` has to run first.
- `src/app/gameState.ts` — the live room and how it is being played: `room`, `engine`,
  `activeScript`, `count`, the three playback modes. Exported bindings rather than a bag,
  because these are read 1 237 times and written 74: live bindings make the reads free and
  only the writes go through a `setX`.
- `src/app/persist.ts` — the localStorage save store (solved rooms, scores, records, play time).
- `src/app/cheats.ts` — the typed cheat codes, the sprite/film effects, and the Tetris minigame.
- `src/app/debugHooks.ts` — the `window.__ff` test interface all 85 UI probes read.
- `src/app/glPlumbing.ts` — the per-tier art sources, the WebGL compositors, and the parity probes.
- `src/app/art.ts` — enhanced/`ai` art loading, the room art cache, and the anti-flash hold predicates.
- `src/data/binReader.ts` — little-endian sequential reader modelling Pascal `blockread`.
- `src/data/ffr.ts` — FFR parser (faithful port of `TRoom.Init`, incl. `ReadBitMap`/`ReadBitMapExtra`).
- `src/data/roomTable.ts` — the 72-room `Desc[]` table, auto-generated from `zaklad.pas`.
- `src/render/framebuffer.ts` — indexed 8-bit screen + blitters (`Kresli`/`KresliRev`/`Kresli2`/`KresliR`).
- `src/render/renderRoom.ts` — static room compositor (faithful `TRoom.Priprav` resting frame).
- `src/render/png.ts` — dependency-free RGBA PNG encoder.
- `src/platform/feedback.ts` — what a player's report contains and the three links out (pure).
- `src/app/feedback.ts` — the feedback strip under the Options panel + the form, and why it sits there.
- `tools/gen-room-table.py` — regenerates `roomTable.ts` from the original Pascal.
- `tools/dump-ffr.ts` — M0 verification CLI (parse + size-check a room or all rooms).
- `tools/render-room.ts` — M1 verification CLI (render a room / all rooms to PNG).
- `tools/preview-server.mjs` — the shared `vite build` + `vite preview`-on-a-free-port machinery.
- `tools/dev-server.mjs` — `npm run dev`: the dev server on a free port, printing what it serves.
- `tools/link-node-modules.mjs` — share one `node_modules` between worktrees (opt-in, lockfile-checked).
- `tools/gen-map.mjs` — regenerates the README's `main.ts` map from the `//#region` markers in that file.
- `tools/region-graph.mjs` — measures which of those regions reference which, and reports the largest
  cycle among them: the number that says whether `main.ts` could be split into files at all. `--edges`
  lists every edge inside the cycle with the symbols carrying it. Guarded by `test/region-cycle.test.ts`.
- `tools/capture-digest.mjs` — byte-exact behavioural fingerprint, comparable across git revisions.
  The safety net for the `main.ts` split; read its header for what it does and does not cover.

### Why `main.ts` is mapped instead of split

The map below is a workaround, and it is worth being precise about what for. At the split, twenty of the
file's 32 regions formed a **single strongly-connected component** in the region graph — every one of them
could reach every other, so none could leave the file on its own. `node tools/region-graph.mjs` prints the
component and the edges inside it.

That is what a map is standing in for. A reader has to trust a table and open a 60 k-token file to reach a
200-line region; a directory of modules would describe itself. The knot is thin rather than deep — most of
those edges are carried by a single shared symbol — so it comes apart one small PR at a time, not in one
rewrite. It is **17 regions and 82 edges** today, the frame layer having left with `src/app/frameClock.ts`.

The cycle is not the only thing that kept regions in the file, and measurement said so: 25 k tokens
were already outside it and had stayed anyway, held by **shared mutable state** — 98 top-level `let`s
with 380 region-touches between them. State that only `main.ts` can see has to be handed to every
extracted module one getter at a time, and that tax is what makes extraction cost about as much
plumbing as it moves code. Giving it an owner instead (`screenState.ts` is the first) removes the tax
outright: `ArtHost` lost five of its thirteen members to it without gaining anything, and
`GlPlumbingHost` three of its eight to `gameState.ts`, and forty of `debugHooks`' 149 host
members stopped being needed at all. Shared-state edges between regions: **115 -> 38**.

What that bought is visible in `src/app/framePacing.ts`: 4 200 tokens of pacing left `main.ts`
behind a host of **eight** names. Priced before the state work, the same move cost about a line
of plumbing per line of code relocated.

**Extraction compounds, and that is the useful part.** The cost of extracting a region is the
number of `main.ts`-local names it needs — so every region that leaves removes its names from
everyone else's bill. Moving the stage geometry out (a region needing ONE name) measurably
cheapened fifteen of the twenty-one remaining regions: the cutscene and room construction by
four names each, `loop()` and the frame painter by three. `node tools/region-graph.mjs` prints
the current numbers.

`test/region-cycle.test.ts` holds the current numbers as a ceiling that ratchets down, so a PR that
untangles a seam records it and a PR that re-tangles one has to say so.

### Map of `src/app/main.ts`

`main.ts` is still the largest file in the project — ~5 690 lines, ~61 k tokens — and most changes to this
game land somewhere inside it. This table exists to let you jump straight to the region you need instead of
reading it front to back.

It is a top-level-`await` module: everything below runs at import time, top to bottom, and the ordering is
deliberate (the device gate must precede every side effect; state must be declared before the boot block
awaits it).

**The table is generated.** Each region is declared by a `//#region` marker at its head in `main.ts`; the
line ranges are derived from where those markers sit, so ordinary edits never falsify them. To change a
region's name, anchors or description, edit its marker and run `npm run map:update`. Do not hand-edit
between the sentinels below.

<!-- MAP:main.ts BEGIN — generated by tools/gen-map.mjs, do not edit by hand -->

*33 regions over 4005 lines. Generated from the `//#region` markers in
`src/app/main.ts` — edit a marker there, then run `npm run map:update`.*

| Lines | Region | Anchors — grep these | What lives here |
| --- | --- | --- | --- |
| 1–16 | File docblock | — | The `URoom.pas` tick state machine this file reproduces, and the keyboard scheme. |
| 17–515 | Imports | — | The only part safe to skim. |
| 516–532 | Device gate | `isUnsupportedDevice`, `showUnsupportedNotice` | Phones are refused here, before any art is fetched — and before every other side effect in the file. The stage scaling and the tick constants that used to sit with it are in `stageGeometry.ts`. |
| 533–540 | Stage geometry wiring | `initStageGeometry` | Hands `stageGeometry.ts` its one name and takes the first stage measurement. The scaling itself is in that module. |
| 541–543 | Stage state wiring | `initStageState` | Assembles the stage and loads the persisted subtitle font. The state itself is in `stageState.ts`. |
| 544–546 | Loading UI wiring | `initLoadingUi` | Hands `loadingUi.ts` its one name and installs the boot-failure traps. The overlay, the fatal screen and relayout() are in that module. |
| 547–549 | Intro wiring | `initIntro` | Builds the intro player and probes for the AI movie variants. The movies and the subtitle overlay are in `introOverlay.ts`. |
| 550–555 | Screen & overlay state | `ui`, `hideAiCredits` | The mutable globals for panel/options/credits/map-info/help/leg-image moved to `screenState.ts` — import `ui` from there. Only the credits-overlay restore is left, because it is behaviour, not state. |
| 556–659 | Save store + cheats wiring | `openSaveStore`, `initCheats` | Opens `persist.ts` and hands `cheats.ts` its view of the game, after the gate. |
| 660–684 | Player settings wiring | `initPlayerSettings` | Hands `playerSettings.ts` its two names and loads the persisted options. Subtitle language and the volume buses are in that module. |
| 685–701 | Render settings wiring | `initRenderSettings` | Hands `renderSettings.ts` its one name and loads the four persisted choices. The tier/backend switches are in that module. |
| 702–735 | Art wiring | `initArt` | Hands `art.ts` its view of the game. The art loading itself is in that module. |
| 736–817 | Room launch wiring | `initRoomLaunch` | Hands `roomLaunch.ts` its view of the game. The parchment and the daRun state machine are in that module. |
| 818–864 | Audio & fish selection | `initAudio`, `hooks`, `peekAtPlayer`, `swapActive`, `selectFish` | Builds the AudioEngine (owned by `audioEngine.ts`), the fishing-hook easter egg, and switching which fish is active. The key/constant tables are in `keyTables.ts`. |
| 865–1078 | Room construction | `buildRoom`, `setInfo`, `applySubFont`, `scriptTalk` | Turns parsed FFR data into a live `Room` + `StepEngine`, and refreshes the info line. Room *loading*, audio, movement and drawing are elsewhere. |
| 1079–1572 | Cutscene, showmode, replay | `startCutscene`, `startShowmode`, `advanceShowmode`, `applyCapAction`, `ensureAiKufr`, `drawCutscene` | The KUFRIK demo, the `.cap` demonstration player, record replay, and the cutscene compositor. |
| 1573–1585 | Room load wiring | `initRoomLoad` | Hands `roomLoad.ts` the three names it needs. Fetching a room, arming its voices and starting its music are in that module. |
| 1586–1778 | Movement, replay & restart | `tryStep`, `beginHeldMove`, `dispatchHeldMove`, `wallShove`, `applyRecordStep`, `restore`, `advanceLoadmode`, `restartRoom` | The `KeyRoom` held-key state machine and how a keypress becomes a game step — plus replaying a saved record (`loadmode`) and restarting a room. |
| 1779–1857 | Save/load game | `saveGame`, `loadGame`, `saveExists`, `canSave`, `onWinBookkeeping` | In-room save slots and what happens on a win. |
| 1858–1870 | Panel wiring | `initPanel` | Hands `panel.ts` its three names. The side panel, the options sub-panel and the help overlay are in that module. |
| 1871–1886 | Map drawing wiring | `initMapDraw` | Hands `mapDraw.ts` the four names it needs, all of them the persisted record the map is a view of. The drawing is in that module. |
| 1887–2268 | Map navigation & story screens | `showMap`, `returnFromRoom`, `showLegImage`, `playFirstRunIntro`, `openCredits`, `drawCredits` | Entering/leaving the map, leg-completion pages, intro replay, the credits roll. |
| 2269–2473 | Room entry & fish animation | `enterRoom`, `beginMapLaunch`, `panelAction`, `updateLipSync`, `fishFrameFor` | The map → room transition (incl. the launch parchment), panel button actions, and which sprite frame each fish shows. |
| 2474–2491 | Render plumbing wiring | `initGlPlumbing` | Hands `glPlumbing.ts` its view of the game. The compositors are in that module. |
| 2492–2501 | Frame painter wiring | `initFramePainter` | Hands `framePainter.ts` the two names it needs: which sprite frame each fish shows, and the hook system. The frame itself — all three tiers, both backends, the subtitle overlay — is in that module. |
| 2502–2712 | The logic tick | `step`, `tickBlink`, `hracNespi` | One 80 ms game step: script, engine, dialogue, death handling, screensaver. |
| 2713–2746 | Frame pacing wiring | `initFramePacing` | Hands `framePacing.ts` its view of the game. The idle throttle, the wake rates and the perf HUD are in that module. |
| 2747–2943 | `loop()` | `loop` | The rAF callback: which screen paints, how many logic steps run, when to sleep. |
| 2944–3179 | Keyboard | `keydown / keyup listeners` | Every key binding, including cheats, dev keys and modal handling. |
| 3180–3488 | Pointer | `cellFromEvent`, `clickCell`, `dirToward`, `clickMapAt`, `panelCoords` | Fish selection and click-to-swim target (the pathfinding is in `stepEngine.ts`), map and panel hit-testing. |
| 3489–3498 | Dev bar wiring | `initDevBar` | Hands `devBar.ts` its two names. The room picker, the dev selects and the relayout watchers are in that module. |
| 3499–3663 | Boot | `await FontData.load`, `parseFfp`, `loadSoundPkg`, `loadRoom(7)`, `initFeedback`, `requestAnimationFrame(loop)` | The top-level-await boot sequence, in load order. What is critical vs. optional is documented inline. |
| 3664–4005 | `window.__ff` host | `debugHooks` | The 114-member host the debug hooks read the game through: getters, plus eight setters for the values probes deliberately write. State that has an owning module is imported there directly instead. The hooks themselves are in `debugHooks.ts`. |

<!-- MAP:main.ts END -->

Regions marked **Hot** are the ones recent history keeps returning to: the loading overlay, room load and
the frame pacing. That came from bucketing the diff hunks of the 25 commits before the split by line — a
measurement that cannot simply be re-run now, because those line numbers refer to the pre-split file.
Re-derive it against a commit range that starts after the split, or not at all. If you are budgeting a
change, budget it against the region, not the file.

**Six regions have moved out** and are no longer in the table: the DOM handles (`app/dom.ts`), the save data
(`app/persist.ts`), the cheats and Tetris (`app/cheats.ts`), the `__ff` hook bodies (`app/debugHooks.ts`),
the render plumbing (`app/glPlumbing.ts`) and the art loading (`app/art.ts`) — together about 27 k tokens,
taking `main.ts` from 88 k to 61 k.

### Map of `src/render/`

The renderer is 28 files and ~84 k tokens. (`src/rooms` and `src/app` are larger by total size, but those are 72 independent room scripts and the app shell respectively; this is the one dense area.) The split runs along
two axes at once (which **art tier**: classic / enhanced / `ai`; and which **backend**: CPU or WebGL), which
is what makes it hard to guess where something lives. This table is the shortcut.

Start with `roomWalk.ts` and `artSource.ts`: between them they answer "what is drawn, in what order" and
"what colour is it", and almost everything else is an implementation of one side of that.

| File | tok | What it is |
| --- | --- | --- |
| **The two seams everything else hangs off** | | |
| `roomWalk.ts` | 2.0 k | ONE traversal deciding what is drawn, in what order, at what coordinates — a port of `TRoom.Priprav`. Replayed by both the faithful and the `ai` renderers, so a rule fixed here is fixed for both. |
| `artSource.ts` | 1.2 k | The pluggable seam deciding *what colour / which pixels*. The only thing that differs between the classic and enhanced looks. |
| **CPU compositing** | | |
| `framebuffer.ts` | 4.7 k | The 8-bit palette-indexed screen and the Delphi blitters (`Kresli`/`KresliRev`/`Kresli2`/`KresliR`). |
| `rgbaScreen.ts` | 3.4 k | The same compositing, but keeping a live RGBA plane beside the index plane — the CPU target for the truecolor tiers. |
| `renderRoom.ts` | 4.2 k | The faithful room renderer: entry points, fish frames, the resting-pose compositor. |
| `classicArtSource.ts` | 0.4 k | The 256-colour palette look. |
| `enhancedArtSource.ts` | 3.0 k | The FFNG truecolor look. |
| **The `ai` tier** | | |
| `roomAi.ts` | 12.8 k | The hi-res AI room compositor — the largest file here, and the one whose rules the mutation harness pins. |
| `aiTarget.ts` | 7.4 k | The surface `roomAi` paints onto: the canvas-2D target, plus the water wobble and ripple maths. |
| `worldMapAi.ts` | 1.6 k | The `ai` world map. |
| `panelAi.ts` | 1.7 k | The `ai` control panel. |
| `creditsAi.ts` | 1.8 k | The `ai` end credits (GPU-composited). |
| **WebGL** | | |
| `glScreen.ts` | 10.9 k | The GPU compositor for classic/enhanced, from palette-INDEX art through an MRT colour+index framebuffer. |
| `glRoomAi.ts` | 8.2 k | The GPU compositor for the `ai` tier, from straight RGBA at ×S. Holds `BG_FS`, the water shader `tools/mutate-gl-room-ai.mjs` mutates. |
| `glCommon.ts` | 1.1 k | The WebGL2 plumbing both of the above share. |
| **Screens and chrome** | | |
| `worldMap.ts` | 2.3 k | The branch map (`UMain.pas PaintBox1Paint`). |
| `mapInfo.ts` | 2.1 k | The map's record info panel (krokoměr). |
| `hud.ts` | 2.3 k | The control panel (TOvl): compositing and hit-testing. |
| `credits.ts` | 0.8 k | The scrolling end credits. |
| `help.ts` | 0.6 k | The control-help screens (`Help.pas`). |
| `subtitles.ts` | 5.4 k | Colour mapping, glyph rendering, and the scrolling line. |
| `font.ts` | 0.9 k | The bitmap font from the original `Chars.dat`/`Chartab.dat`/`Charcol.dat`. |
| `tetrisRender.ts` | 1.3 k | The Tetris minigame's picture. |
| `filmEffects.ts` | 1.1 k | Full-frame effects for the `xsilent` and `xinterlaced` cheats. |
| **Assets in and out** | | |
| `pngDecode.ts` | 1.6 k | PNG decoder for the truecolor art path. |
| `png.ts` | 0.5 k | PNG encoder (used by the verification CLIs, not the game). |
| `enhancedDecode.ts` | 0.2 k | Node-only helper to build `EnhancedArt` from PNG bytes. |
| `loadSlot.ts` | 0.5 k | A FIFO gate for asset fetch+decode, so one room's ~190 requests don't stampede. |

Token counts are rounded and will age; they are here to say *which files are big*, not to be exact. The
file list itself is checked by `test/readme-map.test.ts`, so a new module cannot be added without a row.

## Original data

The shipped room data (`0NN.FFR/.FFS/.FFT`, `PANEL.FFP`) is extracted from the GPL
`ffinstallation.exe` using [REWise](https://codeberg.org/CYBERDEV/REWise) — **without executing
the installer**. Expected at:

    ~/.cache/ffng-orig/extracted/MAINDIR/{Graphic,Sound,Title,Menu}/...

Override the location with `FF_DATA_DIR=/path/to/MAINDIR`.

### Intro movies

The startup **intro** (ALTAR logo → intro movie) and the map's top-left "watch intro"
corner play the original `Movie/{logo,intro}.avi` (Cinepak 640×480) as HTML5 `<video>`.
Transcode them once to browser-friendly **H.264 MP4** (into `public/data/Movie/`, which is
gitignored like all game data):

    node tools/build-movies.mjs   # needs ffmpeg on PATH

This writes two variants per movie: **faithful** (`intro.mp4`/`logo.mp4`, a straight
transcode that keeps the original Cinepak look) and **cleaned** (`intro_clean.mp4`, with
the intro globe's ~2 s Cinepak "burst" patched using FFNG's clean frames of the same
footage — no blur). H.264 is used deliberately: it's the one codec that plays in *every*
browser (Safari included), and the video is bundled locally so file size isn't a concern.
Without the MP4s the game simply skips the intro and boots to the map.

See **[tools/MOVIES.md](tools/MOVIES.md)** for the full pipeline, the burst diagnosis, and
the FFNG-splice parameters.

## Credits & license

- **Original game:** *Fish Fillets* (1998) by **ALTAR interactive**. This is an unaffiliated
  fan port; all original assets and trademarks belong to their owners.
- **Game data:** derived from the GPL-licensed **[fillets-ng](https://fillets-ng.sourceforge.net/)**
  data.
- **Fonts:** Mulish / Manrope / Jost (SIL OFL 1.1, licenses in `public/fonts/`); GNU FreeFont
  FreeSans (GPL).
- **This port:** licensed **GPL-2.0-or-later** — see [`LICENSE`](LICENSE).

Full attribution: **[CREDITS.md](CREDITS.md)**.

## Release / deploy

The web build is published to **GitHub Pages** via `.github/workflows/deploy.yml` (build on
a pushed version tag `v*`, then Pages deploy — or run it manually via *workflow_dispatch*). Because `copyPublicDir` is disabled (see `vite.config.ts`),
`tools/stage-pages-assets.mjs` copies `public/*` into `dist/` (dereferencing the `public/data`
symlink) and writes `.nojekyll` before the Pages artifact is uploaded. Optional
**Cloudflare Web Analytics** is injected at build time only when the `CF_BEACON_TOKEN`
secret (→ `VITE_CF_BEACON_TOKEN`) is set; otherwise analytics is a no-op (see
`src/platform/analytics.ts`). The build stamps `__APP_VERSION__` / `__BUILD_HASH__` /
`__BUILD_DATE__` (logged to the console at boot).
