# How the port was built

The milestone log, M0 to M8. It is the record of the order the 1998 engine was translated in, and
what each stage proved before the next one started — the FFR format, then a static frame, then
movement, gravity, pathfinding, subtitles, sound, cheats, and finally the room scripts.

It lived at the top of `README.md` until it was moved here, because it answers *how this was built*
and the README has to answer *what this is* first. Nothing in it has been edited in the move.

See [`README.md`](README.md) for what the project is, [`AGENTS.md`](AGENTS.md) for how to work in
the repo, and [`KNOWN_ISSUES.md`](KNOWN_ISSUES.md) for where the port still differs from the original.

## Milestones

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
  room (`src/audio/music.ts`): the room's `cHud` index maps to a `rybky*` track (the `TDirect.Spust`
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
