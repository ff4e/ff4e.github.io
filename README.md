# Fish Fillets 4ever — Delphi-faithful web port

Faithful web port of the **1998 ALTAR Fish Fillets**, ported line-by-line from the original
Delphi engine source (not the FFNG remake). Published as **Fish Fillets 4ever**.
GPL-2.0-or-later.

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
  (the original re-derives these by re-running `Programky` during a suppressed load replay). `src/core/record.ts`
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
- **Cheat code (`xwemaketherules`, done):** the original room cheat (`URoom.pas:24666` — sets `datcheatu`,
  `konec:=1`, `RoomVysl:=0`). Type `xwemaketherules` while in a room (or call `__ff.cheat()`) to mark it
  solved-by-cheat and jump back to the map: the room still unlocks its successor, but its node shows the
  cheat state rather than a clean solve. Persisted in `localStorage` (`ff.cheated`). `Escape` toggles between
  the current room and the world map.
- **Easter egg (`xscore`, done):** type `xscore` anywhere to open the hidden **SCORE** bonus room (room 72,
  a line-up-the-blocks score puzzle). SCORE is deliberately kept off the world map and out of the endgame, so
  this typed code (matching the original's `x`-prefixed cheats) is the only way in. The **ZAVER** finale
  (room 71) is the counterpart: it auto-launches once all 70 registered rooms are genuinely solved
  (`pustitzaver`, `USoutez.pas:729` → `av:=9`, `UMain.pas:948`).
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
    npm run dev                     # browser host at http://127.0.0.1:5173 (with sound)
    npm run dump-ffr -- --all       # M0: validate all 72 FFR (byte-exact, DFFR sizes)
    npm run render-room -- UTES     # M1: render a room's resting frame -> out/UTES.png
    npm run test-move -- UTES       # headless movement/push probe + render (exploratory)
    npm run test-path -- UTES little  # BFS-drive a fish to a target + render (exploratory)
    npm run dump-fft -- UTES        # list a room's subtitles (CZ + EN)
    npm run typecheck

## Tests

Automated, deterministic, **non-AI** (no LLM/vision at runtime — plain assertions):

    npm test        # unit + physics (Vitest, headless, no browser, no game data needed)
    npm run test:ui # browser/integration (Playwright; auto-starts the dev server)
    npm run test:all # typecheck + unit + UI, in sequence, fail-fast (the full gate)
    npm run test:solutions # replay known FFNG solutions per room (needs $FFNG_DATA)

`npm run test:all` chains `typecheck && test && test:ui` — the one command to run before
considering a change done (it stops at the first failing phase).

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
- **`npm run test:ui`** (`tools/test-*.mjs`, 17 tests): the HUD (render + hit-test + button dispatch), the
  world map (compositing + node hit-test + branch unlock + navigation), the map/room **audio lifecycle**
  (menu music, `KillSnd` + dialogue-clear on leaving), per-room music, the fixed-timestep clock + dialogue
  pacing, lip-sync heads, save/restart determinism, the faithful **input map** (arrow keys move the active
  fish, Space swaps, 1/2 select, right-click steps toward the cursor, click-select is silent), **exit/win**
  (both fish out → solved → recorded in the progression), the **`xwemaketherules` cheat** (typed in a room or
  `__ff.cheat()` → returns to the map, records the room as cheat-solved, still unlocks the next room),
  **SCHODY**/**KNIHOVNA** end-to-end smoke tests (each room's Programky runs many ticks against real game data
  without error), the **ambient idle chatter** (`StdKecej` — the x03 bank loads, a chatter timer exists in
  ported and unported rooms, and forcing it due speaks a line), and the **death model** (`StdSmrt` — a lone
  death keeps the survivor playing + speaks a line; both dead auto-restarts). Each drives the app through the
  deterministic `__ff` debug hooks and hard-fails on any bad assertion or console error. (The per-room music
  test decodes a ~5 MB WAV and can flake under machine load — re-run in isolation.)


## Layout

- `src/data/binReader.ts` — little-endian sequential reader modelling Pascal `blockread`.
- `src/data/ffr.ts` — FFR parser (faithful port of `TRoom.Init`, incl. `ReadBitMap`/`ReadBitMapExtra`).
- `src/data/roomTable.ts` — the 72-room `Desc[]` table, auto-generated from `zaklad.pas`.
- `src/render/framebuffer.ts` — indexed 8-bit screen + blitters (`Kresli`/`KresliRev`/`Kresli2`/`KresliR`).
- `src/render/renderRoom.ts` — static room compositor (faithful `TRoom.Priprav` resting frame).
- `src/render/png.ts` — dependency-free RGBA PNG encoder.
- `tools/gen-room-table.py` — regenerates `roomTable.ts` from the original Pascal.
- `tools/dump-ffr.ts` — M0 verification CLI (parse + size-check a room or all rooms).
- `tools/render-room.ts` — M1 verification CLI (render a room / all rooms to PNG).

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
