# Map of the source

Navigation maps for the two dense directories, plus the top-level layout. Their whole value is that
you can trust them enough to open one file instead of reading a directory, so
[`CONTRIBUTING.md`](CONTRIBUTING.md) makes keeping them honest a rule and
`test/readme-map.test.ts` makes it a failing test: nothing listed that is gone, nothing present that
is unlisted.

The two directory tables are moved out of `README.md` unedited; the layout above was rewritten,
because the version in the README had drifted (see the commit that moved it).

## Layout

Where things are, one line per directory. The two dense ones have their own tables below; the
others are small enough to read.

- **`src/app/`** — the app shell: everything between the browser and the game — boot, the frame
  loop, every screen, all input. 44 modules, **[mapped below](#map-of-srcapp)**. `main.ts` is the
  composition root and no longer the place to start.
- **`src/render/`** — the renderer, along two axes at once (art tier × backend).
  **[Mapped below](#map-of-srcrender)**.
- **`src/core/`** — the game itself, as pure logic with no browser in it: `room.ts` (push physics,
  gravity, pathfinding — the port of `posun_objekt`/`padani`/`najdi_smer`), `stepEngine.ts` (one
  step, shared by the app and the solvability net), `script.ts` (the room-script runtime),
  `record.ts`, `tetris.ts`, `chatter.ts`, `deathlines.ts`.
- **`src/data/`** — the original file formats, ported reader by reader: `binReader.ts` (a
  little-endian sequential reader modelling Pascal `blockread`), `ffr.ts` (rooms — a faithful port
  of `TRoom.Init`, incl. `ReadBitMap`/`ReadBitMapExtra`), `fft.ts` (subtitles), `ffp.ts` (the
  panel), `bmp.ts`, `winPalette.ts`, `world.ts`, and `roomTable.ts` — the 72-room `Desc[]` table,
  generated from `zaklad.pas`.
- **`src/rooms/`** — 74 independent room scripts, one file per room. Large in total; a change
  touches one file.
- **`src/audio/`**, **`src/intro/`** — sound packages and playback; the intro and briefcase
  cutscene players.
- **`src/platform/`** — the two things that talk to the outside world: `feedback.ts` (what a
  player's report may contain, and the three links out — pure) and `analytics.ts`.
- **`tools/`** — the CLIs and harnesses. `dump-ffr.ts` / `render-room.ts` are the M0/M1
  verification CLIs; `gen-room-table.py` regenerates `roomTable.ts` from the original Pascal;
  `dev-server.mjs` and `preview-server.mjs` are the free-port dev and build servers;
  `link-node-modules.mjs` shares one `node_modules` between worktrees (opt-in, lockfile-checked);
  `strip-unused.mjs` deletes the imports a file no longer uses; `region-graph.mjs` measures which
  `//#region`s of `main.ts` reference which; `capture-digest.mjs` is the byte-exact behavioural
  fingerprint, comparable across git revisions — read its header for what it does and does not
  cover; `mutate-*.mjs` are the mutation harnesses ([`TESTING.md`](TESTING.md)).
- **`test/`** — the unit and integration suites; **`test/ui/`** the browser probes. See
  [`TESTING.md`](TESTING.md).

### Map of `src/app/`

The app shell: everything between the browser and the game. It used to be one file — `main.ts`
was 5 897 lines and ~64 k tokens, and this section held a table of its line ranges, because
that was the only way to open a part of it without reading the whole. That table is gone: the
file is 44, and you find code by name now.

`main.ts` is still the biggest thing here, and it is deliberately what is left over — the
composition root. It declares the state that has no better owner yet, wires each module its
handful of names at boot, and holds the two input routers (keyboard and pointer), which touch
almost every subsystem and so cost more to move than they save. It is a top-level-`await`
module and the ordering is load-bearing: the device gate must precede every side effect, and
`migrateSaves()` must precede any `ff.*` read. **An imported module is evaluated before any
statement of its importer** — which is why every module here keeps module scope inert and does
its real work in an `initX()` that `main.ts` calls at the point the code used to run.

`//#region` markers still divide `main.ts`, and `node tools/region-graph.mjs` still measures
what depends on what. What is gone is the promise to keep a line-number table honest.

Sizes are characters / 4, the same rough token meter the `src/render/` map below uses.

| File | tok | What it owns |
| --- | --- | --- |
| **Composition and state** | | |
| `main.ts` | 19.1 k | The composition root: the leftover state, the boot-time wiring of every module below, and the keyboard and pointer routers. |
| `boot.ts` | 2.5 k | The boot sequence in load order — fonts, panel and map graphics, sound packages, room 7, first frame. |
| `deviceGate.ts` | 1.4 k | What kind of device this is: refusing to run on a phone, and the player's "continue anyway" override. Runs before every side effect. |
| `orientation.ts` | 1.1 k | Which way up a phone has to be held for what is on screen. Pure numbers; nothing here touches the DOM. |
| `touchMode.ts` | 0.9 k | Whether the game is being played by touch, and the dev override that lets a desktop pretend it is. |
| `dom.ts` | 1.3 k | The element handles and their 2D contexts. |
| `helpDom.ts` | 2.4 k | The control-help pages (`Help.pas`) as a document: builds `src/data/helpText.ts` into DOM over #screen and scales it to the stage box. |
| `gameState.ts` | 2.6 k | The live room and how it is currently being played. Live bindings plus setters, because of the 1 237 references only 74 are writes. |
| `screenState.ts` | 1.9 k | Which screen is showing, and everything layered over it. A mutable bag — the reads are many and the shape is flat. |
| `stageState.ts` | 0.8 k | The subtitle font in use and whether it loaded, plus `booted`. |
| `persist.ts` | 2.5 k | Everything kept in localStorage: solved, cheated, scores, saves, and the migration. |
| **The frame** | | |
| `frameClock.ts` | 1.6 k | When the next frame happens, and at what rate. |
| `paintClock.ts` | 0.4 k | The paint-rate cap, kept pure so it can be tested against synthetic refresh trains. |
| `framePacing.ts` | 5.7 k | Whether the next frame must be painted at all, and the perf HUD's counters. |
| `renderLoop.ts` | 3.7 k | The rAF callback: which screen paints, how many logic steps run, when to sleep. |
| `rotatePrompt.ts` | 1.2 k | The "turn your phone" overlay, derived once per frame from the screen, the room and the viewport. |
| `framePainter.ts` | 3.5 k | One room frame, all three art tiers, both backends. |
| `logicTick.ts` | 3.0 k | One 80 ms game step: script, engine, dialogue, death, screensaver. |
| **Playing a room** | | |
| `movement.ts` | 2.6 k | The held-key state machine, and replaying a saved record back into a room. |
| `roomGates.ts` | 0.5 k | May the room accept a command at all — `idle`, `atRest`, `fishBusy`. |
| `roomLoad.ts` | 4.2 k | Fetching a room, arming its voices, starting its music — and the order that keeps audio behind art. Owns the two post-art entry holds and their composition, `roomEntryHeld()`. |
| `roomPreload.ts` | 2.4 k | What a room's PLAY can demand beyond its art and sound — KUFRIK's briefcase cutscene, the leg story page — fetched on entering it, and held for. Plus the unheld `niceToHave` warm of ZAVER, which is the rule's one deliberate exception. |
| `roomLaunch.ts` | 4.0 k | The room-entry parchment and the launch it belongs to. |
| `keyTables.ts` | 0.6 k | Which key moves which fish, the minigame's key map, which panel region each touch button sends, and two constants the room scripts read. |
| **Screens** | | |
| `mapNav.ts` | 4.6 k | On and off the world map; the leg story pages, the first-run intro and the credits roll. |
| `mapDraw.ts` | 3.8 k | Drawing the world map: the branch map, the room-name plaques, the record panel. |
| `panel.ts` | 2.9 k | The side panel the game is actually played through, plus the options sub-panel and help. |
| `touchButtons.ts` | 1.3 k | The in-room touch bar: five buttons, every one dispatched through the panel's own `panelAction` table. |
| `touchSwipe.ts` | 1.6 k | Swipe to move: a finger drag on the room is delivered as a held arrow key, so every guard the keyboard has applies unchanged. |
| `cutscene.ts` | 6.2 k | The KUFRIK demo, the intro/ending movies and the recorded-solution replay. |
| `solveMode.ts` | 2.2 k | Dev-only `solvemode`: the room plays itself from its own recorded solution through the real loop, speaking and recording normally, and aborts loudly on death / a blocked move / moves exhausted / a stall. |
| `intro.ts` | 1.2 k | Intro-movie playback. |
| `introOverlay.ts` | 1.2 k | The logo and intro movies, plus `aiSubScale` (how much smaller the `ai` tier draws its subtitles). |
| `loadingUi.ts` | 2.3 k | The loading overlay, the resize handler, and where an asset failure is turned into a surface — the fatal screen, the note or nothing, chosen by the asset's TIER. The screen is generic (its one action is Reload whichever file broke); the asset's name goes to the log. Only absence BY DESIGN still falls back quietly. |
| `loadNote.ts` | 1.2 k | The `shouldHave` tier's surface: a non-blocking note in the `#notes` rail with Try again and Dismiss, for a load the game can continue without but the player would otherwise be misled about. |
| `subtitleDom.ts` | 5.0 k | Subtitles as DOM text, animated by the compositor — the renderer for every tier that does not bake them, one layer each for the room and a cutscene. |
| **Art, audio and settings** | | |
| `art.ts` | 5.8 k | Which room's art is loaded, what has been remembered about it, and whether the frame is still holding for it. |
| `enhancedLoad.ts` | 1.1 k | Fetching and decoding one room's enhanced art. A pure function of a room name — it remembers nothing. |
| `glPlumbing.ts` | 4.2 k | The per-tier art sources and the two WebGL compositors. |
| `audioEngine.ts` | 0.3 k | Who owns the `AudioEngine`. |
| `renderSettings.ts` | 2.0 k | What the game is drawn WITH — the four persisted choices: art tier, backend, idle-FPS saver, developer pane. |
| `playerSettings.ts` | 1.2 k | The player's options: subtitle language and the three volume buses. |
| `layout.ts` | 2.2 k | Display layout and scaling. |
| `stageGeometry.ts` | 2.2 k | How big the game is drawn, and the constants the simulation is timed by. |
| `cheats.ts` | 6.2 k | The typed codes, the effects they switch on, and the Tetris minigame. |
| `showmodeHolds.ts` | 1.1 k | Pauses lengthened by hand in the KUFRIK demonstration — its only deviation from the 1998 recording. |
| **Development** | | |
| `debugHooks.ts` | 18.6 k | `window.__ff`, the debug/test interface the UI probes drive the game through. |
| `devBar.ts` | 1.4 k | The developer bar, and the relayout watchers. |
| `feedback.ts` | 2.9 k | The player feedback affordance and form. |

### Map of `src/render/`

The renderer is 32 files and ~102 k tokens. (`src/rooms` and `src/app` are larger by total size, but those are 72 independent room scripts and the app shell respectively; this is the one dense area.) The split runs along
two axes at once (which **art tier**: classic / enhanced / `ai`; and which **backend**: CPU or WebGL), which
is what makes it hard to guess where something lives. This table is the shortcut.

Start with `roomWalk.ts` and `artSource.ts`: between them they answer "what is drawn, in what order" and
"what colour is it", and almost everything else is an implementation of one side of that.

| File | tok | What it is |
| --- | --- | --- |
| **The two seams everything else hangs off** | | |
| `assetFetch.ts` | 1.4 k | The one door to the network, and what "this asset did not load" MEANS: absent (an answer, cache it) vs failed (no answer, never cache it). `requiredAsset` / `optionalAsset` make the policy an argument at every call site; `test/asset-fetch-discipline.test.ts` fails the build for a bare `fetch(` anywhere else. |
| `enhancedObjects.ts` | 1.1 k | One room's enhanced object sprites, whole-object-or-nothing — the frame list is indexed by animation phase, so a gap is the wrong picture, not a missing one. |
| `zxBands.ts` | 0.9 k | The gspec=42 ZX loading stripes: the band height per frame and the colour per native row. Shared by the faithful and `ai` renderers, because generating the sequence ADVANCES it. |
| `roomWalk.ts` | 2.0 k | ONE traversal deciding what is drawn, in what order, at what coordinates — a port of `TRoom.Priprav`. Replayed by both the faithful and the `ai` renderers, so a rule fixed here is fixed for both. |
| `artSource.ts` | 1.2 k | The pluggable seam deciding *what colour / which pixels*. The only thing that differs between the classic and enhanced looks. |
| **CPU compositing** | | |
| `framebuffer.ts` | 4.7 k | The 8-bit palette-indexed screen and the Delphi blitters (`Kresli`/`KresliRev`/`Kresli2`/`KresliR`). |
| `rgbaScreen.ts` | 3.4 k | The same compositing, but keeping a live RGBA plane beside the index plane — the CPU target for the truecolor tiers. |
| `renderRoom.ts` | 4.2 k | The faithful room renderer: entry points, fish frames, the resting-pose compositor. |
| `indexedRegion.ts` | 0.5 k | Blits a rectangle of indexed art onto a 2D context, nearest-neighbour, at an arbitrary scale — how the briefcase cutscene's `"model": "original"` frames play inside the upscaled scene. |
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
| `creditsAsset.ts` | 0.9 k | Loads a credits image (lossless WebP, 19.7x smaller than the BMP) and rebuilds its palette indices, so `credits.ts` stays index-exact and unchanged. Throws on a colour outside the palette rather than mis-indexing it. |
| `subtitleGeom.ts` | 3.8 k | The geometry a vector subtitle line is built from — fit-to-room size (one per message, not per row), wave phase and curve, baseline and amplitude, stroke and bevel, the split that lets the text be scaled from the stage while the room is scaled to fit, and the readable band the font size is held inside. Pure and import-free, so the renderer and the tick logic both measure from it and it is unit-tested. |
| `subtitles.ts` | 3.4 k | Colour mapping, glyph rendering, and the scrolling line. |
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
