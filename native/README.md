# Native host (macOS today; tvOS and Xbox are the point)

> **Experimental. Not shipped, not part of the web or iOS build, and `src/` does not depend on
> it.** Nothing under `native/` is imported by the game; it only imports *from* `src/`. CI
> builds it (the `native-macos` job in `.github/workflows/checks.yml`, on pull requests and
> on main) so a change in `src/` that breaks the native bundle is visible, but no release
> consumes it.

The game **without a browser**. It plays a whole game now — from the world map, room after
room, with undo, saves, the record panel's Replay, the leg story pages and the subtitles —
on the AI-upscaled tier, without menus or sound yet:

- **QuickJS-ng** runs the game's own TypeScript. Nothing is ported: the room, its script and
  the step engine (`src/core/`), the AI-tier room walk (`src/render/`), and the game's own
  flow from `src/app/` — `roomLoad` enters a room, `logicTick.step` is the 80 ms game step,
  `movement`'s held-key state machine turns keys into moves, `undo` takes them back,
  `persist` keeps the solved rooms, scores and best records.
- **SDL3** provides the window, the keyboard, the gamepad and the GPU.
- The AI tier's `AiTarget` seam (`src/render/aiTarget.ts`) is implemented on **SDL GPU**
  (`native/js/nativeAiScreen.ts`, `native/host/shaders.metal`). That is the one thing a
  native host has to own.
- The screens around the room — the world map with its record panel, name plaques,
  room-entry parchment and selection ring, and the story pages — draw through `Surface2D`
  (`src/render/surface2d.ts`), which is implemented on **SDL GPU** too
  (`native/js/nativeSurface.ts`, `fs_surf` in `native/host/shaders.metal`): see
  "The world map" below.
- The subtitles are drawn natively too, through `Surface2D` with glyphs from FreeType: see
  "Subtitles" below.
- The off-screen canvases the AI tier builds — the classic-sprite fallback for art with
  no AI file, the mirror's glass mask, LODE's wreck — come from an injected factory
  (`src/render/scratchCanvas.ts`). The browser keeps `document.createElement('canvas')`;
  this host injects `native/js/nativeCanvas.ts`, a CPU buffer that implements only the
  2D calls those canvases make, and rounds translucent pixels through Chromium's
  premultiplied storage exactly as the browser's canvas does (without that, room 9's
  mirror is off by one on three pixels).

SDL GPU drives Metal on macOS and tvOS, and D3D12 on Windows and Xbox (GDK). So this
same host is the shape of an Apple TV build and an Xbox build.

### How the browser's flow runs without the browser

`src/` is not changed for the native host and does not know about it. The flow modules
above are bundled as they are; the handful of modules they import that reach the document,
Web Audio or the page layout are swapped, at bundle time, for a module of the same name in
`native/js/seams/` — the move the unit tests make with `vi.mock`, made once for the whole
bundle by an esbuild plugin in `native/build-js.mjs`. Each seam is typed against the module
it replaces (`typeof import(...)`), so `npm run typecheck:native` catches a changed
signature, and the constants it restates are checked against the real literal types.

The swap is fenced. `build-js.mjs` keeps an allowlist of the `src/app/` modules the native
host runs for real, and fails the build when anything else from `src/app/` reaches the
bundle — so a `src/` change that adds an edge from the flow into the DOM shell breaks this
build loudly instead of shipping a module that throws on its first `document`.

What `src/app/main.ts` owns and does not export is restated in `native/js/game.ts`, the
native composition root: building a room (`buildRoom`), the save slots
(`saveGame`/`loadGame`), the win bookkeeping, the room part of the keyboard router, and the
frame loop's step (`renderLoop.ts`'s one-step-per-frame rule); a few seams restate small
functions too. Each copy carries a `restates <file> \`<anchor>\` @ <hash>` marker, and
`test/native-restated.test.ts` hashes the source span it names (comments and spacing
ignored): any change to the source fails `npm run test` until the copy has been re-read
against it and the pin updated — the failure prints the new hash.
`localStorage` is a JSON file the host owns (`--store FILE`, by default `store.json` in the
user's app-support directory — `~/Library/Application Support/ff4e/Fish Fillets 4ever/` on
macOS), so progress and save slots use the browser game's keys and format. Each write is
flushed to disk before it replaces the store, and the previous store is kept as
`store.json.bak`. A damaged store falls back to the backup; with both damaged the game
refuses to start and says so, rather than run without saving or overwrite them.

A session starts on the world map (or in `--room N`), and every room is left back to it the
way the browser leaves one: a win goes to the map — through the leg's story page when the
room ends a leg, into ZAVER when that win finishes the game, and through the closing page
after ZAVER — the end of a Replay goes to the map, and so does Escape (Ⓑ). `showMap` and
`returnFromRoom` (`mapNav.ts`), the story pages and the record panel's buttons
(`main.ts`'s `clickMapAt`) are restated in `game.ts` and `mapScreen.ts`, pinned like the
rest.

`--demo` (and the smoke gate) keep the old map-less order instead: a solved room leads to
the lowest-numbered room above it that the map would offer (reachable by the map's own
unlock rule, `computeResena`, and not yet solved), else the lowest-numbered such room; with
every registered room solved, the finale (ZAVER); after ZAVER the run ends. A finished game
(ZAVER solved too) goes on room by room in number order, from room 1.

### The world map (`native/js/mapScreen.ts`)

The picture is the browser's: `src/render/mapPaintAi.ts` paints one `ai` map frame through
`Surface2D` from state the caller hands in, and both `src/app/mapDraw.ts` and the native
map screen call it (`test/dom-free.test.ts` keeps it, and everything it imports, off the
page). The native `Surface2D` holds premultiplied colour in an RGBA8 render target, as a
canvas does, decodes images premultiplied with the canvas's rounding, keeps the canvas's
state (axis-aligned transform, alpha, smoothing, blend, save/restore) in JS, and hands the
host quads, which it batches: one vertex upload and one render pass per run of draws into
a target, with clears, uploads and readbacks ordered among them on the frame's command
buffer.

What replaces the pointer is the controller spec's (A3 "World map", "Record panel"; the
geometry is `src/render/mapSelection.ts`, from the Xbox branch, #165):

- a selection always exists — a room node a click could reach — shown with its name plaque,
  as a hover shows it, and a ring (opaque pixels only, so it is drawn identically
  everywhere);
- a direction moves it to the nearest target that way, one step on the press, a repeat
  after 340 ms, then every 140 ms (`native/js/dirRepeat.ts`); a stick engages at 0.5 of its
  travel and lets go below 0.35;
- Ⓐ opens it: a solved or cheated room's record panel, or an unsolved room — launched as
  the original does, with one frame of the map unlit under the plaque and the parchment,
  which stays in the window while the room loads;
- in the panel, left/right cycle Run → Replay → Cancel (Replay skipped with no record), Ⓐ
  presses, Ⓑ closes; Run or Replay of a solved leg-final room shows the leg's story page
  first, and any button continues from it;
- Ⓑ on the plain map does nothing, on purpose; the default selection is the room last
  played if it is still selectable, else the first room not yet solved.

The corner buttons (Intro, Credits, Options, Exit) are not selectable yet: none of their
screens exists natively, and a target that does nothing is worse than none
(`NATIVE_CORNERS`). The story pages are the upscaled ones (`/enhanced-ai/_story/`).

### Subtitles (`native/js/subtitleLayout.ts`, `subtitleDraw.ts`, `roomSubtitles.ts`)

Native only: the web keeps its DOM subtitles (`src/app/subtitleDom.ts`), unchanged.

What is said, and where its rows are, is the game's own and shared: the talk hook puts each
line into the room's `SubtitleSystem` (`src/render/subtitles.ts`) exactly as the browser's
`scriptTalk` does — in the player's language, nothing during a Replay — and `logicTick.step`
scrolls and expires the rows. That system wraps the text against the original bitmap font
and resolves the speaker's colour; `src/render/subtitleGeom.ts` holds every rule the vector
renderer measures from (size, readable band, fit-to-room, baseline, wave, stroke, bevel).
Both are imported, not restated.

`subtitleLayout.ts` restates the part of `syncDomSubtitles` that composes those rules — its
desktop branch (a TV is neither a phone nor a tablet): the font size held in the band, one
fit per message decided when its rows first appear, the glyphs laid out one advance at a time
and centred, the baseline, the wave as the compositor runs it (`waveDy` sampled into 25
keyframes and interpolated), the bevel placed as the CSS gradient lands on the fill span, and
the `ai` tier's shrink about the layer's bottom centre. In the web renderer that arithmetic is
welded to DOM mechanics (a hidden span measures, `text-align` centres, Web Animations wave,
a CSS transform shrinks), so it is pinned rather than shared: `test/native-restated.test.ts`
fails on any change to `syncDomSubtitles` until the copy is re-read. A unit test
(`test/native-subtitle-layout.test.ts`) holds the copy to `subtitleGeom`.

`subtitleDraw.ts` draws that layout with `Surface2D.fillMask` — a quad whose texel alpha is
coverage, filled with a colour — the one operation added to the interface for it. Each glyph is
two coverage masks from **FreeType** (`native/host/text.c`): the glyph, and the glyph with the
outline `-webkit-text-stroke` paints under it (its stroker, centred, Skia's miter limit). They
are rasterised at the size they are shown at, the pen kept to a quarter pixel, and cached in an
atlas; the outline goes down in `rgb(5,5,12)`, then the fill one colour per device row (the
bevel is a vertical gradient), glyph by glyph as the browser layers them. FreeType rather than
stb_truetype because the faces are variable fonts drawn at weight 500 and stb_truetype draws
only a font's default instance (Mulish's is a hairline 200); FreeType 2.15.0 is fetched and
pinned by SHA-256 like the other dependencies, built without its optional libraries.

In the game the layer is laid out for the rect the window shows the room in (`presentRect`):
the room's on-screen box, the text sized from a stage that is the whole window (no panel, no
margins: `computeStageScale`), at one texel per window pixel, and `present(overlay)` draws it
over the room. The subtitle language and on/off are the browser's `ff.options` from the store,
defaulting as the browser does on a device that is not a desktop: Czech on a Czech system
(`locale`), else English. The face is `ff.subfont`, the browser's pick, Mulish by default.
There is no way to change either natively yet (the Options screen is not built).

Approximate by nature, against the browser's own shaping and scaler — see
`compare-subs.mjs` below for how close, and how a wrong one is caught. Also not reproduced:
the browser eases a row's 2 px scroll over a tick (a CSS transition); natively a row steps,
and the wave runs on the game's clock plus the frame's fraction of a tick rather than on the
compositor's.

## Build and run (macOS, Apple silicon)

    brew install cmake ninja
    npm run typecheck:native                                   # native/js against current src/
    node native/build-js.mjs                                   # -> native/build/game.js
    cmake -S native -B native/build/cmake -G Ninja -DCMAKE_BUILD_TYPE=Release
    ninja -C native/build/cmake                                # QuickJS-ng, SDL3, libwebp, FreeType
    native/build/cmake/ff4e-native native/build/game.js --root public --room 3

CMake fetches and builds the four C dependencies at pinned versions (QuickJS-ng v0.17.0,
SDL 3.4.20, libwebp 1.6.0, FreeType 2.15.0), each from a source archive checked by SHA-256,
statically. A clean configure and build
takes under a minute. Nothing from Homebrew but the build tools is used, so a package
upgrade cannot change the pixels `compare.mjs` checks.

Controls, keyboard and gamepad (SDL maps any supported controller to this layout; the
gamepad is turned into the same key codes in `native/host/main.c`, so there is one stream
of keys, read by the room's router in a room and by the map's on the map):

| in a room | keyboard | gamepad |
| --- | --- | --- |
| little fish | `I` `J` `K` `L` | d-pad, left stick |
| big fish | `W` `A` `S` `D` | right stick |
| active fish | arrows | |
| switch fish | Space, Tab (`1`/`2` select) | Ⓐ |
| undo one move | `-` (the character, wherever the layout puts it) | Ⓨ |
| restart the room | Backspace | Ⓧ |
| save / load | F2 / F3 | LB / RB |
| back to the map | Esc | Ⓑ |

| on the map | keyboard | gamepad |
| --- | --- | --- |
| move the selection | arrows, `IJKL`, `WASD` | d-pad, either stick |
| open (panel / launch) / press a panel button | Space, Enter | Ⓐ |
| close the record panel | Esc | Ⓑ |
| continue from a story page | any key | any button |

Close the window to quit.

Other flags:

- `--room N` starts in room N instead of on the map.
- `--demo` plays every room's recorded solution through the real loop (the browser's
  dev-only `solvemode`) instead of reading input: the game plays itself, room after room,
  from where the store says the player left off.
- `--seconds N` quits after N seconds.
- `--store FILE` keeps progress and save slots in FILE instead of the user's.

From a Rosetta shell, prefix the commands with `arch -arm64`, or the universal tools
build x86_64.

## Does it play? The smoke gate (`native/js/smoke.ts`)

    native/build/cmake/ff4e-native native/build/game.js --root public --headless \
      --smoke all --smoke-player 13,70 --store native/build/smoke-store.json

Every room with a recorded solution (70 of 72: ZAVER and SCORE are the ending and the
results screen) is entered through `roomLoad` and played through `solvemode` — every tick of
the real `logicTick.step`, the moves through the real `tryStep`, the win through the real
auto-return — and must be left by a win, with `ff.solved` on disk saying so. Rooms 13
DRAKAR1 and 70 DISKETA, two that carry script state through undo, are also TYPED key by
key through the router the keyboard and the gamepad use, with a save (F2), two undos, a load
(F3) and an undo into the loaded history on the way, each landing checked against the
record it must land on, and then finished: 72 runs. One frame per room is drawn from the
real flow's state. `--store` is required and wiped: a smoke run never touches the player's
progress. `--smoke-out DIR` keeps those frames, and the subtitles on screen at that moment as a
1280×720 window would show them (`-subs.rgba`): the smoke runs the subtitles too — every line
the rooms say goes through the real `SubtitleSystem`, and each drawn frame lays them out and
rasterises them.

Each run starts as it would alone — Math.random seeded per room, the chatter history, blink
state and the room's solved flag put back to rest — so `--smoke N` (or `--smoke-player N`)
reproduces what `--smoke all` reported for room N.

~25 s locally, ~40 s on CI, which runs it in the `native-macos` job before the parity sweep.

The map has a smoke gate of its own (`native/js/mapSmoke.ts`, `--smoke-map --store F`): the
map driven key by key through the real flow — a fresh session opens on the map with room 1
selected, Ⓑ does nothing, Ⓐ launches it, its win comes back with it still selected, a
direction moves the selection, the record panel opens on Run and cycles Run → Replay →
Cancel, Ⓑ closes it, Replay plays the best record and comes back, a leg-final room's win
and its Run both show the story page, and Ⓑ in a room goes back to the map. 21 checks, a
few seconds; CI runs it after the room smoke.

## Is it the same picture? `native/compare.mjs`

    node --import tsx native/compare.mjs --rooms 1,3,10      # or --all for the 72 rooms

This renders the same scene state twice and diffs the two ×S composites:

- through the browser's real `GlAiScreen` (WebGL2, Chromium), via `native/reference.html`;
- through the native host.

The scene is `native/js/scene.ts`: a fixed, headless state built from `src/core/` and
`src/render/`, the same on both sides — not the native game's flow, which needs the seams
and so cannot run in the browser reference. The frame description both sides draw is the
game's (`native/js/frame.ts`, shared with `game.ts`).

It checks three states per room:

- **still**: every primitive except the water wave.
- **wobble**: the per-fragment water at a sub-tick time.
- **played**: after 240 ticks of the room's recorded solution.

For the comparison to be fair, `Math.random` is pinned on both sides (`pinRandom`). Room
scripts draw from it, and V8 and QuickJS have different generators.

It exits non-zero on any differing frame, on a missing or short composite, on a native run
that takes over 60 s, and on any native failure not listed in `KNOWN_GAPS`. That list is
keyed by room and case and is empty today; each entry names the error the failure must
carry. A known gap that starts rendering identically also fails, so the list has to be
updated with the fix. Differing frames leave `-native`, `-webgl` and `-diff` PNGs in
`native/build/compare/`.

Current result: **72 of 72 rooms byte-identical** in all three states: all 216 frames.
CI runs `--all` on a hosted macOS runner, whose Metal device gives the same bytes.

The spike was written at 68/72. Room 56 CHODBA left the list when `scene.ts` stopped
restating `fishFrameFor` and imported the game's: at tick 240 CHODBA is dark, and the
restated copy had no darkness case, so both sides drew a lit idle fish there and agreed
on a wrong picture. The game draws a dark silhouette, which the native host could not
draw until the scratch-canvas factory landed: rooms 9, 56, 68 and 72 healed with it.
Room 66 ZX joined when `backgroundZx` (gspec=42) was ported: the same background pass as
every other room, with the wall's silhouette taking its loading-stripe colour from a
one-texel-per-native-row band texture, as `GlAiScreen` does.

## Is it the same map? `native/compare-map.mjs`

    node --import tsx native/compare-map.mjs                  # or --cases fresh,panel

Eight states of the `ai` world map (`native/js/mapScene.ts`), each painted by
`paintAiMap` twice — on a plain 2D canvas in Chromium, as the browser's `#screen` is, and on
the native GPU `Surface2D` — from the same art, loaded through one reader
(`native/js/mapArt.ts`), and diffed.

`src/render/surface2d.ts` says which paths a GPU can match byte for byte (nearest draws at
any integer scale, opaque blits and uploads, a binary destination-in mask) and which only
approximately (smoothing, a fractional alpha, a partial-alpha upload). Cases built from the
first are gated at Δ0. The rest must be byte-identical outside the region only their
approximate path draws, and inside it within Δ2 on at most 0.5% of the frame — just above
what is measured — so a regression in what only they draw still fails. An unknown `--cases`
name fails too. Current result:

| case | what it covers | result |
| --- | --- | --- |
| fresh | base map (lit-region mask), reachable balls | identical |
| progress | lit paths, solved/cheat/pulsing balls, corner hover, upscaled plaque, selection ring | identical |
| native-plaque | the 640×480 overlay scaled ×4 nearest | identical |
| panel | unlit map, record panel art, hovered Run, settled odometer, plaque | identical |
| panel-rolling | the odometer mid-roll, hovered Replay | identical |
| launch | unlit map, plaque, parchment | identical |
| panel-noreplay (approx.) | the disabled Replay's 0.55-alpha wash | identical in practice |
| panel-zoomed (approx.) | the phone's enlarged panel: smoothed mask, partial-alpha shadow, ×1.5 | max Δ 1 on 0.2% of pixels |

The enlarged panel is a phone's and never drawn natively; it is there because it is the
one place the interface's approximate paths are all used. CI runs the comparison after the
room sweep.

The story pages are one opaque nearest blit of the upscaled page — the exact path — and are
not compared separately.

## Is it the same text? `native/compare-subs.mjs`

    node --import tsx native/compare-subs.mjs                  # or --cases wave,retina
    node --import tsx native/compare-subs.mjs --self-test      # the gate must catch wrong frames

Seven subtitle states (`native/js/subtitleScene.ts`): a room's palette and screen, lines from
the game's subtitle files said at given ticks, shown at a given tick in a 1280×720 window. Each is
built by the game's `SubtitleSystem` and drawn twice — by the browser's real renderer,
`syncDomSubtitles`, in its real layer (`native/subs-reference.html`, screenshotted, every
wave animation paused at the case's tick), and by the native one into a GPU surface — over a
mid grey, so the dark outline counts.

Text from two rasterisers is never byte-identical (CoreText draws the browser's, FreeType the
native host's; Chromium also composites each glyph as a layer), so this is a tolerance gate,
built to fail on the wrong text, place or colour rather than on two scalers disagreeing:

- **lines**: the ink split into horizontal bands; the same number, each band's ink box within
  1.5 CSS px of the browser's on every edge (extent, centring, baseline, size, how far a wave
  has got);
- **shape**: both blurred by a CSS pixel, the difference averaged over a 7×7-CSS-px window, the
  worst window at most 38 of 255. Two scalers spread their disagreement thinly along every edge;
  a wrong letter, a missing outline or a misplaced glyph concentrates it;
- **colour**: each band's mean fill colour within 10 of 255 per channel.

`--self-test` also draws each case wrong — one letter changed, the text two device pixels low,
the speaker colour's channels swapped, the text 6% larger, no outline, and (mid-wave) the clock a
tick late — and fails unless every one is rejected. Measured on an M-series Mac:

| case | what it covers | box | local Δ | colour Δ |
| --- | --- | --- | --- | --- |
| two-speakers | Czech diacritics, both fish's colours | 0 | 17.8 | 3.7 |
| wrapped | a room as big as the stage: long lines wrapped and stacked, each message fitted smaller; a digit-coded speaker | 1 | 24.8 | 5.2 |
| quotes | `"` and `` ` `` drawn as … and ’ | 1 | 20.7 | 3.0 |
| wave | mid-wave, letter by letter | 0 | 14.6 | 3.0 |
| narrow | the narrowest room (285 px), wrapped to its width | 0 | 19.4 | 4.0 |
| retina | two speakers at 2 pixels a point | 0.5 | 29.6 | 0.3 |
| freesans | the original FreeSans Bold (a face with a line gap) | 1 | 21.1 | 4.2 |

The wrong frames measure at least local Δ 47.1 (one letter, `o`→`e`), colour Δ 35.3 or box
2 px: 36 of 36 caught. What it cannot see: a colour wrong by less than ~10/255, and anything
the two rasterisers would both draw (it is not a check of the fonts themselves). CI runs it,
with the self-test, after the map comparison.

## What it does not do yet

- **Menus (Options, Credits, the intro), the panel, sound, video.** The map's corner buttons
  are therefore not selectable. A room's dialogue runs and is subtitled (scripts wait on it
  as they do in the browser), but every line lasts the browser's fallback for a line without
  audio (`DEFAULT_LINE_TICKS`) and is not heard. With no Options screen, the subtitle mode and
  face can only come from the store.
  Room entry takes the path the browser's boot load does: art and room data only. Sound is
  the `AudioBackend` in `src/audio/audioBackend.ts` to implement: the policy in
  `src/audio/audio.ts` already talks to nothing else, and that file says what a mixer has to
  match.
- **KUFRIK's briefcase cutscene and its tutorial demonstration.** The room plays; the
  demonstration is not shown.
- **Talking heads.** The fish blink and a dark room's silhouettes wink out (that is
  `logicTick`'s `tickBlink`, which now runs), but the mouths follow the audio's lip sync,
  and there is no audio.
- **Cheats** (no way to type one), the fishing hooks they enable, and haptics.
- **Quitting** is closing the window: on the map Ⓑ does nothing, by design, and Esc is the
  same key. On tvOS the system's Home and Back will own it.
- **The Siri Remote** (the controller spec's part B): the map and the panel would already
  work from its d-pad and click, but the room's one-handed scheme and the pause menu are
  not built.
- The host queues at most 128 key transitions between two frames and drops the rest. A
  human cannot get near that in one frame; a long stall with keys being pressed throughout
  could, and would lose key-ups.
- A gated check of LODE's wreck in `compare.mjs`. It runs natively (the smoke gate plays
  LODE to the end), but `compare.mjs` never reaches it: the first swap is at tick 3770,
  after the whole recorded solution. A one-off run of the same harness at ticks 3780 and
  3900 was byte-identical. Each run starts a fresh process, so the in-place patch upload
  (one revision behind) is not exercised there.
- The shaders are MSL only. For D3D12 or Vulkan they would be written once in HLSL and
  translated with `SDL_shadercross`.
